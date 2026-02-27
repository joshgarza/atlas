import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Configuration for the headless Claude Code instance used by the Archivist. */
export interface ClaudeCodeConfig {
  /** Claude model to use (default: 'sonnet') */
  model: string;
  /** System prompt describing the Archivist's role and constraints */
  systemPrompt: string;
  /**
   * Tools Claude Code is permitted to use (empty array = pure reasoning, no tools).
   *
   * Default is empty: the Archivist operates in pure reasoning mode with no tool
   * access. Callers should provide all necessary context in the prompt. This avoids
   * the security gap where WebFetch could make mutating HTTP requests to the Atlas API.
   */
  allowedTools: string[];
  /** Timeout for a single invocation in milliseconds */
  timeoutMs: number;
  /** Base URL for the Atlas API (referenced in system prompt for read-only access) */
  atlasBaseUrl: string;
}

/** Result from a Claude Code invocation. */
export interface ClaudeCodeResult {
  result: string;
  costUsd: number;
  durationMs: number;
  sessionId: string;
}

const DEFAULT_ATLAS_BASE_URL = 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

function buildSystemPrompt(atlasBaseUrl: string): string {
  return [
    'You are the Archivist, the internal reasoning engine of Atlas — a personal memory service.',
    'Your role is to process events and reason about knowledge graph structure.',
    '',
    'Constraints:',
    '- You have READ-ONLY access to the Atlas API. Never create, update, or delete data.',
    '- You must not access the filesystem or execute shell commands.',
    '- Return your analysis as structured JSON when asked.',
    '',
    'Atlas API (read-only):',
    `  Base URL: ${atlasBaseUrl}`,
    '  GET /nodes                — List nodes (?type=, ?status=, ?limit=, ?offset=)',
    '  GET /nodes/:id?peek=true  — Read a node without affecting activation',
    '  GET /nodes/:id/edges      — Get edges for a node',
    '  GET /search?q=...         — Full-text search across nodes',
    '  GET /search/related/:id   — Find related nodes via graph traversal',
    '  GET /search/recent        — Recently accessed nodes',
    '',
    'When analyzing events for consolidation, consider:',
    '1. Whether the event content matches an existing node (semantic similarity, not just title)',
    '2. What type of node best represents the content (concept, entity, preference, goal, habit, observation)',
    '3. What edges should connect related concepts',
    '4. Whether existing nodes should be reinforced or attenuated',
  ].join('\n');
}

/**
 * Create a Claude Code configuration with sensible defaults.
 *
 * Environment variables:
 * - ARCHIVIST_MODEL: Claude model (default: 'sonnet')
 * - ARCHIVIST_TIMEOUT_MS: Invocation timeout in ms (default: 120000)
 * - ATLAS_BASE_URL: Atlas API base URL (default: 'http://localhost:3001')
 */
export function createClaudeCodeConfig(overrides?: Partial<ClaudeCodeConfig>): ClaudeCodeConfig {
  const atlasBaseUrl = overrides?.atlasBaseUrl
    ?? process.env.ATLAS_BASE_URL
    ?? DEFAULT_ATLAS_BASE_URL;

  const defaults: ClaudeCodeConfig = {
    model: process.env.ARCHIVIST_MODEL ?? 'sonnet',
    systemPrompt: buildSystemPrompt(atlasBaseUrl),
    allowedTools: [],
    timeoutMs: parseInt(process.env.ARCHIVIST_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS), 10),
    atlasBaseUrl,
  };

  return { ...defaults, ...overrides };
}

/**
 * Query a headless Claude Code instance with strict permission boundaries.
 *
 * Spawns `claude -p` in non-interactive mode with:
 * - JSON output format for structured parsing
 * - Model selection via --model
 * - Tool restrictions via --tools "" (default: pure reasoning, no tools)
 * - No filesystem access, no shell access
 */
export async function queryClaudeCode(
  prompt: string,
  config: ClaudeCodeConfig,
): Promise<ClaudeCodeResult> {
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--model', config.model,
    '--system-prompt', config.systemPrompt,
  ];

  // Permission boundaries: restrict available tools
  if (config.allowedTools.length > 0) {
    args.push('--allowedTools', config.allowedTools.join(','));
  } else {
    // Pure reasoning mode: disable all tools
    args.push('--tools', '');
  }

  let stdout: string;
  try {
    const result = await execFileAsync('claude', args, {
      timeout: config.timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
      env: process.env,
    });
    stdout = result.stdout;
  } catch (err) {
    const error = err as Error & { killed?: boolean; code?: string | number };
    if (error.killed) {
      throw new Error(`Claude Code invocation timed out after ${config.timeoutMs}ms`);
    }
    throw new Error(`Claude Code invocation failed: ${error.message}`);
  }

  let response: Record<string, unknown>;
  try {
    response = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Claude Code returned invalid JSON (${stdout.length} bytes): ${stdout.slice(0, 200)}`,
    );
  }

  if (response.is_error) {
    throw new Error(`Claude Code error: ${String(response.result ?? 'unknown error')}`);
  }

  return {
    result: String(response.result ?? ''),
    costUsd: Number(response.cost_usd ?? 0),
    durationMs: Number(response.duration_ms ?? 0),
    sessionId: String(response.session_id ?? ''),
  };
}
