import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { searchNodes, getRelatedNodes, getRecentNodes } from '../../graph/query.js';
import { searchQuery, relatedQuery, recentQuery, formatZodError } from '../schemas.js';

const app = new Hono();

// Full-text search
app.get('/search',
  zValidator('query', searchQuery, (result, c) => {
    if (!result.success) return c.json({ error: formatZodError(result.error) }, 400);
  }),
  (c) => {
    try {
      const { q, limit } = c.req.valid('query');
      const nodes = searchNodes(q, limit);
      return c.json(nodes);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  },
);

// Related nodes via graph traversal
app.get('/search/related/:id',
  zValidator('query', relatedQuery, (result, c) => {
    if (!result.success) return c.json({ error: formatZodError(result.error) }, 400);
  }),
  (c) => {
    try {
      const id = c.req.param('id');
      const { depth } = c.req.valid('query');
      const nodes = getRelatedNodes(id, depth);
      return c.json(nodes);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  },
);

// Recently accessed nodes
app.get('/search/recent',
  zValidator('query', recentQuery, (result, c) => {
    if (!result.success) return c.json({ error: formatZodError(result.error) }, 400);
  }),
  (c) => {
    try {
      const { limit } = c.req.valid('query');
      const nodes = getRecentNodes(limit);
      return c.json(nodes);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  },
);

export default app;
