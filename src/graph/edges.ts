import { ulid } from 'ulid';
import { getDb } from '../db/connection.js';
import type { Edge, EdgeWithOtherNode, CreateEdgeInput, UpdateEdgeInput, EdgeType } from '../types.js';

/** Parse a raw DB row into an Edge, handling JSON metadata. */
function parseEdgeRow(row: Record<string, unknown>): Edge {
  return {
    id: row.id as string,
    source_id: row.source_id as string,
    target_id: row.target_id as string,
    type: row.type as EdgeType,
    weight: row.weight as number,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    created_at: row.created_at as string,
  };
}

export function createEdge(input: CreateEdgeInput): Edge {
  const db = getDb();
  const id = ulid();
  const now = new Date().toISOString();

  // Validate both nodes exist
  const sourceExists = db.prepare('SELECT id FROM nodes WHERE id = ?').get(input.source_id);
  if (!sourceExists) {
    throw new Error(`Source node not found: ${input.source_id}`);
  }
  const targetExists = db.prepare('SELECT id FROM nodes WHERE id = ?').get(input.target_id);
  if (!targetExists) {
    throw new Error(`Target node not found: ${input.target_id}`);
  }

  db.prepare(
    `INSERT INTO edges (id, source_id, target_id, type, weight, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.source_id,
    input.target_id,
    input.type,
    input.weight ?? 1.0,
    input.metadata ? JSON.stringify(input.metadata) : null,
    now,
  );

  const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as Record<string, unknown>;
  return parseEdgeRow(row);
}

export function getEdgesByNode(nodeId: string): Edge[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM edges WHERE source_id = ? OR target_id = ? ORDER BY created_at DESC')
    .all(nodeId, nodeId) as Record<string, unknown>[];

  return rows.map(parseEdgeRow);
}

export function getEdgesByNodeWithOtherNode(nodeId: string): EdgeWithOtherNode[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         edges.*,
         other.id AS other_node_id,
         other.title AS other_node_title
       FROM edges
       LEFT JOIN nodes AS other
         ON other.id = CASE
           WHEN edges.source_id = ? THEN edges.target_id
           ELSE edges.source_id
         END
       WHERE edges.source_id = ? OR edges.target_id = ?
       ORDER BY edges.created_at DESC`
    )
    .all(nodeId, nodeId, nodeId) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...parseEdgeRow(row),
    other_node: row.other_node_id
      ? {
          id: row.other_node_id as string,
          title: row.other_node_title as string,
        }
      : null,
  }));
}

export function getEdge(id: string): Edge | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;

  if (!row) return null;
  return parseEdgeRow(row);
}

export function listEdges(opts?: { type?: EdgeType; limit?: number; offset?: number }): Edge[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.type) {
    conditions.push('type = ?');
    params.push(opts.type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;

  const rows = db
    .prepare(`SELECT * FROM edges ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(parseEdgeRow);
}

export function updateEdge(id: string, input: UpdateEdgeInput): Edge {
  const db = getDb();

  const existing = db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    throw new Error(`Edge not found: ${id}`);
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.type !== undefined) {
    sets.push('type = ?');
    params.push(input.type);
  }
  if (input.weight !== undefined) {
    sets.push('weight = ?');
    params.push(input.weight);
  }
  if (input.metadata !== undefined) {
    sets.push('metadata = ?');
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) {
    return parseEdgeRow(existing);
  }

  params.push(id);
  db.prepare(`UPDATE edges SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as Record<string, unknown>;
  return parseEdgeRow(row);
}

export function deleteEdge(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM edges WHERE id = ?').run(id);
  return result.changes > 0;
}
