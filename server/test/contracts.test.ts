import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  BlastRadiusResponse,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  SkillVersion,
  SkillStats,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
    // The fixture carries no `skill` — the shape of every finding the model
    // returned before L02's attribution field existed, and of every finding
    // stored in an `eval_cases.expected_output` jsonb document. `Finding.skill`
    // MUST stay nullish: `.nullable()` rejects a MISSING key.
    expect(review.findings[0]!.skill).toBeUndefined();
  });

  it('Finding carries a skill attribution when the model supplied one', () => {
    const f = Finding.parse({
      id: 'f9',
      severity: 'WARNING',
      category: 'test',
      title: 'Uncovered branch',
      file: 'src/discount.ts',
      start_line: 14,
      end_line: 14,
      rationale: 'The cap branch is never exercised.',
      confidence: 0.6,
      skill: 'test-coverage-nudge',
    });
    // Unvalidated at this layer by design — the server checks the slug against
    // the skills actually injected into the run before storing a `skill_id`.
    expect(f.skill).toBe('test-coverage-nudge');
  });

  it('SkillVersion parses without a message (versions predating the field)', () => {
    const v = SkillVersion.parse({
      skill_id: 's1',
      version: 1,
      body: '## Rule',
      created_at: '2026-08-05T00:00:00.000Z',
    });
    expect(v.message).toBeUndefined();
  });

  it('SkillStats keeps unknown rates NULL rather than zero', () => {
    const stats = SkillStats.parse({
      used_by_count: 2,
      agents: [{ id: 'a1', name: 'Test Quality Reviewer' }],
      version_count: 1,
      runs_count: 0,
      pull_rate: null,
      accept_rate: null,
      findings_last_30d: 0,
      findings_by_category: {},
      unattributed_count: 0,
    });
    // A skill nobody has judged has no accept rate; 0 would claim every finding
    // was dismissed. Same rule the cost badge follows for unknown vs free.
    expect(stats.accept_rate).toBeNull();
    expect(stats.pull_rate).toBeNull();
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    const blast = {
      changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'rateLimit',
          file: 'a.ts',
          callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
          endpoints_affected: ['GET /x'],
          crons_affected: ['c'],
        },
      ],
      summary: 's',
    };
    // The PERSISTED shape stays byte-identical: `BlastRadius` is embedded in
    // `PrBrief` (the `pr_brief.json` jsonb column), so it must keep parsing a
    // document that has no `state` key at all.
    expect(() => BlastRadius.parse(blast)).not.toThrow();
    // `state` lives on the non-persisted RESPONSE wrapper, where it is required…
    expect(() =>
      BlastRadiusResponse.parse({ ...blast, state: 'degraded', reason: 'no_rank_graph' }),
    ).not.toThrow();
    expect(BlastRadiusResponse.safeParse(blast).success).toBe(false);
    // …and `reason` is `.nullish()`, so the 'full' path may omit it entirely.
    expect(() => BlastRadiusResponse.parse({ ...blast, state: 'full' })).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
    // The fixture above carries no `cost_usd` — the on-disk shape of every
    // trace written before the L01 cost restore. RunStats.cost_usd MUST stay
    // nullish (not nullable): `.nullable()` rejects a MISSING key and would
    // make every historical run_traces document unparseable.
    expect(trace.stats.cost_usd).toBeUndefined();
    // Same rule, same reason, for L02's per-section token attribution: the
    // fixture has no `token_counts`, so PromptAssembly.token_counts MUST stay
    // nullish or the whole run history stops parsing.
    expect(trace.prompt_assembly.token_counts).toBeUndefined();
  });

  it('RunTrace carries per-section token_counts when the run recorded them', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Test Quality Reviewer', model: 'gpt-4.1', source: 'local' },
      stats: {
        duration_ms: 4100,
        tokens_in: 4949,
        tokens_out: 810,
        cost_usd: 0.002,
        findings: 2,
        grounding: '2/2 passed',
      },
      prompt_assembly: {
        system: 's',
        skills: '## rubric',
        user: 'u',
        token_counts: { system: 412, skills: 1240, user: 8707 },
      },
      tool_calls: [],
      raw_output: '{}',
      memory_pulled: [],
      specs_read: [],
      log: [],
    });
    expect(trace.prompt_assembly.token_counts?.skills).toBe(1240);
  });

  it('RunTrace carries cost_usd when the run recorded one', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', model: 'gpt-4.1', source: 'local' },
      stats: {
        duration_ms: 8200,
        tokens_in: 14820,
        tokens_out: 1240,
        cost_usd: 0.06,
        findings: 3,
        grounding: '3/3 passed',
      },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [],
      raw_output: '{}',
      memory_pulled: [],
      specs_read: [],
      log: [],
    });
    expect(trace.stats.cost_usd).toBe(0.06);
  });

  it('RunTrace accepts an explicitly null cost (failed run)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', model: 'gpt-4.1', source: 'local' },
      stats: {
        duration_ms: 0,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: null,
        findings: 0,
        grounding: '0/0 passed',
      },
      prompt_assembly: { system: 's', user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: [],
    });
    expect(trace.stats.cost_usd).toBeNull();
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
        // SPEC-06 Stage B: required on a table-backed DTO. `instance_id: null`
        // is the built-in github.com host, which is what lets AC-19 hold with
        // no DML backfill.
        provider: 'github',
        instance_id: null,
        namespace_path: 'acme/payments-api',
        instance_label: 'github.com',
        web_url: 'https://github.com/acme/payments-api',
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});
