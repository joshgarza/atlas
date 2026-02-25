import { z } from 'zod';
import type { Context } from 'hono';
import type { Hook } from '@hono/zod-validator';
import { MIN_INTERVAL_MS } from '../archivist/scheduler.js';

// --- Enum schemas ---

export const NodeTypeSchema = z.enum(['concept', 'entity', 'preference', 'goal', 'habit', 'observation']);
export const NodeGranularitySchema = z.enum(['broad', 'standard', 'detailed']);
export const NodeStatusSchema = z.enum(['active', 'superseded', 'deprecated']);
export const EdgeTypeSchema = z.enum(['supports', 'contradicts', 'derived_from', 'related_to', 'supersedes', 'part_of']);
export const EventTypeSchema = z.enum(['observation', 'query', 'mutation', 'archivist_action']);

// --- Input schemas ---

export const CreateNodeInputSchema = z.object({
  type: NodeTypeSchema,
  title: z.string(),
  content: z.string(),
  granularity: NodeGranularitySchema,
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateNodeInputSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  granularity: NodeGranularitySchema.optional(),
  type: NodeTypeSchema.optional(),
  status: NodeStatusSchema.optional(),
  superseded_by: z.string().optional(),
  change_reason: z.string().optional(),
  changed_by: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CreateEdgeInputSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  type: EdgeTypeSchema,
  weight: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateEdgeInputSchema = z.object({
  type: EdgeTypeSchema.optional(),
  weight: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CreateEventInputSchema = z.object({
  type: EventTypeSchema,
  source: z.string(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotency_key: z.string().optional(),
});

// --- Validation error hook ---

// Returns first zod error message as { error: "..." } with 400 status.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validationHook: Hook<any, any, any> = (result, c: Context) => {
  if (!result.success) {
    const issue = result.error.issues[0];
    return c.json({ error: issue.message }, 400);
  }
};

// --- Schedule schema ---

export const UpdateScheduleInputSchema = z.object({
  consolidateIntervalMs: z.number().min(MIN_INTERVAL_MS, {
    message: `consolidateIntervalMs must be >= ${MIN_INTERVAL_MS}`,
  }).optional(),
  decayIntervalMs: z.number().min(MIN_INTERVAL_MS, {
    message: `decayIntervalMs must be >= ${MIN_INTERVAL_MS}`,
  }).optional(),
});
