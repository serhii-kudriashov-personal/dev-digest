import { readFile } from 'node:fs/promises';
import type {
  CiExport,
  CiExportInput,
  CiFailOn,
  CiFile,
  CiInstallation,
  CiRun,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import {
  ConfigError,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from '../../platform/errors.js';
import { TimeoutError, withTimeout } from '../../platform/resilience.js';
import { CiRepository } from './repository.js';
import {
  buildAgentManifestYaml,
  buildMemoryMarkdown,
  buildPrBody,
  buildWorkflowYaml,
  parseRepoFullName,
  parseResultArtifact,
  slugify,
  toInstallationDto,
  toRunDto,
  toRunRecord,
} from './helpers.js';
import {
  CI_AGENTS_DIR,
  CI_ARTIFACT_NAME,
  CI_BRANCH,
  CI_INSTALL_TIMEOUT_MS,
  CI_MAX_RUNS_PER_REFRESH,
  CI_MEMORY_PATH,
  CI_PR_TITLE,
  CI_RUNNER_PATH,
  CI_RUNS_LIST_LIMIT,
  CI_SKILLS_DIR,
  CI_WORKFLOW_FILE,
  CI_WORKFLOW_PATH,
} from './constants.js';

/** Minimal structured logger (pino-compatible), same shape `eval/service.ts`
 *  uses — declared locally rather than imported so `ci` never reaches into
 *  another slice's private `service.ts` (`no-cross-slice-import`). */
export type Logger = {
  warn: (obj: unknown, msg?: string) => void;
};

/**
 * CI slice application logic (SPEC-05) — export preview and install.
 *
 * Reads `container.config`, `container.agentsRepo` (the sanctioned cross-slice
 * channel — `server/INSIGHTS.md` 2026-08-17) and `await container.github()`.
 * Constructs its OWN `CiRepository(container.db)` and never reads
 * `container.db` for a query of its own (`backend-onion-architecture` §4).
 */
export class CiService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  /**
   * Refuse an export whose target repository does not live on GitHub
   * (SPEC-06 — AC-48).
   *
   * Called FIRST by both entry points, before a single file is generated and
   * long before anything is committed: the only supported CI target is GitHub
   * Actions, so a GitLab-resolved repository has nowhere for the generated
   * workflow to run. The refusal is a thrown `AppError`, never a hand-crafted
   * `reply.code` — the envelope and the logging both hang off that
   * (`backend-onion-architecture` §6).
   *
   * A repository the workspace has NOT imported is left alone rather than
   * refused: this gate exists to catch a positively-resolved non-GitHub
   * provider, and refusing on "unknown" would break exporting to a repository
   * that was never imported into DevDigest in the first place.
   */
  private async assertGitHubTarget(workspaceId: string, input: CiExportInput): Promise<void> {
    const target = await this.repo.findTargetRepo(
      workspaceId,
      input.repo,
      input.instance_id ?? null,
    );
    if (!target || target.provider === 'github') return;
    throw new ValidationError(
      `Export to CI targets GitHub Actions, and "${input.repo}" lives on ` +
        `${target.instanceLabel} (${target.provider}). Nothing was generated and nothing ` +
        `was committed.`,
    );
  }

  /**
   * Generate every file the export would write, without any GitHub
   * side-effect. Every file carries its full `contents` (Recommendation 2
   * declined) and `editable: false` on the runner bundle only.
   */
  async buildBundle(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiFile[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const linkedSkills = await this.container.agentsRepo.linkedSkills(agentId);
    const skillSlugs = linkedSkills.map((link) => slugify(link.skill.name));

    let runnerSource: string;
    try {
      runnerSource = await readFile(this.container.config.runnerBundlePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ConfigError(
          `Runner bundle not found at ${this.container.config.runnerBundlePath}. Build it with ` +
            "'cd agent-runner && pnpm install && pnpm build' (server/AGENTS.md).",
        );
      }
      throw err;
    }

    const manifestYaml = buildAgentManifestYaml({
      name: agent.name,
      provider: agent.provider as Provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      strategy: agent.strategy as ReviewStrategy,
      ciFailOn: agent.ciFailOn as CiFailOn,
      skills: skillSlugs,
    });

    const workflowYaml = buildWorkflowYaml({ triggers: input.triggers, postAs: input.post_as });

    const files: CiFile[] = [
      { path: `${CI_AGENTS_DIR}/${slugify(agent.name)}.yaml`, contents: manifestYaml, editable: true },
      ...linkedSkills.map((link) => ({
        path: `${CI_SKILLS_DIR}/${slugify(link.skill.name)}.md`,
        contents: link.skill.body,
        editable: true,
      })),
      { path: CI_MEMORY_PATH, contents: buildMemoryMarkdown([]), editable: true },
      { path: CI_WORKFLOW_PATH, contents: workflowYaml, editable: true },
      { path: CI_RUNNER_PATH, contents: runnerSource, editable: false },
    ];
    return files;
  }

  /**
   * `action: 'files'` — the preview. No GitHub call, no installation written.
   * `installation` still has to satisfy the `CiExport` contract (it has no
   * nullable variant, per the plan's Q2/Recommendation answers), so it is
   * synthesised with an empty id rather than a persisted row.
   */
  async preview(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    await this.assertGitHubTarget(workspaceId, input);
    const files = await this.buildBundle(workspaceId, agentId, input);
    return {
      installation: {
        id: '',
        agent_id: agentId,
        repo: input.repo,
        target_type: input.target,
        installed_at: new Date().toISOString(),
      },
      files,
      pr_url: null,
    };
  }

  /**
   * `action: 'open_pr'` — commit the bundle to `CI_BRANCH`, open (or reuse) a
   * PR against `input.base`, and only THEN record the installation (AC-23:
   * any throw above leaves no row). Bounded by NFR-1's 60s budget.
   */
  async install(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    // Outside `withTimeout`, and before `doInstall`: the refusal is a cheap
    // local read and must not be able to surface as a timeout (AC-48).
    await this.assertGitHubTarget(workspaceId, input);
    try {
      return await withTimeout(
        this.doInstall(workspaceId, agentId, input),
        CI_INSTALL_TIMEOUT_MS,
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new ExternalServiceError(
          `Installing to the "${CI_BRANCH}" branch did not complete within the time limit; ` +
            `check that branch on the target repository directly.`,
        );
      }
      throw err;
    }
  }

  private async doInstall(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiExport> {
    const files = await this.buildBundle(workspaceId, agentId, input);
    const repoRef = parseRepoFullName(input.repo);
    const github = await this.container.github();

    // Never a commit to the base branch (AC-19) — always the dedicated branch.
    await github.commitFiles(repoRef, {
      branch: CI_BRANCH,
      base: input.base,
      message: CI_PR_TITLE,
      files: files.map((f) => ({ path: f.path, contents: f.contents })),
    });

    const existingPr = await github.findOpenPr(repoRef, CI_BRANCH);
    const prUrl = existingPr
      ? existingPr.url
      : (
          await github.openPullRequest(repoRef, {
            title: CI_PR_TITLE,
            head: CI_BRANCH,
            base: input.base,
            body: buildPrBody({ triggers: input.triggers }),
          })
        ).url;

    // Only after both the commit and the PR step succeed (AC-23).
    const installationRow = await this.repo.upsertInstallation(workspaceId, {
      agentId,
      repo: input.repo,
      targetType: input.target,
    });

    return { installation: toInstallationDto(installationRow), files, pr_url: prUrl };
  }

  /**
   * Pull recent GitHub Actions runs for every installation in the workspace
   * and ingest any accepted result artifact (AC-25). A per-installation
   * `try`/`catch` means one unreachable repository cannot abort the whole
   * refresh, and that installation's previously recorded runs stay visible
   * (NFR-5). `ConfigError` from `container.github()` is a normal path here,
   * not a 500 (`backend-onion-architecture` §4).
   */
  async refresh(workspaceId: string, logger?: Logger): Promise<{ ingested: number }> {
    const github = await this.container.github();
    const installations = await this.repo.listInstallationsForWorkspace(workspaceId);
    let ingested = 0;

    for (const installation of installations) {
      try {
        const repoRef = parseRepoFullName(installation.repo);
        const runs = await github.listWorkflowRuns(repoRef, {
          workflowFile: CI_WORKFLOW_FILE,
          perPage: CI_MAX_RUNS_PER_REFRESH, // NFR-2
        });

        for (const run of runs) {
          // The unique index can't dedupe against multiple NULLs
          // (`postgresql-table-design` §Constraints).
          if (!run.htmlUrl) continue;

          const record = toRunRecord(run, null);
          const row = await this.repo.upsertRun(workspaceId, {
            ciInstallationId: installation.id,
            prNumber: record.prNumber,
            ranAt: record.ranAt,
            status: record.status,
            githubUrl: record.githubUrl,
            source: record.source,
          });
          ingested += 1;

          // Already carries a result — nothing left to ingest for this run.
          if (row.findingsCount !== null) continue;

          const zip = await github.downloadRunArtifact(repoRef, run.id, CI_ARTIFACT_NAME);
          if (!zip) continue;

          // Fail closed on a rejected artifact (`security` §A08/§A10) — a
          // `null` here leaves the run recorded with no result, never a
          // trusted guess.
          const artifact = parseResultArtifact(zip, {
            prNumber: run.pullRequestNumbers[0] ?? null,
          });
          if (!artifact) continue;

          const withResult = toRunRecord(run, artifact);
          await this.repo.updateRunResult(workspaceId, row.id, {
            status: withResult.status,
            findingsCount: withResult.findingsCount,
            costUsd: withResult.costUsd,
          });
        }
      } catch (err) {
        logger?.warn(
          { err, installationId: installation.id, repo: installation.repo },
          'CI refresh failed for one installation',
        );
      }
    }

    return { ingested };
  }

  /** Every run in the workspace, newest first — no pagination in v1. */
  async listRuns(workspaceId: string): Promise<CiRun[]> {
    const rows = await this.repo.listRunsForWorkspace(workspaceId, CI_RUNS_LIST_LIMIT);
    return rows.map(toRunDto);
  }

  /** An agent's own installations (AC-33). */
  async listInstallations(workspaceId: string, agentId: string): Promise<CiInstallation[]> {
    const rows = await this.repo.listInstallationsForAgent(workspaceId, agentId);
    return rows.map(toInstallationDto);
  }
}
