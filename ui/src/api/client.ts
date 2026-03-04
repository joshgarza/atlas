import type {
  Node,
  NodeHistory,
  Edge,
  Event,
  CreateNodeInput,
  UpdateNodeInput,
  CreateEdgeInput,
  CreateEventInput,
  PaginatedNodes,
  ArchivistStatus,
  HealthCheck,
  NodeType,
  NodeStatus,
  EdgeType,
} from './types';

const BASE = '/api';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

// --- Nodes ---

export interface ListNodesParams {
  type?: NodeType;
  status?: NodeStatus;
  limit?: number;
  offset?: number;
}

export function listNodes(params: ListNodesParams = {}): Promise<PaginatedNodes> {
  const qs = new URLSearchParams();
  if (params.type) qs.set('type', params.type);
  if (params.status) qs.set('status', params.status);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return request<PaginatedNodes>(`/nodes${query ? `?${query}` : ''}`);
}

export function getNode(id: string, peek = false): Promise<Node> {
  const qs = peek ? '?peek=true' : '';
  return request<Node>(`/nodes/${id}${qs}`);
}

export function createNode(input: CreateNodeInput): Promise<Node> {
  return request<Node>('/nodes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateNode(id: string, input: UpdateNodeInput): Promise<Node> {
  return request<Node>(`/nodes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function getNodeHistory(id: string): Promise<NodeHistory[]> {
  return request<NodeHistory[]>(`/nodes/${id}/history`);
}

export function getNodeEdges(id: string): Promise<Edge[]> {
  return request<Edge[]>(`/nodes/${id}/edges`);
}

// --- Edges ---

export interface ListEdgesParams {
  type?: EdgeType;
  limit?: number;
  offset?: number;
}

export function listEdges(params: ListEdgesParams = {}): Promise<Edge[]> {
  const qs = new URLSearchParams();
  if (params.type) qs.set('type', params.type);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return request<Edge[]>(`/edges${query ? `?${query}` : ''}`);
}

export function createEdge(input: CreateEdgeInput): Promise<Edge> {
  return request<Edge>('/edges', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// --- Events ---

export function createEvent(input: CreateEventInput): Promise<Event> {
  return request<Event>('/events', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// --- Search ---

export function searchNodes(q: string, limit?: number): Promise<Node[]> {
  const qs = new URLSearchParams({ q });
  if (limit != null) qs.set('limit', String(limit));
  return request<Node[]>(`/search?${qs}`);
}

export function getRelatedNodes(id: string, depth?: number): Promise<Node[]> {
  const qs = depth != null ? `?depth=${depth}` : '';
  return request<Node[]>(`/search/related/${id}${qs}`);
}

export function getRecentNodes(limit?: number): Promise<Node[]> {
  const qs = limit != null ? `?limit=${limit}` : '';
  return request<Node[]>(`/search/recent${qs}`);
}

// --- Archivist ---

export function runArchivist(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/archivist/run', { method: 'POST' });
}

export function getArchivistStatus(): Promise<ArchivistStatus> {
  return request<ArchivistStatus>('/archivist/status');
}

// --- Health ---

export function getHealth(): Promise<HealthCheck> {
  return request<HealthCheck>('/health');
}

export { ApiError };
