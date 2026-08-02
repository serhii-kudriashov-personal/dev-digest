# Insights — repo-wide

Lessons that span the whole repo: what broke, why, and how not to step on it
twice. Package-level lessons live in `<pkg>/INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

---

## What Works

_Empty so far._

## What Doesn't Work

### 2026-08-02 — `diff -r` is the wrong check for the two `vendor/shared` copies

**Tried:** verifying the canon/copy sync rule with
`diff -r server/src/vendor/shared client/src/vendor/shared`, expecting empty
output (this is what the L01 plan specified as its acceptance gate).

**Failed:** it can never be empty. The two trees carry ~120 lines of documented
pre-existing drift — `openrouter` missing from the client's `Provider` unions,
`AgentManifest`, `AgentVersionConfig`, `CommitFilesPayload`, `sessionId`, plus
divergent comment wording in `trace.ts`. A blanket `cp -r` "fixes" the diff but
silently ships unrelated contract changes far outside the task's scope.

**Instead:** diff only the files you touched, and ignore comments when you do:
`diff <(grep -v '^\s*[/*]' server/src/vendor/shared/<f>) <(grep -v '^\s*[/*]' client/src/vendor/shared/<f>)`.
Green means *your* change is synced, which is the actual rule. Closing the
historical drift is its own task.

**Where:** the drift is catalogued in "Recurring Errors & Fixes" below
(2026-08-01); the copies are `server/src/vendor/shared` and
`client/src/vendor/shared`.

## Codebase Patterns

### 2026-08-02 — A field added to a persisted-jsonb contract must be `.nullish()`

**Rule:** when you add a field to a Zod schema that is stored as a **jsonb
document** rather than as columns, declare it `.nullish()`, never `.nullable()`.
`.nullable()` accepts an explicit `null` but REJECTS a missing key, and every
document already on disk is missing the new key.

**Why:** `RunTrace` is persisted whole into `run_traces.trace`. Declaring
`RunStats.cost_usd` as `.nullable()` would have made every trace written before
L01 unparseable — a silent, total break of run history that no typecheck
catches, because the rows are `jsonb` and only validate at read time. The
sibling field `RunSummary.cost_usd` IS `.nullable()`, and correctly so: it is
rebuilt from columns on every read, so the key is always present.

**Where:** `server/src/vendor/shared/contracts/trace.ts:67` (`RunStats`, nullish)
vs `:112` (`RunSummary`, nullable); persistence at
`server/src/modules/reviews/repository/run.repo.ts:170` (`saveRunTrace`).
Guard test: `server/test/contracts.test.ts:167`.

### 2026-08-02 — Unknown cost is `null`, never `0`

**Rule:** a run that did not bill anything because it never got that far stores
`cost_usd = NULL`. Only a run that genuinely cost nothing stores `0`. The UI
renders `null` as `—` and `0` as `$0.0000`.

**Why:** the failure paths already zero `tokensIn`/`tokensOut`, so the tempting
move is to zero the cost alongside them. That makes a run that died on a missing
API key render as `$0.00` — indistinguishable from a free run, and actively
misleading on a screen whose whole purpose is spend. The distinction is load
bearing across all four render sites, so it is asserted end to end rather than
left as a convention.

**Where:** `server/src/modules/reviews/run-executor.ts:85` (`failAll`) and `:309`
(catch); formatter `client/src/lib/format.ts:17`; asserted in
`server/test/reviews.it.test.ts` ("a failed run records cost_usd = NULL, not 0").

### 2026-08-01 — `costUsd` reaches the server and dies there

**Symptom:** cost is computed in the adapters and accumulated by the engine, but
never surfaces anywhere.

**Cause:** commit `d45ab0d` removed the consumer (per-run cost) and left the
producer in place. This is intentional — the cost badge returns in L01.

**Takeaway:** don't "fix" it as a forgotten wire and don't delete it as dead
code.

**Superseded by:** 2026-08-02 — L01 landed; the consumer is back. `cost_usd` is
persisted on `agent_runs` again (migration `0010_bored_raider.sql`) and rendered
at four sites. The producer side is unchanged: cost still originates in the
adapters and is accumulated by `reviewer-core`, so there is still nothing to
"fix" there.

## Tool & Library Notes

_Empty so far._

## Recurring Errors & Fixes

### 2026-08-01 — `@devdigest/shared` drifts silently between server and client

**Symptom:** the client's types don't know about the `openrouter` provider even
though the server fully supports it; `AgentManifest`, `AgentVersionConfig`,
`CommitFilesPayload` and the `sessionId` field are missing too.

**Cause:** the contracts are vendored twice — `server/src/vendor/shared` (canon)
and `client/src/vendor/shared` (copy). There is no sync script, and CI can't
catch the divergence because each package typechecks in isolation and both pass.

**Takeaway:** always edit the canon and port the change in the same commit.
Before touching contracts, check: `diff -r server/src/vendor/shared
client/src/vendor/shared`.

## Session Notes

_Empty so far._

## Open Questions

_Empty so far._
