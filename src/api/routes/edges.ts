import { Hono } from 'hono';
import { createEdge, listEdges } from '../../graph/edges.js';
import type { CreateEdgeInput } from '../../types.js';

const app = new Hono();

// List all edges
app.get('/edges', (c) => {
  try {
    const edges = listEdges();
    return c.json(edges);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Create an edge
app.post('/edges', async (c) => {
  try {
    const body = await c.req.json<CreateEdgeInput>();
    const edge = createEdge(body);
    return c.json(edge, 201);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
