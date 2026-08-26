# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [impl](impl/SKILL.md) | Workflow | `/impl plans/<slug>.md` — runs an approved plan to a clean architecture review: `implementer` → `plan-verifier` gap pass → `architecture-reviewer` with a bounded fix-plan remediation loop. Starts at an approved plan and stops before docs, the verdict and the PR |
| [pr-self-review](pr-self-review/SKILL.md) | Workflow | Reviews all open local changes against the skills the diff implicates, runs the repo gates, and blocks `gh pr create` / `gh pr merge` on a CRITICAL |
| [backend-onion-architecture](backend-onion-architecture/SKILL.md) | Backend | Which ring code belongs to and what it may import — ports, composition root, repositories, the Fastify edge, the pure core, `pnpm arch` |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [frontend-ui-architecture](frontend-ui-architecture/SKILL.md) | Frontend | Where code goes and what it may import — placement, module boundaries, business-logic placement, Next.js data models |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |

## Agents

Subagents live in `.claude/agents/`, not here — a different mechanism (own
context window, own tool allowlist, own model) invoked via the Agent tool.
Full map, artifacts and the sources behind each agent's rules:
[`.claude/agents/README.md`](../agents/README.md).

| Agent | Model | Description |
|-------|-------|-------------|
| [researcher](../agents/researcher.md) | Sonnet | Read-only research in two modes — repo (`path:line` evidence) and external (primary sources, pinned versions). Returns conclusions, evidence, links, and an explicit list of what it could not find. Asks clarifying questions instead of guessing. No `Write`/`Edit`, no `Skill` |
| [spec-writer](../agents/spec-writer.md) | Opus | Authors the **what and why**, never the how. Takes a feature request plus its designs — screenshot files, a URL, prose, or the UI already shipped in `client/` — and returns a `## Before I write the spec` intake block first: a twelve-row design review (empty · loading · degraded · error · overflow · staleness · permissions · zero/one/many · navigation · i18n · a11y · truthfulness), a cross-module hop table, questions with defaults, and recommendations. Once answered it writes exactly one `<YYYY-MM-DD>-<feature>.md`, with acceptance criteria in EARS form; a spec may carry workflow and service-communication diagrams and contract *promises*, never implementation. Preloads `mermaid-diagram` (one-shot write, no `Edit`); may load `security` on demand and **nothing else** — an architecture or schema skill is an opinion a spec has no authority over. `Write` is restricted **by contract** to `specs/`, `server/specs/`, `client/specs/`, `reviewer-core/specs/` and `mcp/specs/` — never `e2e/specs/`, which holds browser flows. No `Edit`: a shipped spec is superseded, never rewritten |
| [implementation-planner](../agents/implementation-planner.md) | Opus | Read-only planning of **how**, never **what**. Takes whatever requirements exist (a `specs/*.md`, an issue, a request, or nothing but a one-line ask), returns a `## Before I plan` intake block first — requirements checked row by row with `path:line` evidence, questions, recommendations, and the single-agent-vs-multi-agent question — then, once answered, an Implementation Plan: inventory, the repo rules that bind it, ordered steps, and the rule each step is governed by. **Works without a spec** — with no document it restates its reading of the request as `assumed` derived requirements for confirmation and asks about the gaps (budget 5 → 8, checklist: surfaces, data, contract, UI, trigger, done-when, out-of-scope). Forbidden from authoring a spec either way: a missing requirement is elicited or reported as a gap, never filled. Loads **the same skills as `implementer`** — same two preloaded, same `routing.md` for the rest — so the plan cannot contradict the rules the implementation is held to. Runs in `permissionMode: plan`; no `Write`/`Edit`, no web. Save its output to `plans/<slug>.md` |
| [implementer](../agents/implementer.md) | inherits | Executes an approved `plans/*.md` plan in `client/` and `server/`. Preloads `backend-onion-architecture` + `frontend-ui-architecture`, loads the plan's other skills on demand. Verification is two halves: the eight deterministic gates as one `./scripts/pr-self-review.sh gates` call, then tests run narrowly while iterating and whole once at the end — the `*.it.test.ts` lane only when the change reaches the database. `--reporter=dot`, log tailed not pasted, **two attempts per failing gate** then stop and report. Reads the `## Index` of `INSIGHTS.md`, not the whole file. Stays inside its `Files owned` cell. Never runs the `pr-self-review` **skill**, never commits or opens a PR |
| [test-writer](../agents/test-writer.md) | inherits | Writes and repairs tests in `client/`, `server/`, `reviewer-core/` — the per-ring styles, the placement rules, the `*.it.test.ts` naming gate. Preloads nothing; routes per task from `routing.md`. Takes a behaviour and its file, or — in a multi-agent run — the plan path plus the `AC-N` to cover and `plan-verifier`'s `unverifiable` rows; a `## Verification` command table is not a testable input. Never changes production code to make a test pass, never weakens an assertion, no `e2e/` flows |
| [architecture-reviewer](../agents/architecture-reviewer.md) | Sonnet | Read-only boundary review — onion rings and import direction, frontend placement and the server/client split. Preloads both authored architecture skills; runs `pnpm arch` and reports the rules that fired. Every finding carries `path:line`, the verbatim line and the skill section; pre-existing §12 debt is reported separately. Writes no verdict file and blocks nothing |
| [plan-verifier](../agents/plan-verifier.md) | Sonnet | Read-only conformance check of an implementation against `plans/<slug>.md`. Extracts every step and every line of `## Acceptance-facing checks` first, then one row per item with a verdict — met / partial / not-met / deviated / unverifiable — and `path:line` or command output as evidence. Additionally runs one mechanical `AC-N` set difference against the spec the plan names, reported separately and without a verdict, because a criterion dropped between spec and plan is invisible to every other agent. Runs **before** `test-writer`. Preloads **nothing** deliberately; refuses to substitute generic advice for the check |
| [doc-writer](../agents/doc-writer.md) | Sonnet | Documents shipped features — walkthroughs, ADRs, guides — with Mermaid diagrams, routed to the right `docs/` or `specs/` directory and registered in the matching `AGENTS.md` §Read when. Preloads `mermaid-diagram`. Never writes `INSIGHTS.md` at all — by hand or through the skill; the main session owns that write. Never replaces a `CLAUDE.md` symlink |

They are a chain, not a team:
`spec-writer` → intake answered → spec saved in `specs/` →
`implementation-planner` → intake answered → plan saved to `plans/` →
`implementer` → `plan-verifier` (gap pass) → `test-writer` →
`architecture-reviewer` · security review → `doc-writer` → `pr-self-review`.

`plan-verifier` runs **before** `test-writer`: its `not-met` rows send work back
to `implementer`, and its `unverifiable` rows are the list of criteria nothing
yet makes observable — which is `test-writer`'s worklist. `pr-self-review` is the
only hop that blocks anything, and no agent above it may run it.

The middle of that chain — from an approved plan to a clean architecture review,
remediation loop included — is automated as **`/impl`** ([impl](impl/SKILL.md)).
The two authoring hops above it stay manual because both stop on an intake block
only a human can answer, and the hops below it stay manual because each is a
deliberate decision.
Subagents share no context and no message channel, so the **file is the handoff** —
relaying a plan by paraphrase loses exactly the constraints it exists to carry, and
`plan-verifier` is given the plan's **path**, never a summary of it. None of them can
call another (subagents have no `Agent` tool); the caller dispatches every hop.

That full chain is the **multi-agent** shape, and it is a choice, not the
default: `implementation-planner` asks which mode to run before it plans, and a
one-wire change is usually one `implementer` pass with the tests in it.
`specs/` holds *what* to build and `plans/` holds *how* — see `plans/README.md`.

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
