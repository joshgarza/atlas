import { Hono } from 'hono';
import { getDb } from '../../db/connection.js';
import { getNodeTags } from '../../graph/nodes.js';
import { getRecentNodes } from '../../graph/query.js';
import { getArchivistStatus } from '../../archivist/index.js';
import { getSchedulerStatus } from '../../archivist/scheduler.js';

const app = new Hono();

// Session briefing — compact digest for priming agent sessions
app.get('/session/briefing', (c) => {
  try {
    const db = getDb();

    // 1. Recent events from the last 24h (excluding archivist_action), limit 10
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentEvents = (
      db
        .prepare(
          `SELECT id, type, source, content, created_at
           FROM events
           WHERE created_at >= ? AND type != 'archivist_action'
           ORDER BY created_at DESC
           LIMIT 10`
        )
        .all(since) as { id: string; type: string; source: string; content: string; created_at: string }[]
    ).map((e) => ({
      id: e.id,
      type: e.type,
      source: e.source,
      preview: e.content.length > 100 ? e.content.slice(0, 100) + '...' : e.content,
      created_at: e.created_at,
    }));

    // 2. High-activation nodes (top 5, active only, peek semantics via direct query)
    const highActivationRows = db
      .prepare(
        `SELECT id, title, type, activation
         FROM nodes
         WHERE status = 'active'
         ORDER BY activation DESC
         LIMIT 5`
      )
      .all() as { id: string; title: string; type: string; activation: number }[];

    const highActivationNodes = highActivationRows.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      activation: row.activation,
      tags: getNodeTags(db, row.id),
    }));

    // 3. Archivist status (compact)
    const status = getArchivistStatus();
    const schedule = getSchedulerStatus();
    const archivistStatus = {
      unprocessedEventCount: status.unprocessedEventCount,
      lastRunAt: status.lastRun?.timing?.completedAt ?? null,
      schedulerRunning: schedule.running,
    };

    // 4. Recently accessed/created nodes (limit 5, strip content for compactness)
    const recentNodesFull = getRecentNodes(5);
    const recentNodes = recentNodesFull.map((n) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      activation: n.activation,
      tags: n.tags,
      last_accessed_at: n.last_accessed_at,
    }));

    return c.json({
      recentEvents,
      highActivationNodes,
      archivistStatus,
      recentNodes,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
