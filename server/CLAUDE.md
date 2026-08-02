# @devdigest/api

Fastify backend: imports repos and PRs, indexes code, stores agents, runs reviews.

## Commands

`pnpm dev` (:3001) · `pnpm db:migrate` · `pnpm db:seed` · `pnpm typecheck`
Tests: `pnpm test` (all) · `pnpm exec vitest run --exclude '**/*.it.test.ts'`
(hermetic) · `pnpm exec vitest run .it.test` (real Postgres)

## Map

| Path | What it is |
|---|---|
| `src/app.ts` | bootstrap: plugins → error handler → modules |
| `src/modules/<name>/` | feature plugin: `routes` → `service` → `repository` |
| `src/platform/` | container (DI), jobs, sse, config, errors |
| `src/adapters/` | outbound ports: llm, github, git, astgrep, secrets, … |
| `src/db/schema/` | Drizzle tables; `src/db/migrations/` holds the SQL |
| `src/vendor/shared/` | canonical `@devdigest/shared` (see root CLAUDE.md) |

## Conventions

- **Three layers per module.** `routes.ts` — HTTP and Zod, no logic.
  `service.ts` — logic, no SQL and no HTTP. `repository.ts` — all the SQL.
  Literals in `constants.ts`, pure transforms in `helpers.ts`.
- **A new module** = `modules/<name>/routes.ts` (default Fastify plugin) plus
  one import and one entry in `modules/index.ts`. Registration is static, not
  autoload.
- **Validation happens in the route schema.** Declare Zod `params`/`body` under
  `schema:` — Fastify rejects bad input with 422 before the handler runs.
  Hand-rolled `Schema.parse(req.body)` inside a handler is forbidden.
- **Adapters come from `container`**, never `new` them directly — that is how
  tests swap them via `ContainerOverrides`.
- **A DB-backed test must be named `*.it.test.ts`** (spins up Postgres via
  testcontainers). Everything else is hermetic, using `src/adapters/mocks.ts`.
- Changed `db/schema/`? Run `pnpm db:generate`, then `pnpm db:migrate`.

## Gotchas

- `runBus` (`platform/sse.ts`) is an in-process singleton. Event buffers and run
  cancellation do not survive a second process.
- The `polling` module only syncs the PR list — it does **not** start a review.
- `container.llm()` / `container.github()` throw `ConfigError` when a key is
  missing. That is a normal path: catch it and record a failed run, not a 500.
- `@fastify/autoload` is a dependency but is never used — don't be tempted.
- Rate limiting and logs are disabled under `NODE_ENV=test`.

## Read when

| Read | When |
|---|---|
| `README.md` | adding a route, touching DI, env, or error handling |
| `src/modules/repo-intel/README.md` | working on the indexer or its facade |
| `../docs/agent-prompts/` | editing an agent's system prompt |
| `docs/` | asking why a module is shaped the way it is |
| `specs/` | implementing a new server feature |
| `INSIGHTS.md` | before changing the review pipeline, DB schema, or adapters |
