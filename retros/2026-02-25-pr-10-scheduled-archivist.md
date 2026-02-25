# PR Review Retro: PR #10 — JOS-69: Scheduled Archivist runs
**Date**: 2026-02-25 | **Branch**: task-runner/jos-69 | **Findings**: 2 bug, 1 suggestion

## What Was Found (2-4 sentences)

The scheduler accepted interval values from two input paths (API + environment variables) but only the API path validated them. Zero or negative intervals passed to `setInterval` would create a tight loop, effectively locking the server. Separately, `updateScheduler` silently updated config without restarting the scheduler when it was stopped, making the `PUT /archivist/schedule` endpoint a no-op in that state.

## Root Cause (technical/origin why chain)

**Finding 1 — No interval validation (tight-loop DoS)**
- *What was wrong*: `setInterval(fn, 0)` creates a tight loop
- *Why*: No minimum threshold on interval values before passing to `setInterval`
- *Why*: Validation was added at the API layer (input boundary) but not at the consumption point (`startScheduler`)
- *Why*: The scheduler module was designed as a "trusted internal" component, but it has two external input paths (env vars at startup, API at runtime)
- *Systemic cause*: **Validate-at-edge pattern fails when multiple edges exist.** Dangerous values must be clamped at the point of consumption, not at each caller independently.

**Finding 2 — updateScheduler silent no-op**
- *What was wrong*: Calling `updateScheduler` when the scheduler was stopped updated config but did not start it
- *Why*: The function had a conditional guard (`if (running)`) around `startScheduler()`
- *Why*: The function conflated two responsibilities — config mutation and lifecycle management — without making the lifecycle behavior explicit
- *Systemic cause*: **Split-responsibility functions need their contract documented or enforced.** When a function name implies "update and apply," it should apply.

## Fixes Applied (bulleted: what was done and why)

- **API validation (Step 2)**: Added `MIN_INTERVAL_MS = 60_000` check in `PUT /archivist/schedule` handler, returns 400 for values below the floor. Gives callers a clear error.
- **updateScheduler always restarts (Step 2)**: Removed conditional guard so `updateScheduler` always calls `startScheduler()`, matching the API contract.
- **Structural fix (Step 3 — learn phase)**: Moved `MIN_INTERVAL_MS` to `scheduler.ts` as an exported constant. Added `Math.max(MIN_INTERVAL_MS, value)` clamping inside `startScheduler()` before `setInterval` calls. This guards all input paths (env vars, API, direct calls) at the consumption point. Updated `server.ts` to import `MIN_INTERVAL_MS` from the scheduler instead of defining its own copy.

## Deferred (what, why, and revisit trigger — or "None")

- **runDecay calls runArchivist (suggestion #3)**: The decay timer calls `runArchivist()` which includes consolidation, duplicating work the consolidation timer already does. Deferred because: (a) consolidation is idempotent — no correctness issue, (b) multiple valid approaches (call `decayActivation()` directly vs. restructure the orchestration). **Revisit trigger**: When adding more archivist cycle steps, or if consolidation becomes expensive enough that redundant runs matter.

## Lessons Encoded (lesson -> code change / CLAUDE.md / ~/.claude/MEMORY.md)

1. **Code change (structural prevention)**: `MIN_INTERVAL_MS` exported from `scheduler.ts` with clamping in `startScheduler()`. This is defense-in-depth — the API route still gives a 400 for bad values, but the scheduler itself will never accept a dangerous interval regardless of caller.

2. **~/.claude/MEMORY.md**: Added cross-project lesson about validating at the consumption point when multiple input paths exist, not just at individual entry points.

## Hotspots (files in multiple findings or prior retros — or "None")

- **src/archivist/scheduler.ts** — appeared in 2 of 3 findings (interval validation gap + updateScheduler no-op). New file in this PR, so no prior retro history, but worth watching as the scheduler gains complexity.
- **src/api/server.ts** — inline route handlers growing; the archivist endpoints are defined directly in server.ts rather than in a dedicated route module like the other resources. Not a bug, but a structural divergence that increases the surface area of this file.
