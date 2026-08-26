# Insights — reviewer-core

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

### 2026-08-02 — Invariant #1 is now machine-checked, but the check lives in `server/`

**Rule:** after touching `reviewer-core/src/**`, run `cd ../server && pnpm arch`.
This package's own `pnpm typecheck` and `pnpm test` will **not** catch a broken
zero-I/O invariant — a `import { readFileSync } from 'node:fs'` type-checks fine
and passes every test here.

**Why:** the architecture gate is a `dependency-cruiser` config in the *other*
package (`server/.dependency-cruiser.cjs`), because `dependency-cruiser` is a
`server/` dependency and this repo is not a monorepo, so there is no root-level
tooling to hang it off. `pnpm arch` cruises `src ../reviewer-core/src`, and four
of its rules exist only for this package: `core-is-pure` (no `fastify`,
`drizzle-orm`, `postgres`, `octokit`, `simple-git`, `@ast-grep/napi`, `src/db`,
`src/adapters`), `core-is-pure-node-builtins` (no `fs`, `child_process`, `net`,
`http`, `https`), `core-resolves-everything`, and `core-barrel-only` (consumers
may import only `src/index.ts`). Nothing in `reviewer-core/package.json` runs
them, and CI does not either yet — so the check is only as good as remembering to
cross the package boundary.

Two consequences worth knowing before you debug the gate:

- A rule can only see imports that **survive TypeScript compilation**
  (`tsPreCompilationDeps: false`). An unused or type-only import produces no edge
  at all, so an experiment that "isn't caught" may simply not exist in the graph.
- `@devdigest/shared` resolving here to `../server/src/vendor/shared` is a
  *packaging* inversion, not a dependency-direction violation — that shared tree
  is pure types and Zod schemas (ring 0). The gate is deliberately configured not
  to flag it. Do not "fix" the alias.

**Where:** `server/.dependency-cruiser.cjs`; script at `server/package.json`
(`"arch"`); the ring rules and the rule-verification procedure are in
`.claude/skills/backend-onion-architecture/SKILL.md` §7 and §10.

## Tool & Library Notes

_Empty so far._

## Recurring Errors & Fixes

_Empty so far._

## Session Notes

_Empty so far._

## Open Questions

_Empty so far._
