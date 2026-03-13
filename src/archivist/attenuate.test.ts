import { describe, it, expect } from 'vitest';
import { getDb } from '../db/connection.js';
import { listEvents } from '../events.js';
import { getEdgesByNode } from '../graph/edges.js';
import { createNode, getNode } from '../graph/nodes.js';
import { attenuate } from './attenuate.js';

function makeNode(title: string) {
  return createNode({
    type: 'concept',
    title,
    content: `${title} content`,
    granularity: 'standard',
  });
}

describe('attenuate', () => {
  it('rolls back all changes if a later step fails', () => {
    const db = getDb();
    const original = makeNode('Original');
    const replacement = makeNode('Replacement');

    db.exec(`
      CREATE TRIGGER fail_supersedes_edge
      BEFORE INSERT ON edges
      WHEN NEW.type = 'supersedes'
      BEGIN
        SELECT RAISE(ABORT, 'supersedes edge failure');
      END;
    `);

    expect(() => attenuate(original.id, 'duplicate', replacement.id)).toThrow(
      'supersedes edge failure',
    );

    const persisted = getNode(original.id, true);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe('active');
    expect(persisted!.activation).toBe(1.0);
    expect(persisted!.superseded_by).toBeNull();
    expect(listEvents()).toHaveLength(0);
    expect(getEdgesByNode(original.id)).toEqual([]);
  });

  it('composes with an outer transaction rollback', () => {
    const db = getDb();
    const original = makeNode('Original');
    const replacement = makeNode('Replacement');

    const runWorkflow = db.transaction(() => {
      attenuate(original.id, 'duplicate', replacement.id);
      throw new Error('outer workflow failed');
    });

    expect(() => runWorkflow()).toThrow('outer workflow failed');

    const persisted = getNode(original.id, true);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe('active');
    expect(persisted!.activation).toBe(1.0);
    expect(persisted!.superseded_by).toBeNull();
    expect(listEvents()).toHaveLength(0);
    expect(getEdgesByNode(original.id)).toEqual([]);
  });
});
