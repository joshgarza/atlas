# Atlas: Implementation Plan

## Vision

Atlas is the foundational memory layer for a personal assistant system. Every other capability — CRM follow-ups, todo prioritization, retros, goal tracking — is a consumer of or contributor to the memory system. The memory layer is standalone, independent of any specific UI or tool, and designed to persist indefinitely.

## Architecture

### Roles

1. **Collectors** (external-facing) — source-specific adapters that connect to external systems, fetch information, transform it into events, and deliver it to Atlas via `POST /events`. Responsible for all external I/O.

2. **The Archivist** (internal-facing) — lives entirely within Atlas. Only sees the event log and knowledge graph. Organizes, consolidates, optimizes, and maintains the graph. Operations: consolidate, reinforce, branch, attenuate, synthesize, optimize.

3. **The Curator** (internal-facing) — counterbalance to the Archivist's efficiency. Understands emotional context and personal significance. Browses low-activation nodes without side effects (peek). Surfaces candidates for user review. Introduced only after the Archivist has matured.

### Memory Model

1. **Event Log** (append-only) — immutable record of every observation, query, and mutation. The boundary between Collectors and internal agents.

2. **Knowledge Graph** (active layer) — nodes at varying granularity connected by typed edges. Each node has an activation score (attractor strength) that increases with access and decays with disuse. Full version history preserved.

3. **Activation Model** — on access: `activation += 1.0 * recency_bonus`. On decay: `activation *= decay_factor ^ months_since_last_access`. Floor at 0.01. Never deleted.

### Storage

SQLite — single file, zero-config, portable. FTS5 for text search. sqlite-vec for future embedding-based semantic search.

---

## Phase 1: Foundation (Complete)

**Goal**: Working standalone service with SQLite graph store, HTTP API, and basic node/edge operations.

### What was built

- [x] Project scaffolding (package.json, tsconfig.json, .gitignore)
- [x] SQLite schema with FTS5, triggers, and indexes (`src/db/schema.ts`)
- [x] Database connection management with WAL mode (`src/db/connection.ts`)
- [x] Core type definitions (`src/types.ts`)
- [x] Node CRUD with versioning, tags, and peek mode (`src/graph/nodes.ts`)
- [x] Edge CRUD with node validation (`src/graph/edges.ts`)
- [x] Activation model — recency-weighted bumps + periodic decay (`src/graph/activation.ts`)
- [x] FTS5 search, BFS graph traversal, recent nodes (`src/graph/query.ts`)
- [x] Append-only event log (`src/events.ts`)
- [x] Hono HTTP server with all endpoints (`src/api/`)
- [x] Bare repo + worktree workflow with branch protection
- [x] GitHub remote

### Verified behaviors

- Node creation with tags
- Activation bumps on GET (recency-weighted), no bump on peek
- Node update creates history entry, bumps version
- Edge creation with node validation
- FTS5 search finds content
- Graph traversal finds related nodes
- Event log append-only
- Archivist decay sweep
- Pre-commit hook blocks direct commits to main
- Claude Code hook blocks Edit/Write on main worktree

---

## Phase 2: The Archivist + First Collector (Obsidian)

**Goal**: Prove the full loop — Collector delivers events, Archivist processes them into graph nodes, nodes are searchable and linked.

### The Archivist (`src/archivist/`)

- [ ] Archivist orchestration (`index.ts`) — scheduled internal process triggered via `POST /archivist/run` or cron
- [ ] Consolidation (`consolidate.ts`) — process raw events from event log into graph nodes
- [ ] Reinforcement (`reinforce.ts`) — strengthen activation of accessed/confirmed nodes
- [ ] Attenuation (`attenuate.ts`) — reduce activation on deprecated/superseded paths
- [ ] Synthesis — identify patterns across nodes, create higher-order concept nodes
- [ ] Optimization — rewrite node content for better retrieval (original preserved in history)

### Obsidian Collector (`src/collectors/obsidian.ts`)

- [ ] Read from the Obsidian vault (already structured notes)
- [ ] Transform notes into events
- [ ] Deliver to Atlas via `POST /events`
- [ ] Batch import initially, file watcher for ongoing changes

### API additions

- [ ] Enhanced `POST /archivist/run` — trigger full archivist cycle (consolidate + decay + synthesize)
- [ ] `GET /archivist/status` — last run info, stats

---

## Phase 3: The Curator + More Collectors

**Goal**: Introduce the Curator after the Archivist has matured and the graph has depth. Add more data sources.

### The Curator (`src/curator/`)

- [ ] Curator orchestration (`index.ts`) — lower cadence than Archivist
- [ ] Low-activation node discovery (`surface.ts`) — browse via peek, evaluate personal significance
- [ ] Surfacing logic — present candidates for user review
- [ ] User feedback loop — user decides to revive or leave dormant

### Additional Collectors

- [ ] CRM Collector (`src/collectors/crm.ts`) — read EspoCRM contacts/opportunities, deliver as events
- [ ] Calendar Collector — read Google Calendar events for temporal context

### Adapters

- [ ] MCP adapter — thin wrapper for Claude Code integration
- [ ] CLI — manual queries and administration

---

## Phase 4: Introduction + Autonomous Behaviors

**Goal**: The Archivist and Curator learn from each other. Cross-domain intelligence emerges.

- [ ] Archivist-Curator introduction — they can observe each other's work
- [ ] Cross-domain pattern recognition (CRM relationships + goals + habits)
- [ ] Retro routines — scheduled reflective conversations that query the graph
- [ ] Notification system for time-sensitive follow-ups
- [ ] Bidirectional Collectors — can write back to external systems on Archivist's request
