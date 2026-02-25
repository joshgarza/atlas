import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createEdge } from '../../graph/edges.js';
import { CreateEdgeInputSchema, validationHook } from '../schemas.js';

const app = new Hono();

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

export default app;
