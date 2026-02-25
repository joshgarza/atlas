import { z } from 'zod';
import { MIN_INTERVAL_MS } from '../archivist/scheduler.js';

// --- Enum values (must match types.ts) ---

const nodeTypes = ['concept', 'entity', 'preference', 'goal', 'habit', 'observation'] as const;
const nodeGranularities = ['broad', 'standard', 'detailed'] as const;
const nodeStatuses = ['active', 'superseded', 'deprecated'] as const;
const edgeTypes = ['supports', 'contradicts', 'derived_from', 'related_to', 'supersedes', 'part_of'] as const;
const eventTypes = ['observation', 'query', 'mutation', 'archivist_action'] as const;

// --- Body schemas ---

export const createNodeSchema = z.object({
  type: z.enum(nodeTypes),
  title: z.string(),
  content: z.string(),
  granularity: z.enum(nodeGranularities),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateNodeSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  granularity: z.enum(nodeGranularities).optional(),
  type: z.enum(nodeTypes).optional(),
  status: z.enum(nodeStatuses).optional(),
  superseded_by: z.string().optional(),
  change_reason: z.string().optional(),
  changed_by: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const createEdgeSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  type: z.enum(edgeTypes),
  weight: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const createEventSchema = z.object({
  type: z.enum(eventTypes),
  source: z.string(),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const archivistScheduleSchema = z.object({
  consolidateIntervalMs: z.number().min(MIN_INTERVAL_MS).optional(),
  decayIntervalMs: z.number().min(MIN_INTERVAL_MS).optional(),
});

// --- Query schemas ---

export const nodeListQuery = z.object({
  type: z.enum(nodeTypes).optional(),
  status: z.enum(nodeStatuses).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export const nodeGetQuery = z.object({
  peek: z.string().optional(),
});

export const searchQuery = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().positive().optional(),
});

export const relatedQuery = z.object({
  depth: z.coerce.number().int().positive().optional(),
});

export const recentQuery = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

// --- Error formatting ---

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.length > 0 ? i.path.map((p) => `"${p}"`).join('.') + ': ' : '';
      return `${path}${i.message}`;
    })
    .join(', ');
}
