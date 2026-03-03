import { serve } from '@hono/node-server';
import { startScheduler } from '../archivist/scheduler.js';
import { seedPersonality } from '../seeds/personality.js';
import app from './app.js';

const port = parseInt(process.env.PORT ?? '3001', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Atlas server running on http://localhost:${port}`);
  try {
    seedPersonality();
  } catch (err) {
    console.error('[seed] personality seed failed:', (err as Error).message);
  }
  startScheduler();
});

export default app;
