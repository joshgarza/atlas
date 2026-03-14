import { getDb } from '../db/connection.js';
import { getEmbeddingProvider } from '../model-providers.js';

/** Check if embedding generation is available (API key is set). */
export function isEmbeddingAvailable(): boolean {
  return getEmbeddingProvider().isAvailable();
}

/** Generate an embedding vector for the given text via the Voyage API. */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  return getEmbeddingProvider().generate(text);
}

/** Store an embedding vector for a node in the vec0 table. */
export function storeEmbedding(nodeId: string, embedding: Float32Array): void {
  const db = getDb();

  db.transaction(() => {
    db.prepare('DELETE FROM node_embeddings WHERE node_id = ?').run(nodeId);
    db.prepare(
      'INSERT INTO node_embeddings (node_id, embedding) VALUES (?, ?)'
    ).run(nodeId, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));
  })();
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
