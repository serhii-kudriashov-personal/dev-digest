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

- **Start:** read the `INSIGHTS.md` of the package you are about to touch, plus
  the root one. Say which entries are relevant to today's work — one line each.
  Treat them as high-confidence guidance unless told otherwise.
- **During:** the moment something non-obvious surfaces, use the
  `engineering-insights` skill. Do not wait for the end of the session.
- **End:** before reporting a non-trivial task done, run the skill's wrap-up
  pass. Do not skip this step.
- Append only. Never rewrite or delete an existing entry — supersede it with a
  new dated one.

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
| `docs/smart-diff.md` | working on reviewer-ordered diffs (L04) — the role classification table, the ordering and split thresholds, or the badge→line navigation |
| `docs/` | asking "why was it decided this way" |
| `specs/` | implementing a new feature — read its spec first |
| `mcp/AGENTS.md` | changing the local MCP server (L05) — adding or editing a tool, or preparing to open a PR that touches `mcp/**` |
| `INSIGHTS.md` | at the start of every session, and before any non-trivial change: the traps are written down |
| `.claude/skills/engineering-insights/SKILL.md` | writing an insight — entry format, sections, routing |
| `.claude/agents/researcher.md` | delegating a "where does X live" / "what does the upstream doc say" question — read-only, cites `path:line` or a URL, and lists what it could not find |
| `.claude/agents/planner.md` | delegating "how should we build X here" — read-only, returns a Development Plan (inventory, binding rules, ordered steps, the skills the implementer will load). Save its output to `specs/<slug>.md`; the plan is the handoff |
| `.claude/agents/implementer.md` | executing an approved `specs/*.md` plan across `client/` and `server/` — writes code, loads the plan's skills, runs the gates on its own changes. Does not review, commit, or open a PR |
| `.claude/agents/test-writer.md` | writing or repairing tests in `client/`, `server/`, `reviewer-core/` — knows the per-ring styles, the placement rules and the `*.it.test.ts` gate. Never changes production code to make a test pass; no `e2e/` flows |
| `.claude/agents/architecture-reviewer.md` | asking whether a change respects the onion rings and the frontend placement rules — read-only, runs `pnpm arch`, cites `path:line` plus the verbatim line and the skill section, and separates pre-existing §12 debt from new findings |
| `.claude/agents/plan-verifier.md` | asking "was `specs/<slug>.md` actually implemented" — read-only, one table row per plan item and acceptance criterion, each with a verdict and typed evidence. Not a code review, and it refuses to substitute generic advice |
| `.claude/agents/doc-writer.md` | documenting a shipped feature — picks the right `docs/` or `specs/` directory, draws the Mermaid diagram, and registers the document in the matching `AGENTS.md` §Read when. Never writes `INSIGHTS.md` or a `CLAUDE.md` |
