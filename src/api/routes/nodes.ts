import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createNode, getNode, updateNode, listNodes, getNodeHistory } from '../../graph/nodes.js';
import { getEdgesByNode } from '../../graph/edges.js';
import { createNodeSchema, updateNodeSchema, nodeListQuery, nodeGetQuery, formatZodError } from '../schemas.js';

const app = new Hono();

// Create a node
app.post('/nodes',
  zValidator('json', createNodeSchema, (result, c) => {
    if (!result.success) return c.json({ error: formatZodError(result.error) }, 400);
  }),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const node = createNode(body);
      return c.json(node, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  },
);

// List nodes
app.get('/nodes',
  zValidator('query', nodeListQuery, (result, c) => {
    if (!result.success) return c.json({ error: formatZodError(result.error) }, 400);
  }),
  (c) => {
    try {
      const { type, status, limit, offset } = c.req.valid('query');
      const nodes = listNodes({ type, status, limit, offset });
      return c.json(nodes);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  },
);

// Get a node
app.get('/nodes/:id',
  zValidator('query', nodeGetQuery, (result, c) => {
    if (!result.success) return c.json({ error: formatZodError(result.error) }, 400);
  }),
  (c) => {
    try {
      const id = c.req.param('id');
      const peek = c.req.valid('query').peek === 'true';
      const node = getNode(id, peek);

      if (!node) {
        return c.json({ error: 'Node not found' }, 404);
      }

      return c.json(node);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  },
);

// Update a node
app.put('/nodes/:id',
  zValidator('json', updateNodeSchema, (result, c) => {
    if (!result.success) return c.json({ error: formatZodError(result.error) }, 400);
  }),
  async (c) => {
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
  },
);

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
