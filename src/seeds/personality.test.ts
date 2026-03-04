import { describe, it, expect } from 'vitest';
import { getDb } from '../db/connection.js';
import { createNode } from '../graph/nodes.js';
import { seedPersonality } from './personality.js';

describe('seedPersonality', () => {
  it('creates the personality node with correct attributes', () => {
    seedPersonality();

    const db = getDb();
    const row = db.prepare(
      `SELECT n.* FROM nodes n
       JOIN node_tags nt ON nt.node_id = n.id
       WHERE nt.tag = 'system-personality'`
    ).get() as Record<string, unknown>;

    expect(row).toBeTruthy();
    expect(row.type).toBe('entity');
    expect(row.title).toBe('Digital Chief of Staff');
    expect(row.granularity).toBe('detailed');
    expect(row.status).toBe('active');

    const metadata = JSON.parse(row.metadata as string);
    expect(metadata).toEqual({ source: 'seed', role: 'personality' });
  });

  it('assigns all expected tags', () => {
    seedPersonality();

    const db = getDb();
    const row = db.prepare(
      `SELECT node_id FROM node_tags WHERE tag = 'system-personality'`
    ).get() as { node_id: string };

    const tags = db.prepare(
      `SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag`
    ).all(row.node_id) as { tag: string }[];

    const tagNames = tags.map((t) => t.tag);
    expect(tagNames).toEqual([
      'chief-of-staff', 'identity', 'personality', 'system', 'system-personality',
    ]);
  });

  it('is idempotent — does not create duplicates', () => {
    seedPersonality();
    seedPersonality();

    const db = getDb();
    const rows = db.prepare(
      `SELECT node_id FROM node_tags WHERE tag = 'system-personality'`
    ).all();

    expect(rows.length).toBe(1);
  });

  it('creates edges to existing goal and preference nodes', () => {
    const goal = createNode({
      type: 'goal',
      title: 'Ship v1',
      content: 'Launch the product',
      granularity: 'standard',
    });
    const pref = createNode({
      type: 'preference',
      title: 'Concise replies',
      content: 'Keep responses short',
      granularity: 'standard',
    });

    seedPersonality();

    const db = getDb();
    const personalityRow = db.prepare(
      `SELECT node_id FROM node_tags WHERE tag = 'system-personality'`
    ).get() as { node_id: string };

    const edges = db.prepare(
      `SELECT * FROM edges WHERE source_id = ? ORDER BY target_id`
    ).all(personalityRow.node_id) as Record<string, unknown>[];

    expect(edges.length).toBe(2);

    const targetIds = edges.map((e) => e.target_id).sort();
    expect(targetIds).toEqual([goal.id, pref.id].sort());

    for (const edge of edges) {
      expect(edge.type).toBe('related_to');
      const metadata = JSON.parse(edge.metadata as string);
      expect(metadata).toEqual({ source: 'seed' });
    }
  });

  it('does not create edges to superseded nodes', () => {
    const goal = createNode({
      type: 'goal',
      title: 'Old goal',
      content: 'Outdated',
      granularity: 'standard',
    });

    const db = getDb();
    db.prepare(`UPDATE nodes SET status = 'superseded' WHERE id = ?`).run(goal.id);

    seedPersonality();

    const personalityRow = db.prepare(
      `SELECT node_id FROM node_tags WHERE tag = 'system-personality'`
    ).get() as { node_id: string };

    const edges = db.prepare(
      `SELECT * FROM edges WHERE source_id = ?`
    ).all(personalityRow.node_id);

    expect(edges.length).toBe(0);
  });
});
