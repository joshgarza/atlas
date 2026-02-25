import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { runArchivist, getArchivistStatus, runDeduplication } from '../../archivist/index.js';
import { stopScheduler, updateScheduler, getSchedulerStatus } from '../../archivist/scheduler.js';
import { archivistScheduleSchema, formatZodError } from '../schemas.js';

const app = new Hono();

// Run full archivist cycle
app.post('/archivist/run', async (c) => {
  try {
    const result = await runArchivist();
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Run deduplication
app.post('/archivist/deduplicate', async (c) => {
  try {
    const result = await runDeduplication();
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Get archivist status
app.get('/archivist/status', (c) => {
  try {
    const status = getArchivistStatus();
    const schedule = getSchedulerStatus();
    return c.json({ ...status, schedule });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Update schedule intervals
app.put('/archivist/schedule',
  zValidator('json', archivistScheduleSchema, (result, c) => {
    if (!result.success) return c.json({ error: formatZodError(result.error) }, 400);
  }),
  async (c) => {
    try {
      const body = c.req.valid('json');
      updateScheduler(body);
      return c.json(getSchedulerStatus());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  },
);

// Stop the scheduler
app.delete('/archivist/schedule', (c) => {
  try {
    stopScheduler();
    return c.json(getSchedulerStatus());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
