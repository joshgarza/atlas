import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../db/connection.js';
import { createEvent } from '../events.js';
import { createNode, getNode } from '../graph/nodes.js';
import { consolidate } from './consolidate.js';

const { mockEmbedNodeAsync } = vi.hoisted(() => ({
  mockEmbedNodeAsync: vi.fn(),
}));

vi.mock('../graph/embeddings.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../graph/embeddings.js')>();
  return {
    ...original,
    embedNodeAsync: mockEmbedNodeAsync,
  };
});

function makeEventPayload(title: string, content: string): string {
  return JSON.stringify({ title, content });
}

function getProcessedAt(eventId: string): string | null {
  const db = getDb();
  const row = db
    .prepare('SELECT processed_at FROM events WHERE id = ?')
    .get(eventId) as { processed_at: string | null } | undefined;
  return row?.processed_at ?? null;
}

function countArchivistActions(): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) as count FROM events WHERE type = 'archivist_action'")
    .get() as { count: number };
  return row.count;
}

function blockArchivistActions(): void {
  const db = getDb();
  db.exec(`
    CREATE TRIGGER fail_archivist_action
    BEFORE INSERT ON events
    WHEN NEW.type = 'archivist_action'
    BEGIN
      SELECT RAISE(FAIL, 'archivist action blocked');
    END;
  `);
}

describe('consolidate', () => {
  beforeEach(() => {
    mockEmbedNodeAsync.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('marks events processed and schedules embeddings after a committed create', async () => {
    const { event } = createEvent({
      type: 'observation',
      source: 'test',
      content: makeEventPayload('Fresh memory', 'Remember this detail'),
    });

    const result = await consolidate();
    const db = getDb();
    const createdNode = db
      .prepare('SELECT id, title, content FROM nodes WHERE title = ?')
      .get('Fresh memory') as { id: string; title: string; content: string } | undefined;

    expect(result).toMatchObject({
      processed: 1,
      nodesCreated: 1,
      nodesUpdated: 0,
      edgesCreated: 0,
    });
    expect(createdNode).toBeTruthy();
    expect(getProcessedAt(event.id)).toBeTruthy();
    expect(countArchivistActions()).toBe(1);
    expect(mockEmbedNodeAsync).toHaveBeenCalledTimes(1);
    expect(mockEmbedNodeAsync).toHaveBeenCalledWith(
      createdNode!.id,
      createdNode!.title,
      createdNode!.content,
    );
  });

  it('rolls back node creation and leaves the event unprocessed when the archivist action insert fails', async () => {
    const { event } = createEvent({
      type: 'observation',
      source: 'test',
      content: makeEventPayload('Blocked create', 'This should roll back'),
    });

    blockArchivistActions();

    await expect(consolidate()).rejects.toThrow('archivist action blocked');

    const db = getDb();
    const row = db
      .prepare('SELECT COUNT(*) as count FROM nodes')
      .get() as { count: number };

    expect(row.count).toBe(0);
    expect(getProcessedAt(event.id)).toBeNull();
    expect(countArchivistActions()).toBe(0);
    expect(mockEmbedNodeAsync).not.toHaveBeenCalled();
  });

  it('rolls back node updates and skips embeddings when the archivist action insert fails', async () => {
    const existing = createNode({
      type: 'observation',
      title: 'Stable title',
      content: 'Original content',
      granularity: 'standard',
    });
    mockEmbedNodeAsync.mockClear();

    const { event } = createEvent({
      type: 'observation',
      source: 'test',
      content: makeEventPayload('Stable title', 'New content that should not persist'),
    });

    blockArchivistActions();

    await expect(consolidate()).rejects.toThrow('archivist action blocked');

    const updated = getNode(existing.id, true);

    expect(updated).not.toBeNull();
    expect(updated!.content).toBe('Original content');
    expect(updated!.version).toBe(1);
    expect(getProcessedAt(event.id)).toBeNull();
    expect(countArchivistActions()).toBe(0);
    expect(mockEmbedNodeAsync).not.toHaveBeenCalled();
  });
});
