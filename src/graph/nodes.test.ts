import { describe, it, expect } from 'vitest';
import { getDb } from '../db/connection.js';
import { createNode, getNode, updateNode, getNodeHistory, listNodes } from './nodes.js';

function makeNode(overrides: Partial<Parameters<typeof createNode>[0]> = {}) {
  return createNode({
    type: 'concept',
    title: 'Test Node',
    content: 'Test content',
    granularity: 'standard',
    ...overrides,
  });
}

describe('createNode', () => {
  it('creates a node with defaults', () => {
    const node = makeNode();

    expect(node.id).toBeTruthy();
    expect(node.type).toBe('concept');
    expect(node.title).toBe('Test Node');
    expect(node.content).toBe('Test content');
    expect(node.granularity).toBe('standard');
    expect(node.activation).toBe(1.0);
    expect(node.status).toBe('active');
    expect(node.version).toBe(1);
    expect(node.access_count).toBe(0);
    expect(node.metadata).toBeNull();
    expect(node.tags).toEqual([]);
  });

  it('creates a node with tags', () => {
    const node = makeNode({ tags: ['typescript', 'testing'] });

    expect(node.tags).toEqual(['testing', 'typescript']); // sorted
  });

  it('creates a node with metadata', () => {
    const node = makeNode({ metadata: { source: 'obsidian', path: '/notes/test.md' } });

    expect(node.metadata).toEqual({ source: 'obsidian', path: '/notes/test.md' });
  });
});

describe('getNode', () => {
  it('returns a node by id', () => {
    const created = makeNode();
    const fetched = getNode(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.title).toBe('Test Node');
  });

  it('returns null for nonexistent id', () => {
    const result = getNode('nonexistent');
    expect(result).toBeNull();
  });

  it('bumps activation on normal access', () => {
    const node = makeNode();
    const accessed = getNode(node.id);

    expect(accessed!.activation).toBeGreaterThan(node.activation);
    expect(accessed!.access_count).toBe(1);
    expect(accessed!.last_accessed_at).toBeTruthy();
  });

  it('does not bump activation on peek', () => {
    const node = makeNode();
    const peeked = getNode(node.id, true);

    expect(peeked!.activation).toBe(1.0);
    expect(peeked!.access_count).toBe(0);
    expect(peeked!.last_accessed_at).toBeNull();
  });
});

describe('updateNode', () => {
  it('updates title and content', () => {
    const node = makeNode();
    const updated = updateNode(node.id, {
      title: 'Updated Title',
      content: 'Updated content',
    });

    expect(updated.title).toBe('Updated Title');
    expect(updated.content).toBe('Updated content');
    expect(updated.version).toBe(2);
  });

  it('saves history entry on update', () => {
    const node = makeNode();
    updateNode(node.id, { title: 'New Title', change_reason: 'correction' });

    const history = getNodeHistory(node.id);
    expect(history.length).toBe(1);
    expect(history[0].version).toBe(1);
    expect(history[0].title).toBe('Test Node');
    expect(history[0].change_reason).toBe('correction');
  });

  it('replaces tags on update', () => {
    const node = makeNode({ tags: ['old-tag'] });
    const updated = updateNode(node.id, { tags: ['new-tag-a', 'new-tag-b'] });

    expect(updated.tags).toEqual(['new-tag-a', 'new-tag-b']); // sorted
  });

  it('updates status and superseded_by', () => {
    const original = makeNode();
    const replacement = makeNode({ title: 'Replacement' });

    const updated = updateNode(original.id, {
      status: 'superseded',
      superseded_by: replacement.id,
    });

    expect(updated.status).toBe('superseded');
    expect(updated.superseded_by).toBe(replacement.id);
  });

  it('throws for nonexistent node', () => {
    expect(() => updateNode('nonexistent', { title: 'x' })).toThrow('Node not found');
  });

  it('increments version on each update', () => {
    const node = makeNode();
    updateNode(node.id, { title: 'v2' });
    const v3 = updateNode(node.id, { title: 'v3' });

    expect(v3.version).toBe(3);

    const history = getNodeHistory(node.id);
    expect(history.length).toBe(2);
    expect(history[0].version).toBe(2); // DESC order
    expect(history[1].version).toBe(1);
  });
});

describe('listNodes', () => {
  it('returns all nodes in reverse chronological order', () => {
    const db = getDb();
    const n1 = makeNode({ title: 'First' });
    const n2 = makeNode({ title: 'Second' });

    // Set distinct timestamps to avoid non-deterministic ordering
    db.prepare('UPDATE nodes SET created_at = ? WHERE id = ?').run('2025-01-01T00:00:00.000Z', n1.id);
    db.prepare('UPDATE nodes SET created_at = ? WHERE id = ?').run('2025-01-01T00:00:01.000Z', n2.id);

    const nodes = listNodes();
    expect(nodes.length).toBe(2);
    expect(nodes[0].id).toBe(n2.id);
    expect(nodes[1].id).toBe(n1.id);
  });

  it('filters by type', () => {
    makeNode({ type: 'concept' });
    makeNode({ type: 'entity' });

    const concepts = listNodes({ type: 'concept' });
    expect(concepts.length).toBe(1);
    expect(concepts[0].type).toBe('concept');
  });

  it('filters by status', () => {
    const node = makeNode();
    makeNode({ title: 'Other' });
    updateNode(node.id, { status: 'superseded' });

    const active = listNodes({ status: 'active' });
    expect(active.length).toBe(1);
    expect(active[0].title).toBe('Other');
  });

  it('supports pagination', () => {
    for (let i = 0; i < 5; i++) {
      makeNode({ title: `Node ${i}` });
    }

    const page = listNodes({ limit: 2, offset: 2 });
    expect(page.length).toBe(2);
  });
});
