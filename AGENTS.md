# DevDigest

Local-first AI pull-request review. This is a course starter: one feature works
end to end, the rest is added back by lessons L01–L08.

## Stack

Node 22 · pnpm 10 · TypeScript 5.7 · Zod 3
Fastify 5 · Drizzle 0.38 · Postgres + pgvector
Next.js 15 · React 19 · TanStack Query 5 · Tailwind 4
Vitest 2 · testcontainers · agent-browser

## Commands

| Task | Command |
|---|---|
| Bring everything up from zero | `./scripts/dev.sh` |
| Postgres only | `./scripts/dev.sh --db-only` |
| Apply migrations | `cd server && pnpm db:migrate` |
| Generate a migration | `cd server && pnpm db:generate` |
| Demo data | `cd server && pnpm db:seed` |
| Test a package | `cd <pkg> && pnpm test` |
| Typecheck a package | `cd <pkg> && pnpm typecheck` |

## Map

| Path | What it is |
|---|---|
| `server/` | Fastify API `:3001` — read `server/AGENTS.md` |
| `client/` | Next.js studio `:3000` — read `client/AGENTS.md` |
| `reviewer-core/` | review engine, zero I/O — read `reviewer-core/AGENTS.md` |
| `e2e/` | browser flows — read `e2e/AGENTS.md` |
| `mcp/` | local MCP server (stdio) — read `mcp/AGENTS.md` |
| `scripts/` | `dev.sh` local launch, `e2e.sh` hermetic e2e |

## Repo rules

- **All Markdown is written in English** — README, AGENTS.md, INSIGHTS.md,
  `docs/`, `specs/`, code comments. No exceptions, whatever language the
  request came in.
- **Agent instructions live in `AGENTS.md`.** Every `CLAUDE.md` is a symlink to
  the `AGENTS.md` next to it — Claude Code loads only `CLAUDE.md`, so the link is
  what makes it work. Edit `AGENTS.md`; never replace the symlink with a real
  file. On Windows, clone with `git clone -c core.symlinks=true`, or the links
  arrive as one-line text files.
- **NOT a monorepo.** Five independent `package.json` + lockfiles. Run
  `pnpm install` inside a package, never at the root.
- **Cross-package imports go through tsconfig `paths` only.** Added an alias?
  Add it to every tsconfig that resolves it.
- **`reviewer-core` never emits JS.** Its `build` is `tsc --noEmit`; the server
  consumes its `.ts` sources directly.
- **`@devdigest/shared` exists twice.** Canonical copy is
  `server/src/vendor/shared`; `client/src/vendor/shared` is a MANUAL copy —
  change the canon, sync the copy in the same commit.
- **Secrets go through `SecretsProvider` only** (`~/.devdigest/secrets.json`).
  Never in the DB, never in `AppConfig`, never committed.
- **Migrations are not applied on boot** — run `pnpm db:migrate` yourself.
- **A DB-backed test must be named `*.it.test.ts`**, or the CI split breaks
  silently.
- Hit a non-obvious trap? Capture it with the `engineering-insights` skill,
  which appends it to the right `INSIGHTS.md`, before you call the task done.

## Session protocol

- **Start:** read the **`## Index`** of the `INSIGHTS.md` of the package you are
  about to touch, plus the root one — then open in full only the entries whose
  `Scope` intersects the files you will change. Say which entries are relevant to
  today's work — one line each. Treat them as high-confidence guidance unless
  told otherwise. Reading these files end to end is not the protocol: root is
  ~28k tokens, `server/` ~17k and `client/` ~14k, and surplus context is not only
  a cost, it is a suggestion (root `INSIGHTS.md` 2026-08-02). The three small
  files — `reviewer-core/`, `mcp/`, `e2e/` — carry no index and are read whole.
- **During:** the moment something non-obvious surfaces, use the
  `engineering-insights` skill. Do not wait for the end of the session.
- **End:** before reporting a non-trivial task done, run the skill's wrap-up
  pass. Do not skip this step.
- Append only. Never rewrite or delete an existing entry — supersede it with a
  new dated one. An entry appended to an indexed file ships **its index row in
  the same edit**; an entry with no row is an entry nobody is told to open.
- **The main session writes the insights.** Subagents return
  `## Insight candidates` and do not append: several agents running in one task
  would otherwise write overlapping entries into an append-only file that cannot
  be cleaned up afterwards.

## Do not touch

- `server/src/db/migrations/**` — applied migrations are never edited, only
  superseded by new ones.
- `reviewer-core/src/grounding.ts` and `INJECTION_GUARD` in
  `reviewer-core/src/prompt.ts` — quality and safety gates. Changing them is a
  deliberate decision, not a drive-by edit.
- `*/src/vendor/**` — vendored code, do not refactor.
- Empty tables (`ci_*`, `eval_*`, `memory`, `digests`, `onboarding`, …) are
  intentional, reserved for later lessons. Do not drop or "clean up".
- Vendored skills under `.claude/skills/**` — the ones listed in
  `skills-lock.json` are pulled from upstream; edits are overwritten on sync.
  Skills authored in this repo (`engineering-insights`) are not in the lock and
  are ours to change.

## Read when

| Read | When |
|---|---|
| `README.md` | you need to run, configure env, or troubleshoot |
| `ONBOARDING.md` | asking "how does it all fit together", or new to the repo |
| `TESTING.md` | writing or fixing a test or a CI workflow |
| `docs/agent-prompts/` | editing a review agent's `system_prompt` |
| `docs/l02-experiment.md` | measuring whether a skill (or any prompt change) actually helps |
| `docs/intent-layer.md` | working on derived PR intent (L03) — sources and their exclusions, the deterministic scope gate, the two confidence numbers, or what the run log does and does not record |
| `docs/smart-diff.md` | working on reviewer-ordered diffs (L04) — the role classification table, the ordering and split thresholds, the badge→line navigation, or the severity chip→finding card navigation |
| `docs/blast-radius.md` | working on Blast Radius (L06) — the index-state truth table, the per-symbol caller cap, or the caller→diff-line navigation |
| `docs/pr-risk-brief.md` | working on the PR Risk Brief (SPEC-02) — the six inputs and their drop order, the `BriefGenerationResult` state machine, the validate→cap→redact→persist order, the cache key and staleness, or the focus-after-navigation change shared with L04/L06 |
| `docs/` | asking "why was it decided this way" |
| `specs/` | implementing a new feature — read its spec first. Requirements only; the plan to build them lives in `plans/`. The skeleton and the EARS rules for acceptance criteria are in `specs/README.md` |
| `.claude/agents/spec-writer.md` | delegating "what should this feature do" — reviews the designs (screenshots, a URL, prose, or the shipped UI) for missing states, edge cases, cross-module contracts and UX gaps, returns a `## Before I write the spec` intake block, then writes one `specs/<YYYY-MM-DD>-<feature>.md` with EARS acceptance criteria — behaviour, workflow and service-communication diagrams and contract promises, never implementation. Writes nowhere else, and never plans |
| `mcp/AGENTS.md` | changing the local MCP server (L05) — adding or editing a tool, or preparing to open a PR that touches `mcp/**` |
| `INSIGHTS.md` | at the start of every session, and before any non-trivial change: the traps are written down. Read its `## Index` first and open only the entries whose `Scope` intersects your files — root, `server/` and `client/` are too large to read whole |
| `.claude/skills/engineering-insights/SKILL.md` | writing an insight — entry format, sections, routing |
| `.claude/agents/researcher.md` | delegating a "where does X live" / "what does the upstream doc say" question — read-only, cites `path:line` or a URL, and lists what it could not find |
| `.claude/agents/implementation-planner.md` | delegating "how should we build X here" — read-only, plans **how** and never **what**. Returns a `## Before I plan` intake block first (requirements checked with evidence, questions, recommendations, and the single-agent-vs-multi-agent question), then an Implementation Plan. Save its output to `plans/<slug>.md`; the plan is the handoff |
| `plans/README.md` | saving or reading an implementation plan — and for why `specs/` (what to build) and `plans/` (how) are separate documents |
| `.claude/skills/impl/SKILL.md` | running an approved plan — `/impl plans/<slug>.md` dispatches `implementer` → `plan-verifier` → `architecture-reviewer` and drives the review to clean through a bounded fix-plan loop. Starts at an approved plan (`spec-writer` and `implementation-planner` are run by hand before it) and stops before `doc-writer`, `pr-self-review`, the commit and the PR |
| `.claude/agents/implementer.md` | executing an approved `plans/*.md` plan across `client/` and `server/` — writes code, loads the plan's skills, runs the gates on its own changes via `./scripts/pr-self-review.sh gates` plus narrowly-scoped test runs, and stops after two attempts at a failing gate. Does not review, commit, or open a PR |
| `.claude/agents/test-writer.md` | writing or repairing tests in `client/`, `server/`, `reviewer-core/` — knows the per-ring styles, the placement rules and the `*.it.test.ts` gate. Takes a behaviour and its file, or the `AC-N` plus `plan-verifier`'s `unverifiable` rows. Never changes production code to make a test pass; no `e2e/` flows |
| `.claude/agents/architecture-reviewer.md` | asking whether a change respects the onion rings and the frontend placement rules — read-only, runs `pnpm arch`, cites `path:line` plus the verbatim line and the skill section, and separates pre-existing §12 debt from new findings |
| `.claude/agents/plan-verifier.md` | asking "was `plans/<slug>.md` actually implemented" — read-only, one table row per plan item and acceptance criterion, each with a verdict and typed evidence, plus a mechanical `AC-N` set difference against the spec the plan names. Run it **straight after `implementer` and before `test-writer`**: its `not-met` rows go back to the implementer, its `unverifiable` rows are the test writer's worklist. Not a code review, and it refuses to substitute generic advice |
| `.claude/agents/doc-writer.md` | documenting a shipped feature — picks the right `docs/` or `specs/` directory, draws the Mermaid diagram, and registers the document in the matching `AGENTS.md` §Read when. Never writes `INSIGHTS.md` or a `CLAUDE.md` |
