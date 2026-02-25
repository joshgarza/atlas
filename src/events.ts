import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { getDb } from './db/connection.js';
import type { Event, EventType, CreateEventInput } from './types.js';

function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function rowToEvent(row: Event & { metadata: string | null }): Event {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  };
}

export function createEvent(input: CreateEventInput): Event & { deduplicated: boolean } {
  const db = getDb();
  const contentHash = computeContentHash(input.content);

  // If idempotency_key is provided, check for existing event
  if (input.idempotency_key) {
    const existing = db.prepare(
      'SELECT * FROM events WHERE idempotency_key = ?'
    ).get(input.idempotency_key) as (Event & { metadata: string | null }) | undefined;

    if (existing) {
      return { ...rowToEvent(existing), deduplicated: true };
    }
  }

  const id = ulid();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO events (id, type, source, content, metadata, idempotency_key, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.type,
    input.source,
    input.content,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.idempotency_key ?? null,
    contentHash,
    now,
  );

  return {
    id,
    type: input.type,
    source: input.source,
    content: input.content,
    metadata: input.metadata ?? null,
    idempotency_key: input.idempotency_key ?? null,
    content_hash: contentHash,
    created_at: now,
    deduplicated: false,
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

  return rows.map(rowToEvent);
}
