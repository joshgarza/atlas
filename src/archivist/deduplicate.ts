import { getDb } from '../db/connection.js';
import { createEvent } from '../events.js';
import { updateNode } from '../graph/nodes.js';
import { createEdge, getEdgesByNode } from '../graph/edges.js';
import { attenuate } from './attenuate.js';
import { getReasoningProvider, type DuplicatePair } from '../model-providers.js';

export type { DuplicatePair } from '../model-providers.js';

export interface DeduplicationResult {
  candidatesFound: number;
  mergesPerformed: number;
  mergedPairs: Array<{ keepId: string; removedId: string; reason: string }>;
  skipped: boolean;
}

/**
 * Send node summaries to the configured reasoning provider to identify
 * semantic duplicates.
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
  return getReasoningProvider().findDuplicates(nodes);
}

/**
 * Merge two nodes: combine content from removeNode into keepNode,
 * merge tags and metadata, redirect edges, then attenuate removeNode.
 */
function mergeNodes(keepId: string, removeId: string, reason: string): void {
  const db = getDb();

  const doMerge = db.transaction(() => {
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
  });

  doMerge();
}

/**
 * Run a full deduplication cycle:
 * 1. Fetch all active nodes
 * 2. Use the configured reasoning provider to identify semantic duplicates
 * 3. Merge confirmed duplicate pairs
 *
 * Skips gracefully when the configured reasoning provider is unavailable.
 */
export async function runDeduplication(): Promise<DeduplicationResult> {
  const reasoningProvider = getReasoningProvider();
  if (!reasoningProvider.isAvailable()) {
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

  // Send to Claude in overlapping batches to find duplicates.
  // Overlap ensures nodes near batch boundaries are compared together.
  const BATCH_SIZE = 50;
  const STRIDE = Math.floor(BATCH_SIZE / 2);
  const allPairs: DuplicatePair[] = [];
  const seenPairKeys = new Set<string>();

  for (let i = 0; i < rows.length; i += STRIDE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    if (batch.length < 2) break;
    const pairs = await findDuplicates(batch);
    for (const pair of pairs) {
      const key = [pair.keepId, pair.removeId].sort().join(':');
      if (!seenPairKeys.has(key)) {
        seenPairKeys.add(key);
        allPairs.push(pair);
      }
    }
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
