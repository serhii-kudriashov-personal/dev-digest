/**
 * Error semantics: every failure the model can act on comes back as a tool
 * error whose text names the next call.
 */
import { describe, expect, it } from 'vitest';

import { HttpApiClient } from '../src/api-client.js';
import { createHandlers } from '../src/handlers.js';
import { stubApi } from './helpers/stub-api.js';

const REPO_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';

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

  it('get_blast_radius returns the placeholder without an error and without a call', async () => {
    const api = stubApi({});
    const handlers = createHandlers({ api });
    const result = await handlers.get_blast_radius!({ repo: 'acme/widgets', pr: 42 });

    // NOT isError: `isError: true` is the signal that a retry could work, and
    // this tool will never work in this version.
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result))).toEqual({
      status: 'not_implemented',
      message: 'Blast radius is not available in this version of DevDigest.',
    });
    expect(api.calls).toEqual([]);
  });
});
