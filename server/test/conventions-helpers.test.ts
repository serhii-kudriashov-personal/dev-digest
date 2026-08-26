import { describe, it, expect } from 'vitest';
import {
  buildSkillDraft,
  conventionsSkillBody,
  evidenceRef,
  groundEvidence,
  locateSnippet,
  orderForSkill,
  ruleKey,
  slugify,
  toCandidate,
} from '../src/modules/conventions/helpers.js';
import type { ConventionRow } from '../src/modules/conventions/repository.js';

/**
 * The evidence gate and the skill-body builder, tested in isolation. These are the
 * two places where a model's claim either becomes data or is thrown away, so they
 * are worth pinning independently of the pipeline around them.
 */

const FILE = [
  'import { db } from "./db";', // 1
  '', // 2
  'export async function loadUser(id: string) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  const posts = await db.posts.findMany({ userId: id });', // 5
  '  return { user, posts };', // 6
  '}', // 7
].join('\n');

function row(over: Partial<ConventionRow> = {}): ConventionRow {
  return {
    id: 'c1',
    workspaceId: 'w1',
    repoId: 'r1',
    rule: 'Always use async/await instead of .then() chains.',
    category: 'structure',
    evidencePath: 'src/api/users.ts',
    evidenceSnippet: 'const user = await db.users.find(id);',
    evidenceLineStart: 4,
    evidenceLineEnd: 4,
    confidence: 0.91,
    status: 'accepted',
    createdAt: new Date('2026-08-05T10:00:00Z'),
    ...over,
  } as ConventionRow;
}

describe('locateSnippet', () => {
  it('finds a single-line snippet and reports its 1-based line', () => {
    expect(locateSnippet(FILE, 'const user = await db.users.find(id);')).toEqual({
      start: 4,
      end: 4,
    });
  });

  it('spans the real line range for a multi-line snippet', () => {
    const snippet = 'const user = await db.users.find(id);\nconst posts = await db.posts.findMany';
    expect(locateSnippet(FILE, snippet)).toEqual({ start: 4, end: 5 });
  });

  it('tolerates reindentation — the model often reformats what it quotes', () => {
    expect(locateSnippet(FILE, '      const   user = await db.users.find(id);')).toEqual({
      start: 4,
      end: 4,
    });
  });

  it('returns null for text that is not in the file', () => {
    expect(locateSnippet(FILE, 'db.users.findOrFail(id)')).toBeNull();
  });

  it('returns null for an empty snippet rather than matching at offset 0', () => {
    expect(locateSnippet(FILE, '   ')).toBeNull();
  });
});

describe('groundEvidence', () => {
  const byPath = new Map([['src/api/users.ts', FILE]]);
  const raw = {
    rule: 'Always use async/await instead of .then() chains.',
    category: 'structure' as const,
    evidence_path: 'src/api/users.ts',
    evidence_snippet: 'const user = await db.users.find(id);',
    confidence: 0.91,
  };

  it('keeps a provable candidate and computes its line range server-side', () => {
    const out = groundEvidence(raw, byPath);
    expect(out).not.toBeNull();
    expect(out!.evidenceLineStart).toBe(4);
    expect(out!.evidenceLineEnd).toBe(4);
    expect(out!.confidence).toBe(0.91);
  });

  it('DROPS a candidate citing a file that was never sampled', () => {
    expect(groundEvidence({ ...raw, evidence_path: 'src/nope.ts' }, byPath)).toBeNull();
  });

  it('DROPS a candidate whose snippet is absent — it is not merely low-confidence', () => {
    expect(
      groundEvidence({ ...raw, evidence_snippet: 'await db.users.findOrFail(id)' }, byPath),
    ).toBeNull();
  });

  it('never trusts a line number from the model — there is no field to supply one', () => {
    // Extra keys on the model's item must not reach the grounded output.
    const out = groundEvidence(
      { ...raw, evidence_line_start: 999, evidence_line_end: 999 } as never,
      byPath,
    );
    expect(out!.evidenceLineStart).toBe(4);
  });
});

describe('ruleKey', () => {
  it('ignores case, whitespace and trailing punctuation so a rephrase still dedups', () => {
    expect(ruleKey('Always use async/await.')).toBe(ruleKey('always   use async/await'));
  });

  it('keeps genuinely different rules apart', () => {
    expect(ruleKey('Use async/await')).not.toBe(ruleKey('Use Result types'));
  });
});

describe('slugify', () => {
  it('makes a markdown-heading-safe slug', () => {
    expect(slugify('Always use async/await instead of .then() chains.')).toBe(
      'always-use-async-await-instead-of-then-chains',
    );
  });

  it('falls back rather than producing an empty heading', () => {
    expect(slugify('!!! ???')).toBe('convention');
  });
});

describe('evidenceRef', () => {
  it('renders a span', () => {
    expect(evidenceRef(row({ evidenceLineStart: 23, evidenceLineEnd: 31 }))).toBe(
      'src/api/users.ts:23-31',
    );
  });

  it('collapses a single-line span', () => {
    expect(evidenceRef(row())).toBe('src/api/users.ts:4');
  });

  it('omits the range when none was recorded', () => {
    expect(evidenceRef(row({ evidenceLineStart: null, evidenceLineEnd: null }))).toBe(
      'src/api/users.ts',
    );
  });
});

describe('conventionsSkillBody', () => {
  const body = conventionsSkillBody('payments-api', [row()]);

  it('states its own severity — without it the model reports CRITICAL and flips the verdict', () => {
    expect(body).toContain('Report a **WARNING**');
  });

  it('gives every rule a heading and cites file:line', () => {
    expect(body).toContain('## always-use-async-await-instead-of-then-chains');
    expect(body).toContain('Detected in `src/api/users.ts:4`');
  });

  it('fences the snippet instead of wrapping it as untrusted data', () => {
    // A skill body must NOT be wrapUntrusted-wrapped: it IS the instruction.
    expect(body).not.toContain('<untrusted');
    expect(body).toContain('```');
  });
});

describe('orderForSkill', () => {
  it('orders by category then insertion — never by confidence', () => {
    const rows = [
      row({ id: 'a', category: 'testing', confidence: 0.99, createdAt: new Date(1) }),
      row({ id: 'b', category: 'naming', confidence: 0.1, createdAt: new Date(2) }),
      row({ id: 'c', category: 'naming', confidence: 0.5, createdAt: new Date(3) }),
    ];
    expect(orderForSkill(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('buildSkillDraft', () => {
  const draft = buildSkillDraft('payments-api', [
    row({ id: 'a', evidencePath: 'src/api/users.ts' }),
    row({ id: 'b', evidencePath: 'src/api/users.ts' }),
    row({ id: 'c', evidencePath: 'src/lib/redis.ts' }),
  ]);

  it('names and types the skill for the repo', () => {
    expect(draft.name).toBe('payments-api-conventions');
    expect(draft.type).toBe('convention');
    expect(draft.description).toBe('3 house conventions extracted from payments-api');
  });

  it('lists each evidence path once', () => {
    expect(draft.evidence_files).toEqual(['src/api/users.ts', 'src/lib/redis.ts']);
  });

  it('is enabled: the accept/reject loop the user just completed IS the vetting', () => {
    expect(draft.enabled).toBe(true);
  });

  it('singularizes the description for one convention', () => {
    expect(buildSkillDraft('x', [row()]).description).toBe('1 house convention extracted from x');
  });
});

describe('toCandidate', () => {
  it('maps a row to the wire DTO', () => {
    expect(toCandidate(row())).toEqual({
      id: 'c1',
      rule: 'Always use async/await instead of .then() chains.',
      category: 'structure',
      evidence_path: 'src/api/users.ts',
      evidence_snippet: 'const user = await db.users.find(id);',
      evidence_line_start: 4,
      evidence_line_end: 4,
      confidence: 0.91,
      status: 'accepted',
      created_at: '2026-08-05T10:00:00.000Z',
    });
  });
});
