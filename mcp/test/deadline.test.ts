/**
 * The blocking wait, against a fake engine on loopback.
 *
 * `DEADLINE_MS` and `POLL_INTERVAL_MS` are injected so the deadline case runs in
 * milliseconds instead of two minutes.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { HttpApiClient } from '../src/api-client.js';
import { DEADLINE_MS, POLL_INTERVAL_MS } from '../src/constants.js';
import { createHandlers } from '../src/handlers.js';
import { FAKE_RUN_ID, startFakeEngine } from './helpers/fake-engine.js';
import type { FakeEngine } from './helpers/fake-engine.js';
import { identifierFields, uuidBearingPaths } from './helpers/fields.js';

const REPO_ID = '11111111-1111-4111-8111-111111111111';
const PR_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';

const agents = [{ id: AGENT_ID, name: 'General Reviewer', model: 'claude-opus-5', enabled: true }];
const repos = [{ id: REPO_ID, full_name: 'acme/widgets' }];
const pulls = [{ id: PR_ID, number: 42 }];

const args = { repo: 'acme/widgets', pr: 42, agent: 'General Reviewer' };
const text = (result: { content: Array<{ text: string }> }) => result.content[0]!.text;

let engine: FakeEngine | undefined;

afterEach(async () => {
  await engine?.close();
  engine = undefined;
});

async function boot(runs: Array<Record<string, unknown>>, reviews: Array<Record<string, unknown>>) {
  engine = await startFakeEngine({ agents, repos, pulls, runs, reviews });
  const api = new HttpApiClient(engine.baseUrl);
  return { engine, api };
}

describe('run_agent_on_pr', () => {
  it('returns the verdict and findings when the run completes', async () => {
    const { api } = await boot(
      [{ run_id: FAKE_RUN_ID, status: 'done' }],
      [
        {
          run_id: FAKE_RUN_ID,
          agent_name: 'General Reviewer',
          verdict: 'request_changes',
          score: 41,
          created_at: '2026-08-09T10:00:00.000Z',
          findings: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              severity: 'CRITICAL',
              category: 'security',
              title: 'SSRF in the webhook handler',
              file: 'src/x.ts',
              start_line: 40,
              end_line: 44,
              rationale: 'long markdown that must never be forwarded',
              suggestion: 'Validate the URL against an allowlist.',
              confidence: 1,
            },
          ],
        },
      ],
    );
    const handlers = createHandlers({ api, deadlineMs: 2000, pollIntervalMs: 5 });

    const result = await handlers.run_agent_on_pr!(args);
    expect(result.isError).toBeUndefined();

    const body = JSON.parse(text(result));
    expect(body.status).toBe('completed');
    expect(body.verdict).toBe('request_changes');
    expect(body.score).toBe(41);
    expect(body.counts).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
    expect(body.findings).toHaveLength(1);
    expect(body.trace_url).toBe(`${api.baseUrl}/runs/${FAKE_RUN_ID}/trace`);
    // The run id is a UUID, so the success shape carries one — inside the URL
    // and nowhere else (`specs/l05-mcp-server.md` acceptance 8, carve-out).
    expect(uuidBearingPaths(body)).toEqual(['trace_url']);
    expect(identifierFields(body)).toEqual([]);
  });

  it('surfaces a failed run with its error and a next step', async () => {
    const { api } = await boot(
      [{ run_id: FAKE_RUN_ID, status: 'failed', error: 'no API key configured' }],
      [],
    );
    const handlers = createHandlers({ api, deadlineMs: 2000, pollIntervalMs: 5 });

    const result = await handlers.run_agent_on_pr!(args);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'The review run failed: no API key configured. Check the API key in Settings, then retry.',
    );
  });

  it('times out without cancelling, and points at get_findings', async () => {
    const { engine: fake, api } = await boot([{ run_id: FAKE_RUN_ID, status: 'running' }], []);
    const handlers = createHandlers({ api, deadlineMs: 60, pollIntervalMs: 10 });

    const result = await handlers.run_agent_on_pr!(args);

    // NOT an error: `isError: true` here would invite a retry that starts a
    // SECOND paid run.
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(text(result));
    expect(body.status).toBe('timed_out');
    expect(body.message).toContain('call get_findings');
    expect(body.trace_url).toBe(`${api.baseUrl}/runs/${FAKE_RUN_ID}/trace`);
    // The timed-out shape is the other response that must hand back the run id
    // as a URL and never as a field.
    expect(uuidBearingPaths(body)).toEqual(['trace_url']);

    // The run keeps going and will persist its review. Cancelling would throw
    // away LLM work the user already paid for.
    expect(fake.requests.some((r) => r.includes('/cancel'))).toBe(false);
  });

  it('polls at most 60 times over a simulated 120 seconds', async () => {
    const { engine: fake, api } = await boot([{ run_id: FAKE_RUN_ID, status: 'running' }], []);

    // Virtual clock: `sleep` advances it, so the real 120-second budget is
    // exercised in milliseconds.
    let clock = 0;
    const handlers = createHandlers({
      api,
      deadlineMs: DEADLINE_MS,
      pollIntervalMs: POLL_INTERVAL_MS,
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    });

    const result = await handlers.run_agent_on_pr!(args);
    expect(JSON.parse(text(result)).status).toBe('timed_out');

    const polls = fake.requests.filter((r) => r.endsWith('/runs')).length;
    expect(polls).toBeLessThanOrEqual(60);
    expect(polls).toBeGreaterThan(0);
  });
});
