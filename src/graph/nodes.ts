import { ulid } from 'ulid';
import type Database from 'better-sqlite3';
import { getDb } from '../db/connection.js';
import { bumpActivation } from './activation.js';
import type {
  Node,
  NodeHistory,
  NodeType,
  NodeStatus,
  CreateNodeInput,
  UpdateNodeInput,
} from '../types.js';

export interface NodeWithTags extends Node {
  tags: string[];
}

/** Fetch tags for a node from the node_tags table. */
export function getNodeTags(db: Database.Database, nodeId: string): string[] {
  const rows = db
    .prepare('SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag')
    .all(nodeId) as { tag: string }[];
  return rows.map((r) => r.tag);
}

/** Parse a raw DB row into a Node, handling JSON metadata. */
function parseNodeRow(row: Record<string, unknown>): Node {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  } as Node;
}

/** Parse a raw DB row into a NodeWithTags. */
function toNodeWithTags(db: Database.Database, row: Record<string, unknown>): NodeWithTags {
  const node = parseNodeRow(row);
  return { ...node, tags: getNodeTags(db, node.id) };
}

export function createNode(input: CreateNodeInput): NodeWithTags {
  const db = getDb();
  const id = ulid();
  const now = new Date().toISOString();

  const node = db.transaction(() => {
    db.prepare(
      `INSERT INTO nodes (id, type, title, content, granularity, activation, status, version, created_at, updated_at, access_count, metadata)
       VALUES (?, ?, ?, ?, ?, 1.0, 'active', 1, ?, ?, 0, ?)`
    ).run(
      id,
      input.type,
      input.title,
      input.content,
      input.granularity,
      now,
      now,
      input.metadata ? JSON.stringify(input.metadata) : null,
    );

    if (input.tags && input.tags.length > 0) {
      const insertTag = db.prepare(
        'INSERT INTO node_tags (node_id, tag) VALUES (?, ?)'
      );
      for (const tag of input.tags) {
        insertTag.run(id, tag);
      }
    }

    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown>;
    return toNodeWithTags(db, row);
  })();

  return node;
}

export function getNode(id: string, peek = false): NodeWithTags | null {
  const db = getDb();

  // Check existence first
  const exists = db.prepare('SELECT id FROM nodes WHERE id = ?').get(id);
  if (!exists) return null;

  if (!peek) {
    bumpActivation(id);
  }

  // Read after bump so returned data reflects updated activation
  const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown>;
  return toNodeWithTags(db, row);
}

export function updateNode(id: string, input: UpdateNodeInput): NodeWithTags {
  const db = getDb();

  const updated = db.transaction(() => {
    // Fetch current node
    const current = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!current) {
      throw new Error(`Node not found: ${id}`);
    }

    // Save current version to node_history
    const historyId = ulid();
    db.prepare(
      `INSERT INTO node_history (id, node_id, version, title, content, change_reason, changed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      historyId,
      id,
      current.version,
      current.title,
      current.content,
      input.change_reason ?? null,
      input.changed_by ?? null,
      new Date().toISOString(),
    );

    // Build update fields
    const now = new Date().toISOString();
    const newVersion = (current.version as number) + 1;

    const fields: string[] = ['version = ?', 'updated_at = ?'];
    const values: unknown[] = [newVersion, now];

    if (input.title !== undefined) {
      fields.push('title = ?');
      values.push(input.title);
    }
    if (input.content !== undefined) {
      fields.push('content = ?');
      values.push(input.content);
    }
    if (input.granularity !== undefined) {
      fields.push('granularity = ?');
      values.push(input.granularity);
    }
    if (input.type !== undefined) {
      fields.push('type = ?');
      values.push(input.type);
    }
    if (input.status !== undefined) {
      fields.push('status = ?');
      values.push(input.status);
    }
    if (input.superseded_by !== undefined) {
      fields.push('superseded_by = ?');
      values.push(input.superseded_by);
    }
    if (input.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }

    values.push(id);
    db.prepare(`UPDATE nodes SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    // Replace tags if provided
    if (input.tags !== undefined) {
      db.prepare('DELETE FROM node_tags WHERE node_id = ?').run(id);
      const insertTag = db.prepare(
        'INSERT INTO node_tags (node_id, tag) VALUES (?, ?)'
      );
      for (const tag of input.tags) {
        insertTag.run(id, tag);
      }
    }

    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown>;
    return toNodeWithTags(db, row);
  })();

  return updated;
}

export function getNodeHistory(nodeId: string): NodeHistory[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM node_history WHERE node_id = ? ORDER BY version DESC')
    .all(nodeId) as NodeHistory[];
  return rows;
}

export function listNodes(opts?: {
  type?: NodeType;
  status?: NodeStatus;
  limit?: number;
  offset?: number;
}): NodeWithTags[] {
  const db = getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.type) {
    conditions.push('type = ?');
    params.push(opts.type);
  }
  if (opts?.status) {
    conditions.push('status = ?');
    params.push(opts.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const rows = db
    .prepare(`SELECT * FROM nodes ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map((row) => toNodeWithTags(db, row));
}
