#!/usr/bin/env node
/**
 * devdigest-mcp — a local, stdio-transport MCP server over the DevDigest API.
 *
 * ===========================================================================
 * STDOUT IS THE TRANSPORT. Never write to it.
 * ===========================================================================
 * On a stdio MCP server, `stdout` carries the JSON-RPC frames. One stray write
 * to it — a `console` log, or a stack trace printed on an unhandled rejection —
 * puts non-JSON-RPC bytes into the frame stream and corrupts the session with an
 * error the client reports as a PROTOCOL fault, not as your bug. Every
 * diagnostic in this package goes to `stderr` through `log()` below, and the
 * stdout grep over `mcp/src` in AGENTS.md must stay empty — including in
 * comments, so that the check is a clean pass and not a hit to reason about.
 *
 * The low-level `Server` + `setRequestHandler` API is used deliberately, not the
 * high-level `McpServer.registerTool` helper: that helper derives `inputSchema`
 * from a Zod shape, and the bytes that conversion emits are exactly what the
 * token budget needs to exclude. The low-level API takes the JSON Schema object
 * verbatim. (`Server` carries an `@deprecated` tag in SDK 1.30.0 pointing at
 * `McpServer` "for the high-level API. Only use `Server` for advanced use
 * cases." — this is one of those cases. See `AGENTS.md` §"The MCP SDK".)
 */
import { createRequire } from 'node:module';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { HttpApiClient, normalizeBaseUrl } from './api-client.js';
import { DEFAULT_API_BASE, SERVER_NAME } from './constants.js';
import { createHandlers } from './handlers.js';
import { INSTRUCTIONS, TOOLS } from './tools.js';

/** The only output channel this process may use besides the JSON-RPC frames. */
function log(...parts: unknown[]): void {
  const text = parts
    .map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  process.stderr.write(`[${SERVER_NAME}] ${text}\n`);
}

// Node already prints these to stderr, but an unguarded rejection can race a
// half-written stdout frame. Log and exit non-zero so the client restarts a
// clean process instead of parsing a truncated one.
process.on('uncaughtException', (err) => {
  log('uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log('unhandled rejection:', reason instanceof Error ? reason : String(reason));
  process.exit(1);
});

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    // Resolves to mcp/package.json from both `src/` (tsx) and `dist/` (node).
    const pkg = require('../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  // Base URL from the environment, ONCE, at startup — never from a tool
  // argument. That is what keeps every constructed URL free of an
  // attacker-controlled component.
  const baseUrl = normalizeBaseUrl(process.env.DEVDIGEST_API_BASE ?? DEFAULT_API_BASE);
  const api = new HttpApiClient(baseUrl);
  const handlers = createHandlers({ api });

  const server = new Server(
    { name: SERVER_NAME, version: packageVersion() },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    // `TOOLS` is `as const` so the budget and protocol tests assert on the exact
    // literals; the protocol type wants a mutable array of the same objects.
    // The serialized bytes are identical either way.
    tools: TOOLS as unknown as Tool[],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const handler = handlers[name];
    if (!handler) {
      // "Errors in FINDING the tool… should be reported as an MCP error
      // response" — SDK `CallToolResultSchema` docblock. Only failures inside a
      // tool become `isError` results.
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    const args = request.params.arguments;
    try {
      return await handler(args && typeof args === 'object' ? (args as Record<string, unknown>) : {});
    } catch (err) {
      // Fail closed: a handler that throws still produces a well-formed result.
      log(`handler "${name}" threw:`, err instanceof Error ? err : String(err));
      return {
        content: [
          {
            type: 'text' as const,
            text: `The ${name} tool failed unexpectedly. Retry once; if it fails again, check the DevDigest engine at ${baseUrl}.`,
          },
        ],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  log(`ready — ${TOOLS.length} tools, engine ${baseUrl}`);
}

main().catch((err) => {
  log('fatal:', err instanceof Error ? err : String(err));
  process.exit(1);
});
