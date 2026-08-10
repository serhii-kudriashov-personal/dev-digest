/**
 * `get_findings` end to end, against the fake engine — the call `plan-verifier`
 * ran live and found a UUID in.
 *
 * The UUID it found was inside `trace_url`, which is correct: Step 3's success
 * shape and §Blocking both mandate that URL, and every run id the engine mints
 * is a UUID (`server/src/modules/_shared/schemas.ts:11`). Acceptance 8 of
 * `specs/l05-mcp-server.md` now carries that carve-out explicitly, and the rule
 * it carves out of is about FIELDS, not bytes.
 *
 * Nothing else asserted it: `shape.test.ts` covers the pure transform, and no
 * test at all drove `get_findings` down its success path — which is the branch
 * that decides whether a `trace_url` is emitted and from what.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { HttpApiClient } from '../src/api-client.js';
import { createHandlers } from '../src/handlers.js';
import { FAKE_RUN_ID, startFakeEngine } from './helpers/fake-engine.js';
import type { FakeEngine } from './helpers/fake-engine.js';
import { fieldNames, identifierFields, uuidBearingPaths } from './helpers/fields.js';

const REPO_ID = '11111111-1111-4111-8111-111111111111';
const PR_ID = '22222222-2222-4222-8222-222222222222';
const FINDING_ID = '44444444-4444-4444-8444-444444444444';

const repos = [{ id: REPO_ID, full_name: 'acme/widgets' }];
const pulls = [{ id: PR_ID, number: 42 }];

/** A review row shaped like the engine's, identifiers and all. */
const reviewRow = (over: Record<string, unknown> = {}) => ({
  run_id: FAKE_RUN_ID,
  agent_name: 'General Reviewer',
  verdict: 'request_changes',
  score: 41,
  created_at: '2026-08-09T10:00:00.000Z',
  findings: [
    {
      id: FINDING_ID,
      review_id: '77777777-7777-4777-8777-777777777777',
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
  ...over,
});

const text = (result: { content: Array<{ text: string }> }) => result.content[0]!.text;

let engine: FakeEngine | undefined;

afterEach(async () => {
  await engine?.close();
  engine = undefined;
});

async function callGetFindings(reviews: Array<Record<string, unknown>>) {
  engine = await startFakeEngine({ repos, pulls, reviews });
  const api = new HttpApiClient(engine.baseUrl);
  const handlers = createHandlers({ api });
  const result = await handlers.get_findings!({ repo: 'acme/widgets', pr: 42 });
  expect(result.isError).toBeUndefined();
  return { body: JSON.parse(text(result)) as Record<string, unknown>, baseUrl: api.baseUrl };
}

describe('get_findings identifiers', () => {
  it('emits the run UUID inside trace_url and in no other field, at any depth', async () => {
    const { body, baseUrl } = await callGetFindings([reviewRow()]);

    // The carve-out, asserted directly: the URL survives WITH its UUID …
    expect(body.trace_url).toBe(`${baseUrl}/runs/${FAKE_RUN_ID}/trace`);
    // … and it is the only field in the whole response that carries one.
    // Per-path, not on a serialized blob: a blob cannot tell "a URL that
    // contains a UUID" from "a field that IS a UUID", which is the entire
    // distinction acceptance 8 turns on.
    expect(uuidBearingPaths(body)).toEqual(['trace_url']);

    // The intent behind the criterion: never hand the model an identifier it
    // could pass back as a tool argument. `findings[0].id` and `review_id` are
    // both present on the wire and must not survive shaping.
    expect(identifierFields(body)).toEqual([]);
    expect(fieldNames(body)).not.toContain('confidence');
    expect(fieldNames(body)).not.toContain('rationale');
    // Dropped whole, not renamed: the prose itself is gone too.
    expect(JSON.stringify(body)).not.toContain('must never be forwarded');
  });

  it('omits trace_url when the review has no run id', async () => {
    // `McpReview.run_id` is `string | null` — an `agent_runs` row and its
    // `reviews` row can each outlive the other (root `INSIGHTS.md`
    // 2026-08-02). Building the URL unconditionally would hand the model
    // `…/runs/null/trace`, a link to nothing.
    const { body } = await callGetFindings([reviewRow({ run_id: null })]);

    expect(body).not.toHaveProperty('trace_url');
    expect(uuidBearingPaths(body)).toEqual([]);
    expect(body.verdict).toBe('request_changes');
  });
});
