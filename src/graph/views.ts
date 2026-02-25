import { ulid } from 'ulid';
import { getDb } from '../db/connection.js';
import type { SavedView, CreateSavedViewInput, UpdateSavedViewInput, SearchFilters } from '../types.js';

/** Parse a raw DB row into a SavedView, handling JSON filters. */
function parseViewRow(row: Record<string, unknown>): SavedView {
  return {
    ...row,
    filters: JSON.parse(row.filters as string) as SearchFilters,
  } as SavedView;
}

export function createView(input: CreateSavedViewInput): SavedView {
  const db = getDb();
  const id = ulid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO saved_views (id, name, description, filters, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.description ?? null,
    JSON.stringify(input.filters),
    now,
    now,
  );

  const row = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Record<string, unknown>;
  return parseViewRow(row);
}

export function getView(id: string): SavedView | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseViewRow(row);
}

export function listViews(): SavedView[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM saved_views ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map(parseViewRow);
}

export function updateView(id: string, input: UpdateSavedViewInput): SavedView {
  const db = getDb();

  const current = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!current) {
    throw new Error(`View not found: ${id}`);
  }

  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (input.name !== undefined) {
    fields.push('name = ?');
    values.push(input.name);
  }
  if (input.description !== undefined) {
    fields.push('description = ?');
    values.push(input.description);
  }
  if (input.filters !== undefined) {
    fields.push('filters = ?');
    values.push(JSON.stringify(input.filters));
  }

  values.push(id);
  db.prepare(`UPDATE saved_views SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const row = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Record<string, unknown>;
  return parseViewRow(row);
}

export function deleteView(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM saved_views WHERE id = ?').run(id);
  return result.changes > 0;
}
