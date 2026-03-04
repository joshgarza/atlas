import { getDb } from '../db/connection.js';
import { getNodeTags } from './nodes.js';
import { generateEmbedding } from './embeddings.js';
import type { Node, SearchFilters } from '../types.js';
import type { NodeWithTags } from './nodes.js';

export interface SemanticSearchResult extends NodeWithTags {
  similarity: number;
}

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
 * Advanced search with filtering, sorting, and optional FTS query.
 * Supports: type, status, activation range, date ranges, tags, configurable sort.
 */
export function advancedSearch(filters: SearchFilters): NodeWithTags[] {
  const db = getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];
  let usesFts = false;

  // Full-text search
  if (filters.q) {
    usesFts = true;
    const quoted = `"${filters.q.replace(/"/g, '""')}"`;
    conditions.push('nodes_fts MATCH ?');
    params.push(quoted);
  }

  // Type filter
  if (filters.type) {
    conditions.push('nodes.type = ?');
    params.push(filters.type);
  }

  // Status filter
  if (filters.status) {
    conditions.push('nodes.status = ?');
    params.push(filters.status);
  }

  // Activation range
  if (filters.activation_min !== undefined) {
    conditions.push('nodes.activation >= ?');
    params.push(filters.activation_min);
  }
  if (filters.activation_max !== undefined) {
    conditions.push('nodes.activation <= ?');
    params.push(filters.activation_max);
  }

  // Date range: created_at
  if (filters.created_after) {
    conditions.push('nodes.created_at >= ?');
    params.push(filters.created_after);
  }
  if (filters.created_before) {
    conditions.push('nodes.created_at <= ?');
    params.push(filters.created_before);
  }

  // Date range: updated_at
  if (filters.updated_after) {
    conditions.push('nodes.updated_at >= ?');
    params.push(filters.updated_after);
  }
  if (filters.updated_before) {
    conditions.push('nodes.updated_at <= ?');
    params.push(filters.updated_before);
  }

  // Tags filter (nodes must have ALL specified tags)
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(
      `nodes.id IN (
        SELECT node_id FROM node_tags WHERE tag IN (${filters.tags.map(() => '?').join(', ')})
        GROUP BY node_id HAVING COUNT(DISTINCT tag) = ?
      )`
    );
    params.push(...filters.tags, filters.tags.length);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Sort
  const order = filters.order === 'asc' ? 'ASC' : 'DESC';
  let orderBy: string;
  switch (filters.sort) {
    case 'activation':
      orderBy = `nodes.activation ${order}`;
      break;
    case 'recency':
      orderBy = `CASE WHEN nodes.last_accessed_at IS NOT NULL THEN nodes.last_accessed_at ELSE nodes.created_at END ${order}`;
      break;
    case 'created_at':
      orderBy = `nodes.created_at ${order}`;
      break;
    default:
      // If using FTS, default to relevance; otherwise created_at DESC
      orderBy = usesFts ? `rank, nodes.created_at DESC` : `nodes.created_at ${order}`;
      break;
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const from = usesFts
    ? `nodes_fts JOIN nodes ON nodes.rowid = nodes_fts.rowid`
    : `nodes`;

  const rows = db
    .prepare(`SELECT nodes.* FROM ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[];

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

/**
 * Semantic search over nodes using vector embeddings.
 * Embeds the query string via Voyage API, then performs KNN search via sqlite-vec.
 * Returns nodes ranked by cosine similarity.
 */
export async function semanticSearch(query: string, limit = 10): Promise<SemanticSearchResult[]> {
  const db = getDb();

  const queryEmbedding = await generateEmbedding(query);

  const rows = db
    .prepare(
      `SELECT node_id, distance FROM node_embeddings
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT ?`
    )
    .all(Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength), limit) as Array<{ node_id: string; distance: number }>;

  const results: SemanticSearchResult[] = [];
  for (const row of rows) {
    const nodeRow = db.prepare('SELECT * FROM nodes WHERE id = ?').get(row.node_id) as Record<string, unknown> | undefined;
    if (nodeRow) {
      const nodeWithTags = toNodeWithTags(nodeRow);
      results.push({ ...nodeWithTags, similarity: 1 - row.distance });
    }
  }

  return results;
}
