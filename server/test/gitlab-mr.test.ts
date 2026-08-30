import { describe, it, expect } from 'vitest';
import type { RepoRef } from '@devdigest/shared';
import { GitLabForgeClient } from '../src/adapters/gitlab/forge.js';
import type { HostResolver } from '../src/adapters/gitlab/http.js';

/**
 * The GitLab read adapter's mappings (SPEC-06 —
 * `specs/2026-08-28-gitlab-repositories.md`, AC-20…AC-25, NFR-4).
 *
 * HERMETIC BY CONSTRUCTION, like `gitlab-adapter.test.ts`: `fetch` and the host
 * resolver are both injected, so nothing here opens a socket or resolves a name.
 * AC-4 forbids DevDigest connecting to a local address, so a test may not stand
 * up a loopback instance to talk to, and the plan (Q4) refuses a test-only SSRF
 * bypass — every response below is a recorded fixture replayed through the
 * injected `fetchImpl`.
 *
 * Three fixtures below are deliberately HOSTILE, and each one is the point of
 * its test rather than decoration:
 *
 *  - every payload carries a `web_url` pointing at another origin, so a mapping
 *    that passed the instance's own link through instead of rebuilding it from
 *    the registered base URL fails here (AC-25);
 *  - every inline note carries `outdated` and `resolvable` set to the OPPOSITE
 *    of the correct answer, so a derivation that quietly read a provider field
 *    instead of comparing revision ids fails here (AC-24);
 *  - the namespace is four segments deep, so a two-segment path assumption
 *    fails here (NFR-4).
 */

/** Registered base URL: non-default port AND a path prefix (AC-6). */
const BASE = 'https://gitlab.example.com:8443/gitlab';
/** The fixture access token. Nothing this file produces may contain it. */
const CREDENTIAL = 'glpat-FIXTURE-do-not-echo-0000';
/** A link target on another origin. It must never reach a returned field. */
const HOSTILE_WEB_URL = 'https://evil.example.net/attacker/repo/-/merge_requests/7';

/** NFR-4 — four segments. `owner` carries every segment but the last. */
const REPO: RepoRef = { owner: 'group/sub/team', name: 'project', instanceKey: 'inst-1' };
const NAMESPACE = 'group/sub/team/project';
const ENCODED = encodeURIComponent(NAMESPACE);

/** GitLab's discussion ids are opaque 40-hex strings; they do not reverse into integers. */
const DISCUSSION_CURRENT = '1a2b3c4d5e6f708192a3b4c5d6e7f80912345678';
const DISCUSSION_SUPERSEDED = '99aa88bb77cc66dd55ee44ff33001122334455aa';

/** The merge request's CURRENT diff revisions — the only input AC-24 compares against. */
const CURRENT_REFS = { base_sha: 'base-aaa', head_sha: 'head-bbb', start_sha: 'start-ccc' };
/** A note written before the last force-push: same base and start, superseded head. */
const SUPERSEDED_REFS = { base_sha: 'base-aaa', head_sha: 'head-OLD', start_sha: 'start-ccc' };

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Replay canned responses keyed by `METHOD /pathname`, recording every call.
 * Keyed by pathname rather than by call order because `getPullRequest` makes
 * four requests and `listReviewComments` two — an order-keyed queue would make
 * the test depend on the adapter's call sequence rather than on its mapping.
 */
function rig(routes: Record<string, unknown>, statuses: Record<string, number> = {}) {
  const requests: Recorded[] = [];

  const fetchImpl = (async (input: unknown, init: Record<string, unknown> = {}) => {
    const url = String(input);
    const method = String(init.method ?? 'GET');
    requests.push({
      method,
      url,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const key = `${method} ${new URL(url).pathname}`;
    const status = statuses[key] ?? 200;
    if (!(key in routes)) {
      throw new Error(`gitlab-mr fixture has no route for ${key}`);
    }
    return new Response(JSON.stringify(routes[key]), {
      status,
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

  return { client, requests };
}

const project = `/gitlab/api/v4/projects/${ENCODED}`;
const mrPath = (n: number) => `${project}/merge_requests/${n}`;

/** One entry of GitLab's merge-request LIST payload. */
const listEntry = (over: Record<string, unknown> = {}) => ({
  id: 90210,
  iid: 7,
  title: 'Add rate limiting to the public API',
  author: { id: 3, username: 'marisa.koch', name: 'Marisa Koch' },
  source_branch: 'feat/rate-limit',
  target_branch: 'main',
  sha: 'head-bbb',
  state: 'opened',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T03:00:00.000Z',
  web_url: HOSTILE_WEB_URL,
  ...over,
});

/** A note carrying planted provider flags that contradict the correct answer. */
const note = (over: Record<string, unknown>) => ({
  id: 101,
  body: 'This should be an env var.',
  author: { username: 'ana.reyes' },
  created_at: '2026-06-02T09:00:00.000Z',
  system: false,
  web_url: HOSTILE_WEB_URL,
  // AC-24 traps: both are the OPPOSITE of what the derivation must answer for
  // the discussion each is planted in. `resolved` is a human action, not a
  // statement about the diff, and is never an input either.
  outdated: true,
  resolvable: false,
  resolved: true,
  ...over,
});

const positionAt = (refs: Record<string, string>) => ({
  position_type: 'text',
  ...refs,
  old_path: 'src/config.ts',
  new_path: 'src/config.ts',
  old_line: null,
  new_line: 11,
});

describe('GitLabForgeClient — merge-request mappings (fixtures, no network)', () => {
  // -------------------------------------------------------------------------
  // AC-20 / AC-21 — the list
  // -------------------------------------------------------------------------

  it('AC-20/AC-21: maps the open merge-request list, keeping `iid` as the number', async () => {
    const { client, requests } = rig({
      [`GET ${project}/merge_requests`]: [
        listEntry(),
        // The instance's own vocabulary, mapped rather than trusted.
        listEntry({ iid: 8, state: 'merged', sha: 'head-ccc', title: 'Bump deps' }),
      ],
    });

    const pulls = await client.listPullRequests(REPO);

    expect(pulls).toHaveLength(2);
    expect(pulls[0]).toEqual({
      number: 7,
      title: 'Add rate limiting to the public API',
      author: 'marisa.koch',
      branch: 'feat/rate-limit',
      base: 'main',
      head_sha: 'head-bbb',
      // GitLab's LIST payload carries no line counts — exactly as GitHub's does
      // not — so these are zero here BY DESIGN and the route's BACKFILL_LIMIT
      // loop fills them from the detail endpoint. Asserting a non-zero count
      // here would assert a fiction; the enrichment is covered where it happens,
      // in `forge-resolution.it.test.ts`.
      additions: 0,
      deletions: 0,
      files_count: 0,
      status: 'open',
      opened_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T03:00:00.000Z',
    });
    expect(pulls[1]!.status).toBe('merged');

    // AC-21: the identifier is the project-scoped `iid` — the number in the
    // merge request's own web URL — and it stays a NUMBER, because the store
    // already keys a change request by repository + integer.
    expect(typeof pulls[0]!.number).toBe('number');
    expect(pulls[0]!.number).toBe(7);
    // Not the global `id`, which is the other number on the same payload.
    expect(pulls[0]!.number).not.toBe(90210);

    // NFR-4: the project is addressed by its URL-ENCODED path, which is what
    // makes a four-segment namespace addressable at all.
    expect(requests[0]!.url).toContain(`/projects/${ENCODED}/merge_requests`);
    expect(ENCODED).toBe('group%2Fsub%2Fteam%2Fproject');
    expect(requests[0]!.url.startsWith(`${BASE}/api/v4/`)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AC-22 — the linked issue, and the empty answer that is not a placeholder
  // -------------------------------------------------------------------------

  const detailRoutes = (closesIssues: unknown[]) => ({
    [`GET ${mrPath(7)}`]: {
      ...listEntry(),
      sha: undefined,
      diff_refs: CURRENT_REFS,
      description: 'Adds a limiter. Closes #471.',
    },
    [`GET ${mrPath(7)}/changes`]: {
      changes: [
        {
          old_path: 'src/config.ts',
          new_path: 'src/config.ts',
          diff: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  limit: 100,\n-  legacy: true,\n',
        },
      ],
    },
    [`GET ${mrPath(7)}/commits`]: [
      {
        id: 'head-bbb',
        message: 'Add limiter',
        author_name: 'Marisa Koch',
        committed_date: '2026-06-01T02:00:00.000Z',
      },
    ],
    [`GET ${mrPath(7)}/closes_issues`]: closesIssues,
  });

  it('AC-22: `closes_issues: []` becomes linked_issue null — never a placeholder', async () => {
    const { client } = rig(detailRoutes([]));

    const detail = await client.getPullRequest(REPO, 7);

    // The one assertion this criterion is about. An empty answer from the
    // instance means "this merge request closes nothing", which is a fact — not
    // an unknown, and not an issue object with blank fields.
    expect(detail.linked_issue).toBeNull();
    // Guard the shapes a "helpful" mapping would reach for instead of null.
    expect(detail.linked_issue).not.toEqual({});
    expect(detail.linked_issue).not.toEqual(
      expect.objectContaining({ number: expect.anything() }),
    );
  });

  it('AC-22: a non-empty answer becomes the instance’s own first closed issue', async () => {
    const { client } = rig(
      detailRoutes([
        {
          id: 55501,
          iid: 471,
          title: 'Public API has no rate limit',
          description: 'Anyone can hammer it.',
          state: 'opened',
          web_url: HOSTILE_WEB_URL,
        },
      ]),
    );

    const detail = await client.getPullRequest(REPO, 7);

    // `iid` again, not the global `id`: the number a person sees on the issue.
    expect(detail.linked_issue).toEqual({
      number: 471,
      title: 'Public API has no rate limit',
      body: 'Anyone can hammer it.',
      state: 'opened',
    });
  });

  it('AC-20: detail totals are counted from the hunks GitLab does not count for us', async () => {
    const { client } = rig(detailRoutes([]));

    const detail = await client.getPullRequest(REPO, 7);

    expect(detail.files_count).toBe(1);
    expect(detail.additions).toBe(1);
    expect(detail.deletions).toBe(1);
    expect(detail.files[0]!.path).toBe('src/config.ts');
    expect(detail.commits[0]).toEqual({
      sha: 'head-bbb',
      message: 'Add limiter',
      author: 'Marisa Koch',
      committed_at: '2026-06-01T02:00:00.000Z',
    });
    // The detail payload carries no `sha`; the head comes from `diff_refs`.
    expect(detail.head_sha).toBe('head-bbb');
  });

  // -------------------------------------------------------------------------
  // AC-23 / AC-24 — inline discussion
  // -------------------------------------------------------------------------

  const discussionRoutes = {
    [`GET ${mrPath(7)}`]: { ...listEntry(), sha: undefined, diff_refs: CURRENT_REFS },
    [`GET ${mrPath(7)}/discussions`]: [
      {
        id: DISCUSSION_CURRENT,
        notes: [
          note({ id: 101, position: positionAt(CURRENT_REFS) }),
          note({
            id: 102,
            body: 'Agreed.',
            author: { username: 'bo.tran' },
            position: positionAt(CURRENT_REFS),
          }),
        ],
      },
      {
        id: DISCUSSION_SUPERSEDED,
        notes: [
          note({
            id: 201,
            body: 'This line moved.',
            position: positionAt(SUPERSEDED_REFS),
            // Planted the other way round for THIS discussion, so neither
            // polarity of "just read the provider field" can pass.
            outdated: false,
            resolvable: true,
            resolved: false,
          }),
        ],
      },
      // A merge-request-level comment: no `position`, so not on Files changed.
      { id: 'aabbcc00', notes: [{ id: 301, body: 'LGTM overall', author: { username: 'ana.reyes' } }] },
      // GitLab narrating its own state changes.
      {
        id: 'ddee1122',
        notes: [note({ id: 401, system: true, body: 'changed the description', position: positionAt(CURRENT_REFS) })],
      },
    ],
  };

  it('AC-24: outdated is DERIVED from the revision ids, ignoring `outdated`/`resolvable`', async () => {
    const { client } = rig(discussionRoutes);

    const comments = await client.listReviewComments(REPO, 7);
    const current = comments.find((c) => c.id === DISCUSSION_CURRENT);
    const superseded = comments.find((c) => c.id === DISCUSSION_SUPERSEDED);

    // The note written against the merge request's CURRENT revisions still
    // anchors — even though the fixture says `outdated: true`.
    expect(current!.is_outdated).toBe(false);
    expect(current!.line).toBe(11);

    // The note written against a superseded head does not — even though the
    // fixture says `outdated: false`. If either assertion above and this one
    // both flipped, the derivation is reading the provider field.
    expect(superseded!.is_outdated).toBe(true);
    // An unanchorable note carries no line: showing one would point the reader
    // at the wrong place in the current diff.
    expect(superseded!.line).toBeNull();
    expect(superseded!.original_line).toBe(11);
  });

  it('AC-24: every reply inherits its own thread’s derivation, not the neighbour’s', async () => {
    const { client } = rig(discussionRoutes);

    const comments = await client.listReviewComments(REPO, 7);
    const reply = comments.find((c) => c.id === `${DISCUSSION_CURRENT}:102`);

    expect(reply!.is_outdated).toBe(false);
    expect(reply!.body).toBe('Agreed.');
    expect(reply!.user).toBe('bo.tran');
  });

  it('AC-23: discussions map to string comment ids and string-or-null reply ids', async () => {
    const { client } = rig(discussionRoutes);

    const comments = await client.listReviewComments(REPO, 7);

    // Only the two inline discussions survive: the position-less general
    // comment and the system note are not Files-changed content.
    expect(comments.map((c) => c.id)).toEqual([
      DISCUSSION_CURRENT,
      `${DISCUSSION_CURRENT}:102`,
      DISCUSSION_SUPERSEDED,
    ]);

    for (const comment of comments) {
      expect(typeof comment.id).toBe('string');
      // A string that does not reverse into an integer, which is precisely why
      // the port's identity is a string for EVERY provider rather than a widened
      // GitHub number.
      expect(Number.isNaN(Number(comment.id))).toBe(true);
      expect(comment.in_reply_to_id === null || typeof comment.in_reply_to_id === 'string').toBe(
        true,
      );
    }

    // A thread root points at nothing; a reply points at its own discussion, so
    // one grouping rule threads GitHub and GitLab alike.
    expect(comments[0]!.in_reply_to_id).toBeNull();
    expect(comments[1]!.in_reply_to_id).toBe(DISCUSSION_CURRENT);
    expect(comments[2]!.in_reply_to_id).toBeNull();
  });

  it('AC-21/AC-23: the merge-request number stays a number while comment ids are strings', async () => {
    const { client } = rig({
      ...discussionRoutes,
      [`GET ${project}/merge_requests`]: [listEntry()],
    });

    const [pull] = await client.listPullRequests(REPO);
    const comments = await client.listReviewComments(REPO, 7);

    // The two identifiers of this feature are deliberately different types, and
    // a mapping that "tidied" either one would break a different consumer: the
    // change-request store keys by integer, and the discussion id is opaque.
    expect(typeof pull!.number).toBe('number');
    expect(typeof comments[0]!.id).toBe('string');
  });

  // -------------------------------------------------------------------------
  // AC-25 — every link is rebuilt from the registered base URL
  // -------------------------------------------------------------------------

  it('AC-25: html_url is rebuilt from the REGISTERED base URL, never from the instance’s web_url', async () => {
    const { client } = rig(discussionRoutes);

    const comments = await client.listReviewComments(REPO, 7);

    for (const comment of comments) {
      // The hostile value is present on every fixture note and on the merge
      // request itself, so any pass-through mapping lands here.
      expect(comment.html_url).not.toContain('evil.example.net');
      expect(comment.html_url.startsWith(`${BASE}/${NAMESPACE}/-/merge_requests/7#note_`)).toBe(
        true,
      );
    }
    expect(comments[0]!.html_url).toBe(
      'https://gitlab.example.com:8443/gitlab/group/sub/team/project/-/merge_requests/7#note_101',
    );
  });

  // -------------------------------------------------------------------------
  // AC-23 — a reply lands in its own thread
  // -------------------------------------------------------------------------

  it('AC-23: a reply is posted into the discussion its thread id names', async () => {
    const { client, requests } = rig({
      [`POST ${mrPath(7)}/discussions/${DISCUSSION_CURRENT}/notes`]: {
        id: 999,
        body: 'Done in 3f2a1b.',
        author: { username: 'devdigest' },
        created_at: '2026-06-03T10:00:00.000Z',
        web_url: HOSTILE_WEB_URL,
      },
    });

    // Replying to a NOTE inside the thread, not to the thread root — both must
    // reach the same discussion.
    const created = await client.createReviewComment(REPO, 7, {
      commitId: 'head-bbb',
      path: 'src/config.ts',
      line: 11,
      body: 'Done in 3f2a1b.',
      inReplyTo: `${DISCUSSION_CURRENT}:102`,
    });

    // The URL is the assertion: a reply that opened a NEW discussion would have
    // posted to `.../discussions` and shown up in a different thread.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url).toBe(
      `${BASE}/api/v4/projects/${ENCODED}/merge_requests/7/discussions/${DISCUSSION_CURRENT}/notes`,
    );
    expect(requests[0]!.body).toEqual({ body: 'Done in 3f2a1b.' });

    expect(created.in_reply_to_id).toBe(DISCUSSION_CURRENT);
    expect(created.id).toBe(`${DISCUSSION_CURRENT}:999`);
    expect(typeof created.id).toBe('string');
    expect(created.html_url).not.toContain('evil.example.net');
  });

  it('AC-23: a first comment opens a discussion anchored to the current revisions', async () => {
    const { client, requests } = rig({
      [`GET ${mrPath(7)}`]: { ...listEntry(), diff_refs: CURRENT_REFS },
      [`POST ${mrPath(7)}/discussions`]: {
        id: DISCUSSION_SUPERSEDED,
        notes: [
          {
            id: 777,
            body: 'Please move this to an env var.',
            author: { username: 'devdigest' },
            created_at: '2026-06-03T10:00:00.000Z',
          },
        ],
      },
    });

    const created = await client.createReviewComment(REPO, 7, {
      commitId: 'head-bbb',
      path: 'src/config.ts',
      line: 11,
      body: 'Please move this to an env var.',
    });

    const posted = requests.find((r) => r.method === 'POST')!;
    expect(posted.url).toBe(
      `${BASE}/api/v4/projects/${ENCODED}/merge_requests/7/discussions`,
    );
    // Anchored to the merge request's OWN current revisions, read back from the
    // instance rather than assumed from the caller's `commitId`.
    expect(posted.body).toEqual({
      body: 'Please move this to an env var.',
      position: {
        position_type: 'text',
        ...CURRENT_REFS,
        new_path: 'src/config.ts',
        old_path: 'src/config.ts',
        new_line: 11,
      },
    });

    expect(created.id).toBe(DISCUSSION_SUPERSEDED);
    expect(created.in_reply_to_id).toBeNull();
    expect(created.is_outdated).toBe(false);
  });

  // -------------------------------------------------------------------------
  // AC-45 — a refusal names the instance and stays credential-free
  // -------------------------------------------------------------------------

  it('AC-10/AC-45: a rejected credential names the instance and echoes no token', async () => {
    const { client } = rig(
      { [`GET ${project}/merge_requests`]: { message: '401 Unauthorized' } },
      { [`GET ${project}/merge_requests`]: 401 },
    );

    const err = await client.listPullRequests(REPO).catch((e: unknown) => e as Error);

    // AC-45: names ONE instance and describes the capability behaviourally,
    // rather than listing scope names GitLab does not document per endpoint.
    expect(err.message).toContain('Acme GitLab');
    expect(err.message).toContain('read merge requests and post notes');
    // AC-10: the access token appears in no message, ever.
    expect(err.message).not.toContain(CREDENTIAL);
  });
});
