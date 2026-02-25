import type { NodeType, EdgeType } from '../types.js';

const VALID_NODE_TYPES: NodeType[] = ['concept', 'entity', 'preference', 'goal', 'habit', 'observation'];
const VALID_EDGE_TYPES: EdgeType[] = ['supports', 'contradicts', 'derived_from', 'related_to', 'supersedes', 'part_of'];

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export interface CandidateNode {
  id: string;
  title: string;
  type: string;
  tags: string[];
  contentPreview: string;
}

export interface LlmEdgeSuggestion {
  targetNodeId: string;
  type: EdgeType;
}

export interface LlmConsolidationResult {
  action: 'create' | 'update';
  matchedNodeId?: string;
  title: string;
  summary: string;
  type: NodeType;
  tags: string[];
  edges: LlmEdgeSuggestion[];
}

interface EventInput {
  title: string;
  content: string;
  type?: string;
  tags?: string[];
}

/** Check if LLM consolidation is available (API key is set). */
export function isLlmAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function buildPrompt(event: EventInput, candidates: CandidateNode[]): string {
  const candidateList = candidates.length > 0
    ? candidates.map((c) =>
        `- [${c.id}] "${c.title}" (type: ${c.type}, tags: ${c.tags.join(', ') || 'none'})\n  ${c.contentPreview}`
      ).join('\n')
    : '(no existing nodes)';

  const eventTags = event.tags?.length ? `\nTags: ${event.tags.join(', ')}` : '';
  const eventType = event.type ? `\nSuggested type: ${event.type}` : '';

  return `You are the Archivist for Atlas, a personal memory service. Process this incoming event into a knowledge graph.

## Incoming Event
Title: ${event.title}
Content: ${event.content}${eventType}${eventTags}

## Existing Nodes
${candidateList}

## Task
1. Decide: UPDATE an existing node or CREATE a new one?
   - UPDATE if the event is clearly about the same concept/entity as an existing node (semantic match, not just title)
   - CREATE if it represents a genuinely new concept, entity, or observation
2. Classify the node type: concept, entity, preference, goal, habit, or observation
3. Generate 2-5 lowercase hyphenated tags (e.g., "machine-learning")
4. Write a 1-2 sentence summary
5. Suggest edges to related existing nodes (if any candidates are related)

Respond with ONLY valid JSON (no markdown fences, no explanation):
{
  "action": "create" or "update",
  "matchedNodeId": "id of matched node (only if action is update)",
  "title": "refined title",
  "summary": "1-2 sentence summary",
  "type": "concept|entity|preference|goal|habit|observation",
  "tags": ["tag1", "tag2"],
  "edges": [{"targetNodeId": "node-id", "type": "related_to|supports|contradicts|derived_from|part_of"}]
}`;
}

/** Validate and normalize the LLM response. */
function validateResult(
  raw: Record<string, unknown>,
  candidates: CandidateNode[],
): LlmConsolidationResult {
  const candidateIds = new Set(candidates.map((c) => c.id));

  const action = raw.action === 'update' ? 'update' : 'create';

  let matchedNodeId: string | undefined;
  if (action === 'update' && typeof raw.matchedNodeId === 'string') {
    if (candidateIds.has(raw.matchedNodeId)) {
      matchedNodeId = raw.matchedNodeId;
    }
  }

  // If LLM said update but the node ID isn't valid, fall back to create
  const finalAction = action === 'update' && !matchedNodeId ? 'create' : action;

  const type = VALID_NODE_TYPES.includes(raw.type as NodeType)
    ? (raw.type as NodeType)
    : 'observation';

  const tags = Array.isArray(raw.tags)
    ? (raw.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];

  const edges: LlmEdgeSuggestion[] = [];
  if (Array.isArray(raw.edges)) {
    for (const e of raw.edges as Array<Record<string, unknown>>) {
      if (
        typeof e.targetNodeId === 'string' &&
        candidateIds.has(e.targetNodeId) &&
        VALID_EDGE_TYPES.includes(e.type as EdgeType)
      ) {
        edges.push({
          targetNodeId: e.targetNodeId,
          type: e.type as EdgeType,
        });
      }
    }
  }

  return {
    action: finalAction,
    matchedNodeId: finalAction === 'update' ? matchedNodeId : undefined,
    title: typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : '',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    type,
    tags,
    edges,
  };
}

/** Call Claude to analyze an event for consolidation. */
export async function analyzeEvent(
  event: EventInput,
  candidates: CandidateNode[],
): Promise<LlmConsolidationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const prompt = buildPrompt(event, candidates);

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content[0]?.text;
  if (!text) {
    throw new Error('Empty response from Anthropic API');
  }

  // Extract JSON from response (handle potential markdown wrapping)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in LLM response');
  }

  const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  return validateResult(raw, candidates);
}
