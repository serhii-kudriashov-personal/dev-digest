# devdigest-mcp

A local MCP server that lets an MCP client — Claude Code, Claude Desktop —
review pull requests with DevDigest's agents, read the findings, and read the
coding conventions DevDigest extracted from a repository.

It talks to the DevDigest API over HTTP on `localhost`. It is **local only**:
stdio transport, no remote server, no OAuth, no hosting, no credentials.

## The five tools

| Tool | Arguments | What it does |
|---|---|---|
| `list_agents` | — | the configured reviewer agents, with model and enabled state |
| `run_agent_on_pr` | `repo`, `pr`, `agent` | runs one agent over a PR and **waits** (up to 120 s) for the verdict and findings |
| `get_findings` | `repo`, `pr`, `agent?` | the most recent completed review, without starting a new one |
| `get_conventions` | `repo` | the accepted coding conventions for a repository |
| `get_blast_radius` | `repo`, `pr` | placeholder — not implemented in this version |

Identifiers are flat and human-readable, everywhere: `repo` is the GitHub slug
`owner/name`, `pr` is the pull-request number, `agent` is a name from
`list_agents`. No UUID ever appears in a tool signature or in a tool response.

## Setup

1. **Start the engine.** From the repo root:

   ```sh
   ./scripts/dev.sh
   ```

   (or `./scripts/dev.sh --db-only` plus `cd server && pnpm dev`). The API must
   be answering on `http://localhost:3001` before any tool call.

2. **Build this package.** From `mcp/`:

   ```sh
   pnpm install
   pnpm build
   ```

   `pnpm install` runs **inside** `mcp/`. This repo is not a monorepo.

   Re-run `pnpm build` after **every** change under `src/` — the client launches
   `dist/`, not the sources.

3. **Smoke-test it without any client.** This is the fastest way to tell a broken
   server from a broken client registration. From `mcp/`:

   ```sh
   printf '%s\n' \
     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
     '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
     '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
     | node dist/index.js
   ```

   Expect an `initialize` result and five tools on **stdout**, and the single
   line `[devdigest-mcp] ready …` on **stderr**. A diagnostic appearing on stdout
   is a corrupted transport, not a cosmetic issue.

4. **Or open the MCP Inspector UI.** A visual alternative to step 3 — lets you
   browse the five tools, fill in arguments through a form, and inspect
   requests/responses without an MCP client. From `mcp/`:

   ```sh
   pnpm inspect
   ```

   This rebuilds the package, then launches `@modelcontextprotocol/inspector` in
   web mode against `node dist/index.js` and opens the browser at the printed
   `http://localhost:6274?MCP_INSPECTOR_API_TOKEN=...` URL. The engine must
   already be answering on `http://localhost:3001` (step 1), same as any other
   client. Stop it with Ctrl-C; it is a dev-only tool and is never started by
   `./scripts/dev.sh` or registered anywhere for you.

5. **Register the server** — see the next section.

## Registering: always-on vs on demand

Nothing in this repo ever starts this server. `./scripts/dev.sh` does not know it
exists, there is no `.mcp.json`, and no `mcpServers` key in `.claude/`. The
process is spawned by the **MCP client** as a stdio child, so the only question
is how eagerly the client picks it up.

In every form, `args` must be an **absolute path to the built entry**. A stdio
server is spawned from an unknown working directory, so a relative path fails
silently.

### On demand — one session only (recommended)

Keep the config in a file that is **not** the repo root's `.mcp.json`, so nothing
loads it automatically — `mcp/devdigest.mcp.json` is a good home:

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "node",
      "args": ["/absolute/path/to/dev-digest/mcp/dist/index.js"],
      "env": { "DEVDIGEST_API_BASE": "http://localhost:3001" }
    }
  }
}
```

Then start a session with it only when you want it:

```sh
claude --mcp-config /absolute/path/to/dev-digest/mcp/devdigest.mcp.json
```

Add `--strict-mcp-config` to use *only* this server and ignore every other MCP
configuration for that session. A plain `claude` gets no MCP server at all.

### Always-on

`claude mcp add` registers it persistently. The scope decides how far it spreads:

| Scope | Command | Effect |
|---|---|---|
| `local` (default) | `claude mcp add devdigest -e DEVDIGEST_API_BASE=http://localhost:3001 -- node /abs/path/mcp/dist/index.js` | every session in this directory; not committed |
| `user` | same, with `-s user` | every session in every project |
| `project` | same, with `-s project` | writes `.mcp.json` **into the repository** — it gets committed and affects everyone who clones |

`-s project` is the one to avoid unless the whole team wants the server, because
it makes a machine-specific absolute path part of the repo.

### Confirming it connected

`/mcp` inside a session lists connected servers and their state; `claude mcp list`
health-checks the persistent ones from a shell. A server added through
`--mcp-config` is session-scoped and will **not** appear in `claude mcp list`.

Then ask for the reviewer agents — that routes to `list_agents` and should return
the seeded agents by name.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DEVDIGEST_API_BASE` | `http://localhost:3001` | the only variable this server reads; must be an `http(s)` URL |

No API key, token or credential is read, accepted or stored. The LLM keys live
in the engine's `SecretsProvider` (`~/.devdigest/secrets.json`), where they
belong.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| *"Cannot reach the DevDigest engine at …"* | the API is not running, or is on another port | `./scripts/dev.sh`, or set `DEVDIGEST_API_BASE` |
| *"The review run failed: … Check the API key in Settings"* | no LLM key configured for the agent's provider | add one in the web UI under Settings |
| *"Repository … is not in DevDigest"* | the repo was never added | add it at `http://localhost:3000`, then retry |
| *"Pull request #N is not imported"* | the PR list was never synced, or the PR is not persisted | open the repository in the web UI, then retry |
| *"The review is still running after 120 seconds"* | a long review; the run was **not** cancelled | wait, then call `get_findings` with the same arguments |
| the client reports a protocol/parse error | something wrote to stdout | nothing in `src/**` may `console.log`; stdout is the JSON-RPC transport |

## Cost of a call

`run_agent_on_pr` on a **cold** cache is 3 resolution calls + 1 create, then a
poll every 2 seconds until the run finishes. **Warm**, it is 1 create plus the
polls: repo, PR and agent UUIDs are stable, so they are cached for the lifetime
of the process. The slowest resolution step is the PR lookup, because the engine
syncs that list from GitHub inside the request.

Responses are deliberately small: the top 10 findings by severity, with an
explicit `"N more findings not shown"` marker, and no UUIDs, timestamps,
`confidence` or `rationale`.

## For contributors

Read `AGENTS.md` before changing anything here — in particular the stdout rule,
the "no Zod in `src/**`" rule, and the note that `pr-self-review` does **not**
cover this package, so `pnpm typecheck && pnpm test` must be run by hand.
