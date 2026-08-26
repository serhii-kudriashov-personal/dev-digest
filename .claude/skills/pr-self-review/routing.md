# Routing — diff paths to skills

Step 3 of `SKILL.md`. Match every `review` and `sentinel:` path from
`./scripts/pr-self-review.sh files` against the table. Load the **union** of the
matched rows. A skill no row selected is not opened.

Rows are independent: one file may match several. Within a package, the most
specific row wins for *which sections* to read; the general row still applies.

## Frontend — `client/`

| Path | Load | Sections that matter most |
|---|---|---|
| `client/src/app/**/*.tsx`, `client/src/components/**/*.tsx` | `frontend-ui-architecture` | §1 placement, §2 promotion, §3 module boundaries, §5 business logic |
| same | `react-best-practices` | anti-patterns, hooks rules |
| `client/src/app/**/{layout,page,route,loading,error,template}.tsx` | `next-best-practices` | `file-conventions.md`, `rsc-boundaries.md` |
| a `'use client'` line added or removed | `next-best-practices` + `frontend-ui-architecture` §9 | the server/client boundary |
| `client/src/**/*.test.tsx`, `client/src/test/**` | `react-testing-library` | query priority, `userEvent`, async |
| `client/src/lib/**`, `client/src/i18n/**` | `frontend-ui-architecture` | §1 placement, §2 promotion rule, §6 constants |
| `client/**/index.ts` (a barrel) | `frontend-ui-architecture` §7 | barrel files are HIGH, not CRITICAL |
| `client/src/app/**/styles.ts`, `constants.ts`, `helpers.ts` | `frontend-ui-architecture` | §1, §6, §8 naming |

## Backend — `server/`

| Path | Load | Sections that matter most |
|---|---|---|
| `server/src/modules/**/routes.ts` | `backend-onion-architecture` | §6 the Fastify edge, §2 dependency rule |
| same | `fastify-best-practices` | validation, hooks, error handling |
| same | `security` | input handling, authz, SSRF, secrets |
| `server/src/modules/**/*.repo.ts`, `server/src/modules/**/repository/**` | `backend-onion-architecture` §5 | repositories are the only place Drizzle lives |
| same | `drizzle-orm-patterns` | queries, relations, transactions |
| `server/src/db/schema/**`, `server/src/db/schema.ts` | `postgresql-table-design` + `drizzle-orm-patterns` | types, indexes, constraints |
| `server/src/db/migrations/**` | — | sentinel, see `SKILL.md` §4 |
| `server/src/modules/**` (service, helpers, anything else) | `backend-onion-architecture` | §1 rings, §8 where new code goes |
| `server/src/adapters/**` | `backend-onion-architecture` §3 | ports and adapters |
| same | `security` | every outbound call and every secret |
| `server/src/platform/**` | `backend-onion-architecture` §4 | the composition root |
| `server/test/**` | `backend-onion-architecture` §9 | testing per ring; naming is a gate, not a judgement |

## Engine — `reviewer-core/`

| Path | Load | Sections that matter most |
|---|---|---|
| `reviewer-core/src/**` | `backend-onion-architecture` §7 | the pure core: **zero I/O**, invariant #1 |
| same | `typescript-expert` | only when the change is type-level |
| `reviewer-core/src/grounding.ts` | — | sentinel |
| `reviewer-core/src/prompt.ts` | — | sentinel **if `INJECTION_GUARD` changed** |
| `reviewer-core/src/llm/**` | `zod` | structured output is Zod → JSON Schema |
| `reviewer-core/test/**` | `backend-onion-architecture` §9 | ring 1 is tested hermetically — a stub `LLMProvider`, no key, no network, no Docker |

## MCP server — `mcp/`

| Path | Load | Sections that matter most |
|---|---|---|
| `mcp/src/**` | `security` | input handling, untrusted content, secrets, logging to stderr |
| `mcp/src/api-client.ts` | `security` | every outbound call; the base URL is env-derived, never a tool argument |
| `mcp/test/**` | — | no DB — tests are `*.test.ts`, never `*.it.test.ts` |

## Contracts, and everything else

| Path | Load | Note |
|---|---|---|
| `*/src/vendor/shared/**` | `zod` | plus the repo rule: canon is `server/`, `client/` is a MANUAL copy, synced in the same commit. The `shared:sync` gate checks it. |
| any `z.object(` added or changed | `zod` | a field on a **jsonb-persisted** contract must be `.nullish()`, never `.nullable()` — every document already on disk is missing the new key (root `INSIGHTS.md` 2026-08-02) |
| `e2e/**` | — | no skill covers this. Read `e2e/AGENTS.md` and `e2e/INSIGHTS.md`. |
| `.github/workflows/**` | — | read `TESTING.md`: the unit lane excludes `**/*.it.test.ts`, the integration lane selects only it |
| `**/*.md` | — | repo rule: **all Markdown is written in English**, whatever language the request came in |
| `*CLAUDE.md`, `*AGENTS.md` | — | edit `AGENTS.md`; `CLAUDE.md` must stay a symlink (mode `120000`). The `symlinks` gate checks it. |
| `*.ts`, `*.tsx` anywhere | `typescript-expert` | lowest priority, and only for a type-level change |
| `scripts/**`, `docs/**`, `plans/**` | — | repo rules only. English only. `specs/` is requirements, `plans/` is how they get built — an implementation plan must not carry requirements of its own (`plans/README.md`) |
| `specs/**`, `*/specs/*.md` (never `e2e/specs/**`) | `mermaid-diagram` (only if the spec carries a diagram), `security` (only if it has a non-trivial `## Untrusted inputs`) | English only. Skeleton and EARS rules in `specs/README.md`: `shall`, one response per criterion, `AC-N` never renumbered once shipped, named `<YYYY-MM-DD>-<feature>.md`. A spec is behaviour — diagrams chart what the user or a *system* does, contracts are promises. **No `zod`, no architecture skill**: those are opinions about code, which a spec has no authority over (`.claude/agents/spec-writer.md` §"What is already in your context"). `e2e/specs/**` is not a spec directory — it holds `*.flow.json` |
| `.claude/agents/**` | — | subagent definitions; **not** in `skills-lock.json`, so these are ours. English only, and a new agent is registered in three places: `.claude/agents/README.md`, `.claude/skills/README.md` §Agents, `AGENTS.md` §Read when |
| `.claude/skills/**/SKILL.md` | — | check `skills-lock.json` first (`jq -r '.skills\|keys[]'`): a locked skill is vendored and edits are lost on sync. An **authored** skill is ours, and a new one is registered in two places — `.claude/skills/README.md` §Catalog and `AGENTS.md` §Read when — plus a row in this table if any diff path should load it. A skill with no row is a skill no agent is ever told to open (root `INSIGHTS.md` 2026-08-08). `user-invocable: true` is what makes it a `/slash` command |

## No row matched

Say so. A `docs/`-only diff loads nothing, and the coverage footer must show
zero skills rather than an unqualified "reviewed, clean". Silence is not a pass.

`backend-onion-architecture` does **not** cover `mcp/**`: the rings it addresses
are `server/` and `reviewer-core/`, so opening it for an MCP file spends context
and invents constraints — the same reason no row hands it a `.tsx` file.

## Scope discipline

Both authored skills declare what they do **not** cover, and the routing respects
it instead of handing every skill every file:

- `backend-onion-architecture` decides *where* code lives and *who* may import
  it. Fastify, Drizzle, Postgres and Zod mechanics belong to their own skills.
- `frontend-ui-architecture` decides *placement and imports*. Rendering, hooks
  misuse, memoization and bundle size belong to `react-best-practices` and
  `next-best-practices`.

A finding from the wrong skill for a file is a finding to drop, not to report.

## Vendored severity is not house law

The skills listed in `skills-lock.json` are pulled from upstream. Their severity
tags are the vendor's confidence, not evidence about this repo, and nothing in
those files dates its claims (root `INSIGHTS.md`, 2026-08-02).

**A vendored-skill CRITICAL blocks only when it also violates** an authored skill
(`backend-onion-architecture`, `frontend-ui-architecture`), a rule in `AGENTS.md`,
or a deterministic gate. Otherwise report it as HIGH.

### Demotion list — never CRITICAL, never blocking

| Rule | Where | Why |
|---|---|---|
| "Container components fetch data; presentational components receive props" | `react-best-practices/SKILL.md:24` | Dan Abramov retracted the split in 2019; patterns.dev: hooks "achieve the same result without" it. Superseded by `frontend-ui-architecture` §4. |
| "Max 200 lines per component — split if larger" | `react-best-practices/SKILL.md:26` | Kent C. Dodds: split on a named problem — re-renders, reuse, testing pain — "NOT BEFORE". A long component is not a defect. |

Both are catalogued in `frontend-ui-architecture/RESEARCH.md` §2, with the
superseding rules in that skill's §4. Report either as MEDIUM at most, and only
when the file has an actual named problem.
