import { getDb } from '../db/connection.js';
import { createEvent } from '../events.js';
import { createNode, getNode, updateNode } from '../graph/nodes.js';
import { createEdge } from '../graph/edges.js';
import { searchNodes, getRecentNodes } from '../graph/query.js';
import { bumpActivation } from '../graph/activation.js';
import { embedNodeAsync } from '../graph/embeddings.js';
import { isLlmAvailable, analyzeEvent } from './llm.js';
import type { CandidateNode, LlmConsolidationResult } from './llm.js';
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

interface PendingEmbedding {
  nodeId: string;
  title: string;
  content: string;
}

interface EventProcessingResult {
  nodesCreated: number;
  nodesUpdated: number;
  edgesCreated: number;
  affectedNodeId: string | null;
  embedding?: PendingEmbedding;
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
): EventProcessingResult {
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
    const updatedNode = updateNode(match.id, {
      content: `${match.content}\n\n---\n\n${payload.content}`,
      change_reason: `Reinforced by event ${event.id}`,
      changed_by: 'archivist/consolidate',
      tags: payload.tags,
      metadata: payload.metadata,
    }, { skipEmbedding: true });

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
      affectedNodeId: match.id,
      embedding: {
        nodeId: updatedNode.id,
        title: updatedNode.title,
        content: updatedNode.content,
      },
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
  }, { skipEmbedding: true });

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
    affectedNodeId: node.id,
    embedding: {
      nodeId: node.id,
      title: node.title,
      content: node.content,
    },
  };
}

function consolidateWithLlm(
  event: Event & { metadata: string | null; processed_at: string | null },
  payload: EventPayload,
  analysis: LlmConsolidationResult,
): EventProcessingResult {
  const db = getDb();
  const targetNodeExists = db.prepare('SELECT id FROM nodes WHERE id = ?');

  let nodeId: string;
  let embedding: PendingEmbedding;

  if (analysis.action === 'update' && analysis.matchedNodeId) {
    const existingNode = getNode(analysis.matchedNodeId, true);
    if (!existingNode) {
      throw new Error(`Matched node ${analysis.matchedNodeId} no longer exists`);
    }

    const updatedNode = updateNode(analysis.matchedNodeId, {
      content: `${existingNode.content}\n\n---\n\n${payload.content}`,
      change_reason: `Reinforced by event ${event.id} (LLM consolidation)`,
      changed_by: 'archivist/consolidate',
      type: analysis.type,
      tags: analysis.tags,
      metadata: {
        ...payload.metadata,
        llm_summary: analysis.summary,
      },
    }, { skipEmbedding: true });

    bumpActivation(analysis.matchedNodeId);
    nodeId = analysis.matchedNodeId;
    embedding = {
      nodeId: updatedNode.id,
      title: updatedNode.title,
      content: updatedNode.content,
    };

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
    }, { skipEmbedding: true });

    nodeId = node.id;
    embedding = {
      nodeId: node.id,
      title: node.title,
      content: node.content,
    };

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

  for (const edge of analysis.edges) {
    if (edge.targetNodeId === nodeId) continue;
    if (!targetNodeExists.get(edge.targetNodeId)) continue;

    createEdge({
      source_id: nodeId,
      target_id: edge.targetNodeId,
      type: edge.type,
      metadata: { created_by: 'archivist/consolidate-llm' },
    });
    edgesCreated++;
  }

  return {
    nodesCreated: analysis.action === 'create' ? 1 : 0,
    nodesUpdated: analysis.action === 'update' && analysis.matchedNodeId ? 1 : 0,
    edgesCreated,
    affectedNodeId: nodeId,
    embedding,
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
      db.transaction(() => {
        createEvent({
          type: 'archivist_action',
          source: 'archivist/consolidate',
          content: JSON.stringify({
            action: 'skip',
            event_id: event.id,
            reason: 'unparseable content',
          }),
        });

        markProcessed.run(now, event.id);
      })();
      processed++;
      continue;
    }

    let analysis: LlmConsolidationResult | null = null;
    if (useLlm) {
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
        console.error(`[consolidate] LLM error for event ${event.id}, falling back to FTS:`, (err as Error).message);
      }
    }

    const result = db.transaction(() => {
      const writeResult = analysis
        ? consolidateWithLlm(event, payload, analysis)
        : consolidateWithFts(event, payload);

      markProcessed.run(now, event.id);
      return writeResult;
    })();

    nodesCreated += result.nodesCreated;
    nodesUpdated += result.nodesUpdated;
    edgesCreated += result.edgesCreated;
    if (result.affectedNodeId) affectedNodeIds.push(result.affectedNodeId);
    if (result.embedding) {
      embedNodeAsync(result.embedding.nodeId, result.embedding.title, result.embedding.content);
    }
    processed++;
  }

  return { processed, nodesCreated, nodesUpdated, edgesCreated, affectedNodeIds };
}
