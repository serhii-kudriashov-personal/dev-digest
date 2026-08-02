# Insights — server

Lessons learned in this package: what broke, why, and how not to repeat it.
Cross-package lessons go in the root `INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

---

## What Works

_Empty so far._

## What Doesn't Work

### 2026-08-02 — `*.it.test.ts` SKIPPING silently reads as passing

**Tried:** running `pnpm exec vitest run test/reviews.it.test.ts` to verify new
DB-backed assertions. Output: `7 tests | 7 skipped`, exit code 0, no red.

**Failed:** nothing was verified. `dockerAvailable()` shells out to
`docker info`, and when that call cannot reach the daemon the whole suite
degrades to `describe.skip` by design (so CI without Docker stays green). Under
an agent/tool sandbox the socket is blocked for spawned processes even though
`docker info` succeeds when run directly in the same shell — so the probe is
false, every integration test evaporates, and the run still looks clean. A
Postgres container being up and healthy is NOT evidence the tests ran.

**Instead:** read the test COUNT, never just the exit code. `N skipped` on an
`.it.test.ts` file means unverified, not passing. If the probe is wrong, re-run
with the sandbox disabled — the tests then execute normally against
testcontainers.

**Where:** probe at `server/test/helpers/pg.ts:23` (`dockerAvailable`), gate at
`server/test/reviews.it.test.ts:13` (`const d = hasDocker ? describe : describe.skip`).

## Codebase Patterns

_Empty so far._

## Tool & Library Notes

_Empty so far._

## Recurring Errors & Fixes

### 2026-08-02 — `completeAgentRun`'s parameter type is declared TWICE

**Symptom:** adding a field to the `values` object of
`repository/run.repo.ts:completeAgentRun` and passing it from the executor fails
typecheck with three copies of
`TS2353: 'costUsd' does not exist in type '{ status: ... }'` — pointing at the
CALL SITES, not at the type that needs changing.

**Cause:** `ReviewRepository` (`modules/reviews/repository.ts`) is a hand-written
facade that re-declares the whole inline `values` type instead of deriving it
from the function it delegates to. The executor calls `this.repo.completeAgentRun`,
so it type-checks against the facade's copy, which knows nothing about the new
field.

**Takeaway:** any change to a `repository/*.repo.ts` function signature needs the
same edit in `modules/reviews/repository.ts`. Grep the method name — if it
appears in both files, expect two edits. The same duplication exists for the
other delegated methods there.

**Where:** `server/src/modules/reviews/repository.ts:151` (facade) mirrors
`server/src/modules/reviews/repository/run.repo.ts:134`.

## Session Notes

_Empty so far._

## Open Questions

_Empty so far._
