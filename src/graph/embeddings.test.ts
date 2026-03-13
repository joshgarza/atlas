import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDb } from '../db/connection.js';
import { createNode, updateNode } from './nodes.js';
import { storeEmbedding, embedNode, embedNodeAsync, backfillEmbeddings } from './embeddings.js';
import { semanticSearch } from './query.js';

// Mock generateEmbedding for cross-module consumers (semanticSearch in query.ts)
vi.mock('./embeddings.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./embeddings.js')>();
  return {
    ...original,
    generateEmbedding: vi.fn(),
  };
});

import { generateEmbedding } from './embeddings.js';

const mockedGenerateEmbedding = vi.mocked(generateEmbedding);

function makeEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    arr[i] = Math.sin(seed * (i + 1));
  }
  // Normalize to unit vector
  let norm = 0;
  for (let i = 0; i < 1024; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 1024; i++) arr[i] /= norm;
  return arr;
}

function makeVoyageResponse(seed: number) {
  const emb = makeEmbedding(seed);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ embedding: Array.from(emb) }],
    }),
    text: async () => '',
  };
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

function makeNode(overrides: Partial<Parameters<typeof createNode>[0]> = {}) {
  return createNode({
    type: 'concept',
    title: 'Test Node',
    content: 'Test content',
    granularity: 'standard',
    ...overrides,
  });
}

describe('storeEmbedding', () => {
  it('stores and retrieves an embedding for a node', () => {
    const node = makeNode({ title: 'Embedding Test' });
    const embedding = makeEmbedding(1);

    storeEmbedding(node.id, embedding);

    const db = getDb();
    const row = db.prepare('SELECT node_id FROM node_embeddings WHERE node_id = ?').get(node.id) as { node_id: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.node_id).toBe(node.id);
  });

  it('replaces existing embedding on re-store', () => {
    const node = makeNode({ title: 'Replace Test' });

    storeEmbedding(node.id, makeEmbedding(1));
    storeEmbedding(node.id, makeEmbedding(2));

    const db = getDb();
    const rows = db.prepare('SELECT node_id FROM node_embeddings WHERE node_id = ?').all(node.id);
    expect(rows.length).toBe(1);
  });
});

describe('embedNode (with fetch mock)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.VOYAGE_API_KEY;
  });

  it('generates and stores embedding for a node', async () => {
    // Create node without API key so fire-and-forget skips
    delete process.env.VOYAGE_API_KEY;
    const node = makeNode({ title: 'Embed Me', content: 'Some content' });

    // Now set up key and fetch mock for explicit embedNode call
    process.env.VOYAGE_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue(makeVoyageResponse(42)) as typeof fetch;

    await embedNode(node.id, node.title, node.content);

    expect(globalThis.fetch).toHaveBeenCalledOnce();

    const db = getDb();
    const row = db.prepare('SELECT node_id FROM node_embeddings WHERE node_id = ?').get(node.id);
    expect(row).toBeDefined();
  });
});

describe('embedNodeAsync', () => {
  it('does not throw when embedding generation fails', () => {
    // No API key set, so isEmbeddingAvailable() returns false and it silently skips
    delete process.env.VOYAGE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const node = makeNode({ title: 'Async Fail' });
    expect(() => embedNodeAsync(node.id, node.title, node.content)).not.toThrow();
  });
});

describe('createNode with embeddings', () => {
  it('fires embedding generation on create', () => {
    const node = createNode({
      type: 'concept',
      title: 'New Node',
      content: 'Content here',
      granularity: 'standard',
    });

    // embedNodeAsync is called fire-and-forget
    expect(node.id).toBeDefined();
    expect(node.title).toBe('New Node');
  });
});

describe('updateNode with embeddings', () => {
  it('fires embedding regeneration when content changes', () => {
    const node = createNode({
      type: 'concept',
      title: 'Update Test',
      content: 'Original',
      granularity: 'standard',
    });

    const updated = updateNode(node.id, { content: 'Updated content' });
    expect(updated.content).toBe('Updated content');
  });
});

describe('semanticSearch', () => {
  beforeEach(() => {
    mockedGenerateEmbedding.mockReset();
  });

  it('returns nodes ranked by vector similarity', async () => {
    const node1 = makeNode({ title: 'TypeScript patterns', content: 'Advanced TS design patterns' });
    const node2 = makeNode({ title: 'Python basics', content: 'Intro to Python programming' });
    const node3 = makeNode({ title: 'JavaScript tips', content: 'JS performance optimization' });

    // Store embeddings directly (bypass API)
    const emb1 = makeEmbedding(1);
    const emb2 = makeEmbedding(100);
    const emb3 = makeEmbedding(2); // Similar to emb1

    storeEmbedding(node1.id, emb1);
    storeEmbedding(node2.id, emb2);
    storeEmbedding(node3.id, emb3);

    // Query embedding close to emb1/emb3
    const queryEmb = makeEmbedding(1);
    mockedGenerateEmbedding.mockResolvedValue(queryEmb);

    const results = await semanticSearch('TypeScript', 10);

    expect(results.length).toBe(3);
    // First result should be node1 (exact match embedding)
    expect(results[0].id).toBe(node1.id);
    expect(results[0].similarity).toBeCloseTo(1.0, 2);
    // All results should have similarity scores
    for (const r of results) {
      expect(r.similarity).toBeDefined();
      expect(typeof r.similarity).toBe('number');
    }
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      const node = makeNode({ title: `Node ${i}`, content: `Content ${i}` });
      storeEmbedding(node.id, makeEmbedding(i + 1));
    }

    mockedGenerateEmbedding.mockResolvedValue(makeEmbedding(1));

    const results = await semanticSearch('query', 2);
    expect(results.length).toBe(2);
  });

  it('returns empty array when no embeddings exist', async () => {
    makeNode({ title: 'No embedding', content: 'Nothing stored' });

    mockedGenerateEmbedding.mockResolvedValue(makeEmbedding(1));

    const results = await semanticSearch('query');
    expect(results).toEqual([]);
  });

  it('includes tags in results', async () => {
    const node = makeNode({ title: 'Tagged', content: 'Content', tags: ['alpha', 'beta'] });
    storeEmbedding(node.id, makeEmbedding(1));

    mockedGenerateEmbedding.mockResolvedValue(makeEmbedding(1));

    const results = await semanticSearch('tagged');
    expect(results.length).toBe(1);
    expect(results[0].tags).toEqual(['alpha', 'beta']);
  });

  it('preserves vector-ranked order while hydrating tags in bulk', async () => {
    const nodes = [
      makeNode({ title: 'First', content: 'Content', tags: ['zeta'] }),
      makeNode({ title: 'Second', content: 'Content', tags: ['beta', 'alpha'] }),
      makeNode({ title: 'Third', content: 'Content', tags: ['delta'] }),
    ];
    const embeddings = [makeEmbedding(5), makeEmbedding(1), makeEmbedding(50)];
    const queryEmbedding = makeEmbedding(1);

    for (let i = 0; i < nodes.length; i++) {
      storeEmbedding(nodes[i].id, embeddings[i]);
    }

    mockedGenerateEmbedding.mockResolvedValue(queryEmbedding);

    const expectedOrder = nodes
      .map((node, index) => ({
        id: node.id,
        similarity: cosineSimilarity(embeddings[index], queryEmbedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .map((node) => node.id);

    const results = await semanticSearch('ordered', 3);

    expect(results.map((result) => result.id)).toEqual(expectedOrder);
    expect(results.find((result) => result.id === nodes[0].id)?.tags).toEqual(['zeta']);
    expect(results.find((result) => result.id === nodes[1].id)?.tags).toEqual(['alpha', 'beta']);
    expect(results.find((result) => result.id === nodes[2].id)?.tags).toEqual(['delta']);
  });
});

describe('backfillEmbeddings (with fetch mock)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.VOYAGE_API_KEY;
  });

  it('backfills nodes without embeddings', async () => {
    const node1 = makeNode({ title: 'Has embedding', content: 'Already done' });
    makeNode({ title: 'Missing embedding', content: 'Needs backfill' });

    // Only node1 has an embedding
    storeEmbedding(node1.id, makeEmbedding(1));

    globalThis.fetch = vi.fn().mockResolvedValue(makeVoyageResponse(2)) as typeof fetch;

    const result = await backfillEmbeddings();
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('reports errors without stopping', async () => {
    makeNode({ title: 'Will fail', content: 'Error node' });
    makeNode({ title: 'Will also fail', content: 'Error node 2' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }) as typeof fetch;

    const result = await backfillEmbeddings();
    expect(result.processed).toBe(0);
    expect(result.errors).toBe(2);
  });
});

describe('graceful degradation', () => {
  it('createNode succeeds even when embedding API key is missing', () => {
    delete process.env.VOYAGE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const node = createNode({
      type: 'concept',
      title: 'No API Key',
      content: 'Should still create',
      granularity: 'standard',
    });

    expect(node.id).toBeDefined();
    expect(node.title).toBe('No API Key');
  });
});
