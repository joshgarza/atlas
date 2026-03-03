import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createNode, getNode, updateNode, listNodes, countNodes, getNodeHistory } from '../../graph/nodes.js';
import { getEdgesByNode } from '../../graph/edges.js';
import { CreateNodeInputSchema, UpdateNodeInputSchema, NodeListQuerySchema, NodeGetQuerySchema, validationHook } from '../schemas.js';

const app = new Hono();

// Create a node
app.post('/nodes', zValidator('json', CreateNodeInputSchema, validationHook), async (c) => {
  try {
    const body = c.req.valid('json');
    const node = createNode(body);
    return c.json(node, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// List nodes
app.get('/nodes', zValidator('query', NodeListQuerySchema, validationHook), (c) => {
  try {
    const query = c.req.valid('query');
    const nodes = listNodes(query);
    const total = countNodes(query);
    return c.json({ nodes, total });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Get a node
app.get('/nodes/:id', zValidator('query', NodeGetQuerySchema, validationHook), (c) => {
  try {
    const id = c.req.param('id');
    const { peek } = c.req.valid('query');
    const node = getNode(id, peek ?? false);

    if (!node) {
      return c.json({ error: 'Node not found' }, 404);
    }

    return c.json(node);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Update a node
app.put('/nodes/:id', zValidator('json', UpdateNodeInputSchema, validationHook), async (c) => {
  try {
    const id = c.req.param('id');
    const body = c.req.valid('json');

    // Check if node exists first
    const existing = getNode(id, true);
    if (!existing) {
      return c.json({ error: 'Node not found' }, 404);
    }

    const node = updateNode(id, body);
    return c.json(node);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Get node version history
app.get('/nodes/:id/history', (c) => {
  try {
    const id = c.req.param('id');
    const history = getNodeHistory(id);
    return c.json(history);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Get edges for a node
app.get('/nodes/:id/edges', (c) => {
  try {
    const id = c.req.param('id');
    const edges = getEdgesByNode(id);
    return c.json(edges);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
