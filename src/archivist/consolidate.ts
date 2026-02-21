import { getDb } from '../db/connection.js';
import { createEvent } from '../events.js';
import { createNode, updateNode } from '../graph/nodes.js';
import { searchNodes } from '../graph/query.js';
import { bumpActivation } from '../graph/activation.js';
import type { Event, NodeType, NodeGranularity } from '../types.js';

export interface ConsolidateResult {
  processed: number;
  nodesCreated: number;
  nodesUpdated: number;
}

/** Shape of structured event content from Collectors. */
interface EventPayload {
  type?: NodeType;
  title: string;
  content: string;
  granularity?: NodeGranularity;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/** Parse event content as JSON. Returns null if invalid or missing required fields. */
function parseEventContent(content: string): EventPayload | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.title !== 'string' || typeof parsed.content !== 'string') return null;
    return parsed as unknown as EventPayload;
  } catch {
    return null;
  }
}

/**
 * Process unprocessed events from the event log into graph nodes.
 *
 * For each unprocessed event:
 * - Parse its JSON content
 * - Check if a similar node already exists (via FTS)
 * - If exists: update the existing node and create a derived_from edge
 * - If new: create a new node
 * - Mark the event as processed
 * - Log an archivist_action event
 */
export function consolidate(): ConsolidateResult {
  const db = getDb();

  // Fetch unprocessed events ordered by creation time
  const unprocessed = db
    .prepare(
      `SELECT * FROM events
       WHERE processed_at IS NULL AND type != 'archivist_action'
       ORDER BY created_at ASC`
    )
    .all() as Array<Event & { metadata: string | null; processed_at: string | null }>;

  const markProcessed = db.prepare(
    'UPDATE events SET processed_at = ? WHERE id = ?'
  );

  let nodesCreated = 0;
  let nodesUpdated = 0;
  let processed = 0;

  for (const event of unprocessed) {
    const now = new Date().toISOString();

    const payload = parseEventContent(event.content);
    if (!payload) {
      // Cannot parse — mark processed but skip node creation
      markProcessed.run(now, event.id);
      processed++;
      createEvent({
        type: 'archivist_action',
        source: 'archivist/consolidate',
        content: JSON.stringify({
          action: 'skip',
          event_id: event.id,
          reason: 'unparseable content',
        }),
      });
      continue;
    }

    // Search for existing similar nodes by title
    const existing = searchNodes(payload.title, 5);
    const match = existing.find(
      (n) => n.title.toLowerCase() === payload.title!.toLowerCase()
    );

    if (match) {
      // Reinforce the existing node
      updateNode(match.id, {
        content: `${match.content}\n\n---\n\n${payload.content}`,
        change_reason: `Reinforced by event ${event.id}`,
        changed_by: 'archivist/consolidate',
        tags: payload.tags,
        metadata: payload.metadata,
      });

      bumpActivation(match.id);

      nodesUpdated++;

      createEvent({
        type: 'archivist_action',
        source: 'archivist/consolidate',
        content: JSON.stringify({
          action: 'update',
          event_id: event.id,
          node_id: match.id,
        }),
      });
    } else {
      // Create a new node
      const node = createNode({
        type: payload.type ?? 'observation',
        title: payload.title,
        content: payload.content,
        granularity: payload.granularity ?? 'standard',
        tags: payload.tags,
        metadata: {
          ...payload.metadata,
          source_event_id: event.id,
        },
      });

      nodesCreated++;

      createEvent({
        type: 'archivist_action',
        source: 'archivist/consolidate',
        content: JSON.stringify({
          action: 'create',
          event_id: event.id,
          node_id: node.id,
        }),
      });
    }

    markProcessed.run(now, event.id);
    processed++;
  }

  return { processed, nodesCreated, nodesUpdated };
}
