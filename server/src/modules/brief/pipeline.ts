import type { Container } from '../../platform/container.js';
import type {
  BlastStateReason,
  BriefAnswer,
  BriefInputLabel,
  Provider,
  RepoRef,
} from '@devdigest/shared';
import { BriefAnswer as BriefAnswerSchema } from '@devdigest/shared';
import { assemblePrompt } from '@devdigest/reviewer-core';
import type { FindingRow, PullRow } from '../../db/rows.js';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import {
  BRIEF_DROP_ORDER,
  BRIEF_MAX_IDENTITY_PATHS,
  BRIEF_MAX_ISSUE_CHARS,
  BRIEF_MAX_LINKED_ISSUES,
  BRIEF_MAX_LINKED_SPECS,
  BRIEF_MAX_RETRIES,
  BRIEF_MAX_SPEC_BYTES,
  BRIEF_SCHEMA_NAME,
  BRIEF_SYSTEM,
  BRIEF_TASK,
  BRIEF_TEMPERATURE,
  BRIEF_TIMEOUT_MS,
  BRIEF_TOKEN_BUDGET,
} from './constants.js';
import { changedRanges, normalizeBriefPath, type ChangedRange } from './helpers.js';
import type { BriefPrFileRow, BriefRepoRow } from './repository.js';

/**
 * PR Risk Brief slice — block assembly, budget fitting, the one model call.
 *
 * Modelled on `intent/pipeline.ts`. NO Drizzle and no `src/db` here — every row
 * arrives as a parameter (`no-sql-in-service` matches only `(service|helpers).ts`
 * by filename, so this is discipline rather than a gate, same honesty problem
 * `intent/pipeline.ts` already carries).
 *
 * `collectBlocks` is the ENFORCEMENT POINT for "no raw hunk body ever leaves
 * this slice" (AC-8) — it reads only `changedRanges` (parsed `@@` headers),
 * never a patch's added/removed/context lines.
 */

export interface BriefBlock {
  label: BriefInputLabel;
  text: string;
}

export interface CollectedBriefBlocks {
  blocks: BriefBlock[];
  /** Labels that were never available at all (AC-37) — distinct from a label
   *  later cut for budget, which `fitBudget` reports separately. */
  missing: BriefInputLabel[];
  /** Changed-line ranges keyed by NORMALIZED path — the ground truth
   *  `validateFocus` checks the model's `review_focus` claims against. */
  rangesByPath: Map<string, ChangedRange[]>;
  /** RAW (un-normalized) changed paths — `validateRisks` normalizes its own
   *  input, so passing an already-normalized array here would be redundant. */
  changedPaths: string[];
  /** Endpoint + cron names surfaced by blast radius (AC-19's ground truth). */
  knownEndpoints: string[];
  /** `state === 'full'` — for `StoredRiskBrief.index_complete` (AC-36). */
  indexComplete: boolean;
  /** `null` on the 'full' path, else the blast state's machine reason code. */
  indexReason: BlastStateReason | null;
}

/**
 * Issue numbers CLOSED by this PR. Duplicated from
 * `intent/helpers.ts#linkedIssueNumbers` rather than imported: that file is
 * `SLICE_PRIVATE` (`server/.dependency-cruiser.cjs:65`) and
 * `no-cross-slice-import` would fail. Kept in `pipeline.ts` rather than this
 * slice's own `helpers.ts` — Steps 1–5 already landed `helpers.ts` with its
 * exact Step-4 function list, and this parsing is used ONLY here. Promote to
 * `modules/_shared/pr-text.ts` if a third slice ever needs the same parse
 * (`## Risks` R1 in the plan).
 */
function briefLinkedIssueNumbers(body: string | null): number[] {
  if (!body) return [];
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[:\s]+#(\d+)/gi;
  const out: number[] = [];
  for (const m of body.matchAll(re)) {
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n <= 0) continue;
    if (out.includes(n)) continue;
    out.push(n);
    if (out.length >= BRIEF_MAX_LINKED_ISSUES) break;
  }
  return out;
}

/** The allowlist standing between a PR body and the filesystem — same shape
 *  as `intent/helpers.ts#isSafeSpecPath`, duplicated for the reason above. */
function briefIsSafeSpecPath(p: string): boolean {
  if (p.length === 0 || p.length > 300) return false;
  if (!/\.mdx?$/i.test(p)) return false;
  if (p.includes('..')) return false;
  if (p.startsWith('/') || p.startsWith('~')) return false;
  if (p.includes('\\')) return false;
  if (/[\x00-\x1f\x7f]/.test(p)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return false;
  if (p.startsWith('//')) return false;
  return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(p);
}

/** Repo-relative plan/spec paths mentioned in a PR body — allowlisted. */
function briefLinkedSpecPaths(body: string | null): string[] {
  if (!body) return [];
  const out: string[] = [];
  const candidates = [
    ...[...body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...body.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const p = raw.trim();
    if (!briefIsSafeSpecPath(p)) continue;
    if (out.includes(p)) continue;
    out.push(p);
    if (out.length >= BRIEF_MAX_LINKED_SPECS) break;
  }
  return out;
}

/**
 * Gather the six labelled blocks, in AC-7's order. Every step is best-effort:
 * a missing input degrades to `missing`, never to a thrown error — one absent
 * source must never take the whole brief down (AC-37, NFR-6).
 */
export async function collectBlocks(
  container: Container,
  workspaceId: string,
  prId: string,
  repo: BriefRepoRow,
  pull: PullRow,
  files: BriefPrFileRow[],
  findings: Pick<FindingRow, 'severity' | 'title' | 'file' | 'startLine'>[],
): Promise<CollectedBriefBlocks> {
  const blocks: BriefBlock[] = [];
  const missing: BriefInputLabel[] = [];
  const ref: RepoRef = { owner: repo.owner, name: repo.name };

  const rangesByPath = new Map<string, ChangedRange[]>();
  for (const f of files) rangesByPath.set(normalizeBriefPath(f.path), changedRanges(f.patch));
  const changedPaths = files.map((f) => f.path);

  // 1. pr_identity — NEVER dropped (AC-14): absent from `BRIEF_DROP_ORDER`.
  //    At most `BRIEF_MAX_IDENTITY_PATHS` named individually; the remainder
  //    folded into one aggregate line rather than silently disappearing.
  const named = files.slice(0, BRIEF_MAX_IDENTITY_PATHS);
  const rest = files.slice(BRIEF_MAX_IDENTITY_PATHS);
  const identityLines = named.map((f) => {
    const ranges = rangesByPath.get(normalizeBriefPath(f.path)) ?? [];
    const rangeText =
      ranges.length > 0
        ? ` [lines ${ranges.map((r) => `${r.start}-${r.end}`).join(', ')}]`
        : '';
    return `${f.path} +${f.additions}/-${f.deletions}${rangeText}`;
  });
  if (rest.length > 0) {
    const restAdd = rest.reduce((n, f) => n + f.additions, 0);
    const restDel = rest.reduce((n, f) => n + f.deletions, 0);
    identityLines.push(`… and ${rest.length} more file(s), +${restAdd}/-${restDel} total`);
  }
  blocks.push({
    label: 'pr_identity',
    text:
      `PR #${pull.number}: "${pull.title}"\n` +
      `${pull.branch} -> ${pull.base}\n` +
      `${files.length} changed file(s):\n${identityLines.join('\n')}`,
  });

  // 2. derived_intent — L03's already-rendered `promptBlock`. Absent → missing.
  let promptBlock: string | null = null;
  try {
    const derived = await container.intent.get(workspaceId, prId);
    promptBlock = derived?.promptBlock ?? null;
  } catch {
    // PR existence is already proven by this point (the caller's `getPull`
    // check) — any throw here is treated as a normal absence, same as L03's
    // own degraded-contract callers.
    promptBlock = null;
  }
  if (promptBlock) {
    blocks.push({ label: 'derived_intent', text: promptBlock });
  } else {
    missing.push('derived_intent');
  }

  // 3. blast_radius — summary + endpoint/cron names + state/reason, so AC-36's
  //    "incomplete" is STATED rather than inferred from an empty array.
  let knownEndpoints: string[] = [];
  let indexComplete = false;
  let indexReason: BlastStateReason | null = null;
  try {
    const blast = await container.blast.build(workspaceId, prId);
    const endpoints = new Set<string>();
    for (const d of blast.downstream) {
      for (const e of d.endpoints_affected) endpoints.add(e);
      for (const c of d.crons_affected) endpoints.add(c);
    }
    knownEndpoints = [...endpoints];
    indexComplete = blast.state === 'full';
    indexReason = blast.reason ?? null;
    blocks.push({
      label: 'blast_radius',
      text:
        `${blast.summary}\n` +
        `Index state: ${blast.state}${blast.reason ? ` (${blast.reason})` : ''}\n` +
        `Endpoints/crons touched: ${knownEndpoints.join(', ') || 'none'}`,
    });
  } catch {
    // Defensive only — `BlastService.build` does not normally throw once the
    // PR's existence is already proven. Degrade to missing rather than fail
    // the whole brief over one input.
    missing.push('blast_radius');
  }

  // 4. findings — severity/title/file/start line ONLY (AC-9). `rationale`,
  //    `suggestion` and `confidence` are never even read here (AC-10).
  if (findings.length > 0) {
    const findingLines = findings.map(
      (f) => `${f.severity.toUpperCase()}: ${f.title} (${f.file}:${f.startLine})`,
    );
    blocks.push({ label: 'findings', text: findingLines.join('\n') });
  } else {
    missing.push('findings');
  }

  // 5. linked_issue — best effort (AC-37): a `ConfigError` or a fetch failure
  //    drops the label, never the brief.
  const issueNumbers = briefLinkedIssueNumbers(pull.body);
  if (issueNumbers.length > 0) {
    const texts: string[] = [];
    try {
      const gh = await container.github();
      for (const n of issueNumbers) {
        try {
          const issue = await gh.getIssue(ref, n);
          const body = (issue.body ?? '').trim().slice(0, BRIEF_MAX_ISSUE_CHARS);
          texts.push(`ISSUE #${issue.number}: ${issue.title}\n${body}`);
        } catch {
          /* one unreachable issue must not lose the others */
        }
      }
    } catch {
      /* no GitHub key configured (ConfigError) — a normal degraded path */
    }
    if (texts.length > 0) {
      blocks.push({ label: 'linked_issue', text: texts.join('\n\n') });
    } else {
      missing.push('linked_issue');
    }
  } else {
    missing.push('linked_issue');
  }

  // 6. linked_spec — allowlisted repo-relative paths only; the paths are
  //    attacker-controlled (they come from the PR body).
  const specPaths = briefLinkedSpecPaths(pull.body);
  if (specPaths.length > 0) {
    const texts: string[] = [];
    let budget = BRIEF_MAX_SPEC_BYTES;
    for (const path of specPaths) {
      if (budget <= 0) break;
      let content = '';
      try {
        content = await container.git.readFile(ref, path);
      } catch {
        content = '';
      }
      const trimmed = content.trim();
      if (!trimmed) continue;
      const slice = trimmed.slice(0, budget);
      budget -= slice.length;
      texts.push(`SPEC ${path}:\n${slice}`);
    }
    if (texts.length > 0) {
      blocks.push({ label: 'linked_spec', text: texts.join('\n\n') });
    } else {
      missing.push('linked_spec');
    }
  } else {
    missing.push('linked_spec');
  }

  return {
    blocks,
    missing,
    rangesByPath,
    changedPaths,
    knownEndpoints,
    indexComplete,
    indexReason,
  };
}

function renderBlob(blocks: BriefBlock[]): string {
  return blocks.map((b) => `SOURCE: ${b.label}\n${b.text}`).join('\n\n---\n\n');
}

function briefTask(repo: BriefRepoRow, pull: PullRow): string {
  return BRIEF_TASK(`${repo.owner}/${repo.name}`, pull.number, pull.title);
}

/**
 * The text actually sent to the model — instruction text (system + injection
 * guard + task) plus the assembled blocks — for accurate token counting
 * (AC-11): the recorded count must match an INDEPENDENT `cl100k_base` count of
 * the SAME text, so this counts the real `assemblePrompt` output rather than
 * an approximation of it.
 */
function assembledText(repo: BriefRepoRow, pull: PullRow, blocks: BriefBlock[]): string {
  const { messages } = assemblePrompt({
    system: BRIEF_SYSTEM,
    task: briefTask(repo, pull),
    diff: renderBlob(blocks),
  });
  return messages.map((m) => m.content).join('\n\n');
}

export interface FitBudgetOk {
  ok: true;
  blocks: BriefBlock[];
  /** Labels cut for budget, a SUFFIX of `BRIEF_DROP_ORDER` (AC-13) — distinct
   *  from `CollectedBriefBlocks.missing`, which was never available at all. */
  dropped: BriefInputLabel[];
  tokens: number;
  estimated: boolean;
}

export interface FitBudgetTooLarge {
  ok: false;
  identityTokens: number;
  budget: number;
}

export type FitBudgetResult = FitBudgetOk | FitBudgetTooLarge;

/**
 * Fit the assembled input to `BRIEF_TOKEN_BUDGET`, dropping WHOLE blocks only,
 * from the TAIL of `BRIEF_DROP_ORDER` (AC-13) — never mid-content. `pr_identity`
 * is absent from that order and is therefore never a candidate. If the
 * identity-only input still overflows once every droppable block is gone,
 * generation is impossible and the caller must make no model call (AC-15).
 *
 * On a tokenizer failure the count falls back to `ceil(chars/4)` and is marked
 * `estimated: true` (AC-12) — the adapter's own `TiktokenTokenizer` already
 * self-latches to that heuristic, but a test double may simply throw, so this
 * function does not rely on that internal behaviour.
 */
export function fitBudget(
  blocks: BriefBlock[],
  repo: BriefRepoRow,
  pull: PullRow,
  tokenizer: Tokenizer,
): FitBudgetResult {
  let estimated = false;
  const count = (bs: BriefBlock[]): number => {
    const text = assembledText(repo, pull, bs);
    try {
      return tokenizer.count(text);
    } catch {
      estimated = true;
      return Math.ceil(text.length / 4);
    }
  };

  let working = [...blocks];
  let tokens = count(working);
  const dropped: BriefInputLabel[] = [];

  for (let i = BRIEF_DROP_ORDER.length - 1; i >= 0 && tokens > BRIEF_TOKEN_BUDGET; i--) {
    const label = BRIEF_DROP_ORDER[i]!;
    if (!working.some((b) => b.label === label)) continue;
    working = working.filter((b) => b.label !== label);
    dropped.push(label);
    tokens = count(working);
  }

  if (tokens > BRIEF_TOKEN_BUDGET) {
    return { ok: false, identityTokens: tokens, budget: BRIEF_TOKEN_BUDGET };
  }

  return { ok: true, blocks: working, dropped, tokens, estimated };
}

export interface BriefOutcome {
  data: BriefAnswer;
  provider: Provider;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** NULL when the price book cannot attribute it — never 0. */
  costUsd: number | null;
}

/**
 * One `assemblePrompt` + one `completeStructured` (NFR-5) — the ONLY model
 * call in the slice. The blocks go in the `diff` slot: it is the only
 * UNCONDITIONAL slot and it is `wrapUntrusted`-wrapped, which is the property
 * that matters — every one of the six sources is author-controlled text that
 * must arrive as data. The trace will label the section "Diff"; that is the
 * accepted, recorded cost (`server/INSIGHTS.md` 2026-08-05). The system/task
 * text is NOT wrapped (root `INSIGHTS.md` 2026-08-05).
 */
export async function requestBrief(
  container: Container,
  repo: BriefRepoRow,
  pull: PullRow,
  blocks: BriefBlock[],
  choice: { provider: Provider; model: string },
): Promise<BriefOutcome> {
  const { messages } = assemblePrompt({
    system: BRIEF_SYSTEM,
    task: briefTask(repo, pull),
    diff: renderBlob(blocks),
  });

  const llm = await container.llm(choice.provider);
  const res = await llm.completeStructured<BriefAnswer>({
    model: choice.model,
    schema: BriefAnswerSchema,
    schemaName: BRIEF_SCHEMA_NAME,
    messages,
    temperature: BRIEF_TEMPERATURE,
    maxRetries: BRIEF_MAX_RETRIES,
    timeoutMs: BRIEF_TIMEOUT_MS,
    // Structured-output support on OpenRouter is per ENDPOINT, not per model —
    // opt in HERE, for this call only, same as `intent/pipeline.ts`.
    providerRouting: { requireParameters: true },
  });

  return {
    data: res.data,
    provider: choice.provider,
    model: choice.model,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
