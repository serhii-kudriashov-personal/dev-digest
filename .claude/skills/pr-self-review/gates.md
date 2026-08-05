# Deterministic gates

Step 2 of `SKILL.md`:

```sh
./scripts/pr-self-review.sh gates    # TSV: <status>\t<name>\t<detail>
```

Gates run **before** any reading. They are cheap, objective, and a failure is a
fact rather than a judgement — which is why every `fail` is a CRITICAL with no
severity call to make.

Each gate is selected by what the diff touches, and only runs for those packages.
`status` is `pass` or `fail`; on failure `detail` is the log path under
`.devdigest/pr-self-review-logs/`. **Read the log** — report the actual error, not
"typecheck failed".

Gates run per package because this is **not a monorepo**: four independent
`package.json` with four lockfiles, and `pnpm install` at the root is itself a
repo-rule violation.

| Gate | Runs when | Command | Why it is CRITICAL |
|---|---|---|---|
| `server:typecheck` | `server/**` or `reviewer-core/**` | `cd server && pnpm typecheck` | The server consumes `reviewer-core`'s `.ts` sources directly, so a core change breaks here first. |
| `server:arch` | `server/**` or `reviewer-core/**` | `cd server && pnpm arch` | `dependency-cruiser`, 10 ring rules over `server/src` and `reviewer-core/src`. Root `INSIGHTS.md` (2026-08-02) records it as **not wired into CI** — a PR that puts Drizzle back into a new `routes.ts`, or `node:fs` into `reviewer-core`, is green in CI today. This gate is the only place it runs on a change. |
| `core:typecheck` | `reviewer-core/**` | `cd reviewer-core && pnpm typecheck` | The package never emits JS — `typecheck` *is* its build. |
| `client:typecheck` | `client/**` | `cd client && pnpm typecheck` | — |
| `client:lint` | `client/**` | `cd client && pnpm lint` | ESLint was introduced deliberately; unused-directive reporting is part of why. |
| `shared:sync` | `*/src/vendor/shared/**` | `./scripts/check-shared-sync.sh` | `@devdigest/shared` exists twice — canon `server/src/vendor/shared`, MANUAL copy `client/src/vendor/shared`. Each package typechecks in isolation, so drift is invisible to CI. Not `diff -r`: the two trees carry ~120 lines of documented pre-existing drift, so a blanket diff can never be empty (root `INSIGHTS.md` 2026-08-02). The script freezes that drift as a baseline and fails only on **new** divergence. |
| `test-naming` | always | a changed `*.test.ts` importing `test/helpers/pg` must end `.it.test.ts` | The CI split breaks **silently**: the unit lane excludes `**/*.it.test.ts` and the integration lane selects only it, so a misnamed DB test is collected by the lane with no Postgres. |
| `symlinks` | any `CLAUDE.md` / `AGENTS.md` touched | every row of `git ls-files -s '*CLAUDE.md'` is mode `120000` | Claude Code loads only `CLAUDE.md`, and each one is a symlink to the `AGENTS.md` beside it. Flattened to a regular file it becomes a one-line memory reading `AGENTS.md` — no error, no warning, the project instructions are simply gone. |

## Failure that is not the diff's fault

A gate can fail on something the change did not cause — a pre-existing lint
error, a missing `node_modules`, Docker down. Say which, and keep it CRITICAL
anyway: the PR would carry a red gate either way. What changes is the fix
("install deps", "this is pre-existing on `main`"), not the verdict.

If a gate cannot run at all (missing dependency, tool absent), that is a `fail`
with the reason — never a silent pass. `scripts/pr-self-review.sh` fails closed
by design, and so should the report.
