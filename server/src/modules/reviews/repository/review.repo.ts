import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Finding } from '@devdigest/shared';
import type { FindingRow, PullRow } from '../../../db/rows.js';

export type ReviewRow = typeof t.reviews.$inferSelect;

// ---- reviews + findings ---------------------------------------------------

export async function insertReview(
  db: DbOrTx,
  values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  },
): Promise<ReviewRow> {
  const [row] = await db.insert(t.reviews).values(values).returning();
  return row!;
}

/**
 * @param skillIds resolved skill attribution, parallel to `findings` by index.
 *   Supplied by `resolveSkillAttribution`, which has already discarded any slug
 *   the model named that was not injected into the run. Omit it (or pass a null
 *   entry) and the finding is stored unattributed — NEVER guess here: this layer
 *   has no way to validate a slug, which is the whole reason the caller does.
 */
export async function insertFindings(
  db: DbOrTx,
  reviewId: string,
  findings: Finding[],
  skillIds?: (string | null)[],
): Promise<FindingRow[]> {
  if (findings.length === 0) return [];
  const rows = await db
    .insert(t.findings)
    .values(
      findings.map((f, i) => ({
        reviewId,
        file: f.file,
        startLine: f.start_line,
        endLine: f.end_line,
        severity: f.severity,
        category: f.category,
        title: f.title,
        rationale: f.rationale,
        suggestion: f.suggestion ?? null,
        confidence: f.confidence,
        kind: f.kind ?? 'finding',
        trifectaComponents: f.trifecta_components ?? null,
        skillId: skillIds?.[i] ?? null,
      })),
    )
    .returning();
  return rows;
}

/**
 * Insert a review AND its findings as ONE unit.
 *
 * Prefer this over calling `insertReview` + `insertFindings` in sequence: a
 * failure between the two commits a review carrying a verdict and a score with
 * zero findings, which is indistinguishable from a genuinely clean review — the
 * UI renders both as "no findings", so the corruption is invisible.
 *
 * The transaction stays here rather than in the caller: `Db` belongs to this
 * ring, and a transaction handle must never cross the repository boundary.
 */
export async function insertReviewWithFindings(
  db: Db,
  values: Parameters<typeof insertReview>[1],
  findings: Finding[],
  skillIds?: (string | null)[],
): Promise<{ review: ReviewRow; findingRows: FindingRow[] }> {
  return db.transaction(async (tx) => {
    const review = await insertReview(tx, values);
    const findingRows = await insertFindings(tx, review.id, findings, skillIds);
    return { review, findingRows };
  });
}

/** Reviews for a PR (newest first), each with its findings. */
export async function reviewsForPull(
  db: Db,
  prId: string,
): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
  const reviews = await db
    .select()
    .from(t.reviews)
    .where(eq(t.reviews.prId, prId))
    .orderBy(desc(t.reviews.createdAt));
  if (reviews.length === 0) return [];
  const ids = reviews.map((r) => r.id);
  const findings = await db
    .select()
    .from(t.findings)
    .where(inArray(t.findings.reviewId, ids))
    .orderBy(asc(t.findings.file), asc(t.findings.startLine));
  return reviews.map((review) => ({
    review,
    findings: findings.filter((f) => f.reviewId === review.id),
  }));
}

export async function getReview(db: Db, reviewId: string): Promise<ReviewRow | undefined> {
  const [row] = await db.select().from(t.reviews).where(eq(t.reviews.id, reviewId));
  return row;
}

/** Delete a whole review (one agent's run) + its findings (cascade), scoped
 *  to the workspace. Returns false if not found in the workspace. */
export async function deleteReview(
  db: Db,
  workspaceId: string,
  reviewId: string,
): Promise<boolean> {
  const rows = await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.id, reviewId)))
    .returning({ id: t.reviews.id });
  return rows.length > 0;
}

// ---- finding actions ------------------------------------------------------

export async function getFinding(db: Db, findingId: string): Promise<FindingRow | undefined> {
  const [row] = await db.select().from(t.findings).where(eq(t.findings.id, findingId));
  return row;
}

/** Resolve workspace_id + pr_id for a finding (via review → pr). */
export async function findingContext(
  db: Db,
  findingId: string,
): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
  const finding = await getFinding(db, findingId);
  if (!finding) return undefined;
  const review = await getReview(db, finding.reviewId);
  if (!review) return undefined;
  const [pull] = await db
    .select()
    .from(t.pullRequests)
    .where(eq(t.pullRequests.id, review.prId));
  if (!pull) return undefined;
  return { finding, review, pull };
}

export async function setFindingAccepted(
  db: Db,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ acceptedAt: at, dismissedAt: null })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}

export async function setFindingDismissed(
  db: Db,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ dismissedAt: at, acceptedAt: null })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}

/** AC-43 "Learn" — records the intent only; the memory mechanics behind it
 *  are a later feature (spec §Non-goals). */
export async function setFindingLearned(
  db: Db,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ learnedAt: at })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}

// ---- eval-case creation (L06, SPEC-04) — a finding's full source context --

export interface FindingSourceRow {
  finding: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    acceptedAt: Date | null;
    dismissedAt: Date | null;
    severity: string;
    category: string;
    title: string;
  };
  agentId: string | null;
  prId: string;
  prNumber: number;
  repoFullName: string;
  headSha: string;
  /** The exact patch for the finding's file, or `null` if `pr_files` no
   *  longer carries it. */
  patch: string | null;
}

/**
 * A finding's full source context (AC-1, AC-4…AC-7): the finding itself, the
 * agent whose review produced it, the PR it belongs to, and the exact file
 * patch it cites — everything `POST /findings/:id/eval-case` needs to freeze
 * a case. Workspace-scoped: returns `undefined` when the finding's review
 * does not belong to `workspaceId`, exactly like `findingContext`'s callers
 * already re-check by hand. Looked up by `findings.id` (primary key), so it
 * owes no new index (`server/INSIGHTS.md` 2026-08-09 — `findings` and
 * `reviews` ARE indexed now).
 */
export async function findingSource(
  db: Db,
  workspaceId: string,
  findingId: string,
): Promise<FindingSourceRow | undefined> {
  const ctx = await findingContext(db, findingId);
  if (!ctx || ctx.review.workspaceId !== workspaceId) return undefined;

  const [repoRow] = await db.select().from(t.repos).where(eq(t.repos.id, ctx.pull.repoId));
  if (!repoRow) return undefined;

  const [fileRow] = await db
    .select({ patch: t.prFiles.patch })
    .from(t.prFiles)
    .where(and(eq(t.prFiles.prId, ctx.pull.id), eq(t.prFiles.path, ctx.finding.file)));

  return {
    finding: {
      id: ctx.finding.id,
      file: ctx.finding.file,
      startLine: ctx.finding.startLine,
      endLine: ctx.finding.endLine,
      acceptedAt: ctx.finding.acceptedAt,
      dismissedAt: ctx.finding.dismissedAt,
      severity: ctx.finding.severity,
      category: ctx.finding.category,
      title: ctx.finding.title,
    },
    agentId: ctx.review.agentId,
    prId: ctx.pull.id,
    prNumber: ctx.pull.number,
    repoFullName: repoRow.fullName,
    headSha: ctx.pull.headSha,
    patch: fileRow?.patch ?? null,
  };
}
