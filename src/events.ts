import { ulid } from 'ulid';
import { getDb } from './db/connection.js';
import type { Event, EventType, CreateEventInput } from './types.js';

export function createEvent(input: CreateEventInput): Event {
  const db = getDb();
  const id = ulid();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO events (id, type, source, content, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.type,
    input.source,
    input.content,
    input.metadata ? JSON.stringify(input.metadata) : null,
    now,
  );

  return {
    id,
    type: input.type,
    source: input.source,
    content: input.content,
    metadata: input.metadata ?? null,
    created_at: now,
  };
}

export function listEvents(opts?: {
  type?: EventType;
  limit?: number;
  offset?: number;
}): Event[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.type) {
    conditions.push('type = ?');
    params.push(opts.type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const stmt = db.prepare(`
    SELECT * FROM events ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);

  params.push(limit, offset);

  const rows = stmt.all(...params) as Array<Event & { metadata: string | null }>;

  return rows.map((row) => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));
}
