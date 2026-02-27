import { consolidate } from './consolidate.js';
import type { ConsolidateResult } from './consolidate.js';
import { runDeduplication } from './deduplicate.js';
import type { DeduplicationResult } from './deduplicate.js';
import { inferEdges } from './infer-edges.js';
import type { InferEdgesResult, InferEdgesConfig } from './infer-edges.js';
import { decayActivation } from '../graph/activation.js';
import { getDb } from '../db/connection.js';
import { createClaudeCodeConfig } from './claude.js';
import type { ClaudeCodeConfig } from './claude.js';

export { consolidate } from './consolidate.js';
export { reinforce } from './reinforce.js';
export { attenuate } from './attenuate.js';
export { runDeduplication } from './deduplicate.js';
export { inferEdges } from './infer-edges.js';
export type { InferEdgesResult, InferEdgesConfig } from './infer-edges.js';
export { startScheduler, stopScheduler, updateScheduler, getSchedulerStatus } from './scheduler.js';
export { createClaudeCodeConfig, queryClaudeCode } from './claude.js';
export type { ClaudeCodeConfig, ClaudeCodeResult } from './claude.js';

export interface ArchivistRunResult {
  consolidation: ConsolidateResult;
  inference: InferEdgesResult;
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
 * 2. Infer edges for newly created/updated nodes (via Claude)
 * 3. Deduplicate semantically similar nodes (requires ANTHROPIC_API_KEY)
 * 4. Run activation decay sweep
 */
export async function runArchivist(
  inferenceConfig?: InferEdgesConfig,
): Promise<ArchivistRunResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // Step 1: Consolidate new events (async for LLM calls)
  const consolidation = await consolidate();

  // Step 2: Infer edges for affected nodes
  const inference = await inferEdges(
    consolidation.affectedNodeIds,
    inferenceConfig,
  );

  // Step 3: Deduplicate semantically similar nodes
  const deduplication = await runDeduplication();

  // Step 4: Decay activation scores
  const decay = decayActivation();

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const result: ArchivistRunResult = {
    consolidation,
    inference,
    deduplication,
    decay,
    timing: {
      startedAt,
      completedAt,
      durationMs,
    },
    runCount: runCount + 1,
  };

  // Update in-memory run tracking (note: consolidation and edge writes
  // are already committed to the DB and are not rolled back on failure)
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
      timeoutMs: claudeCodeConfig.timeoutMs,
      atlasBaseUrl: claudeCodeConfig.atlasBaseUrl,
    },
  };
}
