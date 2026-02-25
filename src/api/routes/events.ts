import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createEvent } from '../../events.js';
import { createEventSchema, formatZodError } from '../schemas.js';

const app = new Hono();

// Create an event
app.post('/events',
  zValidator('json', createEventSchema, (result, c) => {
    if (!result.success) return c.json({ error: formatZodError(result.error) }, 400);
  }),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const event = createEvent(body);
      return c.json(event, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  },
);

export default app;
