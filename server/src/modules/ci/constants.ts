/**
 * CI slice literals (SPEC-05) — branch/path conventions, triggers, caps and the
 * pinned third-party action SHAs. `constants.ts` is the slice's PUBLIC surface
 * (`backend-onion-architecture` §13): another slice may import these directly.
 *
 * Every path below MUST agree with what `agent-runner` reads at CI time
 * (`agent-runner/src/manifest.ts`, `skills.ts`, `run.ts`) — the two ends never
 * share a contract for the paths themselves, only for the file contents
 * (`AgentManifest`, `CiResultArtifact`).
 */

/** The dedicated branch every export commits to. Never the base branch (AC-19). */
export const CI_BRANCH = 'devdigest/ci';
/** Default base branch offered in the wizard's install step. */
export const CI_DEFAULT_BASE = 'main';

/** Generated GitHub Actions workflow file. */
export const CI_WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';
/** Basename of `CI_WORKFLOW_PATH` — the GitHub Actions API's `workflow_id`
 *  parameter accepts either form, but the runs list only needs the file
 *  name. Derived from the constant above rather than duplicated so the two
 *  can never drift. */
export const CI_WORKFLOW_FILE = CI_WORKFLOW_PATH.split('/').pop()!;
/** ncc-bundled runner, embedded verbatim (Recommendation 2 declined). */
export const CI_RUNNER_PATH = '.devdigest/runner/index.js';
/** One manifest file per exported agent — `agent-runner/src/manifest.ts` finds
 *  the single file under this directory. */
export const CI_AGENTS_DIR = '.devdigest/agents';
/** One body file per linked skill, named by slug — `agent-runner/src/skills.ts`. */
export const CI_SKILLS_DIR = '.devdigest/skills';
/** Inert, human-readable memory file (Q4 → A). No runner-side consumer. */
export const CI_MEMORY_PATH = '.devdigest/memory.md';

/** Name GitHub Actions stores the uploaded result artifact under. */
export const CI_ARTIFACT_NAME = 'devdigest-result';
/** Filename `agent-runner/src/index.ts` writes inside the artifact. */
export const CI_RESULT_FILE = 'devdigest-result.json';

/** The three PR-lifecycle events the workflow may trigger on (AC-6). */
export const CI_TRIGGER_EVENTS = ['opened', 'synchronize', 'reopened'] as const;
export type CiTriggerEvent = (typeof CI_TRIGGER_EVENTS)[number];

/** NFR-2 — at most this many runs fetched per installation per refresh. */
export const CI_MAX_RUNS_PER_REFRESH = 20;
/** NFR-1 — the whole install (commit + PR) must resolve within this bound. */
export const CI_INSTALL_TIMEOUT_MS = 60_000;
/** Zip-bomb guard on a downloaded result artifact's DECOMPRESSED total — the
 *  wire-size check cannot see expansion (`server/INSIGHTS.md` 2026-08-05),
 *  mirroring `modules/skills/constants.ts`'s `MAX_UNPACKED_BYTES`. A result
 *  artifact is a small JSON file, so the cap is far tighter than skills'. */
export const CI_MAX_UNPACKED_BYTES = 512 * 1024;
/** Generous ceiling on `GET /ci-runs` — v1 has no pagination or filtering
 *  (§Not in scope), so this is a sanity cap, not a page size. */
export const CI_RUNS_LIST_LIMIT = 200;

/**
 * Third-party GitHub Actions pinned to a full 40-character commit SHA (AC-18).
 * Resolved for real via
 * `gh api repos/<action>/git/refs/tags/<version> --jq '.object.sha'`
 * (dereferencing an annotated tag if the response names one) — never a
 * placeholder, which fails AC-18 outright.
 */
export const PINNED_ACTIONS = Object.freeze({
  'actions/checkout': { sha: '11d5960a326750d5838078e36cf38b85af677262', version: 'v4' },
  'actions/upload-artifact': { sha: 'ea165f8d65b6e75b540449e92b4886f43607fa02', version: 'v4' },
}) satisfies Record<string, { sha: string; version: string }>;

export const CI_PR_TITLE = 'Add DevDigest CI review';

/** AC-21's five fixed checklist items, rendered into the PR body. */
export const CI_PR_CHECKLIST = [
  'Grants only the minimum permissions the review step needs (`contents: read`, `pull-requests: write`).',
  'Runs only on the configured pull-request triggers — never on `pull_request_target`.',
  'Contains no secret values in any generated file; every credential is a `${{ secrets.NAME }}` reference.',
  'Embeds a runner bundle built and reviewed as part of this repository, not a third-party action.',
  'Uses the non-privileged `pull_request` trigger, so a fork PR runs with read-only, no-secret permissions.',
] as const;
