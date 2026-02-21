import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { decayActivation } from '../graph/activation.js';
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

// Archivist endpoint — run decay
app.post('/archivist/run', (c) => {
  try {
    const result = decayActivation();
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const port = parseInt(process.env.PORT ?? '3001', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Atlas server running on http://localhost:${port}`);
});

export default app;
