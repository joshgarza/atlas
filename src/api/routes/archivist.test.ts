import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../graph/embeddings.js', () => ({
  backfillEmbeddings: vi.fn(),
  isEmbeddingAvailable: vi.fn(),
}));

import app from './archivist.js';
import { backfillEmbeddings, isEmbeddingAvailable } from '../../graph/embeddings.js';

const mockedBackfillEmbeddings = vi.mocked(backfillEmbeddings);
const mockedIsEmbeddingAvailable = vi.mocked(isEmbeddingAvailable);

describe('POST /archivist/backfill-embeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 when embeddings are unavailable before backfill starts', async () => {
    mockedIsEmbeddingAvailable.mockReturnValue(false);

    const response = await app.request('/archivist/backfill-embeddings', {
      method: 'POST',
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Semantic search embeddings are not configured',
    });
    expect(mockedBackfillEmbeddings).not.toHaveBeenCalled();
  });

  it('runs backfill when embeddings are available', async () => {
    mockedIsEmbeddingAvailable.mockReturnValue(true);
    mockedBackfillEmbeddings.mockResolvedValue({ processed: 3, errors: 1 });

    const response = await app.request('/archivist/backfill-embeddings', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 3, errors: 1 });
    expect(mockedBackfillEmbeddings).toHaveBeenCalledOnce();
  });
});
