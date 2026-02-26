import { Hono } from 'hono';
import { searchNodes, getRelatedNodes, getRecentNodes, advancedSearch } from '../../graph/query.js';
import { NodeTypeSchema, NodeStatusSchema, SortFieldSchema, SortOrderSchema } from '../schemas.js';
import type { SearchFilters } from '../../types.js';

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

// Advanced search with filtering + sorting
app.get('/search/advanced', (c) => {
  try {
    const filters: SearchFilters = {};

    const q = c.req.query('q');
    if (q) filters.q = q;

    const type = c.req.query('type');
    if (type) {
      const parsed = NodeTypeSchema.safeParse(type);
      if (!parsed.success) {
        return c.json({ error: `Invalid type: ${type}` }, 400);
      }
      filters.type = parsed.data;
    }

    const status = c.req.query('status');
    if (status) {
      const parsed = NodeStatusSchema.safeParse(status);
      if (!parsed.success) {
        return c.json({ error: `Invalid status: ${status}` }, 400);
      }
      filters.status = parsed.data;
    }

    const activationMin = c.req.query('activation_min');
    if (activationMin) filters.activation_min = parseFloat(activationMin);

    const activationMax = c.req.query('activation_max');
    if (activationMax) filters.activation_max = parseFloat(activationMax);

    const createdAfter = c.req.query('created_after');
    if (createdAfter) filters.created_after = createdAfter;

    const createdBefore = c.req.query('created_before');
    if (createdBefore) filters.created_before = createdBefore;

    const updatedAfter = c.req.query('updated_after');
    if (updatedAfter) filters.updated_after = updatedAfter;

    const updatedBefore = c.req.query('updated_before');
    if (updatedBefore) filters.updated_before = updatedBefore;

    const tags = c.req.query('tags');
    if (tags) filters.tags = tags.split(',');

    const sort = c.req.query('sort');
    if (sort) {
      const parsed = SortFieldSchema.safeParse(sort);
      if (!parsed.success) {
        return c.json({ error: `Invalid sort: ${sort}` }, 400);
      }
      filters.sort = parsed.data;
    }

    const order = c.req.query('order');
    if (order) {
      const parsed = SortOrderSchema.safeParse(order);
      if (!parsed.success) {
        return c.json({ error: `Invalid order: ${order}` }, 400);
      }
      filters.order = parsed.data;
    }

    const limitStr = c.req.query('limit');
    if (limitStr) filters.limit = parseInt(limitStr, 10);

    const offsetStr = c.req.query('offset');
    if (offsetStr) filters.offset = parseInt(offsetStr, 10);

    const nodes = advancedSearch(filters);
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
