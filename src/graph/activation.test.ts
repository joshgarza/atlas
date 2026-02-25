import { describe, it, expect, vi } from 'vitest';
import { getDb } from '../db/connection.js';
import { createNode, getNode } from './nodes.js';
import { bumpActivation, decayActivation } from './activation.js';

function makeNode(overrides: Partial<Parameters<typeof createNode>[0]> = {}) {
  return createNode({
    type: 'concept',
    title: 'Test',
    content: 'Content',
    granularity: 'standard',
    ...overrides,
  });
}

describe('bumpActivation', () => {
  it('increases activation on first access', () => {
    const node = makeNode();
    bumpActivation(node.id);

    const updated = getNode(node.id, true);
    expect(updated!.activation).toBeGreaterThan(1.0);
    expect(updated!.access_count).toBe(1);
  });

  it('applies recency bonus of 0.5 for never-accessed nodes', () => {
    const node = makeNode();
    // First bump: last_accessed_at is null → recency bonus 0.5
    bumpActivation(node.id);

    const updated = getNode(node.id, true);
    expect(updated!.activation).toBeCloseTo(1.5, 5);
  });

  it('applies recency bonus of 1.0 for recently accessed nodes', () => {
    const node = makeNode();
    // First bump sets last_accessed_at to now
    bumpActivation(node.id);
    // Second bump: accessed within 24h → bonus 1.0
    bumpActivation(node.id);

    const updated = getNode(node.id, true);
    expect(updated!.activation).toBeCloseTo(2.5, 5);
  });

  it('does nothing for nonexistent node', () => {
    // Should not throw
    bumpActivation('nonexistent');
  });
});

describe('decayActivation', () => {
  it('decays nodes based on time since last access', () => {
    const db = getDb();
    const node = makeNode();

    // Set last_accessed_at to 2 months ago to ensure measurable decay
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE nodes SET last_accessed_at = ? WHERE id = ?').run(twoMonthsAgo, node.id);

    const result = decayActivation(db);
    expect(result.decayed).toBe(1);

    const decayed = getNode(node.id, true);
    expect(decayed!.activation).toBeLessThan(1.0);
  });

  it('uses faster decay for superseded nodes', () => {
    const db = getDb();
    const active = makeNode({ title: 'Active' });
    const superseded = makeNode({ title: 'Superseded' });

    // Mark one as superseded
    db.prepare("UPDATE nodes SET status = 'superseded' WHERE id = ?").run(superseded.id);

    // Set both to same old access time
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE nodes SET last_accessed_at = ? WHERE id = ?').run(threeMonthsAgo, active.id);
    db.prepare('UPDATE nodes SET last_accessed_at = ? WHERE id = ?').run(threeMonthsAgo, superseded.id);

    decayActivation(db);

    const activeNode = getNode(active.id, true);
    const supersededNode = getNode(superseded.id, true);

    // Superseded should decay faster (0.90 vs 0.95 factor)
    expect(supersededNode!.activation).toBeLessThan(activeNode!.activation);
  });

  it('floors activation at 0.01', () => {
    const db = getDb();
    const node = makeNode();

    // Set very old access and very low activation
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE nodes SET last_accessed_at = ?, activation = 0.02 WHERE id = ?').run(longAgo, node.id);

    decayActivation(db);

    const decayed = getNode(node.id, true);
    expect(decayed!.activation).toBeGreaterThanOrEqual(0.01);
  });

  it('skips nodes with no meaningful change', () => {
    const db = getDb();
    const node = makeNode();

    // Set last_accessed_at to right now — decay should be negligible
    const now = new Date().toISOString();
    db.prepare('UPDATE nodes SET last_accessed_at = ? WHERE id = ?').run(now, node.id);

    const result = decayActivation(db);
    expect(result.decayed).toBe(0);
  });

  it('returns count of decayed nodes', () => {
    const db = getDb();
    makeNode({ title: 'A' });
    makeNode({ title: 'B' });

    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE nodes SET last_accessed_at = ?').run(oneMonthAgo);

    const result = decayActivation(db);
    expect(result.decayed).toBe(2);
  });
});
