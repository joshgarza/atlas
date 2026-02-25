import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { runArchivist, getArchivistStatus } from '../archivist/index.js';
import { startScheduler, stopScheduler, updateScheduler, getSchedulerStatus, MIN_INTERVAL_MS } from '../archivist/scheduler.js';
import nodeRoutes from './routes/nodes.js';
import edgeRoutes from './routes/edges.js';
import eventRoutes from './routes/events.js';
import searchRoutes from './routes/search.js';

const app = new Hono();

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Mount route modules
app.route('/', nodeRoutes);
app.route('/', edgeRoutes);
app.route('/', eventRoutes);
app.route('/', searchRoutes);

// Archivist endpoints
app.post('/archivist/run', (c) => {
  try {
    const result = runArchivist();
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.get('/archivist/status', (c) => {
  try {
    const status = getArchivistStatus();
    const schedule = getSchedulerStatus();
    return c.json({ ...status, schedule });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

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

app.delete('/archivist/schedule', (c) => {
  try {
    stopScheduler();
    return c.json(getSchedulerStatus());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const port = parseInt(process.env.PORT ?? '3001', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Atlas server running on http://localhost:${port}`);
  startScheduler();
});

export default app;
