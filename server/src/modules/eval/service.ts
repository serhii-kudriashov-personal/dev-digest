import PQueue from 'p-queue';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type {
  EvalCaseInput,
  EvalCaseRecord,
  EvalComparison,
  EvalDashboard,
  EvalRunRecord,
  EvalSetRun,
  EvalTrendPoint,
  LLMProvider,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConfigError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { AgentRow } from '../../db/rows.js';
import { EvalRepository, type EvalCaseRow, type EvalSetRunRow } from './repository.js';
import {
  EVAL_CASE_TIMEOUT_MS,
  EVAL_MAX_CASES_PER_AGENT,
  EVAL_MAX_CONCURRENT_AGENTS,
  EVAL_MAX_DIFF_BYTES,
  EVAL_MAX_EXPECTATIONS_PER_CASE,
  EVAL_MAX_HISTORY_RUNS,
  EVAL_MAX_RECENT_RUNS,
  EVAL_RUN_TIMEOUT_MS,
  EVAL_TASK_LINE,
} from './constants.js';
import {
  caseExpectation,
  caseOutcome,
  comparisonOf,
  derivedNote,
  expectationFromFinding,
  hasSecretShapedLiteral,
  labelSkillBodies,
  matchExpectation,
  prDescriptionFromMeta,
  scoreRun,
  singleFileDiffFragment,
  sumCost,
  toEvalCaseRecord,
  toEvalRunRecordDto,
  toEvalSetRunDto,
  trendPoints,
} from './helpers.js';
import type { EvalCaseComparisonEntry, EvalCaseScoreInput } from './types.js';

/** Minimal structured logger (pino-compatible), same shape `reviews` uses. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

/** Thrown when a set run is cancelled mid-case. Never named by the caller —
 *  the core stays agnostic (`reviewer-core/src/review/run.ts#checkCancelled`);
 *  it is caught here and folded into that case's own recorded error, the same
 *  way `reviews/run-executor.ts#RunCancelledError` is. */
class EvalRunCancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'EvalRunCancelledError';
  }
}

/**
 * NFR-7 per-agent lock: agentId → the set-run id in flight for it. Module
 * scope, deliberately — `EvalService` is constructed PER REQUEST
 * (`new EvalService(app.container)` in `routes.ts`, same as every sibling
 * service), so an instance field would never survive across concurrent
 * requests (precedent + trap: `brief/service.ts`, `server/INSIGHTS.md`
 * 2026-08-17 — a test that does not await a run leaks a live entry into the
 * next case).
 */
const running = new Map<string, string>();

/** NFR-7's workspace-wide ceiling: at most `EVAL_MAX_CONCURRENT_AGENTS` set
 *  runs execute at once, queued beyond that. Module scope for the same reason
 *  as `running` above. */
const queue = new PQueue({ concurrency: EVAL_MAX_CONCURRENT_AGENTS });

/**
 * Eval slice service (L06, SPEC-04). Reads `container.<port>` but never
 * `container.db` — the repository is constructed with it once, here, the
 * sanctioned line (`backend-onion-architecture` §4).
 */
export class EvalService {
  private repo: EvalRepository;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
  }

  // ===========================================================================
  // Cases
  // ===========================================================================

  /** AC-1…AC-9: freeze a judged finding into a case owned by its producing agent. */
  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<{ case: EvalCaseRecord; secret_warning: boolean }> {
    const source = await this.container.reviewRepo.findingSource(workspaceId, findingId);
    if (!source) throw new NotFoundError('Finding not found');

    const judged = source.finding.acceptedAt !== null || source.finding.dismissedAt !== null;
    if (!judged) {
      throw new ValidationError(
        'The finding must be accepted or dismissed before it can become an eval case',
      );
    }
    if (!source.agentId) {
      throw new ValidationError('The finding has no producing agent to own this case');
    }

    const existingCount = await this.repo.countCases(workspaceId, 'agent', source.agentId);
    if (existingCount >= EVAL_MAX_CASES_PER_AGENT) {
      throw new ValidationError(
        `This agent already has the maximum of ${EVAL_MAX_CASES_PER_AGENT} eval cases`,
      );
    }

    const expectation = expectationFromFinding({
      file: source.finding.file,
      startLine: source.finding.startLine,
      endLine: source.finding.endLine,
      judgement: source.finding.acceptedAt !== null ? 'accepted' : 'dismissed',
    });
    const fragment = source.patch ? singleFileDiffFragment(source.finding.file, source.patch) : '';

    const row = await this.repo.insertCase(workspaceId, {
      ownerKind: 'agent',
      ownerId: source.agentId,
      name: `${source.finding.title} (${source.finding.file})`,
      inputDiff: fragment,
      inputFiles: [source.finding.file],
      inputMeta: null,
      expectedOutput: {
        file: source.finding.file,
        start_line: source.finding.startLine,
        end_line: source.finding.endLine,
        title: source.finding.title,
        severity: source.finding.severity,
        category: source.finding.category,
      },
      notes: null,
      runOnSave: false,
      expectationKind: expectation.kind,
      expectFile: expectation.file,
      expectStartLine: expectation.start_line,
      expectEndLine: expectation.end_line,
      sourceFindingId: source.finding.id,
      sourcePrId: source.prId,
      sourcePrNumber: source.prNumber,
      sourceRepoFullName: source.repoFullName,
      sourceHeadSha: source.headSha,
    });

    return {
      case: toEvalCaseRecord(row, undefined, true),
      secret_warning: hasSecretShapedLiteral(fragment),
    };
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRecord[]> {
    const rows = await this.repo.listCases(workspaceId, 'agent', agentId);
    const latest = await this.repo.latestCaseResults(
      workspaceId,
      rows.map((r) => r.id),
    );
    const records: EvalCaseRecord[] = [];
    for (const row of rows) {
      const available = await this.provenanceAvailable(workspaceId, row);
      records.push(toEvalCaseRecord(row, latest.get(row.id), available));
    }
    return records;
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRecord> {
    const row = await this.repo.getCase(workspaceId, caseId);
    if (!row) throw new NotFoundError('Eval case not found');
    const latest = await this.repo.latestCaseResults(workspaceId, [caseId]);
    const available = await this.provenanceAvailable(workspaceId, row);
    return toEvalCaseRecord(row, latest.get(caseId), available);
  }

  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCaseRecord> {
    const existingCount = await this.repo.countCases(
      workspaceId,
      input.owner_kind,
      input.owner_id,
    );
    if (existingCount >= EVAL_MAX_CASES_PER_AGENT) {
      throw new ValidationError(
        `This agent already has the maximum of ${EVAL_MAX_CASES_PER_AGENT} eval cases`,
      );
    }
    this.assertDiffSize(input.input_diff);
    this.assertExpectationCount(input.expected_output);

    const row = await this.repo.insertCase(workspaceId, {
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output ?? null,
      notes: input.notes ?? null,
      runOnSave: input.run_on_save,
      expectationKind: input.expectation?.kind ?? null,
      expectFile: input.expectation?.file ?? null,
      expectStartLine: input.expectation?.start_line ?? null,
      expectEndLine: input.expectation?.end_line ?? null,
      sourceFindingId: null,
      sourcePrId: null,
      sourcePrNumber: null,
      sourceRepoFullName: null,
      sourceHeadSha: null,
    });
    return toEvalCaseRecord(row, undefined, false);
  }

  /** AC-12, AC-13, AC-14. */
  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: Partial<EvalCaseInput>,
  ): Promise<EvalCaseRecord> {
    const existing = await this.repo.getCase(workspaceId, caseId);
    if (!existing) throw new NotFoundError('Eval case not found');

    let expectedOutput: unknown = undefined;
    if (patch.expected_output !== undefined) {
      expectedOutput = patch.expected_output;
      if (typeof expectedOutput === 'string') {
        try {
          expectedOutput = JSON.parse(expectedOutput);
        } catch {
          throw new ValidationError('Expected output is not valid JSON');
        }
      }
      this.assertExpectationCount(expectedOutput);
    }
    if (patch.input_diff !== undefined) this.assertDiffSize(patch.input_diff);

    const updated = await this.repo.updateCase(workspaceId, caseId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(expectedOutput !== undefined ? { expectedOutput } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.run_on_save !== undefined ? { runOnSave: patch.run_on_save } : {}),
      ...(patch.expectation !== undefined
        ? {
            expectationKind: patch.expectation?.kind ?? null,
            expectFile: patch.expectation?.file ?? null,
            expectStartLine: patch.expectation?.start_line ?? null,
            expectEndLine: patch.expectation?.end_line ?? null,
          }
        : {}),
    });
    if (!updated) throw new NotFoundError('Eval case not found');

    if (patch.run_on_save) {
      await this.runCase(workspaceId, caseId);
    }

    const row = (await this.repo.getCase(workspaceId, caseId))!;
    const latest = await this.repo.latestCaseResults(workspaceId, [caseId]);
    const available = await this.provenanceAvailable(workspaceId, row);
    return toEvalCaseRecord(row, latest.get(caseId), available);
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, caseId);
  }

  private assertDiffSize(diff: string): void {
    const bytes = Buffer.byteLength(diff, 'utf8');
    if (bytes > EVAL_MAX_DIFF_BYTES) {
      throw new ValidationError(
        `The case diff is ${bytes} bytes; the cap is ${EVAL_MAX_DIFF_BYTES} bytes`,
      );
    }
  }

  private assertExpectationCount(expectedOutput: unknown): void {
    if (Array.isArray(expectedOutput) && expectedOutput.length > EVAL_MAX_EXPECTATIONS_PER_CASE) {
      throw new ValidationError(
        `Expected output holds ${expectedOutput.length} entries; the cap is ${EVAL_MAX_EXPECTATIONS_PER_CASE}`,
      );
    }
  }

  /** AC-7: `available` is a LIVE re-check, never derived from the presence of
   *  the stored (FK-less) source ids. */
  private async provenanceAvailable(workspaceId: string, row: EvalCaseRow): Promise<boolean> {
    if (!row.sourceFindingId || !row.sourcePrId) return false;
    const pull = await this.container.reviewRepo.getPull(workspaceId, row.sourcePrId);
    return Boolean(pull);
  }

  // ===========================================================================
  // Running a case / a set (AC-17, AC-25…AC-32, NFR-1, NFR-2, NFR-5, NFR-6, NFR-7)
  // ===========================================================================

  /** AC-32: a single-case run, sharing the per-agent lock, writing ONLY an
   *  `eval_runs` row with `set_run_id: null` — no `eval_set_runs` row. */
  async runCase(workspaceId: string, caseId: string): Promise<EvalRunRecord> {
    const evalCase = await this.repo.getCase(workspaceId, caseId);
    if (!evalCase) throw new NotFoundError('Eval case not found');
    if (evalCase.ownerKind !== 'agent') {
      throw new ValidationError('Only agent-owned cases can be run');
    }
    const agentId = evalCase.ownerId;

    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    if (running.has(agentId)) {
      throw new ValidationError('An eval run is already in progress for this agent', {
        set_run_id: running.get(agentId),
      });
    }

    const llm = await this.resolveLlm(agent);

    running.set(agentId, `case:${caseId}`);
    try {
      const skillBodies = await this.resolveSkillBodies(agent);
      await this.executeCase(agent, llm, skillBodies, evalCase, null, () => false);
    } finally {
      running.delete(agentId);
    }

    const row = await this.repo.latestRunForCase(workspaceId, caseId);
    if (!row) throw new ValidationError('The case did not produce a result');
    return toEvalRunRecordDto(row, evalCase.name);
  }

  /** AC-17…AC-31: run an agent's whole case set (or a named subset). */
  async runSet(
    workspaceId: string,
    agentId: string,
    caseIds: string[] | null | undefined,
    logger?: Logger,
  ): Promise<EvalSetRun> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    await this.assertNotRunning(workspaceId, agentId);

    const llm = await this.resolveLlm(agent);

    const allCases = await this.repo.listCases(workspaceId, 'agent', agentId);
    const cases =
      caseIds && caseIds.length > 0 ? allCases.filter((c) => caseIds.includes(c.id)) : allCases;
    if (cases.length === 0) {
      throw new ValidationError('This agent has no eval cases to run');
    }

    const setRunRow = await this.repo.openSetRun(workspaceId, {
      agentId,
      configVersion: agent.version,
      provider: agent.provider,
      model: agent.model,
      coveredCaseIds: cases.map((c) => c.id),
    });

    running.set(agentId, setRunRow.id);
    // Fire-and-forget: the route returns the opened run immediately (NFR-1),
    // exactly the `reviews/service.ts#runReview` pattern.
    void queue.add(() => this.executeSet(workspaceId, agent, llm, setRunRow.id, cases, logger));

    return toEvalSetRunDto(setRunRow, agent.name);
  }

  /** A12: enqueue every enabled agent's set run, skipping one already running. */
  async runAllAgents(workspaceId: string, logger?: Logger): Promise<EvalSetRun[]> {
    const enabled = await this.container.agentsRepo.listEnabled(workspaceId);
    const started: EvalSetRun[] = [];
    for (const agent of enabled) {
      if (running.has(agent.id)) continue;
      const count = await this.repo.countCases(workspaceId, 'agent', agent.id);
      if (count === 0) continue;
      try {
        started.push(await this.runSet(workspaceId, agent.id, null, logger));
      } catch (err) {
        if (err instanceof ValidationError) continue; // already running / no key
        throw err;
      }
    }
    return started;
  }

  async cancelRun(workspaceId: string, setRunId: string): Promise<void> {
    const row = await this.repo.getSetRun(workspaceId, setRunId);
    if (!row) throw new NotFoundError('Eval run not found');
    this.container.runBus.cancel(setRunId);
  }

  private async assertNotRunning(workspaceId: string, agentId: string): Promise<void> {
    if (running.has(agentId)) {
      throw new ValidationError('An eval run is already in progress for this agent', {
        set_run_id: running.get(agentId),
      });
    }
    const inFlight = await this.repo.runningSetRun(workspaceId, agentId);
    if (inFlight && Date.now() - inFlight.ranAt.getTime() < EVAL_RUN_TIMEOUT_MS) {
      throw new ValidationError('An eval run is already in progress for this agent', {
        set_run_id: inFlight.id,
      });
    }
  }

  private async resolveLlm(agent: AgentRow): Promise<LLMProvider> {
    try {
      return await this.container.llm(agent.provider as Provider);
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new ValidationError(`${agent.provider} is not configured`, {
          provider: agent.provider,
        });
      }
      throw err;
    }
  }

  private async resolveSkillBodies(agent: AgentRow): Promise<string[]> {
    const links = await this.container.agentsRepo.linkedSkills(agent.id);
    return labelSkillBodies(
      links.filter((l) => l.skill.enabled).map((l) => ({ name: l.skill.name, body: l.skill.body })),
    );
  }

  /** Execute every case in `cases` against `agent`, streaming no events (A4 —
   *  progress is polled, never published on `runBus`) and closing the set run
   *  with arithmetic-only scoring. */
  private async executeSet(
    workspaceId: string,
    agent: AgentRow,
    llm: LLMProvider,
    setRunId: string,
    cases: EvalCaseRow[],
    logger?: Logger,
  ): Promise<void> {
    const started = Date.now();
    try {
      const skillBodies = await this.resolveSkillBodies(agent);
      const perCase: EvalCaseScoreInput[] = [];
      const costs: (number | null)[] = [];
      let incomplete = false;
      let incompleteReason: string | null = null;
      let casesDone = 0;

      for (const evalCase of cases) {
        if (this.container.runBus.isCancelled(setRunId)) {
          incomplete = true;
          incompleteReason = 'Cancelled';
          break;
        }

        const result = await this.executeCase(agent, llm, skillBodies, evalCase, setRunId, () =>
          this.container.runBus.isCancelled(setRunId),
        );
        perCase.push(result.perCase);
        costs.push(result.cost);
        if (!result.perCase.executed) {
          incomplete = true;
          incompleteReason ??= 'One or more cases failed to execute';
        }

        casesDone += 1;
        await this.repo.bumpSetRunProgress(setRunId, casesDone);

        if (this.container.runBus.isCancelled(setRunId)) {
          incomplete = true;
          incompleteReason = 'Cancelled';
          break;
        }
      }

      if (casesDone === 0) {
        await this.repo.deleteSetRun(setRunId);
        return;
      }

      const score = scoreRun(perCase);
      await this.repo.closeSetRun(setRunId, {
        status: incomplete ? 'incomplete' : 'complete',
        recall: score.recall,
        precision: score.precision,
        citationAccuracy: score.citationAccuracy,
        casesPassed: score.casesPassed,
        costUsd: sumCost(costs),
        durationMs: Date.now() - started,
        incompleteReason,
      });
      await this.repo.pruneRetention(workspaceId, agent.id);
    } catch (err) {
      logger?.error(
        { setRunId, agentId: agent.id, err: (err as Error).message },
        'eval: set run crashed',
      );
    } finally {
      running.delete(agent.id);
    }
  }

  /**
   * Run one case and persist its `eval_runs` row. Never throws — every
   * failure (parse, timeout, cancellation, provider error) is recorded
   * against the case and reflected in the returned `executed: false`, so the
   * caller's loop always continues (AC-25).
   */
  private async executeCase(
    agent: AgentRow,
    llm: LLMProvider,
    skillBodies: string[],
    evalCase: EvalCaseRow,
    setRunId: string | null,
    isCancelled: () => boolean,
  ): Promise<{ perCase: EvalCaseScoreInput; cost: number | null }> {
    const start = Date.now();
    const expectation = caseExpectation(evalCase);
    const notExecuted: EvalCaseScoreInput = {
      executed: false,
      expectationKind: null,
      matched: false,
      groundedCount: 0,
      droppedCount: 0,
    };

    const diff = parseUnifiedDiff(evalCase.inputDiff ?? '');
    if (diff.files.length === 0) {
      await this.repo.recordCaseResult({
        caseId: evalCase.id,
        setRunId,
        pass: null,
        error: 'The case diff has no parseable file',
      });
      return { perCase: notExecuted, cost: null };
    }

    try {
      const prDescription = prDescriptionFromMeta(evalCase.inputMeta);
      const outcome = await this.withTimeout(
        reviewPullRequest({
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          diff,
          llm,
          strategy: (agent.strategy ?? undefined) as ReviewStrategy | undefined,
          ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
          ...(prDescription ? { prDescription } : {}),
          task: EVAL_TASK_LINE,
          checkCancelled: () => {
            if (isCancelled()) throw new EvalRunCancelledError();
          },
        }),
        EVAL_CASE_TIMEOUT_MS,
      );

      const durationMs = Date.now() - start;
      const matchedFinding = expectation
        ? matchExpectation(expectation, outcome.review.findings)
        : undefined;
      const matched = matchedFinding !== undefined;
      const pass = expectation ? caseOutcome(expectation.kind, matched) : null;

      await this.repo.recordCaseResult({
        caseId: evalCase.id,
        setRunId,
        actualOutput: outcome.review,
        pass,
        durationMs,
        costUsd: outcome.costUsd,
        groundingDropped: outcome.dropped,
        matched,
      });

      return {
        perCase: {
          executed: true,
          expectationKind: expectation?.kind ?? null,
          matched,
          groundedCount: outcome.review.findings.length,
          droppedCount: outcome.dropped.length,
        },
        cost: outcome.costUsd,
      };
    } catch (err) {
      const message = (err as Error).message;
      await this.repo.recordCaseResult({
        caseId: evalCase.id,
        setRunId,
        pass: null,
        error: message,
      });
      return { perCase: notExecuted, cost: null };
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Case timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  // ===========================================================================
  // Reads — no model call anywhere below (AC-18, NFR-5)
  // ===========================================================================

  async getRun(workspaceId: string, setRunId: string): Promise<EvalSetRun> {
    const row = await this.repo.getSetRun(workspaceId, setRunId);
    if (!row) throw new NotFoundError('Eval run not found');
    const agent = await this.container.agentsRepo.getById(workspaceId, row.agentId);
    return toEvalSetRunDto(row, agent?.name ?? null);
  }

  async listRuns(workspaceId: string, agentId: string): Promise<EvalSetRun[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    const rows = await this.repo.listSetRuns(workspaceId, agentId);
    return rows.map((r) => toEvalSetRunDto(r, agent?.name ?? null));
  }

  /** AC-47: an agent's own metric trend — complete runs only, newest-last,
   *  capped at `EVAL_MAX_TREND_POINTS` (`helpers.ts#trendPoints`). Read-only,
   *  no score recomputed (NFR-9). */
  async trend(workspaceId: string, agentId: string): Promise<EvalTrendPoint[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    const rows = await this.repo.listSetRuns(workspaceId, agentId, {
      limit: EVAL_MAX_HISTORY_RUNS,
    });
    const dtos = rows.map((r) => toEvalSetRunDto(r, agent?.name ?? null));
    return trendPoints(dtos);
  }

  async listRunCases(workspaceId: string, setRunId: string): Promise<EvalRunRecord[]> {
    const setRun = await this.repo.getSetRun(workspaceId, setRunId);
    if (!setRun) throw new NotFoundError('Eval run not found');
    const rows = await this.repo.listCaseResults(workspaceId, setRunId);
    const caseIds = [...new Set(rows.map((r) => r.caseId))];
    const names = new Map<string, string>();
    for (const id of caseIds) {
      const c = await this.repo.getCase(workspaceId, id);
      if (c) names.set(id, c.name);
    }
    return rows.map((r) => toEvalRunRecordDto(r, names.get(r.caseId) ?? null));
  }

  /** AC-33…AC-37: two-run comparison with the attributability warning. */
  async compare(workspaceId: string, ids: [string, string]): Promise<EvalComparison> {
    const [rowA, rowB] = await Promise.all([
      this.repo.getSetRun(workspaceId, ids[0]),
      this.repo.getSetRun(workspaceId, ids[1]),
    ]);
    if (!rowA || !rowB) throw new NotFoundError('Eval run not found');

    const [earlierRow, laterRow] =
      rowA.ranAt.getTime() <= rowB.ranAt.getTime() ? [rowA, rowB] : [rowB, rowA];
    const agent = await this.container.agentsRepo.getById(workspaceId, earlierRow.agentId);

    const earlier = toEvalSetRunDto(earlierRow, agent?.name ?? null);
    const later = toEvalSetRunDto(laterRow, agent?.name ?? null);

    const [earlierVersion, laterVersion] = await Promise.all([
      this.container.agentsRepo.getVersion(earlierRow.agentId, earlierRow.configVersion),
      this.container.agentsRepo.getVersion(laterRow.agentId, laterRow.configVersion),
    ]);

    return comparisonOf(
      earlier,
      later,
      earlierVersion?.configJson ? this.systemPromptOf(earlierVersion.configJson) : null,
      laterVersion?.configJson ? this.systemPromptOf(laterVersion.configJson) : null,
    );
  }

  private systemPromptOf(configJson: unknown): string | null {
    if (configJson && typeof configJson === 'object' && 'system_prompt' in configJson) {
      const v = (configJson as Record<string, unknown>).system_prompt;
      return typeof v === 'string' ? v : null;
    }
    return null;
  }

  /** AC-40…AC-44, NFR-9: everything here reads recorded numbers only. */
  async dashboard(workspaceId: string): Promise<EvalDashboard> {
    const agentCounts = await this.repo.agentsWithCases(workspaceId);
    const agentsOut: EvalDashboard['agents'] = [];
    const namesById = new Map<string, string>();
    // AC-43: at most ONE derived note on the whole dashboard — the first
    // agent (in `agentsWithCases` order) whose last two runs are both
    // comparable AND produce a non-null note wins.
    let alert: string | null = null;

    for (const { agentId, count } of agentCounts) {
      const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
      if (!agent) continue;
      namesById.set(agentId, agent.name);

      const recentRows = await this.repo.listSetRuns(workspaceId, agentId, {
        limit: EVAL_MAX_HISTORY_RUNS,
      });
      const completeRows = recentRows.filter((r) => r.status === 'complete');
      const lastRow = recentRows[0];

      let direction: 'up' | 'down' | 'flat' | null = null;
      let comparable = false;
      if (lastRow && lastRow.status === 'complete') {
        const previousRow = completeRows.find((r) => r.id !== lastRow.id);
        if (previousRow) {
          const cmp = comparisonOf(
            toEvalSetRunDto(previousRow, agent.name),
            toEvalSetRunDto(lastRow, agent.name),
            null,
            null,
          );
          comparable = cmp.attributability.attributable;
          if (comparable) {
            const before = passRate(previousRow);
            const after = passRate(lastRow);
            direction =
              before === null || after === null || after === before
                ? 'flat'
                : after > before
                  ? 'up'
                  : 'down';

            if (alert === null) {
              const [earlierEntries, laterEntries] = await Promise.all([
                this.caseComparisonEntries(workspaceId, previousRow.id),
                this.caseComparisonEntries(workspaceId, lastRow.id),
              ]);
              const note = derivedNote(cmp.metrics, earlierEntries, laterEntries);
              if (note) alert = `${agent.name}: ${note}`;
            }
          }
        }
      }

      agentsOut.push({
        agent_id: agentId,
        agent_name: agent.name,
        cases_total: count,
        never_run: recentRows.length === 0,
        last_run: lastRow ? toEvalSetRunDto(lastRow, agent.name) : null,
        direction,
        comparable,
      });
    }

    const recentSetRuns = await this.repo.listRecentSetRuns(workspaceId, {
      limit: EVAL_MAX_RECENT_RUNS,
    });
    const recentRuns: EvalSetRun[] = [];
    for (const row of recentSetRuns) {
      const name = namesById.get(row.agentId);
      recentRuns.push(toEvalSetRunDto(row, name ?? null));
    }

    return {
      owner_kind: null,
      owner_id: null,
      cases_total: agentsOut.reduce((n, a) => n + a.cases_total, 0),
      current: {
        recall: null,
        precision: null,
        citation_accuracy: null,
        traces_passed: 0,
        traces_total: 0,
        cost_usd: null,
      },
      delta: null,
      // Trends are per-agent (A13) — this aggregate field stays empty for the
      // cross-agent view; the real series is `trend()` / `GET
      // /agents/:id/eval-trend`, rendered on the agent's own Evals tab (AC-47).
      trend: [],
      recent_runs: recentRuns,
      agents: agentsOut,
      alert,
    };
  }

  /** Per-case identity + outcome for `helpers.ts#derivedNote` — the finding
   *  key is the first grounded finding's `file:start-end`, or null. */
  private async caseComparisonEntries(
    workspaceId: string,
    setRunId: string,
  ): Promise<EvalCaseComparisonEntry[]> {
    const rows = await this.repo.listCaseResults(workspaceId, setRunId);
    return rows.map((r) => {
      const review = r.actualOutput as {
        findings?: { file: string; start_line: number; end_line: number }[];
      } | null;
      const f = review?.findings?.[0];
      return {
        caseId: r.caseId,
        caseName: r.caseId,
        pass: r.pass,
        findingKey: f ? `${f.file}:${f.start_line}-${f.end_line}` : null,
      };
    });
  }
}

function passRate(row: EvalSetRunRow): number | null {
  return row.casesCovered === 0 ? null : row.casesPassed / row.casesCovered;
}
