import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '@devdigest/reviewer-core';
import {
  changedRanges,
  normalizeBriefPath,
  validateFocus,
  validateRisks,
  capBrief,
  isTitleRestatement,
  redactSecrets,
  type ChangedRange,
} from '../src/modules/brief/helpers.js';
import { fitBudget, collectBlocks, type BriefBlock } from '../src/modules/brief/pipeline.js';
import {
  BRIEF_MAX_IDENTITY_PATHS,
  BRIEF_MAX_FOCUS,
  BRIEF_MAX_FOCUS_REASON,
  BRIEF_MAX_RISK_EXPLANATION,
  BRIEF_MAX_RISKS,
  BRIEF_SYSTEM,
  BRIEF_TASK,
  BRIEF_TOKEN_BUDGET,
} from '../src/modules/brief/constants.js';
import type { BriefRepoRow, BriefPrFileRow } from '../src/modules/brief/repository.js';
import type { BriefAnswer, BriefRisk, BriefFocus } from '@devdigest/shared';
import type { PullRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';

/**
 * PR Risk Brief helpers/pipeline — hermetic (ring 2, pure functions; `collectBlocks`
 * and `fitBudget` exercised through a MINIMAL structural `Container`, same shape
 * as `test/indexer-pipeline.test.ts`'s `makeContainer`).
 *
 * `validateFocus`/`validateRisks` are the AC-17…20 enforcement points: nothing the
 * model claims about a file, a line or an endpoint is trusted until checked
 * against the PR's own data. `redactSecrets` is this repo's first redaction
 * surface.
 */

const REPO: BriefRepoRow = { owner: 'acme', name: 'payments-api' };

function makePull(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 482,
    title: 'Add rate limiting to public API endpoints',
    author: 'marisa.koch',
    branch: 'feat/rate-limit',
    base: 'main',
    headSha: 'sha-original',
    lastReviewedSha: null,
    additions: 10,
    deletions: 2,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...overrides,
  } as PullRow;
}

function makeFile(path: string, overrides: Partial<BriefPrFileRow> = {}): BriefPrFileRow {
  return { path, additions: 1, deletions: 0, patch: null, ...overrides };
}

describe('changedRanges — new-side line ranges, never the hunk body', () => {
  it('parses @@ headers into new-side ranges', () => {
    const patch = [
      '@@ -1,4 +1,6 @@ export function config() {',
      ' const a = 1;',
      '-const secret = 1;',
      '+const secret = 2;',
      '+const added = true;',
      ' return a;',
      '@@ -20,3 +22,4 @@ class Other {',
      '-removed();',
      '+addedLine();',
    ].join('\n');
    expect(changedRanges(patch)).toEqual([
      { start: 1, end: 6 },
      { start: 22, end: 25 },
    ]);
  });

  it('a `+0` pure-deletion hunk contributes no range', () => {
    const patch = '@@ -5,3 +5,0 @@\n-a\n-b\n-c';
    expect(changedRanges(patch)).toEqual([]);
  });

  it('a hunk with no length (single line, defaults to 1) still gets a range', () => {
    expect(changedRanges('@@ -1 +1 @@\n-a\n+b')).toEqual([{ start: 1, end: 1 }]);
  });

  it('returns [] for a null or empty patch', () => {
    expect(changedRanges(null)).toEqual([]);
    expect(changedRanges('')).toEqual([]);
  });
});

describe('normalizeBriefPath — strips ./, a/, b/ prefixes (and inherits the sharp edge)', () => {
  it('strips a leading ./', () => {
    expect(normalizeBriefPath('./src/index.ts')).toBe('src/index.ts');
  });

  it('strips a leading a/ or b/ (unified-diff prefixes)', () => {
    expect(normalizeBriefPath('a/src/index.ts')).toBe('src/index.ts');
    expect(normalizeBriefPath('b/src/index.ts')).toBe('src/index.ts');
  });

  it('documented sharp edge: a REAL top-level a/ or b/ directory is stripped too — not fixed here', () => {
    // A repo with a genuine top-level directory literally named `a` containing
    // a `b/foo.ts` loses BOTH real segments — AC-17 wants exact match over a
    // best-effort one, so this is accepted, not "fixed" (`server/INSIGHTS.md` 2026-08-09).
    expect(normalizeBriefPath('a/b/foo.ts')).toBe('foo.ts');
  });

  it('leaves an already-normalized path untouched', () => {
    expect(normalizeBriefPath('src/index.ts')).toBe('src/index.ts');
  });
});

describe('validateFocus — AC-17 (exact match, no basename fallback) and AC-18 (retarget, not drop)', () => {
  const rangesByPath = new Map<string, ChangedRange[]>([
    ['src/index.ts', [{ start: 10, end: 20 }]],
    ['src/utils.ts', [{ start: 1, end: 5 }, { start: 30, end: 40 }]],
  ]);

  it('keeps an entry whose normalized path and line are a real changed range', () => {
    const entry: BriefFocus = { path: './src/index.ts', line: 15, reason: 'inside range' };
    const { kept, dropped } = validateFocus([entry], rangesByPath);
    expect(kept).toEqual([entry]);
    expect(dropped).toBe(0);
  });

  it('drops a plausible-but-wrong path — same basename as a real changed file, but not itself one', () => {
    // `other/index.ts` shares the basename `index.ts` with the real
    // `src/index.ts` — AC-17 forbids a basename fallback, so it must be dropped,
    // not matched against the wrong file's ranges.
    const entry: BriefFocus = { path: 'other/index.ts', line: 15, reason: 'wrong file' };
    const { kept, dropped } = validateFocus([entry], rangesByPath);
    expect(kept).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('keeps but RETARGETS an entry whose line falls outside every changed range', () => {
    const entry: BriefFocus = { path: 'src/utils.ts', line: 100, reason: 'off by a lot' };
    const { kept, dropped } = validateFocus([entry], rangesByPath);
    expect(dropped).toBe(0);
    expect(kept).toEqual([{ ...entry, line: 1 }]); // first changed range's start
  });
});

describe('validateRisks — AC-19: drop an unchecked file or endpoint claim', () => {
  const changedPaths = ['src/a.ts', 'src/b.ts'];
  const knownEndpoints = ['GET /x', 'POST /y'];

  function risk(overrides: Partial<BriefRisk>): BriefRisk {
    return {
      title: 't',
      explanation: 'e',
      severity: 'medium',
      file_refs: [],
      endpoint_refs: [],
      ...overrides,
    };
  }

  it('keeps a risk whose file_refs and endpoint_refs are all real', () => {
    const r = risk({ file_refs: ['src/a.ts'], endpoint_refs: ['GET /x'] });
    const { kept, dropped } = validateRisks([r], changedPaths, knownEndpoints);
    expect(kept).toEqual([r]);
    expect(dropped).toBe(0);
  });

  it('normalizes both sides before comparing — a prefixed file_ref still matches', () => {
    const r = risk({ file_refs: ['a/src/a.ts'] });
    const { kept, dropped } = validateRisks([r], changedPaths, knownEndpoints);
    expect(kept).toEqual([r]);
    expect(dropped).toBe(0);
  });

  it('drops a risk naming a file outside the diff', () => {
    const r = risk({ file_refs: ['src/nonexistent.ts'] });
    const { kept, dropped } = validateRisks([r], changedPaths, knownEndpoints);
    expect(kept).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('drops a risk naming an endpoint never surfaced by blast radius', () => {
    const r = risk({ endpoint_refs: ['DELETE /z'] });
    const { kept, dropped } = validateRisks([r], changedPaths, knownEndpoints);
    expect(kept).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('a risk with EMPTY file_refs/endpoint_refs always survives — it makes no checkable claim', () => {
    const r = risk({});
    const { kept, dropped } = validateRisks([r], changedPaths, knownEndpoints);
    expect(kept).toEqual([r]);
    expect(dropped).toBe(0);
  });
});

describe('capBrief — AC-42 (cap 5/5, order preserved) and NFR-3 (truncate free text)', () => {
  it('caps risks and review_focus to 5 each, keeping the model\'s own order', () => {
    const risks: BriefRisk[] = Array.from({ length: 7 }, (_, i) => ({
      title: `risk-${i}`,
      explanation: 'x'.repeat(300),
      severity: 'low',
      file_refs: [],
      endpoint_refs: [],
    }));
    const review_focus: BriefFocus[] = Array.from({ length: 7 }, (_, i) => ({
      path: `src/f${i}.ts`,
      line: 1,
      reason: 'y'.repeat(200),
    }));
    const answer: BriefAnswer = { what: 'w', why: 'y', risk_level: 'low', risks, review_focus };
    const capped = capBrief(answer);

    expect(capped.risks).toHaveLength(BRIEF_MAX_RISKS);
    expect(capped.risks.map((r) => r.title)).toEqual(['risk-0', 'risk-1', 'risk-2', 'risk-3', 'risk-4']);
    expect(capped.review_focus).toHaveLength(BRIEF_MAX_FOCUS);
    expect(capped.review_focus.map((f) => f.path)).toEqual([
      'src/f0.ts',
      'src/f1.ts',
      'src/f2.ts',
      'src/f3.ts',
      'src/f4.ts',
    ]);
  });

  it('truncates explanation to 240 chars and reason to 160 chars', () => {
    const answer: BriefAnswer = {
      what: 'w',
      why: 'y',
      risk_level: 'low',
      risks: [
        {
          title: 't',
          explanation: 'x'.repeat(500),
          severity: 'low',
          file_refs: [],
          endpoint_refs: [],
        },
      ],
      review_focus: [{ path: 'src/a.ts', line: 1, reason: 'y'.repeat(500) }],
    };
    const capped = capBrief(answer);
    expect(capped.risks[0]!.explanation).toHaveLength(BRIEF_MAX_RISK_EXPLANATION);
    expect(capped.review_focus[0]!.reason).toHaveLength(BRIEF_MAX_FOCUS_REASON);
  });
});

describe('isTitleRestatement — AC-23, case/whitespace/punctuation-insensitive equality', () => {
  it('is a restatement once case, whitespace and punctuation are normalized away', () => {
    expect(
      isTitleRestatement(
        'Add rate limiting to public API endpoints.',
        'Add rate limiting to public API endpoints',
      ),
    ).toBe(true);
    expect(
      isTitleRestatement(
        '  add   RATE limiting to Public API endpoints!!  ',
        'Add rate limiting to public API endpoints',
      ),
    ).toBe(true);
  });

  it('is NOT a restatement when it merely overlaps the title', () => {
    expect(
      isTitleRestatement(
        'Add rate limiting to public API endpoints, and also fix a related bug',
        'Add rate limiting to public API endpoints',
      ),
    ).toBe(false);
  });

  it('an empty (or empty-after-normalizing) `what` is never a restatement', () => {
    expect(isTitleRestatement('', '')).toBe(false);
    expect(isTitleRestatement('   ', 'Add rate limiting')).toBe(false);
  });
});

describe('redactSecrets — one assertion per SECRET_PATTERNS shape (AC-24)', () => {
  const untouched = 'This is a perfectly ordinary sentence about rate limiting.';

  it('AWS access key', () => {
    const text = `key=AKIAABCDEFGHIJ123456 in the env file`;
    expect(redactSecrets(text)).toBe('key=[REDACTED] in the env file');
    expect(redactSecrets(untouched)).toBe(untouched);
  });

  it('GCP API key', () => {
    const text = `gcp key: AIza${'A'.repeat(35)}`;
    expect(redactSecrets(text)).toBe('gcp key: [REDACTED]');
  });

  it('GitHub token (ghp_/ghs_)', () => {
    expect(redactSecrets(`token ghp_${'x'.repeat(36)} leaked`)).toBe('token [REDACTED] leaked');
    expect(redactSecrets(`token ghs_${'x'.repeat(36)} leaked`)).toBe('token [REDACTED] leaked');
  });

  it('npm token', () => {
    expect(redactSecrets(`npm_${'a'.repeat(36)}`)).toBe('[REDACTED]');
  });

  it('Slack token', () => {
    expect(redactSecrets('xoxb-1234567890-1234567890-abcdefghijklmnop')).toBe('[REDACTED]');
    expect(redactSecrets('xoxp-1234-5678-abcd')).toBe('[REDACTED]');
  });

  it('PEM private key block', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIExampleKeyContentHere\n-----END RSA PRIVATE KEY-----';
    expect(redactSecrets(`before\n${pem}\nafter`)).toBe('before\n[REDACTED]\nafter');
  });

  it('generic key/token/password assignment', () => {
    expect(redactSecrets(`password: "supersecretvalue"`)).toBe('[REDACTED]');
    // The match starts at the literal "Token" substring inside "apiToken", not
    // at the start of the identifier — `api` survives, the assignment does not.
    expect(redactSecrets(`apiToken = 'abcdefgh12345'`)).toBe('api[REDACTED]');
  });

  it('mongodb connection URI', () => {
    expect(redactSecrets('mongodb://user:pass@cluster0.example.net:27017/db')).toBe('[REDACTED]');
    expect(redactSecrets('mongodb+srv://user:pass@cluster0.example.net/db')).toBe('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// pipeline.ts — fitBudget / collectBlocks. Still hermetic: `fitBudget` is pure
// given a `Tokenizer`, and `collectBlocks` is driven through a MINIMAL
// structural `Container` (same pattern as `test/indexer-pipeline.test.ts`'s
// `makeContainer`) so no real adapter or Postgres is touched.
// ---------------------------------------------------------------------------

/** Reproduces `pipeline.ts`'s private `renderBlob` + `assembledText`, using the
 *  same public `assemblePrompt`, so AC-12's heuristic can be checked exactly
 *  rather than merely "some positive number". */
function assembledChars(blocks: BriefBlock[], repo: BriefRepoRow, pull: PullRow): number {
  const blob = blocks.map((b) => `SOURCE: ${b.label}\n${b.text}`).join('\n\n---\n\n');
  const { messages } = assemblePrompt({
    system: BRIEF_SYSTEM,
    task: BRIEF_TASK(`${repo.owner}/${repo.name}`, pull.number, pull.title),
    diff: blob,
  });
  return messages.map((m) => m.content).join('\n\n').length;
}

describe('fitBudget — AC-13 (whole-block drop, tail of BRIEF_DROP_ORDER), AC-15, AC-12', () => {
  const charCounter = { count: (text: string) => text.length };

  it('drops WHOLE blocks, in the exact order derived_intent → blast_radius, never mid-content', () => {
    const blocks: BriefBlock[] = [
      { label: 'pr_identity', text: 'IDENTITY_MARKER '.repeat(3) },
      { label: 'derived_intent', text: 'x'.repeat(4000) },
      { label: 'blast_radius', text: 'y'.repeat(8500) },
      { label: 'findings', text: 'FINDINGS_MARKER '.repeat(3) },
      { label: 'linked_issue', text: 'ISSUE_MARKER '.repeat(3) },
      { label: 'linked_spec', text: 'SPEC_MARKER '.repeat(3) },
    ];
    const pull = makePull();
    const fit = fitBudget(blocks, REPO, pull, charCounter);

    expect(fit.ok).toBe(true);
    if (!fit.ok) throw new Error('unreachable');
    expect(fit.dropped).toEqual(['derived_intent', 'blast_radius']);
    expect(fit.blocks.map((b) => b.label)).toEqual([
      'pr_identity',
      'findings',
      'linked_issue',
      'linked_spec',
    ]);
    // The survivors are the SAME text, byte for byte — never truncated.
    expect(fit.blocks.find((b) => b.label === 'pr_identity')!.text).toBe(blocks[0]!.text);
    expect(fit.blocks.find((b) => b.label === 'findings')!.text).toBe(blocks[3]!.text);
    expect(fit.tokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
    expect(fit.estimated).toBe(false);
  });

  it('AC-15: when the identity block ALONE overflows, returns ok:false and never touches the blocks', () => {
    const blocks: BriefBlock[] = [{ label: 'pr_identity', text: 'z'.repeat(60_000) }];
    const pull = makePull();
    const fit = fitBudget(blocks, REPO, pull, charCounter);

    expect(fit.ok).toBe(false);
    if (fit.ok) throw new Error('unreachable');
    expect(fit.budget).toBe(BRIEF_TOKEN_BUDGET);
    expect(fit.identityTokens).toBeGreaterThan(BRIEF_TOKEN_BUDGET);
  });

  it('AC-12: a throwing tokenizer falls back to ceil(chars/4), marked estimated:true', () => {
    const throwingTokenizer = {
      count: () => {
        throw new Error('tokenizer unavailable');
      },
    };
    const blocks: BriefBlock[] = [{ label: 'pr_identity', text: 'hello world' }];
    const pull = makePull();
    const fit = fitBudget(blocks, REPO, pull, throwingTokenizer);

    expect(fit.ok).toBe(true);
    if (!fit.ok) throw new Error('unreachable');
    expect(fit.estimated).toBe(true);
    expect(fit.tokens).toBe(Math.ceil(assembledChars(blocks, REPO, pull) / 4));
  });
});

describe('collectBlocks — AC-14 identity cap (50 named, the rest folded into one aggregate line)', () => {
  /** Only the members `collectBlocks` actually reads — cast to `Container`,
   *  same pattern as `test/indexer-pipeline.test.ts`'s `makeContainer`. */
  function miniContainer(): Container {
    return {
      intent: { get: async () => null },
      blast: {
        build: async () => {
          throw new Error('blast unavailable in this hermetic test');
        },
      },
      github: async () => {
        throw new Error('github must not be called — the PR body links nothing');
      },
      git: {
        readFile: async () => {
          throw new Error('git.readFile must not be called — the PR body links nothing');
        },
      },
    } as unknown as Container;
  }

  it('names at most BRIEF_MAX_IDENTITY_PATHS files; the rest become one aggregate line', async () => {
    const files: BriefPrFileRow[] = Array.from({ length: 300 }, (_, i) =>
      makeFile(`src/file${String(i).padStart(3, '0')}.ts`, { additions: 1, deletions: 0 }),
    );
    const pull = makePull({ body: null });

    const collected = await collectBlocks(miniContainer(), 'ws-1', 'pr-1', REPO, pull, files, []);
    const identity = collected.blocks.find((b) => b.label === 'pr_identity')!;

    const lastNamed = `src/file${String(BRIEF_MAX_IDENTITY_PATHS - 1).padStart(3, '0')}.ts`;
    const firstFolded = `src/file${String(BRIEF_MAX_IDENTITY_PATHS).padStart(3, '0')}.ts`;
    expect(identity.text).toContain(lastNamed); // the 50th file — still named
    expect(identity.text).not.toContain(firstFolded); // the 51st — folded, not named
    expect(identity.text).toMatch(/… and 250 more file\(s\), \+250\/-0 total/);
    expect(collected.blocks).toHaveLength(1); // only pr_identity — everything else is best-effort and absent here
    expect(collected.missing).toEqual(
      expect.arrayContaining(['derived_intent', 'blast_radius', 'findings', 'linked_issue', 'linked_spec']),
    );
  });
});
