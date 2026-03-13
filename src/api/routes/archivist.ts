import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { runArchivist, getArchivistStatus, runDeduplication } from '../../archivist/index.js';
import { stopScheduler, updateScheduler, getSchedulerStatus } from '../../archivist/scheduler.js';
import { backfillEmbeddings, isEmbeddingAvailable } from '../../graph/embeddings.js';
import { UpdateScheduleInputSchema, validationHook } from '../schemas.js';

const app = new Hono();

// Run full archivist cycle
app.post('/archivist/run', async (c) => {
  try {
    const result = await runArchivist();
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Run deduplication
app.post('/archivist/deduplicate', async (c) => {
  try {
    const result = await runDeduplication();
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Get archivist status
app.get('/archivist/status', (c) => {
  try {
    const status = getArchivistStatus();
    const schedule = getSchedulerStatus();
    return c.json({ ...status, schedule });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Update schedule intervals
app.put('/archivist/schedule', zValidator('json', UpdateScheduleInputSchema, validationHook), async (c) => {
  try {
    const body = c.req.valid('json');
    const overrides: Record<string, number> = {};
    if (body.consolidateIntervalMs !== undefined) {
      overrides.consolidateIntervalMs = body.consolidateIntervalMs;
    }
    if (body.decayIntervalMs !== undefined) {
      overrides.decayIntervalMs = body.decayIntervalMs;
    }
    updateScheduler(overrides);
    return c.json(getSchedulerStatus());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Backfill embeddings for nodes missing them
app.post('/archivist/backfill-embeddings', async (c) => {
  try {
    if (!isEmbeddingAvailable()) {
      return c.json(
        { error: 'Semantic search embeddings are not configured' },
        503
      );
    }

    const result = await backfillEmbeddings();
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Stop the scheduler
app.delete('/archivist/schedule', (c) => {
  try {
    stopScheduler();
    return c.json(getSchedulerStatus());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
