import { describe, it, expect } from 'vitest';
import type { RepoRef, ReviewPublication, ReviewPublicationNote } from '@devdigest/shared';
import { GitLabForgeClient } from '../src/adapters/gitlab/forge.js';
import type { HostResolver } from '../src/adapters/gitlab/http.js';

/**
 * Publishing a review onto a merge request (SPEC-06 —
 * `specs/2026-08-28-gitlab-repositories.md`, AC-34…AC-41, AC-10).
 *
 * HERMETIC BY CONSTRUCTION, exactly as `gitlab-mr.test.ts`: `fetch` and the host
 * resolver are both injected. AC-4 forbids DevDigest connecting to a local
 * address and the plan (Q4) refuses a test-only SSRF bypass, so there is no
 * instance to stand up — every response is a recorded fixture replayed through
 * the injected `fetchImpl`.
 *
 * Why the assertions are on the RECORDED REQUESTS and not only on the returned
 * outcome: on GitLab, publishing is four kinds of request (read `diff_refs`,
 * post the summary, post each diff note, act on the verdict), and three of this
 * feature's failure modes are invisible in the outcome alone —
 *
 *  - a diff note anchored with the wrong line field lands on the wrong SIDE of
 *    the diff and still returns 201 (AC-35);
 *  - a `request_changes` run with no standing approval that issues `unapprove`
 *    anyway 404s in production and reports the same outcome as one that
 *    correctly issued nothing (AC-37);
 *  - a partial publication that went on to apply the verdict leaves the merge
 *    request approved on top of half a review (AC-40).
 *
 * The credential is a fixture and appears in nothing this file produces
 * (AC-10) — every failure path below asserts that too.
 */

/** Registered base URL: non-default port AND a path prefix (AC-6). */
const BASE = 'https://gitlab.example.com:8443/gitlab';
/** The fixture access token. No reason, no message, no body may contain it. */
const CREDENTIAL = 'glpat-FIXTURE-do-not-echo-0000';

/** NFR-4 — four segments; `owner` carries every segment but the last. */
const REPO: RepoRef = { owner: 'group/sub/team', name: 'project', instanceKey: 'inst-1' };
const NAMESPACE = 'group/sub/team/project';
const ENCODED = encodeURIComponent(NAMESPACE);

const project = `/gitlab/api/v4/projects/${ENCODED}`;
const mr = (n: number) => `${project}/merge_requests/${n}`;

/** The merge request's current diff revisions — what every note anchors to. */
const DIFF_REFS = { base_sha: 'base-aaa', head_sha: 'head-bbb', start_sha: 'start-ccc' };

/** The identity the stored credential authenticates as. */
const ME = 'devdigest-bot';

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

type Answer = { status?: number; body?: unknown };
type Route = Answer | ((call: number) => Answer);

/**
 * Replay canned answers keyed by `METHOD /pathname`, recording every request.
 *
 * A route may be a FUNCTION of the per-key call index, which is what makes
 * AC-40 testable at all: the second diff note must fail while the first
 * succeeded, and both go to the same path.
 *
 * An unmatched route is recorded in `misses` rather than only thrown, because
 * `publishReview` catches everything — a missing fixture would otherwise
 * surface as a plausible-looking `not_posted` and the test would assert a
 * failure it caused itself. Every case below asserts `misses` is empty.
 */
function rig(routes: Record<string, Route>) {
  const requests: Recorded[] = [];
  const misses: string[] = [];
  const calls = new Map<string, number>();

  const fetchImpl = (async (input: unknown, init: Record<string, unknown> = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? 'GET');
    const path = url.pathname;
    requests.push({
      method,
      path,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });

    const key = `${method} ${path}`;
    const route = routes[key];
    if (route === undefined) {
      misses.push(key);
      throw new Error(`gitlab-publish fixture has no route for ${key}`);
    }
    const n = calls.get(key) ?? 0;
    calls.set(key, n + 1);
    const answer = typeof route === 'function' ? route(n) : route;
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const resolveHost: HostResolver = async () => ['93.184.216.34'];

  const client = new GitLabForgeClient({
    baseUrl: BASE,
    instanceKey: 'inst-1',
    credential: CREDENTIAL,
    instanceLabel: 'Acme GitLab',
    fetchImpl,
    resolveHost,
  });

  const posted = (path: string) => requests.filter((r) => r.method === 'POST' && r.path === path);

  return { client, requests, misses, posted };
}

const rightNote = (over: Partial<ReviewPublicationNote> = {}): ReviewPublicationNote => ({
  path: 'src/config.ts',
  line: 11,
  side: 'RIGHT',
  body: '**CRITICAL — Hard-coded token**\n\nMove this to an env var.',
  ...over,
});

const publication = (over: Partial<ReviewPublication> = {}): ReviewPublication => ({
  summary: '**DevDigest review — Comment**\n\nTwo config values are hard-coded.',
  notes: [rightNote()],
  verdict: 'comment',
  ...over,
});

/** The four routes a `comment`-verdict publication needs, and nothing more. */
const publishRoutes = (over: Record<string, Route> = {}): Record<string, Route> => ({
  [`GET ${mr(7)}`]: { body: { iid: 7, diff_refs: DIFF_REFS } },
  [`POST ${mr(7)}/notes`]: { status: 201, body: { id: 900 } },
  [`POST ${mr(7)}/discussions`]: { status: 201, body: { id: 'aa11bb22' } },
  ...over,
});

describe('GitLabForgeClient.publishReview — AC-34, AC-35: notes and their anchors', () => {
  it('AC-34: the summary is a merge-request note and each finding is its own diff note', async () => {
    const r = rig(publishRoutes());

    const result = await r.client.publishReview(
      REPO,
      7,
      publication({ notes: [rightNote(), rightNote({ path: 'src/auth.ts', line: 42 })] }),
    );

    expect(r.misses).toEqual([]);
    // One merge-request-level note carrying the summary…
    expect(r.posted(mr(7) + '/notes')).toHaveLength(1);
    expect(r.posted(mr(7) + '/notes')[0]!.body).toEqual({
      body: '**DevDigest review — Comment**\n\nTwo config values are hard-coded.',
    });
    // …and one diff note per finding, each on the file the finding names.
    const discussions = r.posted(mr(7) + '/discussions');
    expect(discussions).toHaveLength(2);
    expect((discussions[0]!.body as { position: { new_path: string } }).position.new_path).toBe(
      'src/config.ts',
    );
    expect((discussions[1]!.body as { position: { new_path: string } }).position.new_path).toBe(
      'src/auth.ts',
    );

    // The summary note counts, which is what makes `notes_published` comparable
    // with the count AC-40 reports for a partial publication.
    expect(result).toEqual({ outcome: 'posted_verdict_applied', reason: null, notesPublished: 3 });
  });

  it('AC-35: an ADDED line is anchored by new_line, with all three revision ids and both paths', async () => {
    const r = rig(publishRoutes());

    await r.client.publishReview(REPO, 7, publication({ notes: [rightNote({ line: 11 })] }));

    expect(r.misses).toEqual([]);
    expect(r.posted(mr(7) + '/discussions')[0]!.body).toEqual({
      body: '**CRITICAL — Hard-coded token**\n\nMove this to an env var.',
      position: {
        position_type: 'text',
        // All three: GitLab needs base, start AND head to place a note against
        // a specific revision of the diff.
        base_sha: 'base-aaa',
        head_sha: 'head-bbb',
        start_sha: 'start-ccc',
        // Both paths, because a renamed file has two and the port carries one.
        old_path: 'src/config.ts',
        new_path: 'src/config.ts',
        new_line: 11,
      },
    });
    // Only ONE line field is sent. Sending both is how a note lands on the
    // wrong side of the diff, which is the failure AC-35 exists to name.
    expect(r.posted(mr(7) + '/discussions')[0]!.body).not.toHaveProperty('position.old_line');
  });

  it('AC-35: a REMOVED line is anchored by old_line — reachable only through the port', async () => {
    // READ THIS BEFORE CHANGING IT. End to end, DevDigest cannot produce an
    // old-side note today: `reviewer-core/src/grounding.ts` keeps only a finding
    // whose line appears in the diff's NEW-side line numbers, so
    // `buildReviewPublication` always emits `side: 'RIGHT'`
    // (`reviews/helpers.ts`, decision 3). The port nonetheless expresses both
    // sides because AC-35 requires it, and this is the one place the old-side
    // mapping is observable: a `LEFT` note handed straight to `publishReview`.
    // Nothing here fabricates a finding to manufacture coverage — if grounding
    // ever admits an old-side finding, this assertion is already in place.
    const r = rig(publishRoutes());

    await r.client.publishReview(
      REPO,
      7,
      publication({ notes: [rightNote({ side: 'LEFT', line: 7 })] }),
    );

    expect(r.misses).toEqual([]);
    const position = (r.posted(mr(7) + '/discussions')[0]!.body as { position: Record<string, unknown> })
      .position;
    expect(position['old_line']).toBe(7);
    expect(position).not.toHaveProperty('new_line');
    expect(position['old_path']).toBe('src/config.ts');
    expect(position['new_path']).toBe('src/config.ts');
    expect(position['base_sha']).toBe('base-aaa');
  });
});

describe('GitLabForgeClient.publishReview — AC-36, AC-37, AC-38, AC-41: the verdict', () => {
  it('AC-36: an `approve` verdict issues POST …/approve and reports the verdict applied', async () => {
    const r = rig(publishRoutes({ [`POST ${mr(7)}/approve`]: { status: 201, body: {} } }));

    const result = await r.client.publishReview(REPO, 7, publication({ verdict: 'approve' }));

    expect(r.misses).toEqual([]);
    expect(r.posted(mr(7) + '/approve')).toHaveLength(1);
    expect(result).toEqual({ outcome: 'posted_verdict_applied', reason: null, notesPublished: 2 });
  });

  it('AC-38: a 403 on approve means NOT AN ELIGIBLE APPROVER — never a missing capability', async () => {
    // Merge-request approvals are a FREE-tier feature (root `INSIGHTS.md`
    // 2026-08-28): `approve`/`unapprove` work on every edition and only the
    // ENFORCEMENT of approval rules is paid. So a 403 is almost always the
    // credential's own user not being an eligible approver — a project or group
    // member, and by default not the merge request's author. Reporting it as
    // "this instance cannot approve" sends the operator to change a licence
    // that was never the problem.
    const r = rig(
      publishRoutes({ [`POST ${mr(7)}/approve`]: { status: 403, body: { message: '403 Forbidden' } } }),
    );

    const result = await r.client.publishReview(REPO, 7, publication({ verdict: 'approve' }));

    expect(r.misses).toEqual([]);
    expect(result.outcome).toBe('posted_verdict_not_applied');
    // AC-38: the notes stay posted and the count says so.
    expect(result.notesPublished).toBe(2);

    const reason = result.reason!;
    expect(reason).toContain('The notes were posted');
    expect(reason).toContain('eligible approver');
    expect(reason).toMatch(/member of the project or its group/);
    // AC-45: it names the instance, and never the token (AC-10).
    expect(reason).toContain('Acme GitLab');
    expect(reason).not.toContain(CREDENTIAL);

    // The refusal must NOT be phrased as a capability/licence problem — that is
    // what `expectOk`'s 404 branch says, and it is a different diagnosis.
    expect(reason).not.toMatch(/has no /);
    expect(reason).not.toMatch(/not available/);
    expect(reason).not.toMatch(/unknown/i);
  });

  it('AC-38: a 404 on approve is reported as UNKNOWN, and reads differently from the 403', async () => {
    // GitLab answers 404 for both "not permitted" and "not available" so as not
    // to leak existence, so a confident refusal here would be a guess.
    const r = rig(
      publishRoutes({ [`POST ${mr(7)}/approve`]: { status: 404, body: { message: '404 Not found' } } }),
    );
    const r403 = rig(
      publishRoutes({ [`POST ${mr(7)}/approve`]: { status: 403, body: { message: '403 Forbidden' } } }),
    );

    const notFound = await r.client.publishReview(REPO, 7, publication({ verdict: 'approve' }));
    const forbidden = await r403.client.publishReview(REPO, 7, publication({ verdict: 'approve' }));

    expect(r.misses).toEqual([]);
    expect(notFound.outcome).toBe('posted_verdict_not_applied');
    expect(notFound.reason).toMatch(/unknown/);
    // The two refusals are genuinely distinguishable prose, not one message
    // reused for two very different next actions by the operator.
    expect(notFound.reason).not.toBe(forbidden.reason);
    expect(notFound.reason).not.toContain('eligible approver');
    expect(notFound.reason).not.toContain(CREDENTIAL);
  });

  it('AC-37/AC-41: `request_changes` WITH a standing approval withdraws it and says so', async () => {
    const r = rig(
      publishRoutes({
        [`GET /gitlab/api/v4/user`]: { body: { username: ME } },
        [`GET ${mr(7)}/approvals`]: { body: { approved_by: [{ user: { username: ME } }] } },
        [`POST ${mr(7)}/unapprove`]: { status: 201, body: {} },
      }),
    );

    const result = await r.client.publishReview(
      REPO,
      7,
      publication({ verdict: 'request_changes' }),
    );

    expect(r.misses).toEqual([]);
    expect(r.posted(mr(7) + '/unapprove')).toHaveLength(1);
    expect(result.outcome).toBe('posted_verdict_applied');
    expect(result.reason).toContain('withdrawn');
    // AC-41: the downgrade is stated in words on the SAME outcome.
    expect(result.reason).toContain('no "request changes" review state');
    expect(result.reason).toContain('carried by the summary note');
  });

  it('AC-37: `request_changes` with NO standing approval issues no unapprove request at all', async () => {
    // The outcome alone cannot catch this. A wasted `unapprove` on a merge
    // request DevDigest never approved 404s in production and would still
    // report `posted_verdict_not_applied` — the absence of the request is the
    // only observable difference.
    const r = rig(
      publishRoutes({
        [`GET /gitlab/api/v4/user`]: { body: { username: ME } },
        // Approved by somebody else entirely, which is not DevDigest's approval.
        [`GET ${mr(7)}/approvals`]: { body: { approved_by: [{ user: { username: 'marisa.koch' } }] } },
      }),
    );

    const result = await r.client.publishReview(
      REPO,
      7,
      publication({ verdict: 'request_changes' }),
    );

    expect(r.misses).toEqual([]);
    expect(r.requests.map((q) => `${q.method} ${q.path}`)).not.toContain(`POST ${mr(7)}/unapprove`);
    expect(r.posted(mr(7) + '/unapprove')).toHaveLength(0);

    expect(result.outcome).toBe('posted_verdict_not_applied');
    expect(result.reason).toContain('holds no approval');
    // AC-41 again: the same sentence explains the downgrade either way.
    expect(result.reason).toContain('no "request changes" review state');
    expect(result.reason).toContain('carried by the summary note');
    expect(result.notesPublished).toBe(2);
  });

  it('AC-41: a `request_changes` outcome ALWAYS states that the note carries the verdict', async () => {
    // Three ways the withdrawal can end — withdrawn, none held, and the check
    // itself failing — and all three must still say the downgrade out loud.
    const held = rig(
      publishRoutes({
        [`GET /gitlab/api/v4/user`]: { body: { username: ME } },
        [`GET ${mr(7)}/approvals`]: { body: { approved_by: [{ user: { username: ME } }] } },
        [`POST ${mr(7)}/unapprove`]: { status: 201, body: {} },
      }),
    );
    const none = rig(
      publishRoutes({
        [`GET /gitlab/api/v4/user`]: { body: { username: ME } },
        [`GET ${mr(7)}/approvals`]: { body: { approved_by: [] } },
      }),
    );
    const unreadable = rig(
      publishRoutes({
        [`GET /gitlab/api/v4/user`]: { body: { username: ME } },
        [`GET ${mr(7)}/approvals`]: { status: 500, body: { message: 'boom' } },
      }),
    );

    const outcomes = await Promise.all(
      [held, none, unreadable].map((r) =>
        r.client.publishReview(REPO, 7, publication({ verdict: 'request_changes' })),
      ),
    );

    for (const r of [held, none, unreadable]) expect(r.misses).toEqual([]);
    for (const outcome of outcomes) {
      expect(outcome.reason).toContain(
        'GitLab has no "request changes" review state, so the requested changes are ' +
          'carried by the summary note rather than as a blocking review state.',
      );
      expect(outcome.reason).not.toContain(CREDENTIAL);
      // The notes landed in every one of the three.
      expect(outcome.notesPublished).toBe(2);
    }
    expect(outcomes.map((o) => o.outcome)).toEqual([
      'posted_verdict_applied',
      'posted_verdict_not_applied',
      'posted_verdict_not_applied',
    ]);
  });

  it('a `comment` verdict takes no forge action and needs no reason', async () => {
    const r = rig(publishRoutes());

    const result = await r.client.publishReview(REPO, 7, publication({ verdict: 'comment' }));

    expect(r.misses).toEqual([]);
    // The summary note IS the comment; there is nothing else to do.
    expect(r.requests.filter((q) => /approve/.test(q.path))).toEqual([]);
    expect(result).toEqual({ outcome: 'posted_verdict_applied', reason: null, notesPublished: 2 });
  });
});

describe('GitLabForgeClient.publishReview — AC-39, AC-40: partial and failed publication', () => {
  it('AC-40: a failure AFTER a note has landed is partially_published, with the count', async () => {
    // Three findings; the SECOND diff note is refused. One summary note and one
    // diff note already reached the merge request, so this is not a failure —
    // it is a partial publication, and the number is the answer AC-40 wants.
    const r = rig(
      publishRoutes({
        [`POST ${mr(7)}/discussions`]: (call) =>
          call === 1 ? { status: 500, body: { message: 'boom' } } : { status: 201, body: { id: 'x' } },
      }),
    );

    const result = await r.client.publishReview(
      REPO,
      7,
      publication({
        verdict: 'approve',
        notes: [rightNote(), rightNote({ line: 12 }), rightNote({ line: 13 })],
      }),
    );

    expect(r.misses).toEqual([]);
    expect(result.outcome).toBe('partially_published');
    // Summary + the first diff note. Distinguishable from a complete post (4)
    // and from one that never started (0).
    expect(result.notesPublished).toBe(2);
    expect(result.reason).toContain('2 of 4 notes');
    expect(result.reason).not.toContain(CREDENTIAL);

    // Only two of the three diff notes were even attempted, and the third was
    // not retried behind the caller's back.
    expect(r.posted(mr(7) + '/discussions')).toHaveLength(2);

    // A partial publication does NOT go on to apply the verdict: an approval on
    // a merge request carrying half a review is worse than no approval.
    expect(r.requests.map((q) => q.path)).not.toContain(`${mr(7)}/approve`);
    expect(result.reason).toContain('The verdict was not applied.');
  });

  it('AC-40: a failure on the FIRST note is not_posted — nothing landed', async () => {
    // Ordering is load-bearing: the summary goes first precisely so that
    // "nothing landed" and "something landed" are separable states.
    const r = rig(
      publishRoutes({ [`POST ${mr(7)}/notes`]: { status: 500, body: { message: 'boom' } } }),
    );

    const result = await r.client.publishReview(REPO, 7, publication({ verdict: 'approve' }));

    expect(r.misses).toEqual([]);
    expect(result.outcome).toBe('not_posted');
    expect(result.notesPublished).toBe(0);
    expect(result.reason).toContain('Acme GitLab');
    expect(result.reason).not.toContain(CREDENTIAL);
    // No diff note and no verdict were attempted after the summary failed.
    expect(r.posted(mr(7) + '/discussions')).toHaveLength(0);
    expect(r.requests.map((q) => q.path)).not.toContain(`${mr(7)}/approve`);
  });

  it('AC-39/AC-40: an unreadable merge request is not_posted, and REPORTS rather than throws', async () => {
    // The port reports an outcome instead of throwing, because an exception
    // would throw away the count of what already landed. Even at zero, the
    // caller needs the four-state answer rather than a stack trace.
    const r = rig({
      [`GET ${mr(7)}`]: { status: 404, body: { message: '404 Not found' } },
    });

    const result = await r.client.publishReview(REPO, 7, publication());

    expect(r.misses).toEqual([]);
    expect(result.outcome).toBe('not_posted');
    expect(result.notesPublished).toBe(0);
    expect(result.reason).toContain('Acme GitLab');
    expect(result.reason).not.toContain(CREDENTIAL);
    expect(r.requests.filter((q) => q.method === 'POST')).toEqual([]);
  });
});
