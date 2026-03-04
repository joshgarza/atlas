// Core type definitions for Atlas

import type { z } from 'zod';
import type {
  NodeTypeSchema,
  NodeGranularitySchema,
  NodeStatusSchema,
  EdgeTypeSchema,
  EventTypeSchema,
  SortFieldSchema,
  SortOrderSchema,
  CreateNodeInputSchema,
  UpdateNodeInputSchema,
  CreateEdgeInputSchema,
  UpdateEdgeInputSchema,
  CreateEventInputSchema,
} from './api/schemas.js';

// Enum types derived from zod schemas
export type NodeType = z.infer<typeof NodeTypeSchema>;
export type NodeGranularity = z.infer<typeof NodeGranularitySchema>;
export type NodeStatus = z.infer<typeof NodeStatusSchema>;
export type EdgeType = z.infer<typeof EdgeTypeSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;

export interface Node {
  id: string;
  type: NodeType;
  title: string;
  content: string;
  granularity: NodeGranularity;
  activation: number;
  status: NodeStatus;
  superseded_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  access_count: number;
  metadata: Record<string, unknown> | null;
}

export interface NodeHistory {
  id: string;
  node_id: string;
  version: number;
  title: string;
  content: string;
  change_reason: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface Edge {
  id: string;
  source_id: string;
  target_id: string;
  type: EdgeType;
  weight: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Event {
  id: string;
  type: EventType;
  source: string;
  content: string;
  metadata: Record<string, unknown> | null;
  idempotency_key: string | null;
  content_hash: string;
  created_at: string;
}

// Input types derived from zod schemas
export type CreateNodeInput = z.infer<typeof CreateNodeInputSchema>;
export type UpdateNodeInput = z.infer<typeof UpdateNodeInputSchema>;
export type CreateEdgeInput = z.infer<typeof CreateEdgeInputSchema>;
export type UpdateEdgeInput = z.infer<typeof UpdateEdgeInputSchema>;
export type CreateEventInput = z.infer<typeof CreateEventInputSchema>;

// Advanced search + filtering

export type SortField = z.infer<typeof SortFieldSchema>;
export type SortOrder = z.infer<typeof SortOrderSchema>;

export interface SearchFilters {
  q?: string;
  type?: NodeType;
  status?: NodeStatus;
  activation_min?: number;
  activation_max?: number;
  created_after?: string;
  created_before?: string;
  updated_after?: string;
  updated_before?: string;
  tags?: string[];
  sort?: SortField;
  order?: SortOrder;
  limit?: number;
  offset?: number;
}

// Saved views

export interface SavedView {
  id: string;
  name: string;
  description: string | null;
  filters: SearchFilters;
  created_at: string;
  updated_at: string;
}

export interface CreateSavedViewInput {
  name: string;
  description?: string;
  filters: SearchFilters;
}

export interface UpdateSavedViewInput {
  name?: string;
  description?: string;
  filters?: SearchFilters;
}
