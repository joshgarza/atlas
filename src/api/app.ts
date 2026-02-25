import { Hono } from 'hono';
import nodeRoutes from './routes/nodes.js';
import edgeRoutes from './routes/edges.js';
import eventRoutes from './routes/events.js';
import searchRoutes from './routes/search.js';
import archivistRoutes from './routes/archivist.js';
import uiRoutes from './routes/ui.js';

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
app.route('/', uiRoutes);

export default app;
