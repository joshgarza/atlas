import { getDb } from '../db/connection.js';
import { createEvent } from '../events.js';
import { createEdge } from '../graph/edges.js';
import { searchNodes } from '../graph/query.js';
import type { Node, EdgeType } from '../types.js';
import { getReasoningProvider, type EdgeProposal } from '../model-providers.js';

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

  const reasoningProvider = getReasoningProvider();
  if (!reasoningProvider.isAvailable()) {
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
      proposals = await reasoningProvider.inferEdges(node, candidates);
    } catch (err) {
      createEvent({
        type: 'archivist_action',
        source: 'archivist/infer-edges',
        content: JSON.stringify({
          action: 'inference_error',
          node_id: nodeId,
          error: err instanceof Error ? err.message : String(err),
        }),
      });
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
