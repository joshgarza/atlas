import { getDb } from '../db/connection.js';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBEDDING_MODEL = 'voyage-3';
const EMBEDDING_DIMENSIONS = 1024;

/** Check if embedding generation is available (API key is set). */
export function isEmbeddingAvailable(): boolean {
  return !!(process.env.VOYAGE_API_KEY || process.env.ANTHROPIC_API_KEY);
}

/** Get the API key for Voyage, preferring VOYAGE_API_KEY over ANTHROPIC_API_KEY. */
function getApiKey(): string | undefined {
  return process.env.VOYAGE_API_KEY || process.env.ANTHROPIC_API_KEY;
}

/** Generate an embedding vector for the given text via the Voyage API. */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No embedding API key set (VOYAGE_API_KEY or ANTHROPIC_API_KEY)');
  }

  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      output_dimension: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Voyage API error ${response.status}: ${body}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[] }>;
  };

  const embedding = data.data[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Unexpected embedding dimensions: expected ${EMBEDDING_DIMENSIONS}, got ${embedding?.length ?? 0}`);
  }

  return new Float32Array(embedding);
}

/** Store an embedding vector for a node in the vec0 table. */
export function storeEmbedding(nodeId: string, embedding: Float32Array): void {
  const db = getDb();

  // Delete existing embedding for this node (upsert)
  db.prepare('DELETE FROM node_embeddings WHERE node_id = ?').run(nodeId);

  db.prepare(
    'INSERT INTO node_embeddings (node_id, embedding) VALUES (?, ?)'
  ).run(nodeId, Buffer.from(embedding.buffer));
}

/** Generate and store an embedding for a node. Fire-and-forget safe. */
export async function embedNode(nodeId: string, title: string, content: string): Promise<void> {
  const text = title + '\n' + content;
  const embedding = await generateEmbedding(text);
  storeEmbedding(nodeId, embedding);
}

/** Fire-and-forget embedding generation for a node. Logs errors but never throws. */
export function embedNodeAsync(nodeId: string, title: string, content: string): void {
  if (!isEmbeddingAvailable()) return;

  embedNode(nodeId, title, content).catch((err) => {
    console.error(`Failed to generate embedding for node ${nodeId}:`, err);
  });
}

/**
 * Backfill embeddings for all nodes that don't have one yet.
 * Returns the count of nodes processed and any errors encountered.
 */
export async function backfillEmbeddings(): Promise<{ processed: number; errors: number }> {
  const db = getDb();

  const rows = db.prepare(`
    SELECT n.id, n.title, n.content FROM nodes n
    LEFT JOIN node_embeddings ne ON n.id = ne.node_id
    WHERE ne.node_id IS NULL
  `).all() as Array<{ id: string; title: string; content: string }>;

  let processed = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      await embedNode(row.id, row.title, row.content);
      processed++;
    } catch (err) {
      errors++;
      console.error(`Failed to backfill embedding for node ${row.id}:`, err);
    }
  }

  return { processed, errors };
}
