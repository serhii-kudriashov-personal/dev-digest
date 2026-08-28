import { strFromU8, unzipSync } from 'fflate';
import { stringify as stringifyYaml } from 'yaml';
import {
  AgentManifest,
  CiResultArtifact,
  type CiFailOn,
  type CiInstallation,
  type CiRun,
  type CiRunStatus,
  type Provider,
  type ReviewStrategy,
  type WorkflowRunSummary,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import type { CiInstallationRow, CiRunWithRepo } from './repository.js';
import {
  CI_ARTIFACT_NAME,
  CI_MAX_UNPACKED_BYTES,
  CI_PR_CHECKLIST,
  CI_PR_TITLE,
  CI_RESULT_FILE,
  CI_RUNNER_PATH,
  CI_TRIGGER_EVENTS,
  PINNED_ACTIONS,
} from './constants.js';

/**
 * Pure generators for the exported CI bundle (SPEC-05). No `fs`, no DB, no
 * container, no `fetch` — every input is a parameter
 * (`backend-onion-architecture` §8). This file is covered by `no-sql-in-service`
 * and `no-http-below-the-edge` BECAUSE of its name — that is why generation
 * lives here and not in an invented `workflow.ts` (§13).
 *
 * Every operator-supplied string that ends up in a generated file an
 * unattended CI pipeline will execute is validated against an allowlist
 * FIRST (`parseRepoFullName`, `validateTriggers`) — never escaped ad hoc
 * (`security` §A05).
 */

const REPO_FULL_NAME_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Rejects anything that is not a plain "owner/name" GitHub reference. The
 *  value is operator-supplied and is interpolated into generated YAML and
 *  API calls, so this is the allowlist AC-16/AC-17 and `security` §A05 rest
 *  on. */
export function parseRepoFullName(repo: string): { owner: string; name: string } {
  if (!REPO_FULL_NAME_RE.test(repo)) {
    throw new ValidationError(
      `"${repo}" is not a valid "owner/name" GitHub repository reference.`,
    );
  }
  const [owner, name] = repo.split('/');
  return { owner: owner!, name: name! };
}

/** `[a-z0-9-]` manifest/skill-body filename stem. Never empty — an
 *  all-punctuation name still needs a usable file path. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'agent';
}

/** Non-empty subset of `CI_TRIGGER_EVENTS`, de-duplicated. This is the server
 *  half of AC-7; the wizard's "cannot deselect the last one" is the other
 *  half. Throws on empty or on any event this repo does not support. */
export function validateTriggers(triggers: string[]): string[] {
  const allowed = new Set<string>(CI_TRIGGER_EVENTS);
  const unique = Array.from(new Set(triggers));
  if (unique.length === 0) {
    throw new ValidationError('At least one pull-request trigger must be selected.');
  }
  const unknown = unique.filter((t) => !allowed.has(t));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown trigger(s): ${unknown.join(', ')}`);
  }
  return unique;
}

export interface AgentManifestSource {
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
  /** Slugs, in linked order — resolved to `.devdigest/skills/<slug>.md`. */
  skills: string[];
}

/**
 * `.devdigest/agents/<slug>.yaml` — validated against the SAME `AgentManifest`
 * schema `agent-runner/src/manifest.ts` validates on read, so the two ends
 * cannot drift (`eval-ci.ts:309-316`'s stated intent).
 */
export function buildAgentManifestYaml(input: AgentManifestSource): string {
  const manifest = AgentManifest.parse({
    name: input.name,
    provider: input.provider,
    model: input.model,
    system_prompt: input.systemPrompt,
    skills: input.skills,
    strategy: input.strategy,
    ci_fail_on: input.ciFailOn,
  });
  return stringifyYaml(manifest);
}

/** `.devdigest/memory.md` — inert and human-readable (Q4 → A). Nothing in
 *  `agent-runner` reads this file; it exists for a human in the target repo. */
export function buildMemoryMarkdown(entries: string[]): string {
  const lines = ['# DevDigest memory', ''];
  if (entries.length === 0) {
    lines.push(
      'No memory entries yet. DevDigest does not currently write to this file ' +
        'automatically — it is a place for the team to record notes for the review agent.',
    );
  } else {
    for (const entry of entries) lines.push(`- ${entry}`);
  }
  lines.push('');
  return lines.join('\n');
}

export interface WorkflowYamlInput {
  triggers: string[];
  postAs: 'github_review' | 'pr_comment' | 'none';
}

const SAME_REPO_GUARD = 'github.event.pull_request.head.repo.full_name == github.repository';
const FORKED_GUARD = 'github.event.pull_request.head.repo.full_name != github.repository';

/**
 * `.github/workflows/devdigest-review.yml`. This is where nearly the whole
 * security acceptance-criteria set lands:
 *  - AC-13: exactly two `permissions:` entries.
 *  - AC-14: `pull_request:`, never `pull_request_target`.
 *  - AC-15: the review and upload steps carry the same-repository guard; the
 *    fork branch only prints a skip reason, publishes nothing, uploads no
 *    artifact, and the job does not fail.
 *  - AC-12: the review step is a bare `run:`, never a `uses: devdigest/*`.
 *  - AC-18: every third-party `uses:` is `<action>@<40-char-sha> # v<version>`.
 *  - AC-10: `DEVDIGEST_POST_AS` is the runner's publish-mode env var.
 *  - AC-16/AC-17: every credential is a `${{ secrets.NAME }}` reference.
 */
export function buildWorkflowYaml(input: WorkflowYamlInput): string {
  const triggers = validateTriggers(input.triggers);
  const checkout = PINNED_ACTIONS['actions/checkout'];
  const uploadArtifact = PINNED_ACTIONS['actions/upload-artifact'];

  return `# Generated by DevDigest. Re-export the agent to regenerate — do not edit by hand.
name: DevDigest Review

on:
  pull_request:
    types: [${triggers.join(', ')}]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        if: \${{ ${SAME_REPO_GUARD} }}
        uses: actions/checkout@${checkout.sha} # ${checkout.version}

      - name: Skip forked pull request
        if: \${{ ${FORKED_GUARD} }}
        run: 'echo "DevDigest review skipped: this pull request comes from a fork and cannot access repository secrets."'

      - name: Run DevDigest review
        if: \${{ ${SAME_REPO_GUARD} }}
        run: node ${CI_RUNNER_PATH}
        env:
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          DEVDIGEST_POST_AS: ${input.postAs}

      - name: Upload review result
        if: \${{ always() && ${SAME_REPO_GUARD} }}
        uses: actions/upload-artifact@${uploadArtifact.sha} # ${uploadArtifact.version}
        with:
          name: ${CI_ARTIFACT_NAME}
          path: ${CI_RESULT_FILE}
`;
}

export interface PrBodyInput {
  triggers: string[];
}

/** The AC-21 checklist plus the runner bundle's provenance sentence. */
export function buildPrBody(input: PrBodyInput): string {
  const triggers = validateTriggers(input.triggers);
  const checklist = CI_PR_CHECKLIST.map((item) => `- [x] ${item}`).join('\n');
  return [
    `## ${CI_PR_TITLE}`,
    '',
    'This pull request was opened by DevDigest to install an automated review ' +
      `on pull-request events: ${triggers.join(', ')}.`,
    '',
    `The embedded runner (\`${CI_RUNNER_PATH}\`) is DevDigest's own agent-runner ` +
      'bundle, built and reviewed in the DevDigest repository — not a third-party action.',
    '',
    '### Checklist',
    '',
    checklist,
    '',
  ].join('\n');
}

/** Map a persisted `ci_installations` row to the public `CiInstallation` DTO. */
export function toInstallationDto(row: CiInstallationRow): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
  };
}

/** Map a persisted `ci_runs` row, joined with its installation's `repo`, to
 *  the public `CiRun` DTO — the CI Runs view's repository column. */
export function toRunDto(row: CiRunWithRepo): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.prNumber,
    ran_at: row.ranAt ? row.ranAt.toISOString() : null,
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    repo: row.repo,
  };
}

/**
 * Validate and parse a downloaded run artifact's raw zip bytes into a
 * `CiResultArtifact` (SPEC-05 AC-27). EVERY rejection path returns `null` —
 * never throws — so one malformed upload cannot abort a whole refresh
 * (`security` §A08/§A10: fail closed on a rejected artifact).
 *
 * `expected.prNumber` is GitHub's OWN attribution for the run — the first PR
 * number `WorkflowRunSummary.pullRequestNumbers` names, or `null`. The
 * repository half of AC-27's provenance cross-check is satisfied
 * STRUCTURALLY, not by field comparison: `CiResultArtifact` carries no repo
 * field, and this function is only ever called with bytes fetched THROUGH a
 * run id GitHub itself attributes to this installation's repository — a file
 * naming another repository can never reach this function. Only the PR
 * NUMBER is cross-checked here, against what GitHub reports for the run.
 */
export function parseResultArtifact(
  zipBytes: Uint8Array,
  expected: { prNumber: number | null },
): CiResultArtifact | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    return null;
  }

  // A zip bomb is small on the wire and huge once expanded — the guard has
  // to be on the DECOMPRESSED total, which the wire-size check cannot see
  // (`server/INSIGHTS.md` 2026-08-05).
  const unpacked = Object.values(entries).reduce((n, bytes) => n + bytes.byteLength, 0);
  if (unpacked > CI_MAX_UNPACKED_BYTES) return null;

  const resultBytes = entries[CI_RESULT_FILE];
  if (!resultBytes) return null;

  let json: unknown;
  try {
    json = JSON.parse(strFromU8(resultBytes));
  } catch {
    return null;
  }

  // `safeParse`, never `parse` — this file is written by a party DevDigest
  // does not control (`zod` `parse-use-safeparse`, `parse-never-trust-json`).
  const result = CiResultArtifact.safeParse(json);
  if (!result.success) return null;

  if (
    expected.prNumber !== null &&
    result.data.pr_number != null &&
    result.data.pr_number !== expected.prNumber
  ) {
    return null;
  }

  return result.data;
}

/** The shape `toRunRecord` maps a run (plus an optional accepted artifact)
 *  onto, ready to split across `CiRepository.upsertRun` (the initial record)
 *  and `CiRepository.updateRunResult` (the result fields). */
export interface RunRecord {
  githubUrl: string;
  prNumber: number | null;
  ranAt: Date | null;
  status: CiRunStatus;
  source: 'ci';
  findingsCount: number | null;
  costUsd: number | null;
}

/**
 * Maps ONE GitHub-reported run, plus an optional ACCEPTED artifact, to the
 * persisted `ci_runs` shape (SPEC-05 AC-26/AC-28/AC-29/AC-30).
 *
 *  - `githubUrl` is ALWAYS `run.htmlUrl` — GitHub's own description of the
 *    run — never read from the artifact, even when one is present (AC-26).
 *  - With no accepted artifact, the run has no result yet: `findingsCount`
 *    and `costUsd` stay `null`, and `status` is `'running'` while the run
 *    has not completed, `'failed'` once it has (AC-28).
 *  - With an accepted artifact, a ZERO-finding run is `'no_findings'` — a
 *    SUCCESS, never `'failed'` and never left resultless (AC-29).
 *  - `costUsd` is copied from the artifact VERBATIM, including `null` — it
 *    is never coerced to `0` (AC-30; root `INSIGHTS.md` 2026-08-02).
 */
export function toRunRecord(
  run: WorkflowRunSummary,
  artifact: CiResultArtifact | null,
): RunRecord {
  const base = {
    githubUrl: run.htmlUrl,
    prNumber: run.pullRequestNumbers[0] ?? null,
    ranAt: new Date(run.createdAt),
    source: 'ci' as const,
  };
  if (!artifact) {
    return {
      ...base,
      status: run.status === 'completed' ? 'failed' : 'running',
      findingsCount: null,
      costUsd: null,
    };
  }
  return {
    ...base,
    status: artifact.findings_count === 0 ? 'no_findings' : 'succeeded',
    findingsCount: artifact.findings_count,
    costUsd: artifact.cost_usd,
  };
}
