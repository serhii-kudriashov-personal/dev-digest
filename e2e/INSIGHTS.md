# Insights — e2e

Lessons learned in this package: what broke, why, and how not to repeat it.
Cross-package lessons go in the root `INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

---

## What Works

_Empty so far._

## What Doesn't Work

_Empty so far._

## Codebase Patterns

_Empty so far._

## Tool & Library Notes

_Empty so far._

## Recurring Errors & Fixes

### 2026-08-02 — The e2e suite needs TWO installs that nothing in the repo performs

**Symptom:** `./scripts/e2e.sh` brings the whole hermetic stack up correctly —
Postgres healthy, migrations applied, data seeded, API and web both serving —
and then dies at the last step with `sh: tsx: command not found`. After fixing
that, all flows fail identically with `spawn agent-browser ENOENT`, including
the seven that predate any change you made.

**Cause:** two independent missing dependencies, one local and one global.
`e2e/` is its own package with its own lockfile and had no `node_modules`, so
its `test` script (`tsx run.ts`) has no `tsx`. And `agent-browser` is not a
dependency at all — `run.ts` shells out to a binary named by
`AGENT_BROWSER_BIN` (default `agent-browser`) that has to be installed
system-wide.

**Takeaway:** before touching e2e, run `cd e2e && pnpm install` and confirm the
binary exists (`which agent-browser`). If it does not:
`npm i -g agent-browser && agent-browser install` — the second command downloads
Chrome for Testing and is the part people forget. Because a missing binary makes
EVERY flow fail the same way, `0/8 flows passed` is not evidence that your new
flow is wrong; check `which agent-browser` before debugging the JSON.

**Where:** binary resolution at `e2e/run.ts:40`; install instructions at
`e2e/README.md:52-53`; the runner is invoked by `scripts/e2e.sh` after the stack
is already up, so a failure here costs a full stack boot each time.

## Session Notes

_Empty so far._

## Open Questions

_Empty so far._
