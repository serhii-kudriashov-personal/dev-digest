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
- **NOT a monorepo.** Four independent `package.json` + lockfiles. Run
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
| `docs/` | asking "why was it decided this way" |
| `specs/` | implementing a new feature — read its spec first |
| `INSIGHTS.md` | at the start of every session, and before any non-trivial change: the traps are written down |
| `.claude/skills/engineering-insights/SKILL.md` | writing an insight — entry format, sections, routing |
