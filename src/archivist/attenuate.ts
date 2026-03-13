import { getDb } from '../db/connection.js';
import { createEvent } from '../events.js';
import { createEdge } from '../graph/edges.js';

export interface AttenuateResult {
  nodeId: string;
  previousActivation: number;
  newActivation: number;
  replacementEdgeCreated: boolean;
}

/**
 * Targeted attenuation of a node's activation.
 *
 * Unlike periodic decay, this is an intentional action:
 * - Marks the node as superseded
 * - Reduces activation by half (multiply by 0.5)
 * - Logs an archivist_action event
 * - Optionally creates a supersedes edge to a replacement node
 */
export function attenuate(
  nodeId: string,
  reason: string,
  replacementNodeId?: string,
): AttenuateResult {
  const db = getDb();
  const doAttenuation = db.transaction(() => {
    // Wrap the full semantic action so callers can safely nest attenuate()
    // inside larger archivist transactions without committing partial state.
    const node = db
      .prepare('SELECT id, activation, status FROM nodes WHERE id = ?')
      .get(nodeId) as { id: string; activation: number; status: string } | undefined;

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const previousActivation = node.activation;
    const newActivation = Math.max(node.activation * 0.5, 0.01);

    db.prepare(
      `UPDATE nodes SET
         status = 'superseded',
         activation = ?,
         superseded_by = ?,
         updated_at = ?
       WHERE id = ?`
    ).run(
      newActivation,
      replacementNodeId ?? null,
      new Date().toISOString(),
      nodeId,
    );

    createEvent({
      type: 'archivist_action',
      source: 'archivist/attenuate',
      content: JSON.stringify({
        action: 'attenuate',
        node_id: nodeId,
        reason,
        previous_activation: previousActivation,
        new_activation: newActivation,
        replacement_node_id: replacementNodeId ?? null,
      }),
    });

    let replacementEdgeCreated = false;
    if (replacementNodeId) {
      createEdge({
        source_id: replacementNodeId,
        target_id: nodeId,
        type: 'supersedes',
        metadata: { reason },
      });
      replacementEdgeCreated = true;
    }

    return {
      nodeId,
      previousActivation,
      newActivation,
      replacementEdgeCreated,
    };
  });

  return doAttenuation();
}
