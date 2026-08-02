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

### 2026-08-02 — A PR-list rollup may already exist in `modules/pulls/status.ts` — and its docblock may lie

**Rule:** before writing a new per-PR aggregate for `GET /repos/:id/pulls`, grep
`modules/pulls/status.ts`. Helpers there are pure, exported and unit-tested, but
**not necessarily called** — check for a production caller before assuming the
feature exists, and before writing a second copy of the logic.

**Why:** `rollupSeverities` (severity tally for the list's FINDINGS column) is
fully written and covered by `test/pulls-status.test.ts:52`, yet has zero callers
— the column was designed, half-built, then pulled back, exactly like
`agent_runs.cost_usd` before L01. Worse, the two comments about it **contradict
each other**: the `status.ts` docblock states "The Pull Requests list shows, per
PR: the latest review's SCORE, **a FINDINGS severity breakdown**, and a review
STATUS", while `pulls/routes.ts:116` states "the per-severity FINDINGS breakdown
is **intentionally not surfaced** on the list". Neither comment is evidence of
anything; only the call graph is. Note the helper's keys are lowercase
(`critical/warning/suggestion`) while the contracts' `findings_by_severity`
aggregates use uppercase — they were written apart and never reconciled.

**Where:** `server/src/modules/pulls/status.ts:23` (helper + stale docblock);
`server/src/modules/pulls/routes.ts:114-152` (the two rollups that *are* wired,
score and cost — copy their shape) and `:116` (the contradicting comment);
uppercase siblings at `src/vendor/shared/contracts/observability.ts:111` and
`contracts/productionize.ts:156`.

### 2026-08-02 — The `findings` table has no indexes at all — a FK is not an index

**Rule:** any new query that joins or filters `findings` must ship its own index
in the same migration. Do not assume `review_id` is indexed because it is a
foreign key — Postgres auto-indexes primary keys and unique constraints, never
foreign keys, and Drizzle's `.references()` only emits the constraint.

**Why:** `0000_init.sql:142-158` declares the whole table without a single
index; the `review_id` FK constraint lands separately at `:378` and creates
nothing. Every read of findings to date goes through `reviewsForPull`, which
fetches by `inArray(reviewId, …)` on a table small enough that nobody noticed.
The first per-PR aggregate joining `findings` → `reviews` turns that into a full
scan on every PR-list load, which polls every 60 s.

**Where:** table at `server/src/db/schema/reviews.ts` (add the index there, then
`pnpm db:generate` — applied migrations are never edited); DDL at
`server/src/db/migrations/0000_init.sql:142-158`, FK at `:378`; the current sole
reader is `src/modules/reviews/repository/review.repo.ts:reviewsForPull`.

### 2026-08-02 — The live agent prompt is `agents.system_prompt`, not `docs/agent-prompts/`

**Rule:** editing an agent in the UI writes the `agents.system_prompt` column and
takes effect on the very next run — no restart, no migration. `docs/agent-prompts/*.md`
and `src/db/seed-prompts.ts` are seed material only; the moment someone edits in
the UI they stop describing what the model actually receives. Sync them by hand
if the change should survive a fresh database.

**Why:** the executor passes the column straight through
(`systemPrompt: agent.systemPrompt`). And `pnpm db:seed` will NOT put the file
version back over a UI edit — it looks the agent up by workspace + name and
inserts only when missing, so re-seeding is a no-op for an agent that exists.
That is convenient here, but it also means a stale prompt can never be repaired
by re-seeding.

**Where:** `src/modules/reviews/run-executor.ts:193`; `src/db/seed.ts:217-220`;
the editor field is
`client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx:130`.

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
