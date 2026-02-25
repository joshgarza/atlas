import { Hono } from 'hono';
import { createView, getView, listViews, updateView, deleteView } from '../../graph/views.js';
import { advancedSearch } from '../../graph/query.js';
import type { CreateSavedViewInput, UpdateSavedViewInput } from '../../types.js';

const app = new Hono();

// List saved views
app.get('/views', (c) => {
  try {
    const views = listViews();
    return c.json(views);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Create a saved view
app.post('/views', async (c) => {
  try {
    const body = await c.req.json<CreateSavedViewInput>();
    if (!body.name || !body.filters) {
      return c.json({ error: 'Fields "name" and "filters" are required' }, 400);
    }
    const view = createView(body);
    return c.json(view, 201);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Get a saved view
app.get('/views/:id', (c) => {
  try {
    const id = c.req.param('id');
    const view = getView(id);
    if (!view) {
      return c.json({ error: 'View not found' }, 404);
    }
    return c.json(view);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Update a saved view
app.put('/views/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = getView(id);
    if (!existing) {
      return c.json({ error: 'View not found' }, 404);
    }
    const body = await c.req.json<UpdateSavedViewInput>();
    const view = updateView(id, body);
    return c.json(view);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Delete a saved view
app.delete('/views/:id', (c) => {
  try {
    const id = c.req.param('id');
    const deleted = deleteView(id);
    if (!deleted) {
      return c.json({ error: 'View not found' }, 404);
    }
    return c.json({ deleted: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Execute a saved view (run its filters as a search)
app.get('/views/:id/execute', (c) => {
  try {
    const id = c.req.param('id');
    const view = getView(id);
    if (!view) {
      return c.json({ error: 'View not found' }, 404);
    }
    const nodes = advancedSearch(view.filters);
    return c.json(nodes);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
