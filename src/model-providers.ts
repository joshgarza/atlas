import type { EdgeType, Node, NodeType } from './types.js';
import { createClaudeCodeConfig, queryClaudeCode } from './archivist/claude.js';

const VALID_NODE_TYPES: NodeType[] = [
  'concept',
  'entity',
  'preference',
  'goal',
  'habit',
  'observation',
];
const VALID_EDGE_TYPES: EdgeType[] = [
  'supports',
  'contradicts',
  'derived_from',
  'related_to',
  'supersedes',
  'part_of',
];

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_REASONING_MODEL = 'claude-haiku-4-5-20251001';
const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_EMBEDDING_MODEL = 'voyage-3';
const VOYAGE_EMBEDDING_DIMENSIONS = 1024;

const EMBEDDING_PROVIDER_NAMES = ['voyage-api', 'disabled'] as const;
const REASONING_PROVIDER_NAMES = [
  'anthropic-api',
  'claude-code',
  'disabled',
] as const;

export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDER_NAMES)[number];
export type ReasoningProviderName = (typeof REASONING_PROVIDER_NAMES)[number];

export interface AiProviderConfig {
  embeddingProvider: EmbeddingProviderName;
  reasoningProvider: ReasoningProviderName;
}

type ProviderEnv = Record<string, string | undefined>;

export interface CandidateNode {
  id: string;
  title: string;
  type: string;
  tags: string[];
  contentPreview: string;
}

export interface EventAnalysisInput {
  title: string;
  content: string;
  type?: string;
  tags?: string[];
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

export interface EdgeInferenceCandidate {
  id: string;
  title: string;
  content: string;
  type: string;
}

export interface EdgeProposal {
  target_id: string;
  type: EdgeType;
  confidence: number;
  reason: string;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  type: string;
  content: string;
  activation: number;
}

export interface DuplicatePair {
  keepId: string;
  removeId: string;
  reason: string;
}

export interface EmbeddingProvider {
  name: EmbeddingProviderName;
  isAvailable(): boolean;
  generate(text: string): Promise<Float32Array>;
}

export interface ReasoningProvider {
  name: ReasoningProviderName;
  isAvailable(): boolean;
  analyzeEvent(
    event: EventAnalysisInput,
    candidates: CandidateNode[],
  ): Promise<LlmConsolidationResult>;
  inferEdges(
    node: Node,
    candidates: EdgeInferenceCandidate[],
  ): Promise<EdgeProposal[]>;
  findDuplicates(nodes: DuplicateCandidate[]): Promise<DuplicatePair[]>;
}

function parseEmbeddingProviderName(
  value: string | undefined,
): EmbeddingProviderName {
  const provider = value ?? 'voyage-api';
  if (provider === 'voyage-api' || provider === 'disabled') {
    return provider;
  }

  throw new Error(
    `Unsupported embedding provider "${provider}". Expected one of: ${EMBEDDING_PROVIDER_NAMES.join(', ')}`,
  );
}

function parseReasoningProviderName(
  value: string | undefined,
): ReasoningProviderName {
  const provider = value ?? 'anthropic-api';
  if (
    provider === 'anthropic-api'
    || provider === 'claude-code'
    || provider === 'disabled'
  ) {
    return provider;
  }

  throw new Error(
    `Unsupported reasoning provider "${provider}". Expected one of: ${REASONING_PROVIDER_NAMES.join(', ')}`,
  );
}

export function getAiProviderConfig(
  env: ProviderEnv = process.env,
): AiProviderConfig {
  return {
    embeddingProvider: parseEmbeddingProviderName(env.ATLAS_EMBEDDING_PROVIDER),
    reasoningProvider: parseReasoningProviderName(env.ATLAS_REASONING_PROVIDER),
  };
}

export function getEmbeddingProvider(
  env: ProviderEnv = process.env,
): EmbeddingProvider {
  const { embeddingProvider } = getAiProviderConfig(env);

  switch (embeddingProvider) {
    case 'disabled':
      return disabledEmbeddingProvider;
    case 'voyage-api':
      return voyageEmbeddingProvider;
  }
}

export function getReasoningProvider(
  env: ProviderEnv = process.env,
): ReasoningProvider {
  const { reasoningProvider } = getAiProviderConfig(env);

  switch (reasoningProvider) {
    case 'anthropic-api':
      return anthropicReasoningProvider;
    case 'claude-code':
      return claudeCodeReasoningProvider;
    case 'disabled':
      return disabledReasoningProvider;
  }
}

async function callAnthropic(
  prompt: string,
  maxTokens: number,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_REASONING_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const text = data.content.find((block) => block.type === 'text')?.text;
  if (!text) {
    throw new Error('Empty response from Anthropic API');
  }

  return text;
}

function extractJsonObject(text: string): string {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in reasoning response');
  }

  return jsonMatch[0];
}

function extractJsonArray(text: string): string {
  const cleaned = text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('No JSON array found in reasoning response');
  }

  return jsonMatch[0];
}

function buildEventAnalysisPrompt(
  event: EventAnalysisInput,
  candidates: CandidateNode[],
): string {
  const candidateList = candidates.length > 0
    ? candidates
      .map((candidate) =>
        `- [${candidate.id}] "${candidate.title}" (type: ${candidate.type}, tags: ${candidate.tags.join(', ') || 'none'})\n  ${candidate.contentPreview}`,
      )
      .join('\n')
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

function validateConsolidationResult(
  raw: Record<string, unknown>,
  candidates: CandidateNode[],
): LlmConsolidationResult {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));

  const action = raw.action === 'update' ? 'update' : 'create';

  let matchedNodeId: string | undefined;
  if (action === 'update' && typeof raw.matchedNodeId === 'string') {
    if (candidateIds.has(raw.matchedNodeId)) {
      matchedNodeId = raw.matchedNodeId;
    }
  }

  const finalAction = action === 'update' && !matchedNodeId ? 'create' : action;

  const type = VALID_NODE_TYPES.includes(raw.type as NodeType)
    ? (raw.type as NodeType)
    : 'observation';

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  const edges: LlmEdgeSuggestion[] = [];
  if (Array.isArray(raw.edges)) {
    for (const edge of raw.edges) {
      if (typeof edge !== 'object' || edge === null) {
        continue;
      }

      const record = edge as Record<string, unknown>;
      if (
        typeof record.targetNodeId === 'string'
        && candidateIds.has(record.targetNodeId)
        && VALID_EDGE_TYPES.includes(record.type as EdgeType)
      ) {
        edges.push({
          targetNodeId: record.targetNodeId,
          type: record.type as EdgeType,
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

function buildEdgeInferencePrompt(
  node: Node,
  candidates: EdgeInferenceCandidate[],
): string {
  const candidateList = candidates
    .map(
      (candidate) =>
        `- ID: ${candidate.id}\n  Title: ${candidate.title}\n  Type: ${candidate.type}\n  Content: ${candidate.content.slice(0, 300)}`,
    )
    .join('\n');

  return `You are the Archivist of a personal knowledge graph. Your task is to identify semantic relationships between a new node and existing nodes.

## New node
- Title: ${node.title}
- Type: ${node.type}
- Content: ${node.content.slice(0, 500)}

## Candidate nodes
${candidateList}

## Edge types
- supports: the new node provides evidence for or reinforces the candidate
- contradicts: the new node conflicts with the candidate
- derived_from: the new node is derived from or builds on the candidate
- related_to: the nodes share a topic or theme
- part_of: the new node is a component or subset of the candidate

## Instructions
Analyze the new node against each candidate. Return ONLY a JSON array of proposed edges. Each edge object must have:
- "target_id": the candidate node ID
- "type": one of the edge types above
- "confidence": a number from 0.0 to 1.0
- "reason": a brief explanation (one sentence)

Only propose edges where there is a meaningful semantic relationship. If no relationships exist, return an empty array.

Respond with ONLY the JSON array, no other text.`;
}

function parseEdgeProposals(
  text: string,
  candidates: EdgeInferenceCandidate[],
): EdgeProposal[] {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));

  let parsed: unknown[];
  try {
    parsed = JSON.parse(extractJsonArray(text)) as unknown[];
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const proposals: EdgeProposal[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const proposal = item as Record<string, unknown>;
    const targetId = proposal.target_id;
    const type = proposal.type;
    const confidence = proposal.confidence;
    const reason = proposal.reason;

    if (typeof targetId !== 'string' || !candidateIds.has(targetId)) {
      continue;
    }
    if (typeof type !== 'string' || !VALID_EDGE_TYPES.includes(type as EdgeType)) {
      continue;
    }
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
      continue;
    }
    if (typeof reason !== 'string') {
      continue;
    }

    proposals.push({
      target_id: targetId,
      type: type as EdgeType,
      confidence,
      reason,
    });
  }

  return proposals;
}

function buildDuplicatePrompt(nodes: DuplicateCandidate[]): string {
  const summaries = nodes.map((node) => {
    const snippet = node.content.length > 200
      ? `${node.content.slice(0, 200)}...`
      : node.content;

    return `- [${node.id}] "${node.title}" (type: ${node.type}, activation: ${node.activation.toFixed(2)})\n  Content: ${snippet}`;
  });

  return `You are analyzing a knowledge graph for near-duplicate nodes, nodes that represent the same concept but with different phrasing, abbreviations, or minor variations.

Given these nodes:
${summaries.join('\n')}

Identify pairs that are near-duplicates (same underlying concept, different phrasing). For each pair, choose which node to KEEP (prefer higher activation, more content, or better title) and which to REMOVE (merge into the kept node).

Return ONLY a JSON array. No explanation, no markdown fencing. Example:
[{"keepId":"abc","removeId":"xyz","reason":"Both describe the same concept"}]

If no duplicates exist, return: []

Important:
- Only flag true duplicates (same concept, different words). Related but distinct concepts are NOT duplicates.
- Be conservative, only flag pairs you are confident about.`;
}

function parseDuplicatePairs(text: string): DuplicatePair[] {
  try {
    const pairs = JSON.parse(extractJsonArray(text)) as DuplicatePair[];
    if (!Array.isArray(pairs)) {
      return [];
    }

    return pairs.filter(
      (pair) =>
        typeof pair.keepId === 'string'
        && typeof pair.removeId === 'string'
        && typeof pair.reason === 'string',
    );
  } catch {
    return [];
  }
}

const voyageEmbeddingProvider: EmbeddingProvider = {
  name: 'voyage-api',
  isAvailable(): boolean {
    return !!(process.env.VOYAGE_API_KEY || process.env.ANTHROPIC_API_KEY);
  },
  async generate(text: string): Promise<Float32Array> {
    const apiKey = process.env.VOYAGE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'No embedding API key set (VOYAGE_API_KEY or ANTHROPIC_API_KEY)',
      );
    }

    const response = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_EMBEDDING_MODEL,
        input: text,
        output_dimension: VOYAGE_EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    const embedding = data.data[0]?.embedding;
    if (
      !embedding
      || embedding.length !== VOYAGE_EMBEDDING_DIMENSIONS
    ) {
      throw new Error(
        `Unexpected embedding dimensions: expected ${VOYAGE_EMBEDDING_DIMENSIONS}, got ${embedding?.length ?? 0}`,
      );
    }

    return new Float32Array(embedding);
  },
};

const disabledEmbeddingProvider: EmbeddingProvider = {
  name: 'disabled',
  isAvailable(): boolean {
    return false;
  },
  async generate(): Promise<Float32Array> {
    throw new Error('Embedding provider is disabled');
  },
};

const anthropicReasoningProvider: ReasoningProvider = {
  name: 'anthropic-api',
  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  },
  async analyzeEvent(
    event: EventAnalysisInput,
    candidates: CandidateNode[],
  ): Promise<LlmConsolidationResult> {
    const prompt = buildEventAnalysisPrompt(event, candidates);
    const responseText = await callAnthropic(prompt, 1024);
    const raw = JSON.parse(extractJsonObject(responseText)) as Record<
      string,
      unknown
    >;
    return validateConsolidationResult(raw, candidates);
  },
  async inferEdges(
    node: Node,
    candidates: EdgeInferenceCandidate[],
  ): Promise<EdgeProposal[]> {
    const prompt = buildEdgeInferencePrompt(node, candidates);
    const responseText = await callAnthropic(prompt, 1024);
    return parseEdgeProposals(responseText, candidates);
  },
  async findDuplicates(nodes: DuplicateCandidate[]): Promise<DuplicatePair[]> {
    if (nodes.length < 2) {
      return [];
    }

    const prompt = buildDuplicatePrompt(nodes);
    const responseText = await callAnthropic(prompt, 4096);
    return parseDuplicatePairs(responseText);
  },
};

const claudeCodeReasoningProvider: ReasoningProvider = {
  name: 'claude-code',
  isAvailable(): boolean {
    return true;
  },
  async analyzeEvent(
    event: EventAnalysisInput,
    candidates: CandidateNode[],
  ): Promise<LlmConsolidationResult> {
    const prompt = buildEventAnalysisPrompt(event, candidates);
    const response = await queryClaudeCode(prompt, createClaudeCodeConfig());
    const raw = JSON.parse(extractJsonObject(response.result)) as Record<
      string,
      unknown
    >;
    return validateConsolidationResult(raw, candidates);
  },
  async inferEdges(
    node: Node,
    candidates: EdgeInferenceCandidate[],
  ): Promise<EdgeProposal[]> {
    const prompt = buildEdgeInferencePrompt(node, candidates);
    const response = await queryClaudeCode(prompt, createClaudeCodeConfig());
    return parseEdgeProposals(response.result, candidates);
  },
  async findDuplicates(nodes: DuplicateCandidate[]): Promise<DuplicatePair[]> {
    if (nodes.length < 2) {
      return [];
    }

    const prompt = buildDuplicatePrompt(nodes);
    const response = await queryClaudeCode(prompt, createClaudeCodeConfig());
    return parseDuplicatePairs(response.result);
  },
};

const disabledReasoningProvider: ReasoningProvider = {
  name: 'disabled',
  isAvailable(): boolean {
    return false;
  },
  async analyzeEvent(): Promise<LlmConsolidationResult> {
    throw new Error('Reasoning provider is disabled');
  },
  async inferEdges(): Promise<EdgeProposal[]> {
    throw new Error('Reasoning provider is disabled');
  },
  async findDuplicates(): Promise<DuplicatePair[]> {
    throw new Error('Reasoning provider is disabled');
  },
};
