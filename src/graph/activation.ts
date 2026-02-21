import type Database from 'better-sqlite3';
import { getDb } from '../db/connection.js';

/**
 * Calculate a recency bonus multiplier based on how recently the node was last accessed.
 * Returns 1.0 if accessed within the last day, scaling down to 0.1 for very old access.
 */
function recencyBonus(lastAccessedAt: string | null): number {
  if (!lastAccessedAt) {
    // Never accessed before — treat as moderate recency
    return 0.5;
  }

  const now = Date.now();
  const lastAccess = new Date(lastAccessedAt).getTime();
  const hoursSinceAccess = (now - lastAccess) / (1000 * 60 * 60);

  if (hoursSinceAccess < 24) return 1.0;
  if (hoursSinceAccess < 24 * 7) return 0.8;
  if (hoursSinceAccess < 24 * 30) return 0.5;
  if (hoursSinceAccess < 24 * 90) return 0.3;
  return 0.1;
}

/**
 * Bump a node's activation score on access.
 * Formula: activation = activation + (1.0 * recencyBonus)
 * Also updates last_accessed_at and increments access_count.
 */
export function bumpActivation(nodeId: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const row = db
    .prepare('SELECT activation, last_accessed_at FROM nodes WHERE id = ?')
    .get(nodeId) as { activation: number; last_accessed_at: string | null } | undefined;

  if (!row) return;

  const bonus = recencyBonus(row.last_accessed_at);
  const newActivation = row.activation + 1.0 * bonus;

  db.prepare(
    'UPDATE nodes SET activation = ?, last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?'
  ).run(newActivation, now, nodeId);
}

/**
 * Periodic activation decay sweep, intended for the Archivist.
 * For each node: activation = activation * decay_factor ^ months_since_last_access
 * decay_factor = 0.95 for active nodes, 0.90 for superseded.
 * Floor at 0.01.
 * Returns the count of nodes that were decayed.
 */
export function decayActivation(db?: Database.Database): { decayed: number } {
  db = db ?? getDb();
  const now = Date.now();

  const rows = db
    .prepare('SELECT id, activation, status, last_accessed_at, created_at FROM nodes')
    .all() as {
      id: string;
      activation: number;
      status: string;
      last_accessed_at: string | null;
      created_at: string;
    }[];

  const update = db.prepare('UPDATE nodes SET activation = ? WHERE id = ?');
  let decayed = 0;

  const applyDecay = db.transaction(() => {
    for (const row of rows) {
      const referenceTime = row.last_accessed_at ?? row.created_at;
      const msSinceAccess = now - new Date(referenceTime).getTime();
      const monthsSinceAccess = msSinceAccess / (1000 * 60 * 60 * 24 * 30);

      const decayFactor = row.status === 'superseded' ? 0.90 : 0.95;
      let newActivation = row.activation * Math.pow(decayFactor, monthsSinceAccess);

      // Floor at 0.01
      if (newActivation < 0.01) {
        newActivation = 0.01;
      }

      // Only update if the value actually changed (avoid unnecessary writes)
      if (Math.abs(newActivation - row.activation) > 1e-9) {
        update.run(newActivation, row.id);
        decayed++;
      }
    }
  });

  applyDecay();

  return { decayed };
}
