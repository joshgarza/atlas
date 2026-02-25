import { getDb } from '../db/connection.js';
import { createEvent } from '../events.js';
import { updateNode } from '../graph/nodes.js';
import { createEdge, getEdgesByNode } from '../graph/edges.js';
import { attenuate } from './attenuate.js';

export interface DuplicatePair {
  keepId: string;
  removeId: string;
  reason: string;
}

export interface DeduplicationResult {
  candidatesFound: number;
  mergesPerformed: number;
  mergedPairs: Array<{ keepId: string; removedId: string; reason: string }>;
  skipped: boolean;
}

/**
 * Call the Anthropic API for semantic similarity analysis.
 * Uses built-in fetch to avoid adding dependencies.
 */
async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required for deduplication');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content[0].text;
}

/**
 * Send node summaries to Claude to identify semantic duplicates.
 * Returns pairs of node IDs that represent the same concept.
 */
async function findDuplicates(
  nodes: Array<{
    id: string;
    title: string;
    type: string;
    content: string;
    activation: number;
  }>,
): Promise<DuplicatePair[]> {
  if (nodes.length < 2) return [];

  const summaries = nodes.map((n) => {
    const snippet =
      n.content.length > 200 ? n.content.slice(0, 200) + '...' : n.content;
    return `- [${n.id}] "${n.title}" (type: ${n.type}, activation: ${n.activation.toFixed(2)})\n  Content: ${snippet}`;
  });

  const prompt = `You are analyzing a knowledge graph for near-duplicate nodes — nodes that represent the same concept but with different phrasing, abbreviations, or minor variations.

Given these nodes:
${summaries.join('\n')}

Identify pairs that are near-duplicates (same underlying concept, different phrasing). For each pair, choose which node to KEEP (prefer higher activation, more content, or better title) and which to REMOVE (merge into the kept node).

Return ONLY a JSON array. No explanation, no markdown fencing. Example:
[{"keepId":"abc","removeId":"xyz","reason":"Both describe the same concept"}]

If no duplicates exist, return: []

Important:
- Only flag true duplicates (same concept, different words). Related but distinct concepts are NOT duplicates.
- Be conservative — only flag pairs you are confident about.`;

  const response = await callClaude(prompt);

  // Parse JSON from response (handle potential markdown fencing)
  const cleaned = response
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    const pairs = JSON.parse(cleaned) as DuplicatePair[];
    return pairs.filter(
      (p) =>
        typeof p.keepId === 'string' &&
        typeof p.removeId === 'string' &&
        typeof p.reason === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Merge two nodes: combine content from removeNode into keepNode,
 * merge tags and metadata, redirect edges, then attenuate removeNode.
 */
function mergeNodes(keepId: string, removeId: string, reason: string): void {
  const db = getDb();

  const keepRow = db
    .prepare('SELECT * FROM nodes WHERE id = ?')
    .get(keepId) as Record<string, unknown> | undefined;
  const removeRow = db
    .prepare('SELECT * FROM nodes WHERE id = ?')
    .get(removeId) as Record<string, unknown> | undefined;

  if (!keepRow || !removeRow) {
    throw new Error(
      `Cannot merge: node not found (keep=${keepId}, remove=${removeId})`,
    );
  }

  // Merge tags
  const keepTags = db
    .prepare('SELECT tag FROM node_tags WHERE node_id = ?')
    .all(keepId) as { tag: string }[];
  const removeTags = db
    .prepare('SELECT tag FROM node_tags WHERE node_id = ?')
    .all(removeId) as { tag: string }[];
  const mergedTags = [
    ...new Set([
      ...keepTags.map((t) => t.tag),
      ...removeTags.map((t) => t.tag),
    ]),
  ];

  // Merge content
  const mergedContent = `${keepRow.content as string}\n\n---\n\n${removeRow.content as string}`;

  // Merge metadata
  const keepMeta = keepRow.metadata
    ? JSON.parse(keepRow.metadata as string)
    : {};
  const removeMeta = removeRow.metadata
    ? JSON.parse(removeRow.metadata as string)
    : {};
  const mergedMeta = {
    ...keepMeta,
    merged_from: [...(keepMeta.merged_from ?? []), removeId],
    merge_sources_metadata: {
      ...(keepMeta.merge_sources_metadata ?? {}),
      [removeId]: removeMeta,
    },
  };

  // Update the keep node with merged content
  updateNode(keepId, {
    content: mergedContent,
    tags: mergedTags,
    metadata: mergedMeta,
    change_reason: `Merged duplicate node ${removeId}: ${reason}`,
    changed_by: 'archivist/deduplicate',
  });

  // Redirect edges from removeNode to keepNode
  const removeEdges = getEdgesByNode(removeId);
  const keepEdges = getEdgesByNode(keepId);

  for (const edge of removeEdges) {
    if (edge.type === 'supersedes') continue;

    const otherNodeId =
      edge.source_id === removeId ? edge.target_id : edge.source_id;
    if (otherNodeId === keepId) continue;

    // Check if keepNode already has a similar edge
    const alreadyExists = keepEdges.some((ke) => {
      const keepOtherId =
        ke.source_id === keepId ? ke.target_id : ke.source_id;
      return keepOtherId === otherNodeId && ke.type === edge.type;
    });

    if (!alreadyExists) {
      const isSource = edge.source_id === removeId;
      createEdge({
        source_id: isSource ? keepId : otherNodeId,
        target_id: isSource ? otherNodeId : keepId,
        type: edge.type,
        weight: edge.weight,
        metadata: { ...(edge.metadata ?? {}), redirected_from: removeId },
      });
    }
  }

  // Attenuate the removed node (marks superseded, creates supersedes edge)
  attenuate(removeId, reason, keepId);

  // Log the merge action
  createEvent({
    type: 'archivist_action',
    source: 'archivist/deduplicate',
    content: JSON.stringify({
      action: 'merge',
      keep_node_id: keepId,
      removed_node_id: removeId,
      reason,
    }),
  });
}

/**
 * Run a full deduplication cycle:
 * 1. Fetch all active nodes
 * 2. Use Claude to identify semantic duplicates (beyond FTS matching)
 * 3. Merge confirmed duplicate pairs
 *
 * Requires ANTHROPIC_API_KEY. Skips gracefully if not set.
 */
export async function runDeduplication(): Promise<DeduplicationResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { candidatesFound: 0, mergesPerformed: 0, mergedPairs: [], skipped: true };
  }

  const db = getDb();

  const rows = db
    .prepare(
      `SELECT id, title, type, content, activation FROM nodes
       WHERE status = 'active'
       ORDER BY activation DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    type: string;
    content: string;
    activation: number;
  }>;

  if (rows.length < 2) {
    return { candidatesFound: 0, mergesPerformed: 0, mergedPairs: [], skipped: false };
  }

  // Send to Claude in batches to find duplicates
  const BATCH_SIZE = 50;
  const allPairs: DuplicatePair[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const pairs = await findDuplicates(batch);
    allPairs.push(...pairs);
  }

  // Validate that all referenced node IDs exist in our active set
  const activeIds = new Set(rows.map((r) => r.id));
  const validPairs = allPairs.filter(
    (p) =>
      activeIds.has(p.keepId) &&
      activeIds.has(p.removeId) &&
      p.keepId !== p.removeId,
  );

  // A node should only be merged once per cycle
  const merged = new Set<string>();
  const mergedPairs: Array<{
    keepId: string;
    removedId: string;
    reason: string;
  }> = [];

  for (const pair of validPairs) {
    if (merged.has(pair.keepId) || merged.has(pair.removeId)) continue;

    try {
      mergeNodes(pair.keepId, pair.removeId, pair.reason);
      merged.add(pair.removeId);
      mergedPairs.push({
        keepId: pair.keepId,
        removedId: pair.removeId,
        reason: pair.reason,
      });
    } catch (err) {
      createEvent({
        type: 'archivist_action',
        source: 'archivist/deduplicate',
        content: JSON.stringify({
          action: 'merge_failed',
          keep_node_id: pair.keepId,
          removed_node_id: pair.removeId,
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  }

  return {
    candidatesFound: validPairs.length,
    mergesPerformed: mergedPairs.length,
    mergedPairs,
    skipped: false,
  };
}
