import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { getDb, closeDb } from '../../db/connection.js';
import { stopScheduler } from '../../archivist/scheduler.js';
import app from '../app.js';

// --- Helpers ---

function get(path: string) {
  return app.request(path);
}

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function put(path: string, body: unknown) {
  return app.request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(path: string) {
  return app.request(path, { method: 'DELETE' });
}

// --- Test suite ---

let tmpDir: string;

before(() => {
  const testDataRoot = join(process.cwd(), 'data', 'test-tmp');
  mkdirSync(testDataRoot, { recursive: true });
  tmpDir = mkdtempSync(join(testDataRoot, 'atlas-test-'));
  getDb(join(tmpDir, 'test.db'));
});

after(() => {
  stopScheduler();
  closeDb();
  rmSync(tmpDir, { recursive: true });
});

// Shared state: IDs created during tests for cross-endpoint verification
let nodeIdA: string;
let nodeIdB: string;
let edgeId: string;

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: 'ok' });
  });
});

// --- Nodes ---

describe('POST /nodes', () => {
  it('creates a node', async () => {
    const res = await post('/nodes', {
      type: 'concept',
      title: 'TypeScript',
      content: 'A typed superset of JavaScript',
      granularity: 'standard',
      tags: ['language', 'programming'],
      metadata: { source: 'test' },
    });
    assert.equal(res.status, 201);
    const node = await res.json();
    assert.equal(node.type, 'concept');
    assert.equal(node.title, 'TypeScript');
    assert.equal(node.content, 'A typed superset of JavaScript');
    assert.equal(node.granularity, 'standard');
    assert.equal(node.status, 'active');
    assert.equal(node.version, 1);
    assert.equal(node.activation, 1);
    assert.equal(node.access_count, 0);
    assert.deepEqual(node.tags, ['language', 'programming']);
    assert.deepEqual(node.metadata, { source: 'test' });
    assert.ok(node.id);
    assert.ok(node.created_at);
    nodeIdA = node.id;
  });

  it('creates a second node', async () => {
    const res = await post('/nodes', {
      type: 'entity',
      title: 'Hono Framework',
      content: 'A lightweight web framework',
      granularity: 'detailed',
    });
    assert.equal(res.status, 201);
    const node = await res.json();
    assert.equal(node.type, 'entity');
    assert.equal(node.title, 'Hono Framework');
    assert.deepEqual(node.tags, []);
    nodeIdB = node.id;
  });
});

describe('GET /nodes', () => {
  it('lists all nodes with total count', async () => {
    const res = await get('/nodes');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.nodes));
    assert.equal(body.nodes.length, 2);
    assert.equal(body.total, 2);
  });

  it('filters by type', async () => {
    const res = await get('/nodes?type=concept');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.nodes.length, 1);
    assert.equal(body.nodes[0].type, 'concept');
    assert.equal(body.total, 1);
  });

  it('filters by status', async () => {
    const res = await get('/nodes?status=active');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.nodes.length, 2);
    assert.equal(body.total, 2);
  });

  it('supports limit and offset with total', async () => {
    const res = await get('/nodes?limit=1&offset=0');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.nodes.length, 1);
    assert.equal(body.total, 2);
  });

  it('rejects invalid type', async () => {
    const res = await get('/nodes?type=INVALID');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  it('rejects non-numeric limit', async () => {
    const res = await get('/nodes?limit=abc');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });
});

describe('GET /nodes/:id', () => {
  it('returns a node and bumps activation', async () => {
    const res = await get(`/nodes/${nodeIdA}`);
    assert.equal(res.status, 200);
    const node = await res.json();
    assert.equal(node.id, nodeIdA);
    assert.equal(node.title, 'TypeScript');
    assert.ok(node.activation > 1, 'activation should be bumped above initial 1.0');
    assert.equal(node.access_count, 1);
  });

  it('returns 404 for missing node', async () => {
    const res = await get('/nodes/nonexistent');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Node not found');
  });

  it('supports peek mode (no activation bump)', async () => {
    // Read current state
    const before = await (await get(`/nodes/${nodeIdB}?peek=true`)).json();
    const accessBefore = before.access_count;

    // Peek again
    const res = await get(`/nodes/${nodeIdB}?peek=true`);
    assert.equal(res.status, 200);
    const node = await res.json();
    assert.equal(node.access_count, accessBefore);
  });
});

describe('PUT /nodes/:id', () => {
  it('updates a node and creates history', async () => {
    const res = await put(`/nodes/${nodeIdA}`, {
      title: 'TypeScript Language',
      content: 'A typed superset of JavaScript for large-scale apps',
      change_reason: 'Expanded description',
      changed_by: 'test-suite',
      tags: ['language', 'programming', 'typed'],
    });
    assert.equal(res.status, 200);
    const node = await res.json();
    assert.equal(node.title, 'TypeScript Language');
    assert.equal(node.version, 2);
    assert.deepEqual(node.tags, ['language', 'programming', 'typed']);
  });

  it('returns 404 for missing node', async () => {
    const res = await put('/nodes/nonexistent', { title: 'nope' });
    assert.equal(res.status, 404);
  });
});

describe('GET /nodes/:id/history', () => {
  it('returns version history', async () => {
    const res = await get(`/nodes/${nodeIdA}/history`);
    assert.equal(res.status, 200);
    const history = await res.json();
    assert.ok(Array.isArray(history));
    assert.equal(history.length, 1); // one previous version
    assert.equal(history[0].version, 1);
    assert.equal(history[0].title, 'TypeScript');
    assert.equal(history[0].change_reason, 'Expanded description');
    assert.equal(history[0].changed_by, 'test-suite');
  });

  it('returns empty array for node with no history', async () => {
    const res = await get(`/nodes/${nodeIdB}/history`);
    assert.equal(res.status, 200);
    const history = await res.json();
    assert.deepEqual(history, []);
  });
});

// --- Edges ---

describe('POST /edges', () => {
  it('creates an edge between nodes', async () => {
    const res = await post('/edges', {
      source_id: nodeIdA,
      target_id: nodeIdB,
      type: 'related_to',
      weight: 0.8,
      metadata: { reason: 'test' },
    });
    assert.equal(res.status, 201);
    const edge = await res.json();
    assert.equal(edge.source_id, nodeIdA);
    assert.equal(edge.target_id, nodeIdB);
    assert.equal(edge.type, 'related_to');
    assert.equal(edge.weight, 0.8);
    assert.deepEqual(edge.metadata, { reason: 'test' });
    assert.ok(edge.id);
    edgeId = edge.id;
  });

  it('rejects edge with nonexistent source node', async () => {
    const res = await post('/edges', {
      source_id: 'nonexistent',
      target_id: nodeIdB,
      type: 'related_to',
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.ok(body.error);
  });
});

describe('GET /edges', () => {
  it('rejects invalid edge type', async () => {
    const res = await get('/edges?type=INVALID');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  it('rejects non-numeric limit', async () => {
    const res = await get('/edges?limit=abc');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });
});

describe('GET /nodes/:id/edges', () => {
  it('returns edges for a node', async () => {
    const res = await get(`/nodes/${nodeIdA}/edges`);
    assert.equal(res.status, 200);
    const edges = await res.json();
    assert.ok(Array.isArray(edges));
    assert.equal(edges.length, 1);
    assert.equal(edges[0].id, edgeId);
  });

  it('returns edges when node is the target', async () => {
    const res = await get(`/nodes/${nodeIdB}/edges`);
    assert.equal(res.status, 200);
    const edges = await res.json();
    assert.equal(edges.length, 1);
    assert.equal(edges[0].id, edgeId);
  });
});

// --- Events ---

describe('POST /events', () => {
  it('creates an event', async () => {
    const res = await post('/events', {
      type: 'observation',
      source: 'test-suite',
      content: JSON.stringify({
        title: 'Node.js Testing',
        content: 'Built-in test runner available since Node 18',
      }),
      metadata: { origin: 'integration-test' },
    });
    assert.equal(res.status, 201);
    const event = await res.json();
    assert.equal(event.type, 'observation');
    assert.equal(event.source, 'test-suite');
    assert.ok(event.id);
    assert.ok(event.created_at);
  });
});

// --- Search ---

describe('GET /search', () => {
  it('returns matching nodes via full-text search', async () => {
    const res = await get('/search?q=TypeScript');
    assert.equal(res.status, 200);
    const nodes = await res.json();
    assert.ok(Array.isArray(nodes));
    assert.ok(nodes.length >= 1);
    assert.equal(nodes[0].id, nodeIdA);
  });

  it('returns 400 when q param is missing', async () => {
    const res = await get('/search');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('"q"'));
  });

  it('supports limit param', async () => {
    const res = await get('/search?q=TypeScript&limit=1');
    assert.equal(res.status, 200);
    const nodes = await res.json();
    assert.ok(nodes.length <= 1);
  });
});

describe('GET /search/related/:id', () => {
  it('returns related nodes via graph traversal', async () => {
    const res = await get(`/search/related/${nodeIdA}`);
    assert.equal(res.status, 200);
    const nodes = await res.json();
    assert.ok(Array.isArray(nodes));
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].id, nodeIdB);
  });

  it('returns empty array for isolated node', async () => {
    // Create a node with no edges
    const createRes = await post('/nodes', {
      type: 'concept',
      title: 'Isolated Concept',
      content: 'Has no connections',
      granularity: 'broad',
    });
    const isolated = await createRes.json();
    const res = await get(`/search/related/${isolated.id}`);
    assert.equal(res.status, 200);
    const nodes = await res.json();
    assert.deepEqual(nodes, []);
  });
});

describe('GET /search/semantic', () => {
  it('returns 400 when q param is missing', async () => {
    const res = await get('/search/semantic');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('"q"'));
  });

  it('rejects non-numeric limit', async () => {
    const res = await get('/search/semantic?q=TypeScript&limit=abc');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });
});

describe('GET /search/recent', () => {
  it('returns recently accessed nodes', async () => {
    const res = await get('/search/recent');
    assert.equal(res.status, 200);
    const nodes = await res.json();
    assert.ok(Array.isArray(nodes));
    assert.ok(nodes.length >= 1);
  });

  it('supports limit param', async () => {
    const res = await get('/search/recent?limit=1');
    assert.equal(res.status, 200);
    const nodes = await res.json();
    assert.ok(nodes.length <= 1);
  });
});

// --- Archivist ---

describe('POST /archivist/run', () => {
  it('runs a full archivist cycle', async () => {
    const res = await post('/archivist/run', {});
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.ok(result.consolidation);
    assert.ok(typeof result.consolidation.processed === 'number');
    assert.ok(typeof result.consolidation.nodesCreated === 'number');
    assert.ok(typeof result.consolidation.nodesUpdated === 'number');
    assert.ok(result.decay);
    assert.ok(typeof result.decay.decayed === 'number');
    assert.ok(result.timing);
    assert.ok(result.timing.startedAt);
    assert.ok(result.timing.completedAt);
    assert.ok(typeof result.timing.durationMs === 'number');
    assert.equal(result.runCount, 1);
  });
});

describe('GET /archivist/status', () => {
  it('returns archivist status', async () => {
    const res = await get('/archivist/status');
    assert.equal(res.status, 200);
    const status = await res.json();
    assert.equal(status.runCount, 1);
    assert.ok(status.lastRun);
    assert.ok(typeof status.unprocessedEventCount === 'number');
    assert.ok(status.schedule);
    assert.ok(typeof status.schedule.running === 'boolean');
  });
});

describe('PUT /archivist/schedule', () => {
  it('updates scheduler intervals', async () => {
    const res = await put('/archivist/schedule', {
      consolidateIntervalMs: 120_000,
      decayIntervalMs: 300_000,
    });
    assert.equal(res.status, 200);
    const status = await res.json();
    assert.equal(status.running, true);
    assert.equal(status.consolidateIntervalMs, 120_000);
    assert.equal(status.decayIntervalMs, 300_000);
  });

  it('rejects intervals below minimum', async () => {
    const res = await put('/archivist/schedule', {
      consolidateIntervalMs: 1000,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('consolidateIntervalMs'));
  });
});

describe('DELETE /archivist/schedule', () => {
  it('stops the scheduler', async () => {
    const res = await del('/archivist/schedule');
    assert.equal(res.status, 200);
    const status = await res.json();
    assert.equal(status.running, false);
  });
});

// --- Session Briefing ---

describe('GET /session/briefing', () => {
  it('returns 200 with all four sections', async () => {
    const res = await get('/session/briefing');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.recentEvents));
    assert.ok(Array.isArray(body.highActivationNodes));
    assert.ok(Array.isArray(body.recentNodes));
    assert.ok(body.archivistStatus);
    assert.ok(typeof body.archivistStatus.unprocessedEventCount === 'number');
    assert.ok(typeof body.archivistStatus.schedulerRunning === 'boolean');
  });

  it('includes high-activation nodes with compact fields', async () => {
    const res = await get('/session/briefing');
    const body = await res.json();
    if (body.highActivationNodes.length > 0) {
      const node = body.highActivationNodes[0];
      assert.ok(node.id);
      assert.ok(node.title);
      assert.ok(node.type);
      assert.ok(typeof node.activation === 'number');
      assert.ok(Array.isArray(node.tags));
      // Should NOT include full content
      assert.equal(node.content, undefined);
    }
  });

  it('includes recent nodes without content field', async () => {
    const res = await get('/session/briefing');
    const body = await res.json();
    if (body.recentNodes.length > 0) {
      const node = body.recentNodes[0];
      assert.ok(node.id);
      assert.ok(node.title);
      assert.ok(node.type);
      assert.equal(node.content, undefined);
    }
  });

  it('truncates event content to ~100 chars', async () => {
    // Create an event with long content
    const longContent = 'A'.repeat(200);
    await post('/events', {
      type: 'observation',
      source: 'test',
      content: longContent,
    });

    const res = await get('/session/briefing');
    const body = await res.json();
    const longEvent = body.recentEvents.find(
      (e: { source: string }) => e.source === 'test'
    );
    if (longEvent) {
      assert.ok(longEvent.preview.length <= 104); // 100 + '...'
      assert.ok(longEvent.preview.endsWith('...'));
    }
  });

  it('excludes archivist_action events', async () => {
    // Create an archivist_action event
    await post('/events', {
      type: 'archivist_action',
      source: 'archivist',
      content: 'internal action',
    });

    const res = await get('/session/briefing');
    const body = await res.json();
    const archivistEvents = body.recentEvents.filter(
      (e: { type: string }) => e.type === 'archivist_action'
    );
    assert.equal(archivistEvents.length, 0);
  });
});
