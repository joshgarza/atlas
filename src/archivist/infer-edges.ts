import { getDb } from '../db/connection.js';
import { createEvent } from '../events.js';
import { createEdge } from '../graph/edges.js';
import { searchNodes } from '../graph/query.js';
import type { Node, EdgeType } from '../types.js';

export interface InferEdgesResult {
  analyzed: number;
  edgesCreated: number;
  edgesFlagged: number;
  skipped: number;
}

export interface InferEdgesConfig {
  /** Minimum confidence to auto-create an edge (0–1). Default: 0.7 */
  confidenceThreshold?: number;
  /** Maximum candidate nodes to send per inference call. Default: 10 */
  maxCandidates?: number;
}

/** A single edge proposal returned by Claude. */
interface EdgeProposal {
  target_id: string;
  type: EdgeType;
  confidence: number;
  reason: string;
}

const VALID_EDGE_TYPES: Set<string> = new Set([
  'supports', 'contradicts', 'derived_from', 'related_to', 'supersedes', 'part_of',
]);

/**
 * Call the Anthropic Messages API to infer relationships between a node
 * and a set of candidate nodes.
 */
async function callClaude(
  node: Node,
  candidates: Array<{ id: string; title: string; content: string; type: string }>,
): Promise<EdgeProposal[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const prompt = buildPrompt(node, candidates);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const text = data.content.find((b) => b.type === 'text')?.text ?? '';
  return parseEdgeProposals(text, candidates);
}

function buildPrompt(
  node: Node,
  candidates: Array<{ id: string; title: string; content: string; type: string }>,
): string {
  const candidateList = candidates
    .map(
      (c) =>
        `- ID: ${c.id}\n  Title: ${c.title}\n  Type: ${c.type}\n  Content: ${c.content.slice(0, 300)}`,
    )
    .join('\n');

  return `You are the Archivist of a personal knowledge graph. Your task is to identify semantic relationships between a new node and existing nodes.

## New node
- Title: ${node.title}
- Type: ${node.type}
- Content: ${node.content.slice(0, 500)}

## Candidate nodes
${candidateList}

## Edge types
- supports: the new node provides evidence for or reinforces the candidate
- contradicts: the new node conflicts with the candidate
- derived_from: the new node is derived from or builds on the candidate
- related_to: the nodes share a topic or theme
- part_of: the new node is a component or subset of the candidate

## Instructions
Analyze the new node against each candidate. Return ONLY a JSON array of proposed edges. Each edge object must have:
- "target_id": the candidate node ID
- "type": one of the edge types above
- "confidence": a number from 0.0 to 1.0
- "reason": a brief explanation (one sentence)

Only propose edges where there is a meaningful semantic relationship. If no relationships exist, return an empty array.

Respond with ONLY the JSON array, no other text.`;
}

/**
 * Parse Claude's response into validated edge proposals.
 * Silently drops malformed entries.
 */
function parseEdgeProposals(
  text: string,
  candidates: Array<{ id: string }>,
): EdgeProposal[] {
  const candidateIds = new Set(candidates.map((c) => c.id));

  // Extract JSON array from response (may be wrapped in markdown code fences)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed: unknown[];
  try {
    parsed = JSON.parse(jsonMatch[0]) as unknown[];
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const proposals: EdgeProposal[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;

    const target_id = obj.target_id;
    const type = obj.type;
    const confidence = obj.confidence;
    const reason = obj.reason;

    if (typeof target_id !== 'string' || !candidateIds.has(target_id)) continue;
    if (typeof type !== 'string' || !VALID_EDGE_TYPES.has(type)) continue;
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) continue;
    if (typeof reason !== 'string') continue;

    proposals.push({
      target_id,
      type: type as EdgeType,
      confidence,
      reason,
    });
  }

  return proposals;
}

/**
 * Analyze newly created/updated nodes and infer edges based on semantic
 * relationships. High-confidence edges are auto-created; low-confidence
 * edges are flagged as events for review.
 */
export async function inferEdges(
  nodeIds: string[],
  config?: InferEdgesConfig,
): Promise<InferEdgesResult> {
  const threshold = config?.confidenceThreshold ?? 0.7;
  const maxCandidates = config?.maxCandidates ?? 10;

  const result: InferEdgesResult = {
    analyzed: 0,
    edgesCreated: 0,
    edgesFlagged: 0,
    skipped: 0,
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    result.skipped = nodeIds.length;
    return result;
  }

  const db = getDb();

  for (const nodeId of nodeIds) {
    const row = db
      .prepare('SELECT * FROM nodes WHERE id = ?')
      .get(nodeId) as (Record<string, unknown>) | undefined;

    if (!row) {
      result.skipped++;
      continue;
    }

    const node: Node = {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    } as Node;

    // Find candidate nodes via FTS search on the node's title
    let candidates: Array<{ id: string; title: string; content: string; type: string }> = [];
    try {
      const searchResults = searchNodes(node.title, maxCandidates + 1);
      candidates = searchResults
        .filter((n) => n.id !== nodeId)
        .slice(0, maxCandidates)
        .map((n) => ({ id: n.id, title: n.title, content: n.content, type: n.type }));
    } catch {
      // FTS failed — skip this node
      result.skipped++;
      continue;
    }

    if (candidates.length === 0) {
      result.skipped++;
      continue;
    }

    // Check for existing edges to avoid duplicates
    const existingEdges = db
      .prepare('SELECT source_id, target_id FROM edges WHERE source_id = ? OR target_id = ?')
      .all(nodeId, nodeId) as Array<{ source_id: string; target_id: string }>;

    const connectedIds = new Set(
      existingEdges.map((e) => (e.source_id === nodeId ? e.target_id : e.source_id)),
    );

    // Remove already-connected nodes from candidates
    candidates = candidates.filter((c) => !connectedIds.has(c.id));
    if (candidates.length === 0) {
      result.skipped++;
      continue;
    }

    let proposals: EdgeProposal[];
    try {
      proposals = await callClaude(node, candidates);
    } catch {
      result.skipped++;
      continue;
    }

    result.analyzed++;

    for (const proposal of proposals) {
      if (proposal.confidence >= threshold) {
        // Auto-create high-confidence edge
        createEdge({
          source_id: nodeId,
          target_id: proposal.target_id,
          type: proposal.type,
          weight: proposal.confidence,
          metadata: {
            inferred: true,
            confidence: proposal.confidence,
            reason: proposal.reason,
          },
        });
        result.edgesCreated++;

        createEvent({
          type: 'archivist_action',
          source: 'archivist/infer-edges',
          content: JSON.stringify({
            action: 'create_edge',
            source_id: nodeId,
            target_id: proposal.target_id,
            edge_type: proposal.type,
            confidence: proposal.confidence,
            reason: proposal.reason,
          }),
        });
      } else {
        // Flag low-confidence edge for review
        result.edgesFlagged++;

        createEvent({
          type: 'archivist_action',
          source: 'archivist/infer-edges',
          content: JSON.stringify({
            action: 'flag_edge',
            source_id: nodeId,
            target_id: proposal.target_id,
            edge_type: proposal.type,
            confidence: proposal.confidence,
            reason: proposal.reason,
          }),
        });
      }
    }
  }

  return result;
}
