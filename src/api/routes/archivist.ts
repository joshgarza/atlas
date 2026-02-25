import { Hono } from 'hono';
import { runArchivist, getArchivistStatus } from '../../archivist/index.js';
import { stopScheduler, updateScheduler, getSchedulerStatus, MIN_INTERVAL_MS } from '../../archivist/scheduler.js';

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
app.put('/archivist/schedule', async (c) => {
  try {
    const body = await c.req.json();
    const overrides: Record<string, number> = {};
    if (typeof body.consolidateIntervalMs === 'number') {
      if (body.consolidateIntervalMs < MIN_INTERVAL_MS) {
        return c.json({ error: `consolidateIntervalMs must be >= ${MIN_INTERVAL_MS}` }, 400);
      }
      overrides.consolidateIntervalMs = body.consolidateIntervalMs;
    }
    if (typeof body.decayIntervalMs === 'number') {
      if (body.decayIntervalMs < MIN_INTERVAL_MS) {
        return c.json({ error: `decayIntervalMs must be >= ${MIN_INTERVAL_MS}` }, 400);
      }
      overrides.decayIntervalMs = body.decayIntervalMs;
    }
    updateScheduler(overrides);
    return c.json(getSchedulerStatus());
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
