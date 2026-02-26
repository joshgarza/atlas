// Core type definitions for Atlas

import type { z } from 'zod';
import type {
  NodeTypeSchema,
  NodeGranularitySchema,
  NodeStatusSchema,
  EdgeTypeSchema,
  EventTypeSchema,
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
  created_at: string;
}

// Input types derived from zod schemas
export type CreateNodeInput = z.infer<typeof CreateNodeInputSchema>;
export type UpdateNodeInput = z.infer<typeof UpdateNodeInputSchema>;
export type CreateEdgeInput = z.infer<typeof CreateEdgeInputSchema>;
export type UpdateEdgeInput = z.infer<typeof UpdateEdgeInputSchema>;
export type CreateEventInput = z.infer<typeof CreateEventInputSchema>;
