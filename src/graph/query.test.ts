import { describe, it, expect } from 'vitest';
import { getDb } from '../db/connection.js';
import { createNode, getNode } from './nodes.js';
import { createEdge } from './edges.js';
import { searchNodes, getRelatedNodes, getRecentNodes } from './query.js';

function makeNode(overrides: Partial<Parameters<typeof createNode>[0]> = {}) {
  return createNode({
    type: 'concept',
    title: 'Test Node',
    content: 'Test content',
    granularity: 'standard',
    ...overrides,
  });
}

describe('searchNodes', () => {
  it('finds nodes by title', () => {
    makeNode({ title: 'TypeScript Patterns', content: 'patterns for TS' });
    makeNode({ title: 'Python Basics', content: 'intro to python' });

    const results = searchNodes('TypeScript');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('TypeScript Patterns');
  });

  it('finds nodes by content', () => {
    makeNode({ title: 'Languages', content: 'Rust is a systems programming language' });
    makeNode({ title: 'Other', content: 'unrelated content' });

    const results = searchNodes('Rust');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Languages');
  });

  it('returns empty array for no matches', () => {
    makeNode({ title: 'Something', content: 'else' });

    const results = searchNodes('nonexistent');
    expect(results).toEqual([]);
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      makeNode({ title: `Concept ${i}`, content: 'shared keyword searchable' });
    }

    const results = searchNodes('searchable', 2);
    expect(results.length).toBe(2);
  });

  it('handles special characters in query', () => {
    makeNode({ title: 'C++ Guide', content: 'C++ programming' });

    // Should not throw — special chars are quoted
    const results = searchNodes('C++');
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('includes tags in results', () => {
    makeNode({ title: 'Tagged Node', content: 'has tags', tags: ['alpha', 'beta'] });

    const results = searchNodes('Tagged');
    expect(results.length).toBe(1);
    expect(results[0].tags).toEqual(['alpha', 'beta']);
  });
});

describe('getRelatedNodes', () => {
  it('returns directly connected nodes at depth 1', () => {
    const a = makeNode({ title: 'A' });
    const b = makeNode({ title: 'B' });
    const c = makeNode({ title: 'C' });

    createEdge({ source_id: a.id, target_id: b.id, type: 'related_to' });
    createEdge({ source_id: a.id, target_id: c.id, type: 'supports' });

    const related = getRelatedNodes(a.id);
    expect(related.length).toBe(2);

    const titles = related.map((n) => n.title).sort();
    expect(titles).toEqual(['B', 'C']);
  });

  it('does not include the origin node', () => {
    const a = makeNode({ title: 'A' });
    const b = makeNode({ title: 'B' });
    createEdge({ source_id: a.id, target_id: b.id, type: 'related_to' });

    const related = getRelatedNodes(a.id);
    expect(related.every((n) => n.id !== a.id)).toBe(true);
  });

  it('traverses deeper with depth > 1', () => {
    const a = makeNode({ title: 'A' });
    const b = makeNode({ title: 'B' });
    const c = makeNode({ title: 'C' });

    createEdge({ source_id: a.id, target_id: b.id, type: 'related_to' });
    createEdge({ source_id: b.id, target_id: c.id, type: 'related_to' });

    // Depth 1: only B
    const depth1 = getRelatedNodes(a.id, 1);
    expect(depth1.length).toBe(1);
    expect(depth1[0].title).toBe('B');

    // Depth 2: B and C
    const depth2 = getRelatedNodes(a.id, 2);
    expect(depth2.length).toBe(2);
  });

  it('returns empty array for isolated node', () => {
    const a = makeNode({ title: 'Lonely' });
    const related = getRelatedNodes(a.id);
    expect(related).toEqual([]);
  });

  it('follows edges in both directions', () => {
    const a = makeNode({ title: 'A' });
    const b = makeNode({ title: 'B' });
    // Edge goes B → A, but querying from A should still find B
    createEdge({ source_id: b.id, target_id: a.id, type: 'derived_from' });

    const related = getRelatedNodes(a.id);
    expect(related.length).toBe(1);
    expect(related[0].title).toBe('B');
  });
});

describe('getRecentNodes', () => {
  it('returns nodes ordered by most recent access', () => {
    const db = getDb();
    const a = makeNode({ title: 'A' });
    const b = makeNode({ title: 'B' });

    // Access both nodes to populate last_accessed_at
    getNode(a.id);
    getNode(b.id);

    // Set distinct timestamps to avoid non-deterministic ordering
    db.prepare('UPDATE nodes SET last_accessed_at = ? WHERE id = ?').run('2025-01-01T00:00:00.000Z', a.id);
    db.prepare('UPDATE nodes SET last_accessed_at = ? WHERE id = ?').run('2025-01-01T00:00:01.000Z', b.id);

    const recent = getRecentNodes();
    expect(recent[0].title).toBe('B');
  });

  it('falls back to created_at for never-accessed nodes', () => {
    makeNode({ title: 'First' });
    makeNode({ title: 'Second' });

    const recent = getRecentNodes();
    // Both have null last_accessed_at, so ordered by created_at DESC
    expect(recent[0].title).toBe('Second');
    expect(recent[1].title).toBe('First');
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      makeNode({ title: `Node ${i}` });
    }

    const recent = getRecentNodes(3);
    expect(recent.length).toBe(3);
  });

  it('returns empty array when no nodes exist', () => {
    const recent = getRecentNodes();
    expect(recent).toEqual([]);
  });
});
