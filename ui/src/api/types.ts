// Mirrors server types from src/types.ts

export type NodeType = 'concept' | 'entity' | 'preference' | 'goal' | 'habit' | 'observation';
export type NodeGranularity = 'broad' | 'standard' | 'detailed';
export type NodeStatus = 'active' | 'superseded' | 'deprecated';
export type EdgeType = 'supports' | 'contradicts' | 'derived_from' | 'related_to' | 'supersedes' | 'part_of';
export type EventType = 'observation' | 'query' | 'mutation' | 'archivist_action';

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
  tags?: string[];
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

export interface CreateNodeInput {
  type: NodeType;
  title: string;
  content: string;
  granularity: NodeGranularity;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateNodeInput {
  title?: string;
  content?: string;
  granularity?: NodeGranularity;
  type?: NodeType;
  status?: NodeStatus;
  superseded_by?: string;
  change_reason?: string;
  changed_by?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateEdgeInput {
  source_id: string;
  target_id: string;
  type: EdgeType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateEventInput {
  type: EventType;
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
}

export interface ArchivistStatus {
  lastRun: string | null;
  eventsProcessed: number;
  nodesCreated: number;
  nodesUpdated: number;
  unprocessedEvents: number;
  schedule: {
    running: boolean;
    consolidateIntervalMs: number;
    decayIntervalMs: number;
  };
}

export interface PaginatedNodes {
  nodes: Node[];
  total: number;
}

export interface HealthCheck {
  status: string;
}
