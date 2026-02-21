import { getDb } from '../db/connection.js';
import { createEvent } from '../events.js';
import { bumpActivation } from '../graph/activation.js';
import { getEdgesByNode } from '../graph/edges.js';

export interface ReinforceResult {
  nodeId: string;
  propagated: number;
}

/**
 * Strengthen activation of a node and propagate to connected nodes.
 *
 * - Bumps the target node's activation
 * - Logs an archivist_action event
 * - Slightly bumps connected nodes (propagation via edges)
 */
export function reinforce(nodeId: string, reason: string): ReinforceResult {
  const db = getDb();

  // Verify node exists
  const node = db.prepare('SELECT id FROM nodes WHERE id = ?').get(nodeId) as
    | { id: string }
    | undefined;
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  // Bump the primary node
  bumpActivation(nodeId);

  // Log the reinforcement
  createEvent({
    type: 'archivist_action',
    source: 'archivist/reinforce',
    content: JSON.stringify({
      action: 'reinforce',
      node_id: nodeId,
      reason,
    }),
  });

  // Propagate to connected nodes (lighter bump)
  const edges = getEdgesByNode(nodeId);
  const propagated = new Set<string>();

  for (const edge of edges) {
    const neighborId = edge.source_id === nodeId ? edge.target_id : edge.source_id;
    if (!propagated.has(neighborId)) {
      // Use a lighter bump — just update activation directly with a small boost
      const neighbor = db
        .prepare('SELECT activation FROM nodes WHERE id = ?')
        .get(neighborId) as { activation: number } | undefined;

      if (neighbor) {
        const boost = 0.2 * edge.weight;
        db.prepare('UPDATE nodes SET activation = ? WHERE id = ?').run(
          neighbor.activation + boost,
          neighborId,
        );
        propagated.add(neighborId);
      }
    }
  }

  return { nodeId, propagated: propagated.size };
}
