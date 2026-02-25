import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createEdge, getEdge, listEdges, updateEdge, deleteEdge } from '../../graph/edges.js';
import type { EdgeType } from '../../types.js';
import { CreateEdgeInputSchema, UpdateEdgeInputSchema, validationHook } from '../schemas.js';

const app = new Hono();

// List all edges
app.get('/edges', (c) => {
  try {
    const type = c.req.query('type') as EdgeType | undefined;
    const limitStr = c.req.query('limit');
    const offsetStr = c.req.query('offset');

    const opts: { type?: EdgeType; limit?: number; offset?: number } = {};
    if (type) opts.type = type;
    if (limitStr) opts.limit = parseInt(limitStr, 10);
    if (offsetStr) opts.offset = parseInt(offsetStr, 10);

    const edges = listEdges(opts);
    return c.json(edges);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Get a single edge
app.get('/edges/:id', (c) => {
  try {
    const id = c.req.param('id');
    const edge = getEdge(id);

    if (!edge) {
      return c.json({ error: 'Edge not found' }, 404);
    }

    return c.json(edge);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Create an edge
app.post('/edges', zValidator('json', CreateEdgeInputSchema, validationHook), async (c) => {
  try {
    const body = c.req.valid('json');
    const edge = createEdge(body);
    return c.json(edge, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Update an edge
app.put('/edges/:id', zValidator('json', UpdateEdgeInputSchema, validationHook), async (c) => {
  try {
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const existing = getEdge(id);
    if (!existing) {
      return c.json({ error: 'Edge not found' }, 404);
    }

    const edge = updateEdge(id, body);
    return c.json(edge);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Delete an edge
app.delete('/edges/:id', (c) => {
  try {
    const id = c.req.param('id');
    const deleted = deleteEdge(id);

    if (!deleted) {
      return c.json({ error: 'Edge not found' }, 404);
    }

    return c.json({ deleted: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
