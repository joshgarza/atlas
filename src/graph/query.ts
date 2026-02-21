import { getDb } from '../db/connection.js';
import { getNodeTags } from './nodes.js';
import type { Node } from '../types.js';
import type { NodeWithTags } from './nodes.js';

/** Parse a raw DB row into a Node, handling JSON metadata. */
function parseNodeRow(row: Record<string, unknown>): Node {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  } as Node;
}

/** Convert a raw DB row into a NodeWithTags. */
function toNodeWithTags(row: Record<string, unknown>): NodeWithTags {
  const db = getDb();
  const node = parseNodeRow(row);
  return { ...node, tags: getNodeTags(db, node.id) };
}

/**
 * Full-text search over nodes using FTS5.
 * Returns nodes matching the query, ordered by relevance.
 */
export function searchNodes(query: string, limit = 20): NodeWithTags[] {
  const db = getDb();

  // Quote the query to prevent FTS5 syntax errors from special characters
  // (dashes, colons, slashes, etc. in titles/content)
  const quoted = `"${query.replace(/"/g, '""')}"`;

  const rows = db
    .prepare(
      `SELECT nodes.* FROM nodes_fts
       JOIN nodes ON nodes.rowid = nodes_fts.rowid
       WHERE nodes_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(quoted, limit) as Record<string, unknown>[];

  return rows.map(toNodeWithTags);
}

/**
 * BFS traversal from a given node through edges.
 * Returns connected nodes up to the specified depth (default 1).
 * Does not include the origin node itself.
 */
export function getRelatedNodes(nodeId: string, depth = 1): NodeWithTags[] {
  const db = getDb();

  const visited = new Set<string>();
  visited.add(nodeId);

  let frontier = [nodeId];

  for (let d = 0; d < depth; d++) {
    const nextFrontier: string[] = [];

    for (const currentId of frontier) {
      const edges = db
        .prepare('SELECT source_id, target_id FROM edges WHERE source_id = ? OR target_id = ?')
        .all(currentId, currentId) as { source_id: string; target_id: string }[];

      for (const edge of edges) {
        const neighborId = edge.source_id === currentId ? edge.target_id : edge.source_id;
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          nextFrontier.push(neighborId);
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // Remove the origin node from visited set to get only related nodes
  visited.delete(nodeId);

  if (visited.size === 0) return [];

  // Fetch all discovered nodes
  const placeholders = Array.from(visited).map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
    .all(...visited) as Record<string, unknown>[];

  return rows.map(toNodeWithTags);
}

/**
 * Get recently accessed/created nodes.
 * Ordered by last_accessed_at DESC (nulls last), then created_at DESC.
 */
export function getRecentNodes(limit = 20): NodeWithTags[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT * FROM nodes
       ORDER BY
         CASE WHEN last_accessed_at IS NOT NULL THEN last_accessed_at ELSE created_at END DESC
       LIMIT ?`
    )
    .all(limit) as Record<string, unknown>[];

  return rows.map(toNodeWithTags);
}
