/**
 * Error semantics: every failure the model can act on comes back as a tool
 * error whose text names the next call.
 */
import { describe, expect, it } from 'vitest';

import { HttpApiClient } from '../src/api-client.js';
import { createHandlers } from '../src/handlers.js';
import {
  MAX_BLAST_CALLERS_PER_SYMBOL,
  MAX_BLAST_SYMBOLS,
} from '../src/constants.js';
import { fieldNames, identifierFields, uuidBearingPaths } from './helpers/fields.js';
import { stubApi } from './helpers/stub-api.js';

const REPO_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
/** A REAL uuid, so the no-UUID assertion below can actually fail. */
const PR_ID = '22222222-2222-4222-8222-222222222222';

const repos = [{ id: REPO_ID, full_name: 'acme/widgets' }];
const agents = [{ id: AGENT_ID, name: 'General Reviewer', model: 'claude-opus-5', enabled: true }];

const text = (result: { content: Array<{ text: string }> }) => result.content[0]!.text;

function handlersWith(responses: Record<string, unknown | (() => unknown)>) {
  return createHandlers({ api: stubApi(responses) });
}

describe('run_agent_on_pr errors', () => {
  it('points an unknown agent at list_agents', async () => {
    const handlers = handlersWith({ 'GET /agents': agents });
    const result = await handlers.run_agent_on_pr!({
      repo: 'acme/widgets',
      pr: 42,
      agent: 'Nope',
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Call list_agents');
    expect(text(result)).toBe(
      'Agent "Nope" not found. Call list_agents to see the configured agents, then retry with one of those names.',
    );
  });

  it('tells the user where to add an unknown repository', async () => {
    const handlers = handlersWith({ 'GET /agents': agents, 'GET /repos': [] });
    const result = await handlers.run_agent_on_pr!({
      repo: 'acme/widgets',
      pr: 42,
      agent: 'General Reviewer',
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'Repository "acme/widgets" is not in DevDigest. Add it in the web UI at http://localhost:3000, or check the spelling — it must be owner/name.',
    );
  });

  it('tells the user to import a pull request that is not there', async () => {
    const handlers = handlersWith({
      'GET /agents': agents,
      'GET /repos': repos,
      [`GET /repos/${REPO_ID}/pulls`]: [{ id: null, number: 42 }],
    });
    const result = await handlers.run_agent_on_pr!({
      repo: 'acme/widgets',
      pr: 42,
      agent: 'General Reviewer',
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'Pull request #42 is not imported for acme/widgets. Open the repository in the web UI to import its pull requests, then retry.',
    );
  });

  it('rejects a malformed pr without touching the network', async () => {
    const api = stubApi({});
    const handlers = createHandlers({ api });
    const result = await handlers.run_agent_on_pr!({
      repo: 'acme/widgets',
      pr: 'forty-two',
      agent: 'General Reviewer',
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('whole pull-request number');
    expect(api.calls).toEqual([]);
  });
});

describe('engine availability', () => {
  it('tells the user how to start a stopped engine', async () => {
    // Port 1 on loopback: nothing listens, so the connection is refused
    // immediately. No outbound network.
    const api = new HttpApiClient('http://127.0.0.1:1');
    const handlers = createHandlers({ api });
    const result = await handlers.list_agents!({});

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'Cannot reach the DevDigest engine at http://127.0.0.1:1. Start it with ./scripts/dev.sh, then retry.',
    );
  });
});

describe('read tools', () => {
  it('get_findings points at run_agent_on_pr when nothing has been reviewed', async () => {
    const handlers = handlersWith({
      'GET /repos': repos,
      [`GET /repos/${REPO_ID}/pulls`]: [{ id: 'pr-uuid', number: 42 }],
      'GET /pulls/pr-uuid/reviews': [],
    });
    const result = await handlers.get_findings!({ repo: 'acme/widgets', pr: 42 });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'No review exists for acme/widgets#42 yet. Call run_agent_on_pr to create one.',
    );
  });

  it('get_conventions points at the Conventions tab when none are accepted', async () => {
    const handlers = handlersWith({
      'GET /repos': repos,
      [`GET /repos/${REPO_ID}/conventions`]: {
        candidates: [
          {
            rule: 'pending one',
            status: 'pending',
            category: 'naming',
            evidence_path: 'src/a.ts',
          },
        ],
        last_scan: null,
      },
    });
    const result = await handlers.get_conventions!({ repo: 'acme/widgets' });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "No accepted conventions for acme/widgets. Extract them in the web UI under the repository's Conventions tab.",
    );
  });

  it('get_blast_radius points at re-analyzing the repository when the index is unusable', async () => {
    const handlers = handlersWith({
      'GET /repos': repos,
      [`GET /repos/${REPO_ID}/pulls`]: [{ id: PR_ID, number: 42 }],
      [`GET /pulls/${PR_ID}/blast`]: {
        state: 'degraded',
        reason: 'no_rank_graph',
        changed_symbols: [],
        downstream: [],
        summary:
          'Blast radius unavailable: the index is incomplete and the import graph was never built.',
      },
    });
    const result = await handlers.get_blast_radius!({ repo: 'acme/widgets', pr: 42 });

    // isError HERE, unlike the L05 placeholder: the fix is a user action the
    // message names, not a retry that can never succeed.
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'The code index for acme/widgets cannot answer this yet. Re-analyze the repository in the web UI at http://localhost:3000, then retry.',
    );
  });
});

describe('get_blast_radius', () => {
  const blast = {
    state: 'full',
    changed_symbols: [
      { name: 'rateLimit', file: 'server/src/platform/limiter.ts', kind: 'function' },
      { name: 'nowMs', file: 'server/src/platform/clock.ts', kind: 'function' },
    ],
    downstream: [
      {
        symbol: 'rateLimit',
        file: 'server/src/platform/limiter.ts',
        callers: [
          { name: 'buildApp', file: 'server/src/app.ts', line: 96 },
          { name: 'pullsRoutes', file: 'server/src/modules/pulls/routes.ts', line: 49 },
        ],
        endpoints_affected: ['GET /pulls/:id', 'POST /pulls/:id/review'],
        crons_affected: ['job:poll_repos'],
      },
      {
        symbol: 'nowMs',
        file: 'server/src/platform/clock.ts',
        callers: [],
        endpoints_affected: [],
        crons_affected: [],
      },
    ],
    summary:
      '2 changed symbols reach 2 callers in 2 files; 2 HTTP endpoints and 1 cron may be affected.',
  };

  function handlersForBlast(body: unknown) {
    const api = stubApi({
      'GET /repos': repos,
      [`GET /repos/${REPO_ID}/pulls`]: [{ id: PR_ID, number: 42 }],
      [`GET /pulls/${PR_ID}/blast`]: body,
    });
    return { api, handlers: createHandlers({ api }) };
  }

  it('makes exactly one blast call beyond resolution, and returns a concise result', async () => {
    const { api, handlers } = handlersForBlast(blast);
    const result = await handlers.get_blast_radius!({ repo: 'acme/widgets', pr: 42 });

    expect(result.isError).toBeUndefined();
    expect(api.calls).toEqual([
      'GET /repos',
      `GET /repos/${REPO_ID}/pulls`,
      `GET /pulls/${PR_ID}/blast`,
    ]);

    const parsed = JSON.parse(text(result)) as Record<string, unknown>;
    // Keys are a subset of the documented success shape — nothing extra leaks.
    expect(Object.keys(parsed).every((k) =>
      ['state', 'summary', 'changed_symbols', 'truncated', 'note'].includes(k),
    )).toBe(true);
    expect(parsed.state).toBe('full');
    expect(parsed.note).toBeUndefined();
    expect(parsed.changed_symbols).toEqual([
      {
        symbol: 'rateLimit',
        file: 'server/src/platform/limiter.ts',
        kind: 'function',
        caller_count: 2,
        callers: ['server/src/app.ts:96', 'server/src/modules/pulls/routes.ts:49'],
        endpoints: ['GET /pulls/:id', 'POST /pulls/:id/review'],
        crons: ['job:poll_repos'],
      },
      {
        symbol: 'nowMs',
        file: 'server/src/platform/clock.ts',
        kind: 'function',
        caller_count: 0,
        callers: [],
      },
    ]);
  });

  it('carries no identifier field and no UUID anywhere in the tree', async () => {
    const { handlers } = handlersForBlast(blast);
    const parsed = JSON.parse(
      text(await handlers.get_blast_radius!({ repo: 'acme/widgets', pr: 42 })),
    );

    // A recursive FIELD check, never a regex over the serialized text — a
    // criterion phrased over bytes selects for fixtures that dodge it (root
    // `INSIGHTS.md` 2026-08-09). `PR_ID` is a real UUID, so this can fail.
    expect(identifierFields(parsed)).toEqual([]);
    expect(uuidBearingPaths(parsed)).toEqual([]);
    expect(fieldNames(parsed)).not.toContain('confidence');
    expect(fieldNames(parsed)).not.toContain('rationale');
  });

  it('adds an actionable note — not the machine reason code — on a partial index', async () => {
    const { handlers } = handlersForBlast({ ...blast, state: 'partial', reason: 'index_partial' });
    const parsed = JSON.parse(
      text(await handlers.get_blast_radius!({ repo: 'acme/widgets', pr: 42 })),
    ) as Record<string, unknown>;

    expect(parsed.state).toBe('partial');
    expect(parsed.note).toBe(
      'The code index is incomplete, so some callers may be missing. Treat this list as a lower bound.',
    );
    // The machine code stays server-side: it tells a model nothing it can act on.
    expect(fieldNames(parsed)).not.toContain('reason');
  });

  it('caps symbols and callers, keeping caller_count untruncated', async () => {
    const symbols = Array.from({ length: MAX_BLAST_SYMBOLS + 3 }, (_, i) => ({
      name: `sym${i}`,
      file: `src/s${i}.ts`,
      kind: 'function',
    }));
    const { handlers } = handlersForBlast({
      state: 'full',
      changed_symbols: symbols,
      downstream: symbols.map((s) => ({
        symbol: s.name,
        file: s.file,
        callers: Array.from({ length: MAX_BLAST_CALLERS_PER_SYMBOL + 4 }, (_, i) => ({
          name: `c${i}`,
          file: `src/c${i}.ts`,
          line: i + 1,
        })),
        endpoints_affected: [],
        crons_affected: [],
      })),
      summary: 'many',
    });
    const parsed = JSON.parse(
      text(await handlers.get_blast_radius!({ repo: 'acme/widgets', pr: 42 })),
    ) as { changed_symbols: Array<{ callers: string[]; caller_count: number }>; truncated: string };

    expect(parsed.changed_symbols).toHaveLength(MAX_BLAST_SYMBOLS);
    expect(parsed.truncated).toBe(
      `showing ${MAX_BLAST_SYMBOLS} of ${MAX_BLAST_SYMBOLS + 3} changed symbols`,
    );
    for (const sym of parsed.changed_symbols) {
      expect(sym.callers).toHaveLength(MAX_BLAST_CALLERS_PER_SYMBOL);
      // The count is the REAL fan-out, so a cap never understates the impact.
      expect(sym.caller_count).toBe(MAX_BLAST_CALLERS_PER_SYMBOL + 4);
    }
  });

  it('turns a malformed engine body into a bad-shape error, never a half-parsed object', async () => {
    const { handlers } = handlersForBlast({ state: 'full', summary: 'x' });
    const result = await handlers.get_blast_radius!({ repo: 'acme/widgets', pr: 42 });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('a shape this MCP server does not understand');
  });

  it('rejects a malformed pr without touching the network', async () => {
    const api = stubApi({});
    const handlers = createHandlers({ api });
    const result = await handlers.get_blast_radius!({ repo: 'acme/widgets', pr: 1.5 });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('whole pull-request number');
    expect(api.calls).toEqual([]);
  });
});
