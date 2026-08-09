# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
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
| [planner](../agents/planner.md) | Opus | Read-only planning. Turns a request into a Development Plan: inventory of what already exists, the repo rules that bind it, ordered steps, and the rule each step is governed by. Loads **the same skills as `implementer`** — same two preloaded, same `routing.md` for the rest — so the plan cannot contradict the rules the implementation is held to. Runs in `permissionMode: plan`; no `Write`/`Edit`, no web. Save its output to `specs/<slug>.md` |
| [implementer](../agents/implementer.md) | inherits | Executes an approved `specs/*.md` plan in `client/` and `server/`. Preloads `backend-onion-architecture` + `frontend-ui-architecture`, loads the plan's other skills on demand, runs typecheck / lint / tests / `pnpm arch` / `shared:sync` on its own changes. Never runs `pr-self-review`, never commits or opens a PR |
| [test-writer](../agents/test-writer.md) | inherits | Writes and repairs tests in `client/`, `server/`, `reviewer-core/` — the per-ring styles, the placement rules, the `*.it.test.ts` naming gate. Preloads nothing; routes per task from `routing.md`. Never changes production code to make a test pass, never weakens an assertion, no `e2e/` flows |
| [architecture-reviewer](../agents/architecture-reviewer.md) | Opus | Read-only boundary review — onion rings and import direction, frontend placement and the server/client split. Preloads both authored architecture skills; runs `pnpm arch` and reports the rules that fired. Every finding carries `path:line`, the verbatim line and the skill section; pre-existing §12 debt is reported separately. Writes no verdict file and blocks nothing |
| [plan-verifier](../agents/plan-verifier.md) | Opus | Read-only conformance check of an implementation against `specs/<slug>.md`. Extracts every step and acceptance criterion first, then one row per item with a verdict — met / partial / not-met / deviated / unverifiable — and `path:line` or command output as evidence. Preloads **nothing** deliberately; refuses to substitute generic advice for the check |
| [doc-writer](../agents/doc-writer.md) | Sonnet | Documents shipped features — walkthroughs, ADRs, guides — with Mermaid diagrams, routed to the right `docs/` or `specs/` directory and registered in the matching `AGENTS.md` §Read when. Preloads `mermaid-diagram`. Never writes `INSIGHTS.md` by hand, never replaces a `CLAUDE.md` symlink |

They are a chain, not a team:
`planner` → plan saved to `specs/` → `implementer` → `test-writer` →
`plan-verifier` · `architecture-reviewer` → `doc-writer`.
Subagents share no context and no message channel, so the **file is the handoff** —
relaying a plan by paraphrase loses exactly the constraints it exists to carry, and
`plan-verifier` is given the plan's **path**, never a summary of it. None of them can
call another (subagents have no `Agent` tool); the caller dispatches every hop.

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
