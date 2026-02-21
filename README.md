# Atlas

A personal memory service built on the idea that memory is the hub, not a feature.

The memory model is inspired by attractor states in neuroscience — concepts form paths that deepen with use, enabling fast retrieval and mastery. Errors are corrected by branching (creating new paths) and attenuating old ones, never by deletion. Nothing is ever lost.

## Architecture

Atlas has three layers:

1. **Event Log** — append-only, immutable record of every observation, query, and mutation. External tools deliver information here.
2. **Knowledge Graph** — nodes (concepts, entities, goals, preferences) connected by typed edges, each with an activation score that strengthens with use and decays with neglect.
3. **Internal Agents** — the Archivist (organizes and optimizes the graph) and the Curator (surfaces dormant ideas worth revisiting).

Two agent roles operate on the system:

- **Collectors** (external-facing) — source-specific adapters that fetch information from external systems (Obsidian, CRM, Calendar) and deliver it as events.
- **Internal Agents** (Archivist + Curator) — live entirely within Atlas. They never reach outside. They organize, consolidate, and maintain the graph.

## Tech Stack

- **TypeScript** + **Hono** (HTTP framework)
- **SQLite** via `better-sqlite3` (single-file database, WAL mode)
- **FTS5** for full-text search
- **ULIDs** for time-ordered IDs

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npx tsx src/api/server.ts

# Start with file watching (development)
npx tsx watch src/api/server.ts
```

The server runs on `http://localhost:3001` by default.

## API

```
# Nodes
POST   /nodes                  Create a node
GET    /nodes                  List nodes (?type=, ?status=, ?limit=, ?offset=)
GET    /nodes/:id              Get a node (bumps activation)
GET    /nodes/:id?peek=true    Read without affecting activation
PUT    /nodes/:id              Update a node (creates history entry)
GET    /nodes/:id/history      Get all versions of a node
GET    /nodes/:id/edges        Get all edges for a node

# Edges
POST   /edges                  Create an edge between nodes

# Events
POST   /events                 Log a raw event

# Search
GET    /search?q=...           Full-text search across nodes
GET    /search/related/:id     Find related nodes (graph traversal)
GET    /search/recent          Recently accessed nodes

# Maintenance
POST   /archivist/run          Trigger activation decay
GET    /health                 Health check
```

## Development

This repo uses a **bare repo + worktree** workflow. See [CLAUDE.md](CLAUDE.md) for the full development guide.

```bash
# From the atlas/ hub directory:
./create-worktree.sh feat-my-feature    # Create a feature worktree
./remove-worktree.sh feat-my-feature    # Remove after merge
./check-worktrees.sh                    # Validate setup
```

Direct commits to `main` are blocked by git hooks. All changes go through feature branches.
