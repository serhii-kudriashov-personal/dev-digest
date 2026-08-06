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

### 2026-08-03 — Three flows pass only because `next dev` is slow: they click the PR row with no `wait` for it

**Tried:** running the suite against a **production** build (`next build` +
`next start`) instead of `scripts/e2e.sh`'s `next dev`, to remove
compile lag as a flake source before judging a client refactor.

**Failed:** the opposite of the expectation — the production run was *worse*,
`5/8`, and three flows died on the same step they had never failed on:

```
✗ open the PR row — agent-browser find text Add rate limiting to public API endpoints click
```

**Cause:** flows `04`, `05` and `08` go straight from `wait --url /pulls` to
`find text … click`. `wait --url` resolves the moment the URL changes — the PR
list is still empty, because the rows come from a `GET /repos/:id/pulls` the
browser has not received yet. Flow `02` does the identical click and has **never**
failed, on any harness, for one reason:

| Flow | Step before the click | Verdict |
|---|---|---|
| `02` | `wait --text "Add rate limiting to public API endpoints"` | passes everywhere |
| `04`, `05`, `08` | *(nothing)* | races the fetch |

Under `next dev` the first hit on `/repos/[repoId]/pulls` costs an on-demand
compile, and that accidental delay is what the three flows have been relying on
as their implicit wait. A production build serves the page instantly, so the
click loses the race. Same code, same seed — only the server changed.

**Instead:** the fix is one line per flow, copying `02`: insert
`{"cmd":["wait","--text","Add rate limiting to public API endpoints"]}` before
the `find … click`. Until that lands, do not read a local `8/8` as coverage —
`next dev` is papering over it, and **CI runs a production build**, so CI is the
harness where these three are genuinely fragile. This is the local-vs-CI
asymmetry already flagged as plan item 4.4, with teeth: it does not just make the
two environments differ, it hides real spec defects in the slower one.

Corollary for judging a refactor: flow `05` failed on one `next dev` run and
passed on the next with **no code change**, so a single suite run cannot attribute
a failure to a diff. Run it twice, and compare against a baseline (see the root
`INSIGHTS.md` entry on reconstructing the immediately-prior state).

**Where:** the missing waits are `e2e/specs/04-pr-findings.flow.json`,
`05-pr-diff.flow.json` and `08-pr-severity-filter.flow.json` (step 3 of each);
the working pattern is `02-repo-pulls-detail.flow.json` (step 3). The dev server
is started at `scripts/e2e.sh:148` (`next dev -p "$WEB_PORT"`).

## Codebase Patterns

_Empty so far._

## Tool & Library Notes

### 2026-08-03 — `agent-browser` 0.33.2 refuses to click the severity chip: "covered by `<aside>`" is a FALSE positive

**Quirk:** flow `08`'s `find text Warning click` fails every run, on every
harness, with

```
✗ Element '[data-agent-browser-located='true']' is covered by <aside> at its
  click point, so the input would land on that element instead.
```

The element is found — the failure is the pre-click actionability guard, not the
locator. Measured on the live page, the guard is simply wrong:

| Check | Value |
|---|---|
| innermost elements matching `/Warning/i` | exactly **1** (`<button>`, text `Warning1`) |
| chip rect | x `424.8 … 538.0`, y `528.9 … 560.4` |
| `<aside>` rect | x `0 … 264`, `position: static`, `z-index: auto` |
| `document.elementFromPoint(chip centre)` | the `BUTTON` itself |

No geometric overlap, and the chip is the topmost element at its own centre.
Retried at a taller viewport (`set viewport 1280 900`) — identical refusal, so it
is not the 577px default window either.

**The product is fine.** Driving the same button with a real DOM click
round-trips exactly what the flow asserts: URL becomes
`?tab=findings&severity=WARNING`, the WARNING finding ("N+1 query in user list
endpoint") survives, the CRITICAL card disappears. Verified directly, so a red
flow `08` is a tooling defect and must not be read as a broken severity filter.

**Workaround:** none found that keeps the current spec. `find text … click` is
the blocked path; the chip is a real `<button>`, so a
`find role button click --name Warning` variant is the thing to try when someone
next touches this flow — it was not confirmed here (the throwaway stack had
already been torn down when it was attempted, so that one result is void). Note
the version: `agent-browser` is a **global** binary with no entry in
`e2e/package.json`, so it is unpinned and `npm i -g agent-browser` installs
whatever is current — 0.33.2 here. If this flow used to pass, an upgrade is the
first suspect, and pinning the global install is the real fix.

**Where:** spec `e2e/specs/08-pr-severity-filter.flow.json` (step 10); the chip
is rendered by
`client/src/app/repos/[repoId]/pulls/[number]/_components/SeverityFilterBar/`;
the covering `<aside>` is the nav in `client/src/components/app-shell/`. Binary
resolution at `e2e/run.ts:40` (`AGENT_BROWSER_BIN`).

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
