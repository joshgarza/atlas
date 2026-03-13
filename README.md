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
- **sqlite-vec** for embedding storage and backend semantic search
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
GET    /search/semantic        Semantic search over embedded nodes (?q=...&limit=...)
GET    /search/recent          Recently accessed nodes

# Maintenance
POST   /archivist/run          Trigger activation decay
POST   /archivist/backfill-embeddings  Generate embeddings for nodes that are missing them
GET    /health                 Health check
```

## Semantic Search Status

Semantic search is present in the backend today via `GET /search/semantic`, and embeddings can be backfilled manually via `POST /archivist/backfill-embeddings`.

The current implementation is intentionally backend-first. `semanticSearch()` ranks results by running `vec_distance_cosine()` across the full `node_embeddings` table, so it is a full-table scan rather than an indexed KNN query. That trade-off is acceptable at the current graph size, but it should be revisited when Atlas reaches roughly 10,000 embedded nodes or sqlite-vec ships a mature cosine KNN path.

Operationally, this is still a manual capability rather than a polished end-user feature. Embedding generation and backfill exist for backend workflows, while the README and PLAN now reflect that the UX and automation around semantic search are still in progress.

## Obsidian Collector (Windows)

The Obsidian collector runs natively on Windows (not in Docker/WSL2) so that file-watching works reliably against the Windows filesystem.

### Prerequisites

- [Node.js](https://nodejs.org/) installed on Windows
- Atlas server running and accessible (default: `http://localhost:3001`)

### One-time batch import

```powershell
npx tsx src/collectors/run-obsidian.ts
```

### Batch import + watch for changes

```powershell
npx tsx src/collectors/run-obsidian.ts --watch
```

### Environment variables

| Variable     | Default                                                         | Description              |
|--------------|-----------------------------------------------------------------|--------------------------|
| `VAULT_PATH` | `C:\Users\josh\OneDrive\Documents\Obsidian\Obsidian Vault`     | Path to Obsidian vault   |
| `ATLAS_URL`  | `http://localhost:3001`                                         | Atlas API base URL       |

### Running on a schedule (Task Scheduler)

To run an import automatically:

1. Open **Task Scheduler** (`taskschd.msc`)
2. Create a new task with a trigger (e.g. daily, or at logon)
3. Set the action to **Start a program**:
   - Program: `node`
   - Arguments: `--import tsx src/collectors/run-obsidian.ts`
   - Start in: the Atlas repo directory
4. For continuous watching, use the `--watch` flag and set the task to run at logon with "Run whether user is logged on or not"

## Development

This repo uses a **bare repo + worktree** workflow. See [CLAUDE.md](CLAUDE.md) for the full development guide.

```bash
# From the atlas/ hub directory:
./create-worktree.sh feat-my-feature    # Create a feature worktree
./remove-worktree.sh feat-my-feature    # Remove after merge
./check-worktrees.sh                    # Validate setup
```

Direct commits to `main` are blocked by git hooks. All changes go through feature branches.
