import { ulid } from 'ulid';
import { getDb } from '../db/connection.js';
import type { Edge, CreateEdgeInput } from '../types.js';

/** Parse a raw DB row into an Edge, handling JSON metadata. */
function parseEdgeRow(row: Record<string, unknown>): Edge {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  } as Edge;
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

export function getEdge(id: string): Edge | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;

  if (!row) return null;
  return parseEdgeRow(row);
}
