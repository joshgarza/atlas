import { consolidate } from './consolidate.js';
import type { ConsolidateResult } from './consolidate.js';
import { decayActivation } from '../graph/activation.js';
import { getDb } from '../db/connection.js';

export { consolidate } from './consolidate.js';
export { reinforce } from './reinforce.js';
export { attenuate } from './attenuate.js';

export interface ArchivistRunResult {
  consolidation: ConsolidateResult;
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
}

// In-memory tracking
let lastRunResult: ArchivistRunResult | null = null;
let runCount = 0;

/**
 * Run a full archivist cycle:
 * 1. Consolidate unprocessed events into graph nodes
 * 2. Run activation decay sweep
 */
export function runArchivist(): ArchivistRunResult {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // Step 1: Consolidate new events
  const consolidation = consolidate();

  // Step 2: Decay activation scores
  const decay = decayActivation();

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  runCount++;

  const result: ArchivistRunResult = {
    consolidation,
    decay,
    timing: {
      startedAt,
      completedAt,
      durationMs,
    },
    runCount,
  };

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
  };
}
