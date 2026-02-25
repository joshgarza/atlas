import { Hono } from 'hono';
import { createEvent } from '../../events.js';
import type { CreateEventInput } from '../../types.js';

const app = new Hono();

// Create an event
app.post('/events', async (c) => {
  try {
    const body = await c.req.json<CreateEventInput>();
    const { deduplicated, ...event } = createEvent(body);
    return c.json(event, deduplicated ? 200 : 201);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
