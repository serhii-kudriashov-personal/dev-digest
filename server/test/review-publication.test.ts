import { describe, it, expect } from 'vitest';
import { PostBackOutcome, ReviewPostBack } from '@devdigest/shared';
import type { FindingRow } from '../src/db/rows.js';
import type { ReviewPostbackRow, ReviewRow } from '../src/modules/reviews/repository.js';
import {
  POST_BACK_NOTE_CAP,
  POST_BACK_SEVERITY_ORDER,
} from '../src/modules/reviews/constants.js';
import { buildReviewPublication, toPostBackDto } from '../src/modules/reviews/helpers.js';

/**
 * What actually goes onto a change request, decided before any forge is
 * involved (SPEC-06 — `specs/2026-08-28-gitlab-repositories.md`, AC-34, AC-35,
 * AC-39, AC-41, NFR-3, NFR-12).
 *
 * HERMETIC: `buildReviewPublication` and `toPostBackDto` are pure, and that is
 * deliberate — the cap, the ordering and every string a user reads are settled
 * here so one rule holds for every provider. None of it needs a forge, a
 * database or a network to exercise.
 *
 * The regression this file exists for is NOT "twenty notes". It is "the WRONG
 * twenty notes": a cap applied in row order publishes whatever the model
 * happened to emit first and silently drops a CRITICAL, and a test that only
 * counted twenty would pass on exactly that bug. Every case below therefore
 * asserts WHICH findings survived, not how many.
 */

const REVIEW: ReviewRow = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  prId: '33333333-3333-4333-8333-333333333333',
  agentId: null,
  runId: '44444444-4444-4444-8444-444444444444',
  kind: 'review',
  verdict: 'comment',
  summary: 'Two config values are hard-coded.',
  score: 72,
  model: 'mock-model',
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
};

const review = (over: Partial<ReviewRow> = {}): ReviewRow => ({ ...REVIEW, ...over });

let seq = 0;
const finding = (over: Partial<FindingRow> & { severity: string }): FindingRow => ({
  id: `finding-${seq++}`,
  reviewId: REVIEW.id,
  file: 'src/config.ts',
  startLine: 11,
  endLine: 11,
  category: 'correctness',
  title: 'Hard-coded value',
  rationale: 'This should come from the environment.',
  suggestion: null,
  confidence: 0.9,
  kind: 'finding',
  trifectaComponents: null,
  skillId: null,
  acceptedAt: null,
  dismissedAt: null,
  learnedAt: null,
  ...over,
});

const severities = (payload: { publication: { notes: { body: string }[] } }): string[] =>
  payload.publication.notes.map((n) => n.body.split(' —')[0]!.replace(/\*/g, ''));

describe('buildReviewPublication — NFR-3, the cap and what survives it', () => {
  /**
   * The input is ordered ADVERSARIALLY on purpose: 22 suggestions come first
   * and the only CRITICAL is at index 22, past the cap. An implementation that
   * sliced the rows as they arrived would publish twenty suggestions, drop the
   * critical, still report twenty notes, and still say it truncated five.
   */
  const adversarial = (): FindingRow[] => [
    ...Array.from({ length: 22 }, (_, i) =>
      finding({ severity: 'SUGGESTION', file: `src/s${i}.ts`, startLine: i + 1, title: `Nit ${i}` }),
    ),
    finding({
      severity: 'CRITICAL',
      file: 'src/auth.ts',
      startLine: 10,
      title: 'Token compared with ==',
    }),
    finding({ severity: 'WARNING', file: 'src/w1.ts', startLine: 1, title: 'Unbounded loop' }),
    finding({ severity: 'WARNING', file: 'src/w2.ts', startLine: 2, title: 'Swallowed error' }),
  ];

  it('NFR-3: 25 findings publish exactly 20 notes and report the 5 that were dropped', () => {
    const findings = adversarial();
    const { publication, truncated } = buildReviewPublication(review(), findings);

    expect(findings).toHaveLength(25);
    expect(publication.notes).toHaveLength(POST_BACK_NOTE_CAP);
    expect(POST_BACK_NOTE_CAP).toBe(20);
    expect(truncated).toBe(5);
  });

  it('NFR-3: the cap keeps the most severe — the CRITICAL at input index 22 survives', () => {
    const findings = adversarial();
    // Pin the trap itself: if the fixture ever stops putting the critical past
    // the cap in row order, this test stops proving anything.
    expect(findings[22]!.severity).toBe('CRITICAL');
    expect(findings.slice(0, POST_BACK_NOTE_CAP).every((f) => f.severity === 'SUGGESTION')).toBe(
      true,
    );

    const payload = buildReviewPublication(review(), findings);

    // The single assertion the ordering exists for.
    expect(payload.publication.notes[0]!.body).toContain('Token compared with ==');
    expect(severities(payload)[0]).toBe('CRITICAL');
    // Both warnings outrank every suggestion, so all three severe findings are
    // in and exactly five suggestions were dropped.
    expect(severities(payload).slice(0, 3)).toEqual(['CRITICAL', 'WARNING', 'WARNING']);
    expect(severities(payload).filter((s) => s === 'SUGGESTION')).toHaveLength(17);
    expect(payload.truncated).toBe(5);
  });

  it('NFR-3: the truncation is STATED in the summary, never silent', () => {
    const { publication, truncated } = buildReviewPublication(review(), adversarial());

    // A silent cap turns "the review found 25 things" into "the merge request
    // shows 20", with nothing on the change request explaining the difference.
    expect(publication.summary).toContain('20');
    expect(publication.summary).toContain('25');
    expect(publication.summary).toMatch(/Showing the 20 most severe of 25 findings/);
    expect(publication.summary).toContain(`${truncated} more are in DevDigest`);
  });

  it('NFR-3: a review under the cap says nothing about truncation', () => {
    const { publication, truncated } = buildReviewPublication(review(), [
      finding({ severity: 'WARNING' }),
    ]);

    expect(truncated).toBe(0);
    expect(publication.notes).toHaveLength(1);
    expect(publication.summary).not.toMatch(/more are in DevDigest/);
    expect(publication.summary).not.toMatch(/Showing the/);
  });

  it('NFR-3: an UNRECOGNISED severity sorts last, so it can never outrank a CRITICAL', () => {
    // `rank()` returns -1 from `indexOf` for anything outside the order, and a
    // raw -1 would sort the unknown severity AHEAD of CRITICAL — publishing a
    // finding nobody classified and dropping the one that matters.
    const findings = [
      finding({ severity: 'NITPICK', title: 'Unclassified' }),
      finding({ severity: 'CRITICAL', title: 'Token compared with ==' }),
    ];

    const { publication, truncated } = buildReviewPublication(review(), findings, 1);

    expect(publication.notes).toHaveLength(1);
    expect(publication.notes[0]!.body).toContain('Token compared with ==');
    expect(truncated).toBe(1);
    expect(POST_BACK_SEVERITY_ORDER).toEqual(['CRITICAL', 'WARNING', 'SUGGESTION']);
    expect(POST_BACK_SEVERITY_ORDER).not.toContain('NITPICK');
  });
});

describe('buildReviewPublication — AC-34, AC-35, AC-41: what each note says and where it lands', () => {
  it('AC-34: one summary note plus one inline note per published finding', () => {
    const findings = [
      finding({ severity: 'WARNING', file: 'src/a.ts', startLine: 4, title: 'A' }),
      finding({ severity: 'WARNING', file: 'src/b.ts', startLine: 9, title: 'B' }),
    ];

    const { publication } = buildReviewPublication(review(), findings);

    expect(publication.summary.length).toBeGreaterThan(0);
    expect(publication.notes.map((n) => [n.path, n.line])).toEqual([
      ['src/a.ts', 4],
      ['src/b.ts', 9],
    ]);
  });

  it('AC-35: a note anchors on the finding’s START line, not its end line', () => {
    // Grounding guarantees the START line appears in the diff; an end line can
    // run past the hunk the finding was grounded against, which would anchor
    // the note on a line the merge request's diff does not contain.
    const { publication } = buildReviewPublication(review(), [
      finding({ severity: 'CRITICAL', startLine: 11, endLine: 40 }),
    ]);

    expect(publication.notes[0]!.line).toBe(11);
    expect(publication.notes[0]!.line).not.toBe(40);
  });

  it('AC-35: every note is RIGHT-sided — a property of the FINDINGS, not a shortcut', () => {
    // `reviewer-core/src/grounding.ts` keeps only a finding whose line appears
    // in the diff's NEW-side line numbers, so no old-side finding can reach this
    // function at all. The port still expresses both sides, and the old-side
    // mapping is asserted where it IS reachable — `gitlab-publish.test.ts`,
    // against `publishReview` with a LEFT note in the payload. Nothing here
    // fabricates an old-side finding to manufacture coverage.
    const { publication } = buildReviewPublication(review(), [
      finding({ severity: 'CRITICAL' }),
      finding({ severity: 'SUGGESTION', file: 'src/z.ts' }),
    ]);

    expect(publication.notes.map((n) => n.side)).toEqual(['RIGHT', 'RIGHT']);
  });

  it('AC-41: the summary carries the verdict IN WORDS for each of the three verdicts', () => {
    // GitLab has no "request changes" review state, so a verdict that is not
    // written into the note is a verdict the merge request does not carry.
    const words = (verdict: string) =>
      buildReviewPublication(review({ verdict }), []).publication.summary;

    expect(words('request_changes')).toContain('Request changes');
    expect(words('approve')).toContain('Approve');
    expect(words('comment')).toContain('Comment');

    // The verdict also crosses the port as data, so the adapter can act on it.
    expect(buildReviewPublication(review({ verdict: 'request_changes' }), []).publication.verdict)
      .toBe('request_changes');
  });

  it('AC-41: a review with no recorded verdict is published as a comment, not as an approval', () => {
    const { publication } = buildReviewPublication(review({ verdict: null }), []);

    expect(publication.verdict).toBe('comment');
    expect(publication.summary).toContain('Comment');
    expect(publication.summary).not.toContain('Approve');
  });

  it('a note body carries the severity, the title, the rationale and any suggested fix', () => {
    const { publication } = buildReviewPublication(review(), [
      finding({
        severity: 'CRITICAL',
        title: 'Token compared with ==',
        rationale: 'Timing-unsafe comparison.',
        suggestion: 'Use a constant-time compare.',
      }),
    ]);

    const body = publication.notes[0]!.body;
    expect(body).toContain('CRITICAL');
    expect(body).toContain('Token compared with ==');
    expect(body).toContain('Timing-unsafe comparison.');
    expect(body).toContain('Suggested fix: Use a constant-time compare.');
  });
});

describe('PostBackOutcome — AC-39, the four-state contract a consumer branches on', () => {
  it('AC-39: the outcome set is CLOSED and is exactly the four states', () => {
    expect(PostBackOutcome.options).toEqual([
      'posted_verdict_applied',
      'posted_verdict_not_applied',
      'partially_published',
      'not_posted',
    ]);
    // A bare success or a bare failure is not one of the four (AC-39).
    expect(PostBackOutcome.safeParse('ok').success).toBe(false);
    expect(PostBackOutcome.safeParse('posted').success).toBe(false);
    expect(PostBackOutcome.safeParse('failed').success).toBe(false);
  });

  it('AC-39: a consumer branches on the CODE, never on the reason prose', () => {
    // The regression this catches: a fifth state added to the contract with no
    // consumer updated, and a consumer that told the states apart by matching
    // words in `reason` — which is server-composed prose that legitimately
    // changes (AC-38, AC-41 and NFR-3 can all be true at once).
    const LABELS: Record<string, { posted: boolean; label: string }> = {
      posted_verdict_applied: { posted: true, label: 'Posted with the verdict applied' },
      posted_verdict_not_applied: { posted: true, label: 'Posted without the verdict applied' },
      partially_published: { posted: true, label: 'Partially published' },
      not_posted: { posted: false, label: 'Not posted' },
    };

    expect(Object.keys(LABELS).sort()).toEqual([...PostBackOutcome.options].sort());
    expect(new Set(Object.values(LABELS).map((v) => v.label)).size).toBe(
      PostBackOutcome.options.length,
    );

    // Every branch is reachable from the code alone, with `reason` null.
    for (const option of PostBackOutcome.options) {
      const dto = ReviewPostBack.parse({
        run_id: REVIEW.runId,
        pr_id: REVIEW.prId,
        outcome: option,
        reason: null,
        notes_published: 0,
        created_at: '2026-06-01T00:00:00.000Z',
      });
      expect(LABELS[dto.outcome]!.label.length).toBeGreaterThan(0);
    }
  });
});

describe('toPostBackDto — NFR-12, the recorded row as the wire contract', () => {
  const row: ReviewPostbackRow = {
    id: '55555555-5555-4555-8555-555555555555',
    runId: REVIEW.runId!,
    prId: REVIEW.prId,
    outcome: 'partially_published',
    reason: '2 of 4 notes reached the merge request before publication stopped.',
    notesPublished: 2,
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
  };

  it('NFR-12: a stored row round-trips into the response contract', () => {
    const dto = toPostBackDto(row);

    expect(dto).toEqual({
      run_id: row.runId,
      pr_id: row.prId,
      outcome: 'partially_published',
      reason: row.reason,
      notes_published: 2,
      created_at: '2026-06-01T12:00:00.000Z',
    });
    expect(ReviewPostBack.safeParse(dto).success).toBe(true);
  });

  it('NFR-12: `notes_published` survives as a number, so "how much landed" is answerable', () => {
    // AC-40's whole point: a partial publication is distinguishable from a
    // complete post AND from one that never started, and the count is what
    // distinguishes them.
    expect(toPostBackDto({ ...row, notesPublished: 0, outcome: 'not_posted' }).notes_published)
      .toBe(0);
    expect(toPostBackDto(row).notes_published).toBe(2);
  });
});
