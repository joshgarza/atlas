import { describe, it, expect } from 'vitest';
import { createNode } from './nodes.js';
import { createEdge, getEdgesByNode, getEdge } from './edges.js';

function makeTwoNodes() {
  const a = createNode({ type: 'concept', title: 'A', content: 'Node A', granularity: 'standard' });
  const b = createNode({ type: 'concept', title: 'B', content: 'Node B', granularity: 'standard' });
  return { a, b };
}

describe('createEdge', () => {
  it('creates an edge between two nodes', () => {
    const { a, b } = makeTwoNodes();
    const edge = createEdge({ source_id: a.id, target_id: b.id, type: 'related_to' });

    expect(edge.id).toBeTruthy();
    expect(edge.source_id).toBe(a.id);
    expect(edge.target_id).toBe(b.id);
    expect(edge.type).toBe('related_to');
    expect(edge.weight).toBe(1.0);
    expect(edge.metadata).toBeNull();
  });

  it('creates an edge with custom weight and metadata', () => {
    const { a, b } = makeTwoNodes();
    const edge = createEdge({
      source_id: a.id,
      target_id: b.id,
      type: 'supports',
      weight: 0.8,
      metadata: { reason: 'evidence' },
    });

    expect(edge.weight).toBe(0.8);
    expect(edge.metadata).toEqual({ reason: 'evidence' });
  });

  it('throws when source node does not exist', () => {
    const { b } = makeTwoNodes();
    expect(() =>
      createEdge({ source_id: 'nonexistent', target_id: b.id, type: 'related_to' })
    ).toThrow('Source node not found');
  });

  it('throws when target node does not exist', () => {
    const { a } = makeTwoNodes();
    expect(() =>
      createEdge({ source_id: a.id, target_id: 'nonexistent', type: 'related_to' })
    ).toThrow('Target node not found');
  });
});

describe('getEdgesByNode', () => {
  it('returns edges where node is source or target', () => {
    const a = createNode({ type: 'concept', title: 'A', content: 'A', granularity: 'standard' });
    const b = createNode({ type: 'concept', title: 'B', content: 'B', granularity: 'standard' });
    const c = createNode({ type: 'concept', title: 'C', content: 'C', granularity: 'standard' });

    createEdge({ source_id: a.id, target_id: b.id, type: 'related_to' });
    createEdge({ source_id: c.id, target_id: a.id, type: 'supports' });

    const edges = getEdgesByNode(a.id);
    expect(edges.length).toBe(2);
  });

  it('returns empty array for node with no edges', () => {
    const { a } = makeTwoNodes();
    const edges = getEdgesByNode(a.id);
    expect(edges).toEqual([]);
  });
});

describe('getEdge', () => {
  it('returns an edge by id', () => {
    const { a, b } = makeTwoNodes();
    const created = createEdge({ source_id: a.id, target_id: b.id, type: 'derived_from' });

    const fetched = getEdge(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.type).toBe('derived_from');
  });

  it('returns null for nonexistent id', () => {
    expect(getEdge('nonexistent')).toBeNull();
  });
});
