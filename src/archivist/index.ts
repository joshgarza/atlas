import { consolidate } from './consolidate.js';
import type { ConsolidateResult } from './consolidate.js';
import { runDeduplication } from './deduplicate.js';
import type { DeduplicationResult } from './deduplicate.js';
import { decayActivation } from '../graph/activation.js';
import { getDb } from '../db/connection.js';
import { createClaudeCodeConfig } from './claude.js';
import type { ClaudeCodeConfig } from './claude.js';

export { consolidate } from './consolidate.js';
export { reinforce } from './reinforce.js';
export { attenuate } from './attenuate.js';
export { runDeduplication } from './deduplicate.js';
export { startScheduler, stopScheduler, updateScheduler, getSchedulerStatus } from './scheduler.js';
export { createClaudeCodeConfig, queryClaudeCode } from './claude.js';
export type { ClaudeCodeConfig, ClaudeCodeResult } from './claude.js';

export interface ArchivistRunResult {
  consolidation: ConsolidateResult;
  deduplication: DeduplicationResult;
  decay: { decayed: number };
  timing: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  runCount: number;
}

export interface ArchivistStatus {
  lastRun: ArchivistRunResult | null;
  runCount: number;
  unprocessedEventCount: number;
  claudeCode: {
    model: string;
    allowedTools: string[];
    maxTurns: number;
    timeoutMs: number;
    atlasBaseUrl: string;
  };
}

// In-memory tracking
let lastRunResult: ArchivistRunResult | null = null;
let runCount = 0;

// Claude Code config (initialized once, readable via status)
const claudeCodeConfig = createClaudeCodeConfig();

/**
 * Run a full archivist cycle:
 * 1. Consolidate unprocessed events into graph nodes
 * 2. Deduplicate semantically similar nodes (requires ANTHROPIC_API_KEY)
 * 3. Run activation decay sweep
 */
export async function runArchivist(): Promise<ArchivistRunResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // Step 1: Consolidate new events (async for LLM calls)
  const consolidation = await consolidate();

  // Step 2: Deduplicate semantically similar nodes
  const deduplication = await runDeduplication();

  // Step 3: Decay activation scores
  const decay = decayActivation();

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const result: ArchivistRunResult = {
    consolidation,
    deduplication,
    decay,
    timing: {
      startedAt,
      completedAt,
      durationMs,
    },
    runCount: runCount + 1,
  };

  // Only update state after all steps succeed
  runCount++;
  lastRunResult = result;
  return result;
}

/**
 * Get the current archivist status.
 */
export function getArchivistStatus(): ArchivistStatus {
  const db = getDb();

  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM events WHERE processed_at IS NULL AND type != 'archivist_action'"
    )
    .get() as { count: number };

  return {
    lastRun: lastRunResult,
    runCount,
    unprocessedEventCount: row.count,
    claudeCode: {
      model: claudeCodeConfig.model,
      allowedTools: claudeCodeConfig.allowedTools,
      maxTurns: claudeCodeConfig.maxTurns,
      timeoutMs: claudeCodeConfig.timeoutMs,
      atlasBaseUrl: claudeCodeConfig.atlasBaseUrl,
    },
  };
}
