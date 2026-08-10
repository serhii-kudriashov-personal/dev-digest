# @devdigest/mcp

A local, **stdio-transport MCP server** that exposes five fixed tools
(`list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`,
`get_blast_radius`) to an MCP client such as Claude Code or Claude Desktop.

It is a **thin HTTP client** of the DevDigest API on `http://localhost:3001`.
No database, no Drizzle, no `server/src` runtime import.

## ⚠️ `pr-self-review` does NOT cover this package

`pr-self-review` does not yet detect this package — `scripts/pr-self-review.sh:220-222`
classifies only `server/*`, `client/*`, `reviewer-core/*`. Until a follow-up wires
`mcp:typecheck` and `mcp:test`, run `cd mcp && pnpm typecheck && pnpm test` **by
hand** before opening any PR that touches `mcp/**`. A green `pr-self-review`
verdict says nothing about this package.

There is also **no CI workflow** for `mcp/` and `pnpm arch` does not scan it. The
manual checklist above is the only gate this package has. That is a deliberate,
documented state, not an oversight.

## Commands

| Task | Command |
|---|---|
| Install (inside the package — never at the repo root) | `cd mcp && pnpm install` |
| Typecheck | `pnpm typecheck` |
| Test | `pnpm test` |
| Build | `pnpm build` → `dist/index.js` |
| Run the built server | `node dist/index.js` (or `pnpm start`) |
| Watch mode | `pnpm dev` |
| Inspect via web UI | `pnpm inspect` → builds, then launches `@modelcontextprotocol/inspector --web` against `node dist/index.js` |

Env: `DEVDIGEST_API_BASE` (default `http://localhost:3001`). It is the **only**
environment variable this package reads.

## Map

| Path | What it is |
|---|---|
| `src/index.ts` | stdio transport wiring, `initialize` instructions, handler registration, stderr logging |
| `src/tools.ts` | the five tool **definitions** — hand-written JSON Schema literals + `INSTRUCTIONS` |
| `src/handlers.ts` | one function per tool: validate → resolve → call → shape; all failure texts |
| `src/resolve.ts` | `owner/name` → repo UUID, PR number → pr UUID, agent name → agent id; argument validation |
| `src/api-client.ts` | the **only** place `fetch` is called; base URL, timeouts, error-envelope mapping |
| `src/shape.ts` | pure transforms: concise response shapes, severity sort, truncation markers |
| `src/sanitize.ts` | `fenceUntrusted`, control-character strip, length caps |
| `src/types.ts` | the wire shapes consumed, plus the runtime response guards |
| `src/constants.ts` | budgets, caps, deadline, poll interval |
| `test/*.test.ts` | protocol shape, token budget, error semantics, deadline, shaping |

## The MCP SDK — resolved facts, not assumptions

Recorded from the **installed package**, which is the source of truth (published
docs lag npm). Re-check this table when the dependency is bumped.

| Fact | Value | Where it was read |
|---|---|---|
| Package + version | `@modelcontextprotocol/sdk` **1.30.0** | `node_modules/@modelcontextprotocol/sdk/package.json` |
| Low-level server | `Server`, from `@modelcontextprotocol/sdk/server/index.js` | `dist/esm/server/index.d.ts` |
| stdio transport | `StdioServerTransport`, from `.../server/stdio.js` | `dist/esm/server/stdio.d.ts` |
| Request schemas | `ListToolsRequestSchema`, `CallToolRequestSchema`, from `.../types.js` | `dist/esm/types.d.ts:2423,2749` |
| `instructions` | a `ServerOptions` field, echoed into the `initialize` result | `dist/esm/server/index.js:50,268` |
| Annotation names | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` (all optional booleans) | `dist/esm/types.js:1183-1209` |
| `isError` | optional boolean on `CallToolResult`; tool failures belong **in the result**, protocol errors are only for failures in *finding* the tool | `dist/esm/types.js:1303-1317` |
| Protocol revision | `LATEST_PROTOCOL_VERSION = '2025-11-25'` | `dist/esm/types.d.ts:3` |

Two things the SDK contradicts about a naive reading of the plan:

1. **`Server` carries an `@deprecated` tag** — "Use `McpServer` instead for the
   high-level API. Only use `Server` for advanced use cases." This *is* one of
   those cases: `McpServer.registerTool` derives `inputSchema` from a Zod shape,
   and the bytes that conversion emits are exactly what the token budget must
   exclude. The low-level API takes the JSON Schema object verbatim. Keep
   `Server`; revisit only if it is actually removed.
2. **The tool name charset is not enforced by the SDK.** `ToolSchema.name` is a
   plain `z.string()`. `^[A-Za-z0-9_.-]{1,128}$` is a protocol rule this package
   holds itself to, asserted in `test/tools-list.test.ts`.

The SDK does **not** validate tool arguments against the declared `inputSchema` —
`setRequestHandler` only validates the `tools/call` request and result envelopes
(`dist/esm/server/index.js:95-131`). Argument validation is entirely ours.

## Conventions

- **stdout IS the transport.** On a stdio MCP server, `stdout` carries the
  JSON-RPC frames. One stray `console.log` — or a stack trace on an unhandled
  rejection — corrupts the session with an error the client reports as a
  *protocol* fault, not as your bug. Every diagnostic goes to **stderr** through
  `log()` in `src/index.ts`. `rg -n 'console\.log' mcp/src` must return nothing.
- **Type-only imports from `@devdigest/shared`, and nothing else from another
  package.** No import of `server/`, `client/` or `reviewer-core/` code at
  runtime, ever. `backend-onion-architecture` §2's "a type-only import is not a
  dependency" is what makes the alias legal; `pnpm arch` does not cover `mcp/`,
  so this one is held by convention.
- **No Zod in `src/**`.** Zod is a devDependency for **type resolution only**
  (the canonical contract sources import it). Tool `inputSchema`s are
  hand-written JSON Schema literals and argument validation is hand-rolled
  guards, precisely so the Zod→JSON-Schema artifacts never enter the token
  budget. Adding a `z.object(` here means the `zod` skill must be loaded first.
- **No secret is ever a tool argument.** The API is `LocalNoAuthProvider` for
  local calls, so none is needed. The base URL comes from `DEVDIGEST_API_BASE`,
  read once at startup — never from an argument, which is what keeps the SSRF
  question answered.
- **`fetch` lives in `api-client.ts` and nowhere else.**
- **Tests are `*.test.ts`, never `*.it.test.ts`.** This package has no database;
  that suffix is the repo's CI split for tests that need Postgres, and a
  Postgres-free test in that lane fails in a way that looks unrelated.
- **Build with `tsc` to `dist/`, not `tsx`.** The client spawns this process
  fresh on every session, so the per-spawn transform cost is real.
- **The tool descriptions in `src/tools.ts` are verbatim** from
  `specs/l05-mcp-server.md` §"The verbatim definitions". A paraphrase is a
  defect: the token budget and the design-principle mapping were computed from
  those exact strings. Change the spec first, then this file, then re-run
  `test/token-budget.test.ts`.

## Untrusted content — the stated position

Finding titles and suggestions, PR text and convention rules are **data**: LLM
output plus prose written by external pull-request authors, handed into a second
model's context. They are fenced by `fenceUntrusted` in `src/sanitize.ts`, after
control characters are stripped, fence-lookalikes neutralised and the text
hard-capped.

Two limits, stated honestly:

1. A delimiter is a **mitigation, not a control**.
2. The receiving model is a third-party client whose system prompt we do not
   write, so unlike `reviewer-core` there is **no `INJECTION_GUARD`** on the
   other side telling it what the fence means. The `initialize` instructions say
   it once, and not every client surfaces those to the model.

The real controls are procedural: the tool set is read-mostly, the one write tool
creates a review the user asked for, and no tool executes anything.

`wrapUntrusted` is deliberately **not** imported from `reviewer-core` — root
`INSIGHTS.md` (2026-08-09): a ring-1 barrel must not grow a public export for a
consumer no engine path calls. `src/sanitize.ts` is the local equivalent.

## Gotchas

- **`McpReview` mirrors a slice-private file.** The body of
  `GET /pulls/:id/reviews` is `ReviewDto`
  (`server/src/modules/reviews/helpers.ts:18-32`), which is **not** a shared
  contract — it is a plain interface in a slice-private file, and
  `backend-onion-architecture` §4 makes `helpers.ts` private. So `src/types.ts`
  declares the narrow shape this client reads instead. **Nothing mechanical
  couples the two**: re-check `McpReview` and `isReviewArray` whenever that file
  changes, because a drift shows up at runtime, not at typecheck.
- **Why the shared types come from a generated `.d.ts`.** `tsconfig.json` maps
  `@devdigest/shared` to `.shared-dts/`, produced by `pnpm shared-dts` from the
  canon at `server/src/vendor/shared`. Pointing the alias straight at the canon's
  `.ts` sources — as the plan first specified — compiles, but `tsc` then treats
  them as program inputs and **emits a second copy of every contract into
  `dist/`** (importing `zod`, which is not a runtime dependency) while moving the
  entry point to `dist/mcp/src/index.js`. Type-only imports are elided from the
  *emitted JS*, not from the *program*. `.shared-dts/` is generated, gitignored,
  and never edited.
- **Polling, not SSE.** `run_agent_on_pr` polls `GET /pulls/:id/runs` every
  2000 ms. `/runs/:id/events` looks like the natural wait mechanism and is not:
  if the API server restarts mid-run, `runBus`'s buffers are empty and the SSE
  connection hangs forever with no `done`, while the database row is reaped to a
  terminal status. Polling reads that row and sees the truth in every case.
- **The poll interval is rate-limit arithmetic**, not a taste call. The API is
  globally limited to 120 req/min (`server/src/app.ts:96`); 2000 ms is 30/min for
  a full wait. See the comment on `POLL_INTERVAL_MS`.
- **The 120-second deadline never cancels the run.** Cancelling throws away LLM
  work the user already paid for and leaves a `cancelled` row `get_findings` can
  never satisfy. The result is `status: "timed_out"` with `isError: false`, on
  purpose — `isError: true` would invite a retry that starts a *second* paid run.
- **`get_blast_radius` makes no HTTP call.** A stub must not spend the API's
  rate-limit budget.
- **`PrMeta.id` is `.nullish()`.** A null id means the PR was listed from GitHub
  but never persisted — that is the "not imported" answer, not a crash.
- **`GET /repos/:id/pulls` syncs from GitHub inside the request**
  (`server/src/modules/pulls/routes.ts:49-79`), so PR resolution is the slowest
  and most failure-prone link in a cold `run_agent_on_pr`. It degrades rather
  than fails without a GitHub token.
- **`findings.confidence` is dropped from every response.** It is not calibrated
  (root `INSIGHTS.md` 2026-08-02: `1.0` on a hallucination), so surfacing it into
  another model's context is worse than omitting it.
- **No `outputSchema` on any tool.** It is serialized into every `tools/list`
  response — a permanent per-request cost that roughly doubles each definition —
  and buys the model nothing, since it reads a result rather than constructing
  one. Deliberate; not an oversight to "fix". Revisit only if a target client is
  found to require `structuredContent`.
- **`trace_url` is a plain string, not an MCP `resource_link`.** Whether a given
  client dereferences a `resource_link` is unverified; a URL string costs ~15
  tokens and works everywhere. Upgrading is a one-line change.
- **The budget test's tokenizer is knowingly wrong.** `cl100k_base` is OpenAI's,
  not Anthropic's. It buys a hermetic, key-free test; the ~2× headroom absorbs
  the error. If a real Anthropic number is ever wanted, produce it once by hand
  with `messages.count_tokens` and record it here — do not put a network call in
  the suite.

## Read when

| Read | When |
|---|---|
| `README.md` | wiring the server into an MCP client, or troubleshooting a tool call |
| `../specs/l05-mcp-server.md` | the source of truth for this package's design and acceptance |
| `../server/src/vendor/shared/contracts/` | the contracts every response is derived from |
| `../server/src/modules/reviews/routes.ts` | the endpoints `run_agent_on_pr` and `get_findings` drive |
| `docs/request-lifecycle.md` | asking why `run_agent_on_pr` polls instead of using SSE, why the poll interval is 2000 ms, why a timeout does not cancel the run or set `isError`, or how the token budget and the untrusted-content fencing were sized |
| `docs/` | asking why this package is designed the way it is |
| `specs/` | implementing a new tool |
| `INSIGHTS.md` | at the start of every session — package-level lessons for `mcp/**` |
| `../INSIGHTS.md` | at the start of every session — repo-wide lessons |
