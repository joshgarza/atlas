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
export const SortFieldSchema = z.enum(['activation', 'recency', 'created_at']);
export const SortOrderSchema = z.enum(['asc', 'desc']);

function parseOptionalQueryNumber(schema: z.ZodNumber) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? Number(trimmed) : value;
  }, schema).optional();
}

const QueryTagsSchema = z.string().transform((value) =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
);

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

// --- Query parameter schemas ---

export const NodeListQuerySchema = z.object({
  type: NodeTypeSchema.optional(),
  status: NodeStatusSchema.optional(),
  limit: parseOptionalQueryNumber(z.number().int().positive()),
  offset: parseOptionalQueryNumber(z.number().int().nonnegative()),
});

export const NodeGetQuerySchema = z.object({
  peek: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
});

export const EdgeListQuerySchema = z.object({
  type: EdgeTypeSchema.optional(),
  limit: parseOptionalQueryNumber(z.number().int().positive()),
  offset: parseOptionalQueryNumber(z.number().int().nonnegative()),
});

export const SearchQuerySchema = z.object({
  q: z.string({ error: 'Query parameter "q" is required' }).min(1, 'Query parameter "q" is required'),
  limit: parseOptionalQueryNumber(z.number().int().positive()),
});

export const AdvancedSearchQuerySchema = z.object({
  q: z.string().optional(),
  type: NodeTypeSchema.optional(),
  status: NodeStatusSchema.optional(),
  activation_min: parseOptionalQueryNumber(z.number()),
  activation_max: parseOptionalQueryNumber(z.number()),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  updated_after: z.string().optional(),
  updated_before: z.string().optional(),
  tags: QueryTagsSchema.optional(),
  sort: SortFieldSchema.optional(),
  order: SortOrderSchema.optional(),
  limit: parseOptionalQueryNumber(z.number().int().positive()),
  offset: parseOptionalQueryNumber(z.number().int().nonnegative()),
});

export const RelatedSearchQuerySchema = z.object({
  depth: parseOptionalQueryNumber(z.number().int().positive()),
});

export const RecentSearchQuerySchema = z.object({
  limit: parseOptionalQueryNumber(z.number().int().positive()),
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
