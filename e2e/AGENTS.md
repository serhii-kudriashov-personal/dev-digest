# @devdigest/e2e

Deterministic browser flows on top of Vercel `agent-browser` (CDP, no LLM).

## Commands

`pnpm test` — run the specs against an already-running stack
`pnpm e2e:hermetic` — `../scripts/e2e.sh`: brings up the whole stack, then runs
`pnpm typecheck`

Env: `E2E_BASE_URL` (default `http://localhost:3000`) · `AGENT_BROWSER_BIN` ·
`E2E_STEP_TIMEOUT` (default 60000).

## Map

| Path | What it is |
|---|---|
| `specs/NN-name.flow.json` | the flows — **test specs, not documentation** |
| `run.ts` | runner: loads flows, executes commands, writes results |
| `lib/assert.ts` | argument substitution and light stdout checks |
| `agent-browser.json` | browser config |

⚠️ In this package `specs/` is taken by test flows. Documentation and feature
specifications live in `docs/`.

## Conventions

- **This is not Playwright or Cypress.** Each spec is JSON listing
  `agent-browser` commands; all commands in a flow share one browser session.
- **A new flow = a new `NN-name.flow.json`.** Leave the runner alone. Run order
  is the lexical order of filenames, so the `NN` prefix is mandatory.
- **Seeded data only, read-only.** No spec may trigger an LLM call or require
  an API key.
- **A step fails when its command exits non-zero** — including a `wait --text`
  or `wait --url` whose condition never holds. That is the assertion; keep any
  extra text checks minimal.
- Dynamic values go through placeholders (`{BASE}`), never hard-coded.

## Gotchas

- The specs depend on the seed (`server: pnpm db:seed`) — repo
  `acme/payments-api`, PR #482, the two built-in agents. Changed the seed?
  Re-check the specs.
- Flakiness here almost always means a missing `wait`, not a slow CI runner.

## Read when

| Read | When |
|---|---|
| `README.md` | writing or fixing a flow |
| `../TESTING.md` | working out what this layer covers and what it doesn't |
| `docs/` | asking why agent-browser was chosen and what it can't do |
| `INSIGHTS.md` | chasing a flake or odd browser behaviour |
