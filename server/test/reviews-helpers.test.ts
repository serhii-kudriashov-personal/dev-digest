import { describe, it, expect } from 'vitest';
import type { PromptAssembly } from '@devdigest/shared';
import {
  labelSkillBodies,
  promptTokenCounts,
  resolveSkillAttribution,
  taskLine,
} from '../src/modules/reviews/helpers.js';

/**
 * Unit coverage for the review task-line. The key invariant: our trusted
 * instruction always tells the model to review the whole diff and never
 * withhold a security/correctness finding — no matter what the PR text claims.
 */

describe('taskLine', () => {
  const pull = { number: 3, title: 'test: vulnerable fixture', author: 'burnjohn' } as never;

  it('names the PR being reviewed', () => {
    const line = taskLine(pull);
    expect(line).toContain('#3');
    expect(line).toContain('test: vulnerable fixture');
  });

  it('keeps the non-negotiable "never withhold security" rule', () => {
    const line = taskLine(pull);
    expect(line).toMatch(/never .*withhold .*(or downgrade )?.*security/i);
    expect(line).toMatch(/review the entire diff/i);
  });
});

describe('promptTokenCounts', () => {
  const count = (text: string) => text.length;

  const assembly = (over: Partial<PromptAssembly> = {}): PromptAssembly => ({
    system: 'sys',
    skills: null,
    memory: null,
    specs: null,
    callers: null,
    repo_map: null,
    pr_description: null,
    user: 'user',
    ...over,
  });

  it('counts each section that is present', () => {
    const counts = promptTokenCounts(assembly({ skills: 'abcde' }), count);
    expect(counts).toEqual({ system: 3, skills: 5, user: 4 });
  });

  it('OMITS an absent section rather than recording 0', () => {
    // "the section did not exist" and "the section was empty" are different
    // facts; a 0 would claim a skills block was assembled and cost nothing.
    expect('skills' in promptTokenCounts(assembly(), count)).toBe(false);
  });

  it('records an empty-but-present section as 0', () => {
    expect(promptTokenCounts(assembly({ skills: '' }), count).skills).toBe(0);
  });

  it('attributes the skills block separately from the rest of the prompt', () => {
    const withSkills = promptTokenCounts(assembly({ skills: 'x'.repeat(120) }), count);
    const without = promptTokenCounts(assembly(), count);
    expect(withSkills.skills).toBe(120);
    expect(withSkills.system).toBe(without.system);
  });
});

describe('labelSkillBodies', () => {
  it('prefixes each body with its slug so the model has something to cite', () => {
    // Without the label there are no slugs in the prompt, and `Finding.skill`
    // could only ever be a guess.
    const out = labelSkillBodies([
      { id: '1', name: 'test-coverage-nudge', version: 1, order: 0, body: '## Rubric' },
    ]);
    expect(out).toEqual(['### test-coverage-nudge\n## Rubric']);
  });

  it('keeps the given order — that order is the prompt order', () => {
    const out = labelSkillBodies([
      { id: '1', name: 'second', version: 1, order: 0, body: 'b' },
      { id: '2', name: 'first', version: 1, order: 1, body: 'a' },
    ]);
    expect(out[0]).toContain('### second');
    expect(out[1]).toContain('### first');
  });
});

describe('resolveSkillAttribution', () => {
  const injected = [
    { id: 'id-cov', name: 'test-coverage-nudge', version: 1, order: 0, body: 'x' },
    { id: 'id-sec', name: 'secret-leakage-gate', version: 2, order: 1, body: 'y' },
  ];

  it('resolves a slug that names an injected skill', () => {
    const r = resolveSkillAttribution([{ skill: 'test-coverage-nudge' }], injected);
    expect(r.byIndex).toEqual(['id-cov']);
    expect(r.rejected).toEqual([]);
  });

  it('REJECTS a slug that was not injected into this run', () => {
    // The gate that makes the field trustworthy: root INSIGHTS records the model
    // returning confidence 1.0 for a hallucination, so a self-reported slug is
    // checked against what the server actually put in the prompt.
    const r = resolveSkillAttribution([{ skill: 'lethal-trifecta' }], injected);
    expect(r.byIndex).toEqual([null]);
    expect(r.rejected).toEqual(['lethal-trifecta']);
  });

  it('rejects an invented slug rather than fuzzy-matching it', () => {
    const r = resolveSkillAttribution([{ skill: 'coverage' }], injected);
    expect(r.byIndex).toEqual([null]);
    expect(r.rejected).toEqual(['coverage']);
  });

  it('leaves an absent, null or blank attribution unattributed WITHOUT rejecting it', () => {
    // "I did not attribute this" is a valid answer the schema asks for; it is not
    // a mis-attribution and must not be logged as one.
    const r = resolveSkillAttribution([{}, { skill: null }, { skill: '   ' }], injected);
    expect(r.byIndex).toEqual([null, null, null]);
    expect(r.rejected).toEqual([]);
  });

  it('tolerates the markdown ticks and casing the model tends to add', () => {
    const r = resolveSkillAttribution(
      [{ skill: '`test-coverage-nudge`' }, { skill: 'Secret-Leakage-Gate' }, { skill: ' id-cov ' }],
      injected,
    );
    expect(r.byIndex[0]).toBe('id-cov');
    expect(r.byIndex[1]).toBe('id-sec');
    // Matching is by NAME, not id — an id echoed back is not a slug.
    expect(r.byIndex[2]).toBeNull();
  });

  it('keeps results positionally aligned with the findings array', () => {
    const r = resolveSkillAttribution(
      [{ skill: 'secret-leakage-gate' }, { skill: 'nope' }, { skill: 'test-coverage-nudge' }],
      injected,
    );
    expect(r.byIndex).toEqual(['id-sec', null, 'id-cov']);
  });

  it('attributes nothing when the run injected no skills at all', () => {
    const r = resolveSkillAttribution([{ skill: 'test-coverage-nudge' }], []);
    expect(r.byIndex).toEqual([null]);
    expect(r.rejected).toEqual(['test-coverage-nudge']);
  });

  it('allows two findings to share one skill', () => {
    const r = resolveSkillAttribution(
      [{ skill: 'test-coverage-nudge' }, { skill: 'test-coverage-nudge' }],
      injected,
    );
    expect(r.byIndex).toEqual(['id-cov', 'id-cov']);
  });
});
