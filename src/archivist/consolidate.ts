import { getDb } from '../db/connection.js';
import { createEvent } from '../events.js';
import { createNode, getNode, updateNode } from '../graph/nodes.js';
import { createEdge } from '../graph/edges.js';
import { searchNodes, getRecentNodes } from '../graph/query.js';
import { bumpActivation } from '../graph/activation.js';
import { embedNodeAsync } from '../graph/embeddings.js';
import { isLlmAvailable, analyzeEvent } from './llm.js';
import type { CandidateNode } from './llm.js';
import type { Event, NodeType, NodeGranularity } from '../types.js';

export interface ConsolidateResult {
  processed: number;
  nodesCreated: number;
  nodesUpdated: number;
  edgesCreated: number;
  /** IDs of nodes created or updated during this consolidation pass. */
  affectedNodeIds: string[];
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

interface EmbeddingJob {
  nodeId: string;
  title: string;
  content: string;
}

interface EventProcessingDelta {
  nodesCreated: number;
  nodesUpdated: number;
  edgesCreated: number;
  affectedNodeIds: string[];
  embeddingJobs: EmbeddingJob[];
}

/** Parse event content as JSON. Returns null if invalid or missing required fields. */
function parseEventContent(raw: string): EventPayload | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.title !== 'string') return null;
    // Accept "content" or "body" (Obsidian collector uses "body")
    const text = parsed.content ?? parsed.body;
    if (typeof text !== 'string') return null;
    return { ...parsed, content: text } as unknown as EventPayload;
  } catch {
    return null;
  }
}

/** Truncate text to a maximum length, adding ellipsis if truncated. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

/** Gather candidate nodes for LLM context via FTS search + recent nodes. */
function gatherCandidates(title: string): CandidateNode[] {
  const seen = new Set<string>();
  const candidates: CandidateNode[] = [];

  // FTS search on the event title
  try {
    const ftsResults = searchNodes(title, 10);
    for (const node of ftsResults) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        candidates.push({
          id: node.id,
          title: node.title,
          type: node.type,
          tags: node.tags,
          contentPreview: truncate(node.content, 200),
        });
      }
    }
  } catch {
    // FTS query failed — continue with recent nodes only
  }

  // Add recent high-activation nodes for broader context
  try {
    const recent = getRecentNodes(10);
    for (const node of recent) {
      if (!seen.has(node.id) && candidates.length < 15) {
        seen.add(node.id);
        candidates.push({
          id: node.id,
          title: node.title,
          type: node.type,
          tags: node.tags,
          contentPreview: truncate(node.content, 200),
        });
      }
    }
  } catch {
    // Continue without recent nodes
  }

  return candidates;
}

/**
 * Process a single event using FTS title matching (fallback path).
 * Returns the action taken and whether a node was created or updated.
 */
function consolidateWithFts(
  event: Event & { metadata: string | null; processed_at: string | null },
  payload: EventPayload,
): EventProcessingDelta {
  let existing: ReturnType<typeof searchNodes> = [];
  try {
    existing = searchNodes(payload.title, 5);
  } catch {
    // FTS query failed — treat as no match
  }
  const match = existing.find(
    (n) => n.title.toLowerCase() === payload.title!.toLowerCase()
  );

  if (match) {
    const content = `${match.content}\n\n---\n\n${payload.content}`;
    const updated = updateNode(match.id, {
      content,
      change_reason: `Reinforced by event ${event.id}`,
      changed_by: 'archivist/consolidate',
      tags: payload.tags,
      metadata: payload.metadata,
    }, { deferEmbedding: true });

    bumpActivation(match.id);

    createEvent({
      type: 'archivist_action',
      source: 'archivist/consolidate',
      content: JSON.stringify({
        action: 'update',
        event_id: event.id,
        node_id: match.id,
        method: 'fts',
      }),
    });

    return {
      nodesCreated: 0,
      nodesUpdated: 1,
      edgesCreated: 0,
      affectedNodeIds: [match.id],
      embeddingJobs: [{
        nodeId: updated.id,
        title: updated.title,
        content: updated.content,
      }],
    };
  }

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
  }, { deferEmbedding: true });

  createEvent({
    type: 'archivist_action',
    source: 'archivist/consolidate',
    content: JSON.stringify({
      action: 'create',
      event_id: event.id,
      node_id: node.id,
      method: 'fts',
      }),
    });

  return {
    nodesCreated: 1,
    nodesUpdated: 0,
    edgesCreated: 0,
    affectedNodeIds: [node.id],
    embeddingJobs: [{
      nodeId: node.id,
      title: node.title,
      content: node.content,
    }],
  };
}

function consolidateWithLlm(
  event: Event & { metadata: string | null; processed_at: string | null },
  payload: EventPayload,
  analysis: Awaited<ReturnType<typeof analyzeEvent>>,
): EventProcessingDelta {
  let nodeId: string;
  const embeddingJobs: EmbeddingJob[] = [];

  if (analysis.action === 'update' && analysis.matchedNodeId) {
    // Update the existing node with LLM-enriched data
    const existingNode = getNode(analysis.matchedNodeId, true);
    if (!existingNode) {
      throw new Error(`Matched node ${analysis.matchedNodeId} no longer exists`);
    }
    const updated = updateNode(analysis.matchedNodeId, {
      content: `${existingNode.content}\n\n---\n\n${payload.content}`,
      change_reason: `Reinforced by event ${event.id} (LLM consolidation)`,
      changed_by: 'archivist/consolidate',
      type: analysis.type,
      tags: analysis.tags,
      metadata: {
        ...payload.metadata,
        llm_summary: analysis.summary,
      },
    }, { deferEmbedding: true });

    bumpActivation(analysis.matchedNodeId);
    nodeId = analysis.matchedNodeId;

    embeddingJobs.push({
      nodeId: updated.id,
      title: updated.title,
      content: updated.content,
    });

    createEvent({
      type: 'archivist_action',
      source: 'archivist/consolidate',
      content: JSON.stringify({
        action: 'update',
        event_id: event.id,
        node_id: analysis.matchedNodeId,
        method: 'llm',
        llm_summary: analysis.summary,
      }),
    });
  } else {
    // Create a new node with LLM-generated metadata
    const node = createNode({
      type: analysis.type,
      title: analysis.title || payload.title,
      content: payload.content,
      granularity: payload.granularity ?? 'standard',
      tags: analysis.tags,
      metadata: {
        ...payload.metadata,
        source_event_id: event.id,
        llm_summary: analysis.summary,
      },
    }, { deferEmbedding: true });

    nodeId = node.id;
    embeddingJobs.push({
      nodeId: node.id,
      title: node.title,
      content: node.content,
    });

    createEvent({
      type: 'archivist_action',
      source: 'archivist/consolidate',
      content: JSON.stringify({
        action: 'create',
        event_id: event.id,
        node_id: node.id,
        method: 'llm',
        llm_summary: analysis.summary,
      }),
    });
  }

  let edgesCreated = 0;

  // Create edges suggested by the LLM
  for (const edge of analysis.edges) {
    // Skip self-edges
    if (edge.targetNodeId === nodeId) continue;
    try {
      createEdge({
        source_id: nodeId,
        target_id: edge.targetNodeId,
        type: edge.type,
        metadata: { created_by: 'archivist/consolidate-llm' },
      });
      edgesCreated++;
    } catch {
      // Edge creation can fail if target no longer exists — skip
    }
  }

  return {
    nodesCreated: analysis.action === 'update' ? 0 : 1,
    nodesUpdated: analysis.action === 'update' ? 1 : 0,
    edgesCreated,
    affectedNodeIds: [nodeId],
    embeddingJobs,
  };
}

/**
 * Process unprocessed events from the event log into graph nodes.
 *
 * When ANTHROPIC_API_KEY is set, uses Claude for semantic matching:
 * - Determines whether events map to existing nodes or create new ones
 * - Auto-generates tags, summaries, and node type classification
 * - Auto-creates edges between related concepts
 *
 * Falls back to FTS title matching when the LLM is unavailable or errors.
 */
export async function consolidate(): Promise<ConsolidateResult> {
  const db = getDb();

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
  const runEventTransaction = db.transaction(
    (
      eventId: string,
      processedAt: string,
      writeOperation: () => EventProcessingDelta,
    ): EventProcessingDelta => {
      const result = writeOperation();
      markProcessed.run(processedAt, eventId);
      return result;
    },
  );

  let nodesCreated = 0;
  let nodesUpdated = 0;
  let edgesCreated = 0;
  let processed = 0;
  const affectedNodeIds: string[] = [];

  const useLlm = isLlmAvailable();

  for (const event of unprocessed) {
    const now = new Date().toISOString();

    const payload = parseEventContent(event.content);
    if (!payload) {
      runEventTransaction(event.id, now, () => {
        createEvent({
          type: 'archivist_action',
          source: 'archivist/consolidate',
          content: JSON.stringify({
            action: 'skip',
            event_id: event.id,
            reason: 'unparseable content',
          }),
        });

        return {
          nodesCreated: 0,
          nodesUpdated: 0,
          edgesCreated: 0,
          affectedNodeIds: [],
          embeddingJobs: [],
        };
      });
      processed++;
      continue;
    }

    let result: EventProcessingDelta;

    if (useLlm) {
      let analysis: Awaited<ReturnType<typeof analyzeEvent>> | null = null;

      try {
        const candidates = gatherCandidates(payload.title);
        analysis = await analyzeEvent(
          {
            title: payload.title,
            content: payload.content,
            type: payload.type,
            tags: payload.tags,
          },
          candidates,
        );
      } catch (err) {
        // LLM failed — fall back to FTS
        console.error(`[consolidate] LLM error for event ${event.id}, falling back to FTS:`, (err as Error).message);
      }

      if (analysis) {
        try {
          result = runEventTransaction(
            event.id,
            now,
            () => consolidateWithLlm(event, payload, analysis),
          );
        } catch (err) {
          if (!(err instanceof Error) || !err.message.includes('no longer exists')) {
            throw err;
          }

          console.error(`[consolidate] LLM match disappeared for event ${event.id}, falling back to FTS:`, err.message);
          result = runEventTransaction(
            event.id,
            now,
            () => consolidateWithFts(event, payload),
          );
        }
      } else {
        result = runEventTransaction(
          event.id,
          now,
          () => consolidateWithFts(event, payload),
        );
      }
    } else {
      // No LLM available — use FTS fallback
      result = runEventTransaction(
        event.id,
        now,
        () => consolidateWithFts(event, payload),
      );
    }

    nodesCreated += result.nodesCreated;
    nodesUpdated += result.nodesUpdated;
    edgesCreated += result.edgesCreated;
    affectedNodeIds.push(...result.affectedNodeIds);
    for (const job of result.embeddingJobs) {
      embedNodeAsync(job.nodeId, job.title, job.content);
    }
    processed++;
  }

  return { processed, nodesCreated, nodesUpdated, edgesCreated, affectedNodeIds };
}
