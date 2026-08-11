# Insights — mcp

Lessons learned in this package: what broke, why, and how not to repeat it.
Cross-package lessons go in the root `INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

---

## What Works

_Empty so far._

## What Doesn't Work

_Empty so far._

## Codebase Patterns

### 2026-08-11 — Changing a tool's `description` in `src/tools.ts` is a THREE-file change, and only one of the three is obvious

**Rule:** when you edit any string in `TOOLS`, expect to touch:

1. `src/tools.ts` — the string itself;
2. `test/tools-list.test.ts` — which asserts **prose content**, not just shape;
3. `AGENTS.md` §Conventions — which names the spec each description is verbatim
   from, and §Gotchas if the tool's behaviour changed with it.

Then re-run `test/token-budget.test.ts`, which prints a per-tool breakdown.

**Why:** step 2 is the one that surprises. `tools-list.test.ts` is named as if it
checked the protocol envelope, and mostly it does — name charset, `required`
arrays, `additionalProperties: false`, the read-only annotation set. But it also
carries per-tool content assertions, and L06 hit one:
`expect(blast?.description.startsWith('Not implemented yet — do not retry.'))`.
Implementing `get_blast_radius` for real made it fail from a file the change plan
never listed, with a diff that reads `expected false to be true` and points at a
line number rather than at the string that moved.

Worth knowing what the budget headroom actually bought: the placeholder's entry
was ~60 tokens and the real one is **135**, taking `tools/list` from ~540 to
**616 / 1200**. `TOOL_DEFINITION_TOKEN_BUDGET`'s own comment predicted exactly
this ("a later lesson implementing `get_blast_radius` for real will roughly double
that entry"), so the ceiling did not need raising — which is the whole argument for
sizing a gate with headroom instead of one word above today's number.

**Where:** the definitions are `src/tools.ts` (`TOOLS`); the content assertion is
`test/tools-list.test.ts` (`get_blast_radius describes the real tool, verbatim
from its spec`); the budget and its per-tool `stdout` breakdown are
`test/token-budget.test.ts` against `src/constants.ts`
(`TOOL_DEFINITION_TOKEN_BUDGET`); the verbatim-source convention, which now names
**two** specs, is `AGENTS.md` §Conventions.

## Tool & Library Notes

### 2026-08-10 — `pnpm install`'s warnings on `@modelcontextprotocol/inspector` are both false alarms for `pnpm inspect`

**Quirk:** adding `@modelcontextprotocol/inspector` as a devDependency prints two
scary-looking lines that are not failures:

1. `Ignored build scripts: @modelcontextprotocol/inspector@2.1.0` — pnpm refuses
   to run its `postinstall` by default.
2. `Issues with peer dependencies found … ink-select-input 5.0.0 ✕ unmet peer
   ink@^4.0.0: found 6.8.0 ✕ unmet peer react@^18.0.0: found 19.2.8`.

Neither blocks `pnpm inspect` (`pnpm run build && mcp-inspector node
dist/index.js`, `--web` mode, the only mode this package documents).

**Workaround:** none needed — verified by reading the source and by a live run.
The ignored `postinstall` is `scripts/install-clients.mjs`, which opens with
"Safe outside a source checkout" and its first real check is `repoRoot.split(sep)
.includes("node_modules")` → exits immediately when true. Installed as a
dependency, it always lives under `node_modules`, so the script is a no-op by
design; running `pnpm approve-builds` for it buys nothing. The peer-dependency
mismatch belongs to `ink-select-input`, a dependency of the **TUI** client
(`--tui`), not the web client this package's script invokes — confirmed by
running `mcp-inspector --web node dist/index.js` after `pnpm build` and getting a
working `http://localhost:6274?MCP_INSPECTOR_API_TOKEN=…` URL that connects to
the built server on the first try.

**Where:** `mcp/package.json` (`devDependencies["@modelcontextprotocol/inspector"]`,
`scripts.inspect`); the self-skip check is
`node_modules/@modelcontextprotocol/inspector/scripts/install-clients.mjs`
(gitignored, re-read it after any version bump); documented for users at
`mcp/README.md` §Setup step 4 and `mcp/AGENTS.md` §Commands.

## Recurring Errors & Fixes

_Empty so far._

## Session Notes

_Empty so far._

## Open Questions

_Empty so far._
