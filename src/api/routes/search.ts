import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { searchNodes, getRelatedNodes, getRecentNodes, advancedSearch, semanticSearch } from '../../graph/query.js';
import { SearchQuerySchema, AdvancedSearchQuerySchema, RelatedSearchQuerySchema, RecentSearchQuerySchema, validationHook } from '../schemas.js';

const app = new Hono();

// Full-text search
app.get('/search', zValidator('query', SearchQuerySchema, validationHook), (c) => {
  try {
    const { q, limit } = c.req.valid('query');
    const nodes = searchNodes(q, limit);
    return c.json(nodes);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Advanced search with filtering + sorting
app.get('/search/advanced', zValidator('query', AdvancedSearchQuerySchema, validationHook), (c) => {
  try {
    const filters = c.req.valid('query');
    const nodes = advancedSearch(filters);
    return c.json(nodes);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Related nodes via graph traversal
app.get('/search/related/:id', zValidator('query', RelatedSearchQuerySchema, validationHook), (c) => {
  try {
    const id = c.req.param('id');
    const { depth } = c.req.valid('query');
    const nodes = getRelatedNodes(id, depth);
    return c.json(nodes);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Semantic search via vector embeddings
app.get('/search/semantic', async (c) => {
  try {
    const q = c.req.query('q');
    if (!q) {
      return c.json({ error: 'Query parameter "q" is required' }, 400);
    }

    const limitStr = c.req.query('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit < 1)) {
      return c.json({ error: 'Invalid limit parameter' }, 400);
    }

    const results = await semanticSearch(q, limit);
    return c.json(results);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Recently accessed nodes
app.get('/search/recent', zValidator('query', RecentSearchQuerySchema, validationHook), (c) => {
  try {
    const { limit } = c.req.valid('query');
    const nodes = getRecentNodes(limit);
    return c.json(nodes);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
