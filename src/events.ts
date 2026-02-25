import { ulid } from 'ulid';
import { getDb } from './db/connection.js';
import type { Event, EventType, CreateEventInput } from './types.js';

export interface CreateEventResult {
  event: Event;
  existing: boolean;
}

export function createEvent(input: CreateEventInput): CreateEventResult {
  const db = getDb();
  const key = input.idempotency_key ?? null;

  // If an idempotency key is provided, check for an existing event
  if (key) {
    const existing = db.prepare(
      'SELECT * FROM events WHERE idempotency_key = ?'
    ).get(key) as (Event & { metadata: string | null }) | undefined;

    if (existing) {
      return {
        event: {
          ...existing,
          metadata: existing.metadata ? JSON.parse(existing.metadata) : null,
        },
        existing: true,
      };
    }
  }

  const id = ulid();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO events (id, type, source, content, metadata, idempotency_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.type,
    input.source,
    input.content,
    input.metadata ? JSON.stringify(input.metadata) : null,
    key,
    now,
  );

  const event: Event = {
    id,
    type: input.type,
    source: input.source,
    content: input.content,
    metadata: input.metadata ?? null,
    idempotency_key: key,
    created_at: now,
  };

  return { event, existing: false };
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

  const rows = stmt.all(...params) as Array<Event & { metadata: string | null; idempotency_key: string | null }>;

  return rows.map((row) => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    idempotency_key: row.idempotency_key ?? null,
  }));
}
