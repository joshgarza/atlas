import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startScheduler } from '../archivist/scheduler.js';
import nodeRoutes from './routes/nodes.js';
import edgeRoutes from './routes/edges.js';
import eventRoutes from './routes/events.js';
import searchRoutes from './routes/search.js';
import archivistRoutes from './routes/archivist.js';

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
app.route('/', archivistRoutes);

const port = parseInt(process.env.PORT ?? '3001', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Atlas server running on http://localhost:${port}`);
  startScheduler();
});

export default app;
