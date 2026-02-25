# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Atlas is a personal memory service — the foundational layer of a personal assistant system. Memory is the hub, not a feature. The memory model is inspired by attractor states in neuroscience: concepts form paths that deepen with use, enabling fast retrieval and mastery. Errors are corrected by branching (creating new paths) and attenuating old ones, never by deletion. Nothing is ever lost.

## Linear
- Team: `JOS`
- Project: `atlas`

## CLI

All commands via:
```bash
node --experimental-strip-types /home/josh/coding/claude/task-runner/main/src/cli.ts <command>
```

```bash
<cli> add-ticket "Title" --team JOS --project atlas [--description "Details"]
<cli> run JOS-42
<cli> review <pr-url>
<cli> standup --project atlas
```

## Architecture

### Roles

- **Collectors** (external-facing) — source-specific adapters that deliver events to Atlas via `POST /events`. They handle all external I/O.
- **The Archivist** (internal-facing) — lives within Atlas. Processes the event log into the knowledge graph. Consolidates, reinforces, attenuates, synthesizes. Never touches the outside world.
- **The Curator** (internal-facing) — counterbalance to the Archivist. Browses low-activation nodes without side effects (peek), surfaces dormant ideas worth revisiting.

### Memory Model

1. **Event Log** (append-only) — every observation, query, and mutation is recorded as an immutable event
2. **Knowledge Graph** (active layer) — nodes, edges, activation scores, full version history
3. **The Archivist** (internal agent) — consolidates events into nodes, manages activation decay

### Tech Stack

- **Runtime**: TypeScript (Node.js)
- **Framework**: Hono + `@hono/node-server`
- **Database**: SQLite via `better-sqlite3` (WAL mode, FTS5 for search)
- **IDs**: ULIDs (time-ordered)

## Critical Rules

### Branch Protection
- **NEVER commit directly to `main`** — a pre-commit hook will reject it
- **NEVER create merge commits on `main`** — a pre-merge-commit hook will reject it
- If the Claude Code hook blocks your Edit/Write, you are on the `main` worktree — switch to a feature branch worktree

### Shell Commands
- **NEVER chain shell commands** with `&&`, `||`, or `;` — run each command as a separate Bash tool call. Chained commands bypass the permission system and make it harder to add granular permissions over time.

### PR Workflow
- **NEVER auto-merge PRs** — always run the full review-learn-fix cycle and wait for explicit user approval before merging

### Git Worktree Workflow

This repo uses a **bare repo + worktree** layout.

```
/home/josh/coding/claude/
  atlas.git/              # Bare repository (do not work here directly)
    hooks/                # Shared git hooks (pre-commit, pre-merge-commit)
  atlas/                  # Worktrees container (coordination hub)
    main/                 # main branch (protected, read-only for agents)
    <feature-worktrees>/  # Created per-task, deleted after merge
```

### How to Work
- **Start Claude from a worktree directory** (e.g. `atlas/<feature>/`)
- Each worktree is a full working copy with its own `node_modules` and `data/`
- Feature worktrees are **temporary** — create for active work, delete after merging

### Worktree Lifecycle

From the hub directory (`atlas/`):

```bash
# Create a worktree (handles settings copy, npm install)
./create-worktree.sh <name> [branch-name]

# Remove a worktree and its branch (after merge)
./remove-worktree.sh <name>

# Validate all worktrees have required config
./check-worktrees.sh
```

### Merging to Main
1. Work and commit on a feature worktree
2. Rebase onto main: `git rebase main`
3. Push and open a PR:
   ```bash
   git push -u origin <branch>
   gh pr create
   ```
4. **NEVER auto-merge PRs** — always run the full review-learn-fix cycle before merging. Wait for user approval to merge.
5. After PR is approved and merged on GitHub:
   ```bash
   cd /home/josh/coding/claude/atlas/main && git pull origin main
   cd .. && ./remove-worktree.sh <name>
   ```

## Development Commands

```bash
# Start the server
npx tsx src/api/server.ts

# Start with file watching
npx tsx watch src/api/server.ts

# Type-check
npx tsc --noEmit
```

## HTTP API (port 3001)

```
# Nodes
POST   /nodes              # Create a node
GET    /nodes               # List nodes (?type=, ?status=, ?limit=, ?offset=)
GET    /nodes/:id           # Get a node (bumps activation)
GET    /nodes/:id?peek=true # Read without affecting activation (for Curator)
PUT    /nodes/:id           # Update a node (creates history entry)
GET    /nodes/:id/history   # Get all versions of a node
GET    /nodes/:id/edges     # Get all edges for a node

# Edges
POST   /edges               # Create an edge between nodes

# Events
POST   /events              # Log a raw event (Collectors write here)

# Search
GET    /search?q=...        # Full-text search across nodes
GET    /search/related/:id  # Find related nodes (graph traversal)
GET    /search/recent       # Recently accessed nodes

# Archivist
POST   /archivist/run       # Run full archivist cycle (consolidate + decay)
GET    /archivist/status     # Last run info, stats, unprocessed event count

# Health
GET    /health              # Health check
```

## File Structure

```
src/
  types.ts                # Core type definitions
  events.ts               # Append-only event log
  db/
    schema.ts             # SQLite schema + migrations
    connection.ts         # Database connection management
  graph/
    nodes.ts              # Node CRUD + versioning
    edges.ts              # Edge CRUD
    activation.ts         # Activation scoring + decay
    query.ts              # FTS search, graph traversal, recent nodes
  archivist/
    index.ts              # Orchestration — run cycle, track status
    consolidate.ts        # Process events into graph nodes
    reinforce.ts          # Targeted activation boost + propagation
    attenuate.ts          # Targeted attenuation of superseded nodes
  collectors/
    obsidian.ts           # Obsidian vault reader + event transformer
    run-obsidian.ts       # CLI entry point for Obsidian collector
  api/
    server.ts             # Hono HTTP server
    routes/
      nodes.ts            # Node endpoints
      edges.ts            # Edge endpoints
      events.ts           # Event ingestion
      search.ts           # Search endpoints
data/
  atlas.db                # SQLite database (gitignored)
```

## Activation Model

- **On access**: `activation += 1.0 * recency_bonus` (1.0 if <24h, scaling to 0.1 if >3 months)
- **On decay** (archivist sweep): `activation *= decay_factor ^ months_since_last_access` (0.95 active, 0.90 superseded)
- **Floor**: activation never drops below 0.01
- **Peek**: reads without side effects — activation unchanged
