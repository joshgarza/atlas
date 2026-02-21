import { Hono } from 'hono';
import { searchNodes, getRelatedNodes, getRecentNodes } from '../../graph/query.js';

const app = new Hono();

// Full-text search
app.get('/search', (c) => {
  try {
    const q = c.req.query('q');
    if (!q) {
      return c.json({ error: 'Query parameter "q" is required' }, 400);
    }

    const limitStr = c.req.query('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    const nodes = searchNodes(q, limit);
    return c.json(nodes);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Related nodes via graph traversal
app.get('/search/related/:id', (c) => {
  try {
    const id = c.req.param('id');
    const depthStr = c.req.query('depth');
    const depth = depthStr ? parseInt(depthStr, 10) : undefined;

    const nodes = getRelatedNodes(id, depth);
    return c.json(nodes);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Recently accessed nodes
app.get('/search/recent', (c) => {
  try {
    const limitStr = c.req.query('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    const nodes = getRecentNodes(limit);
    return c.json(nodes);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
