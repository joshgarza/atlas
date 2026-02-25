import { consolidate } from './consolidate.js';
import { runArchivist } from './index.js';

const DEFAULT_CONSOLIDATE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SchedulerConfig {
  consolidateIntervalMs: number;
  decayIntervalMs: number;
}

export interface SchedulerStatus {
  running: boolean;
  consolidateIntervalMs: number;
  decayIntervalMs: number;
  lastConsolidateAt: string | null;
  lastDecayAt: string | null;
  consolidateRunCount: number;
  decayRunCount: number;
}

let consolidateTimer: ReturnType<typeof setInterval> | null = null;
let decayTimer: ReturnType<typeof setInterval> | null = null;

let config: SchedulerConfig = {
  consolidateIntervalMs: parseInt(
    process.env.ARCHIVIST_CONSOLIDATE_INTERVAL_MS ?? String(DEFAULT_CONSOLIDATE_INTERVAL_MS),
    10
  ),
  decayIntervalMs: parseInt(
    process.env.ARCHIVIST_DECAY_INTERVAL_MS ?? String(DEFAULT_DECAY_INTERVAL_MS),
    10
  ),
};

let lastConsolidateAt: string | null = null;
let lastDecayAt: string | null = null;
let consolidateRunCount = 0;
let decayRunCount = 0;

function runConsolidate(): void {
  try {
    consolidate();
    lastConsolidateAt = new Date().toISOString();
    consolidateRunCount++;
    console.log(`[scheduler] consolidation complete at ${lastConsolidateAt}`);
  } catch (err) {
    console.error('[scheduler] consolidation error:', (err as Error).message);
  }
}

function runDecay(): void {
  try {
    runArchivist();
    lastDecayAt = new Date().toISOString();
    decayRunCount++;
    console.log(`[scheduler] full archivist cycle (with decay) complete at ${lastDecayAt}`);
  } catch (err) {
    console.error('[scheduler] decay cycle error:', (err as Error).message);
  }
}

/**
 * Start the archivist scheduler with two timers:
 * - Consolidation runs frequently (default: every 30 minutes)
 * - Full cycle with decay runs less often (default: every 24 hours)
 */
export function startScheduler(overrides?: Partial<SchedulerConfig>): void {
  if (consolidateTimer || decayTimer) {
    stopScheduler();
  }

  if (overrides) {
    config = { ...config, ...overrides };
  }

  consolidateTimer = setInterval(runConsolidate, config.consolidateIntervalMs);
  decayTimer = setInterval(runDecay, config.decayIntervalMs);

  console.log(
    `[scheduler] started — consolidation every ${config.consolidateIntervalMs}ms, decay every ${config.decayIntervalMs}ms`
  );
}

/**
 * Stop the archivist scheduler.
 */
export function stopScheduler(): void {
  if (consolidateTimer) {
    clearInterval(consolidateTimer);
    consolidateTimer = null;
  }
  if (decayTimer) {
    clearInterval(decayTimer);
    decayTimer = null;
  }
  console.log('[scheduler] stopped');
}

/**
 * Update scheduler intervals at runtime. Restarts timers with new config.
 * If the scheduler is stopped, it will be started with the new config.
 */
export function updateScheduler(overrides: Partial<SchedulerConfig>): void {
  config = { ...config, ...overrides };
  startScheduler();
}

/**
 * Get the current scheduler status.
 */
export function getSchedulerStatus(): SchedulerStatus {
  return {
    running: consolidateTimer !== null || decayTimer !== null,
    consolidateIntervalMs: config.consolidateIntervalMs,
    decayIntervalMs: config.decayIntervalMs,
    lastConsolidateAt,
    lastDecayAt,
    consolidateRunCount,
    decayRunCount,
  };
}
