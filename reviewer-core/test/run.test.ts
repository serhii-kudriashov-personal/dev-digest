import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredResult } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest } from '../src/index.js';

/**
 * Engine-level test for reviewPullRequest (the core lifted out of the server's
 * runOneAgent). Uses the server's mock LLM + git so we exercise the real
 * assemble → completeStructured → reduce → grounding pipeline with no DB/SSE.
 */
describe('reviewPullRequest (engine)', () => {
  // One grounded finding (line 11 is in the MockGitClient diff) + one
  // hallucinated finding (line 999) the grounding gate must drop.
  const fixture = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
      {
        id: 'f-hallucinated',
        severity: 'WARNING',
        category: 'bug',
        title: 'phantom finding on a line not in the diff',
        file: 'src/config.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'not real',
        confidence: 0.3,
        kind: 'finding',
      },
    ],
  };

  it('single-pass: assembles, grounds, drops the hallucinated finding', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #482',
      onEvent: (e) => events.push(e.msg),
    });

    expect(outcome.mode).toBe('single-pass');
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
    // Score is derived from the SURVIVING findings, not the model's self-reported
    // 38: one CRITICAL remains after grounding ⇒ 100 − 35 = 65.
    expect(outcome.review.score).toBe(65);
    // progress is surfaced (server bridges this onto SSE; runner logs it)
    expect(events.some((m) => m.includes('Citation grounding'))).toBe(true);
  });

  it('score is deterministic from findings: a clean approve scores 100', async () => {
    // Model "approves" but reports a nonsense low score (the cheap-model bug).
    // The engine must ignore that and score the zero findings as a perfect 100.
    const clean = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      task: 'Review PR #5',
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('checkCancelled throwing aborts before the LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    await expect(
      reviewPullRequest({
        systemPrompt: 's',
        model: 'gpt-4.1',
        diff,
        llm,
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  it('forwards sessionId to every LLM call (OpenRouter session grouping)', async () => {
    const seen: (string | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.sessionId);
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, sessionId: 'sess-abc' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'sess-abc')).toBe(true);
  });
});

describe('reviewPullRequest — the scope gate (L03)', () => {
  // Two grounded findings on line 11 (which IS in the MockGitClient diff), so
  // grounding keeps both and only the scope gate can change the outcome.
  const scopedFixture = {
    verdict: 'request_changes',
    summary: 'two issues',
    score: 50,
    findings: [
      {
        id: 'in',
        severity: 'WARNING',
        category: 'bug',
        title: 'in-scope warning',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'related to the stated intent',
        confidence: 0.8,
        kind: 'finding',
        scope: 'in_scope',
      },
      {
        id: 'out',
        severity: 'WARNING',
        category: 'style',
        title: 'out-of-scope warning',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'unrelated to the stated intent',
        confidence: 0.8,
        kind: 'finding',
        scope: 'out_of_scope',
      },
    ],
  };

  it('WITHOUT intent: both findings survive and the score is the pre-L03 value', async () => {
    const llm = new MockLLMProvider('openai', { structured: scopedFixture });
    const diff = await new MockGitClient().diff();
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'gpt-4.1',
      diff,
      llm,
    });
    expect(outcome.review.findings).toHaveLength(2);
    expect(outcome.scopeDropped).toHaveLength(0);
    // Two WARNINGs at a penalty of 12 each ⇒ 100 − 24 = 76, exactly the score
    // the engine produced before L03.
    expect(outcome.review.score).toBe(76);
  });

  it('WITH intent: the sole out-of-scope warning is kept (one signal always survives)', async () => {
    const llm = new MockLLMProvider('openai', { structured: scopedFixture });
    const diff = await new MockGitClient().diff();
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'gpt-4.1',
      diff,
      llm,
      intent: 'Adds a rate limiter to /api.',
    });
    expect(outcome.review.findings).toHaveLength(2);
    expect(outcome.scopeDropped).toHaveLength(0);
  });

  it('WITH intent: surplus out-of-scope findings are dropped and reported as events', async () => {
    const noisy = {
      ...scopedFixture,
      findings: [
        ...scopedFixture.findings,
        {
          ...scopedFixture.findings[1]!,
          id: 'out2',
          title: 'second out-of-scope warning',
          severity: 'SUGGESTION',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: noisy });
    const diff = await new MockGitClient().diff();
    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'gpt-4.1',
      diff,
      llm,
      intent: 'Adds a rate limiter to /api.',
      onEvent: (e) => events.push(e.msg),
    });
    expect(outcome.review.findings.map((f) => f.id)).toEqual(['in', 'out']);
    expect(outcome.scopeDropped).toHaveLength(1);
    // Never silent: the suppression is on the record.
    expect(events.some((m) => m.includes('scope dropped'))).toBe(true);
  });
});
