# Export to CI — implementation plan

## Task
Build SPEC-05 v1: a 4-step "Export to CI" wizard that generates an agent bundle
(manifest, skill bodies, memory file, GitHub Actions workflow, runner bundle) and
opens a pull request on a dedicated `devdigest/ci` branch in a target repository,
plus a CI Runs page and an agent-level CI tab that pull workflow runs and result
artifacts from GitHub on refresh.

## Requirements source
`specs/2026-08-24-export-to-ci.md` (SPEC-05, status `draft`) — §Goals (four
outcomes), AC-1…AC-33, NFR-1…NFR-8, and §Not in scope for v1. This plan
implements those requirements and does not define or amend them. Where this plan
records a requirement gap, it is under `## Risks & open questions`, never
resolved silently.

**§Not in scope for v1 is binding.** Nothing in this plan builds staleness
badges, bulk update, "Active in N repos", byte-size display or caps, live secret
badges, a zip install path, a three-way run-state distinction, per-cause error
screens, extra empty states, focus management, pagination/filtering/auto-refresh,
installation removal, a bespoke step rail, non-GitHub CI targets, or a push-based
ingest channel.

## Answers taken
Caller resolved all five intake questions and all three recommendations on
2026-08-24. Guiding principle stated by the caller: **keep v1 as simple as
possible; where a choice trades runtime elegance for less code, take the simpler
one.**

- **Q1 runner bundle → A.** The server reads `agent-runner/dist/index.js` from
  disk via a new `AppConfig.runnerBundlePath`, and throws `ConfigError` (surfaced
  through AC-5's error state) when it is absent. `cd agent-runner && pnpm install
  && pnpm build` is a stated prerequisite. No commit of a built blob, no change
  to root `.gitignore`.
- **Q2 AC-26 commit → B.** No `head_sha` column and **no contract change in
  either `vendor/shared/contracts` copy**. AC-26 is satisfied as an attribution
  rule: repo from the installation, job link from GitHub's own run description,
  never from the artifact.
- **Q3 dedupe → A.** One migration: `UNIQUE (agent_id, repo)` on
  `ci_installations`, `UNIQUE (ci_installation_id, github_url)` on `ci_runs`,
  plus `INDEX (ci_installation_id, ran_at DESC)`.
- **Q4 memory file → A.** Generate an inert, human-readable `.devdigest/memory.md`
  with empty-state text. No runner-side consumer is invented.
- **Q5 YAML → A.** Add `yaml@^2.6.1` to `server/package.json`, matching the
  version `agent-runner` already pins.
- **Recommendation 1 — adopted.** Generation lives in `modules/ci/helpers.ts`,
  never `workflow.ts`. `agent-runner/**` is not edited to fix its two stale
  references.
- **Recommendation 2 — declined.** `CiFile.contents` carries the full bytes for
  every file including the runner bundle, literally per AC-3. No special-casing.
- **Recommendation 3 — adopted.** Package gates are run directly; the implementer
  does not run `./scripts/pr-self-review.sh`.

**Mode chosen: multi-agent, exactly five `implementer` dispatches.** The
five-dispatch ceiling is a hard constraint from the user, not a preference. See
`## Execution` for the mapping and for the two merges made to fit it.

## Context read

- Root `INSIGHTS.md` (2026-08-06, "`pr-self-review` cannot gate a PR built in a
  secondary git worktree") — `git worktree list` confirms this tree
  (`emdash/export-to-ci-pnakp`) is secondary. Every gate is run per package;
  `./scripts/pr-self-review.sh` is not run at all.
- Root `INSIGHTS.md` (2026-08-02, "Unknown cost is `null`, never `0`") — binds
  AC-30 on both the server (`ci_runs.cost_usd` stays `NULL`) and the client (the
  cost cell renders a placeholder, never `0`).
- Root `INSIGHTS.md` (2026-08-19, "'Zero consumers, safe to edit' proves the edit
  is SAFE, not that the field's existing shape fits the new consumer") — this is
  exactly why the unwritten `ci_*` tables still needed the constraint audit that
  produced Q3.
- Root `INSIGHTS.md` (2026-08-18, "Unwired scaffolding's copy doesn't just go
  stale, it actively disagrees with the current design") — `client/messages/en/ci.json`
  is rewritten against the spec, not re-derived from.
- Root `INSIGHTS.md` (2026-08-05, "A lesson feature is mostly already
  scaffolded") — the inventory below is the whole reason this plan is five
  dispatches and not ten.
- Root `INSIGHTS.md` (2026-08-02, "`diff -r` is the wrong check for the two
  `vendor/shared` copies") — the two `adapters.ts` copies already carry documented
  drift; `./scripts/check-shared-sync.sh` is the check, and `--update` must not be
  run.
- `server/INSIGHTS.md` (2026-08-05, "A base64 upload route needs its OWN
  `bodyLimit`") — read for the *second* half of its lesson: a compressed archive
  needs a cap on its **decompressed** total, because the wire-size check cannot
  see expansion. This binds Step 3.4's artifact unzip.
- `server/INSIGHTS.md` (2026-08-17, "A slice's `constants.ts` export is a
  sanctioned cross-slice import; a slice's pure helper function is not") — the CI
  slice reaches agent data through `container.agentsRepo`, never through
  `modules/agents/repository.ts`.
- `server/INSIGHTS.md` (2026-08-05, "`db:generate` goes INTERACTIVE when one
  migration both drops and adds a column") — this migration is additive only, so
  the trap does not fire; recorded so the implementer does not expect a prompt.
- `server/INSIGHTS.md` (2026-08-02, "`octokit` and `p-queue` are UNRESOLVABLE to
  dependency-cruiser") — read and rejected as non-binding: Step 1.3 adds methods
  to an existing `octokit`-importing adapter, introducing no new rule.
- `client/INSIGHTS.md` (2026-08-16, "A new screen does not appear in the left
  panel until it has a row in the vendored `NAV` array") — the spec cites this for
  AC-32 and it is exact. It also rules explicitly that adding a `NAV` row is
  *config, not a refactor of vendored code*, which is what makes Step 5.4 legal
  under `CLAUDE.md` §Do not touch.
- `client/INSIGHTS.md` (2026-08-16, "A duplicated `VALID_TABS` swallows every new
  tab") — read and **already fixed**: `AgentEditorView/constants.ts:11` now derives
  `VALID_TABS` from `TABS`, so adding one row is enough. Recorded so the
  implementer does not add a second array.
- `client/INSIGHTS.md` (2026-08-09, "A `retry: false` query for a resource that
  does not exist YET caches the 404 forever") — binds Step 4.2 and Step 5.3: the
  CI hooks must not carry `retry: false`, and the refresh mutation must invalidate
  the runs key.
- `client/INSIGHTS.md` (2026-08-08, "`@testing-library/user-event` is NOT
  installed here, so every interactive test uses `fireEvent`") — **contradicts**
  the vendored `react-testing-library` skill, which mandates `userEvent`. The repo
  insight wins; `test-writer` uses `fireEvent`.
- `client/INSIGHTS.md` (2026-08-05, "`IconName` is the vendored REGISTRY's key
  set, not lucide's export list") — `Workflow` and `GitBranch` are both in
  `client/src/vendor/ui/icons.tsx:79,45`, so `Workflow` is safe for both the tab
  and the nav row.
- `client/INSIGHTS.md` (2026-08-03, "A `'use client'` page becomes a server
  wrapper with NO Suspense") — binds Step 5.2's route shape.
- `CLAUDE.md` §Repo rules, §Do not touch; `specs/2026-08-24-export-to-ci.md`;
  `agent-runner/README.md` §Runtime environment; `agent-runner/insights/INSIGHTS.md`
  (2026-07-08, `DEVDIGEST_POST_AS` has no producer) — the gap AC-10 closes.

## Inventory — what already exists

| Thing | Where | Verdict |
|---|---|---|
| `CiTarget`, `CiFile`, `AgentManifest`, `CiExportInput`, `CiInstallation`, `CiExport`, `CiRunStatus`, `CiRun`, `CiResultArtifact` | `server/src/vendor/shared/contracts/eval-ci.ts:298-404` | **reuse unchanged** — no contract edit anywhere in this plan |
| `ci_installations`, `ci_runs` tables | `server/src/db/schema/ci.ts:4-26`; DDL at `server/src/db/migrations/0000_init.sql:49-67` | **extend** — columns are right; both lack every constraint and index this feature needs |
| `agent_runs.source` (`'local' \| 'ci'`, default `local`) | `server/src/db/schema/runs.ts:44` | **reuse, not written** — writing it would touch the reviews slice (out of scope) |
| `agents.ci_fail_on` (`never\|critical\|warning\|any`, default `critical`) | `server/src/db/schema/agents.ts:25` | reuse — read into the manifest |
| `GitHubClient.commitFiles` / `findOpenPr` / `openPullRequest` | `server/src/vendor/shared/adapters.ts:168-176`; impl `server/src/adapters/github/octokit.ts:245,264,332` | reuse — `commitFiles` is documented idempotent (create-or-fast-forward), which is what AC-20 needs |
| `GitHubClient` Actions capability (list workflow runs, download an artifact) | — | **new**. `rg -n 'workflow_runs\|listWorkflowRuns\|artifact' server/src/adapters/github/octokit.ts server/src/vendor/shared/adapters.ts` returns nothing |
| `container.github()` (async, secret-backed, `ConfigError` on missing token) | `server/src/platform/container.ts:218-224` | reuse |
| `container.agentsRepo.getById()` / `.linkedSkills()` (returns the full `skills` row incl. `body`) | `server/src/platform/container.ts:111`; `server/src/modules/agents/repository.ts:65,192` | reuse — the sanctioned cross-slice channel |
| `MockGitHubClient` | `server/src/adapters/mocks.ts:135` | **extend** — must `implements` the two new methods or ring 2 becomes untestable |
| `fflate` (`unzipSync`) + a `MAX_UNPACKED_BYTES` zip-bomb guard | `server/package.json:34`; working precedent `server/src/modules/skills/helpers.ts:75-88`, `skills/constants.ts:26` | reuse — **no new dependency for the artifact unzip** |
| A YAML serializer in `server/` | — | **new**. `rg '"yaml"' server/package.json` returns nothing; `agent-runner` pins `yaml@^2.6.1` |
| `AppConfig.runnerBundlePath` | — | **new**. `server/src/platform/config.ts:42-79` has no runner-related field |
| `agent-runner/dist/index.js` | — | **absent and untracked**. `git ls-files agent-runner` returns 21 files, none under `dist/`; `agent-runner/.gitignore:2` ignores `dist/` and, being deeper, overrides root `.gitignore:5`'s `!agent-runner/dist/` |
| `server/src/modules/ci/` | — | **new**. Not in `server/src/modules/index.ts:32-48` |
| `getContext(container, req)` (workspace/user resolution), `IdParams` | `server/src/modules/_shared/context.ts:15`, `_shared/schemas.ts` | reuse |
| `withRetry` / `withTimeout` | `server/src/platform/resilience.ts` (used at `adapters/github/octokit.ts:15`) | reuse — NFR-1's 60 s bound |
| `client/src/vendor/ui/ExportWizardSteps.tsx` (numbered + labelled step rail) | `client/src/vendor/ui/ExportWizardSteps.tsx`, exported from `client/src/vendor/ui/index.ts` | **reuse as-is** — AC-11 is satisfied by reuse; vendored, no refactor |
| `client/messages/en/ci.json` | `client/messages/en/ci.json` | **rewrite** — ships four live target tiles (contradicts AC-1), a `publishDialog` namespace for the superseded single-dialog design, and `blockMergeDesc: "Requires a GitHub App…"` (contradicts AC-9) |
| `nav["ci-runs"]: "CI Runs"` label | `client/messages/en/shell.json:28` | reuse — already present |
| `activeKeyFor` → `"ci-runs"` for `/ci-runs` | `client/src/components/app-shell/helpers.ts:39` | reuse — already present |
| The `NAV` row for `ci-runs` | — | **new**. `client/src/vendor/ui/nav.ts:22-38` has `pulls`, `context`, `skills`, `agents`, `conventions`, `eval` and nothing else |
| `/ci-runs` route | — | **new**. `find client/src/app -maxdepth 3 -type d` lists no `ci-runs` |
| `editor.tabs.ci: "CI"` label | `client/messages/en/agents.json:52` | reuse — already present |
| The `ci` row in the agent editor's `TABS` | — | **new**. `client/src/app/agents/[id]/_components/AgentEditor/constants.ts:11-16` has four rows and a comment reading "Stats/CI arrive in later lessons" |
| `VALID_TABS` derived from `TABS` | `client/src/app/agents/[id]/_components/AgentEditorView/constants.ts:11` | reuse — the 2026-08-16 duplication bug is already fixed |
| `Workflow` / `GitBranch` in the icon registry | `client/src/vendor/ui/icons.tsx:79,45` | reuse |
| `apiFetch` / `api` client, `lib/hooks/*` domain files + barrel | `client/src/lib/api.ts:21`, `client/src/lib/hooks/index.ts` | reuse — a new `ci.ts` domain file plus one barrel line |

## Constraints that bind

| Rule | Applies? | What the implementation must do |
|---|---|---|
| `@devdigest/shared` exists twice | **yes** | `server/src/vendor/shared/adapters.ts` is canon; `client/src/vendor/shared/adapters.ts` is the manual copy. The `GitHubClient` additions land in **both, in Step 1.1, same step**. Adding identical text to both leaves the recorded drift unchanged, so `./scripts/check-shared-sync.sh` must pass **without** `--update`. Never run `--update`. No `contracts/**` file is touched anywhere in this plan. |
| a field on a **jsonb-persisted** contract | **no** | No Zod contract changes at all (Q2 answer). `ci_runs` has no jsonb column. |
| a DB-backed test | **yes** | Repository tests go in `server/test/ci.it.test.ts`. The `.it.test.ts` suffix is the CI split (`TESTING.md`); a DB test named otherwise breaks the lanes silently. Also: read the **test count**, not the exit code — `N skipped` on an `.it.test.ts` file means unverified (`backend-onion-architecture` §9). |
| a migration | **yes** | Exactly one, additive: generated with `cd server && pnpm db:generate`, applied by hand with `cd server && pnpm db:migrate`. Never on boot. The 18 existing files in `server/src/db/migrations/` are never edited. Additive-only, so the interactive-prompt trap (`server/INSIGHTS.md` 2026-08-05) does not fire. |
| ring / import direction | **yes** | New slice `modules/ci/` uses only manifest filenames (`constants`, `helpers`, `repository`, `service`, `routes`) — see §13 below. Enforced by `cd server && pnpm arch`, which root `INSIGHTS.md` (2026-08-02) records as **not wired into CI**, so the implementer runs it by hand every dispatch that touches `server/`. |
| slice file manifest (`backend-onion-architecture` §13) | **yes** | **No `workflow.ts`.** Every `modules/` gate rule selects files by *name*; an invented name is outside every rule and `pnpm arch` stays green while the file does whatever it likes (§12's `settings/feature-models.ts` is the live proof). Generation goes in `helpers.ts`. |
| a slice is dead until `modules/index.ts` names it | **yes** | `modules/ci/routes.ts` plus one import and one entry in `server/src/modules/index.ts` — **same dispatch** (Step 2.5). Nothing fails on the way: typecheck passes, `pnpm arch` passes, every endpoint 404s. |
| `reviewer-core` | **no** | Not touched. §Non-goals forbids changing `reviewer-core`, the grounding gate, or `agent-runner`'s pipeline. |
| new file placement in `client/` | **yes** | Wizard and CI tab are single-route components → `src/app/agents/[id]/_components/<Name>/`. CI Runs is a route → `src/app/ci-runs/page.tsx` + `_components/CiRunsView/`. Data fetching only in `src/lib/hooks/ci.ts`. Nothing is promoted to `src/components/` — every new component has exactly one consumer (`frontend-ui-architecture` §1, §2). |
| a secret | **yes** | The GitHub token DevDigest uses comes only from `container.github()`, which reads `SecretsProvider`. `OPENROUTER_API_KEY` is **named, never read** — no code path in this plan resolves, stores, transmits or displays its value. No generated file contains a literal credential; every credential in the workflow is a `${{ secrets.NAME }}` reference (AC-8, AC-16, AC-17). The runner's own `process.env` reads are outside this repo's `SecretsProvider` chokepoint by design (`agent-runner/CLAUDE.md`) and are not changed. |
| any `CLAUDE.md` / `AGENTS.md` | **yes, one file** | The prerequisite note goes in `server/AGENTS.md` §Read when (Step 1.6). Edit `AGENTS.md`; `CLAUDE.md` stays a symlink, mode `120000`. |
| empty tables reserved for later lessons | **yes** | `ci_installations` and `ci_runs` are exactly such tables and are now being filled — that is the feature. `eval_*`, `memory`, `digests`, `onboarding` are not touched, not dropped, not "cleaned up". |
| a new rule in an agent `system_prompt` | **no** | No agent prompt is edited. |
| worktree scope fence (caller's constraint) | **yes** | Nothing in this plan touches `server/src/modules/reviews/**`, `server/src/modules/pulls/**`, `server/src/modules/polling/**`, or `client/src/app/repos/[repoId]/pulls/**`. `git worktree list` confirms a sibling worktree `emdash/multi-agents-review-jhnh3` owns those. Verified: no step needs them. |

## Modules touched

| Package | Path | Ring / layer | Why |
|---|---|---|---|
| server | `src/vendor/shared/adapters.ts` | 0 — ports | `GitHubClient` gains the two Actions capabilities AC-25…AC-27 need |
| client | `src/vendor/shared/adapters.ts` | 0 — manual copy | Same edit, same step (repo rule) |
| server | `src/adapters/github/octokit.ts` | 3 — infrastructure | Octokit implementation of the two new methods |
| server | `src/adapters/mocks.ts` | 3 (test seam) | `MockGitHubClient` must `implements` the widened interface |
| server | `src/db/schema/ci.ts` | 3 — data | Unique constraints + list index |
| server | `src/db/migrations/0019_*.sql` | 3 — data | Generated, never hand-edited |
| server | `src/platform/config.ts` | 4 — composition root | `runnerBundlePath` |
| server | `src/modules/ci/constants.ts` | 2 — public literals | Branch, paths, pinned action SHAs, triggers, caps, PR checklist |
| server | `src/modules/ci/helpers.ts` | 2 — pure transforms | Workflow / manifest / memory generation, artifact validation |
| server | `src/modules/ci/service.ts` | 2 — application | Export, install, refresh orchestration |
| server | `src/modules/ci/repository.ts` | 3 — SQL | All `ci_installations` / `ci_runs` queries, workspace-scoped |
| server | `src/modules/ci/routes.ts` | 5 — edge | HTTP + Zod only |
| server | `src/modules/index.ts` | 5 — registry | One import, one entry |
| server | `package.json`, `server/AGENTS.md` | — | `yaml@^2.6.1`; the build prerequisite |
| client | `messages/en/ci.json` | — | Full rewrite against SPEC-05 |
| client | `src/lib/hooks/ci.ts`, `src/lib/hooks/index.ts` | data layer | The only place the client talks to the API |
| client | `src/app/agents/[id]/_components/ExportToCiWizard/**` | route-local | The 4-step wizard |
| client | `src/app/agents/[id]/_components/CiTab/**` | route-local | AC-22, AC-24, AC-33 |
| client | `src/app/agents/[id]/_components/AgentEditor/constants.ts` | route-local | One `TABS` row |
| client | `src/app/ci-runs/page.tsx`, `_components/CiRunsView/**` | route | AC-28…AC-32 |
| client | `src/vendor/ui/nav.ts` | vendored **route/shortcut config** | One `NAV` row + one `SHORTCUTS` row. Explicitly sanctioned by `client/INSIGHTS.md` 2026-08-16: "adding the row is config, not a refactor of vendored code" |

## Skills — read by the planner, to be loaded by the executor

Every row below is a skill the planner actually opened, matched from
`.claude/skills/pr-self-review/routing.md`.

| Path glob | Skill | Sections | routing.md row | Rule it imposes on this plan |
|---|---|---|---|---|
| `server/src/modules/ci/**`, `server/src/adapters/**`, `server/src/platform/**` | `backend-onion-architecture` *(preloaded)* | §1 rings, §3 ports, §4 container, §5 repositories, §6 edge, §8 placement, §9 testing, §13 manifest | rows 34, 35, 37 | Generation is `helpers.ts`, never `workflow.ts` (§13); all SQL in `repository.ts` (§5); `container.github()`, never `new OctokitGitHubClient` (§4); the slice is dead until `modules/index.ts` names it (§13) |
| `server/src/modules/ci/routes.ts` | `fastify-best-practices` | `rules/schemas.md`, `rules/error-handling.md`, `rules/routes.md` | row 28 | Validation is declared in the route `schema:` as Zod so Fastify 422s before the handler; handlers `throw` `AppError` subclasses, never `reply.code(500).send()` |
| `server/src/modules/ci/routes.ts`, `server/src/adapters/github/octokit.ts`, `server/src/modules/ci/helpers.ts` | `security` | A01 access control, A05 injection, A06 rate limiting, A08 integrity, A09 logging, "Secret Detection" | rows 29, 36 | Trace the source of every value: `repo`, `agentId`, `triggers`, `post_as` and the whole artifact are attacker-reachable. Never log a token. Never interpolate an unvalidated string into generated YAML. Rate-limit the write path |
| `server/src/modules/ci/repository.ts` | `drizzle-orm-patterns` | "Upsert-Friendly Design", `references/queries-joins-aggregations.md` | rows 30, 31 | `onConflict` requires an exact matching unique index — which is why Step 1.4's constraints and Step 2.4/3.3's upserts are the same design decision |
| `server/src/db/schema/ci.ts` | `postgresql-table-design` | "Constraints", "Indexing", "Upsert-Friendly Design" | row 32 | `UNIQUE` allows multiple NULLs — `github_url` must be `NOT NULL`-checked in the service before the upsert, or duplicates slip through. PostgreSQL does **not** auto-index FK columns |
| `server/src/db/schema/ci.ts` | `drizzle-orm-patterns` | "Migrations", "Constraints and Warnings" | row 32 | `generate` + `migrate`, never `push` |
| `server/src/modules/ci/helpers.ts` (artifact validation) | `zod` | `parse-use-safeparse`, `parse-never-trust-json`, `object-optional-vs-nullable` | row 64 | `CiResultArtifact.safeParse`, never `.parse`, on a file DevDigest does not control |
| `client/src/app/**/*.tsx`, `client/src/lib/**` | `frontend-ui-architecture` *(preloaded)* | §1 placement, §2 promotion, §3 boundaries, §5 business logic, §9 App Router | rows 14, 19, 21 | Every new component has one consumer → route-local `_components/`. All fetching in `src/lib/hooks/ci.ts` through `apiFetch`. A mutation invalidates its query keys in `onSuccess` |
| `client/src/app/**/*.tsx` | `react-best-practices` | "Derive, Don't Store", "useEffect Rules", "Conditional Rendering", "Key Prop Patterns", "Accessibility" | row 15 | Wizard step state is `useState`; everything else (the advance-enabled flag, the file list, the error text) is **derived during render**, never stored and synced by an Effect. `{count && …}` is banned where `count` can be `0` — directly relevant to a zero-findings run |
| `client/src/app/ci-runs/page.tsx` | `next-best-practices` | `file-conventions.md`, `rsc-boundaries.md`, `suspense-boundaries.md`, `directives.md` | row 16 | Mark the interactive leaf, not the page (`frontend-ui-architecture` §9 agrees) |
| `client/src/**/*.test.tsx` | `react-testing-library` | query priority, async, "Anti-Patterns" | row 18 | Query by role/label first. **Its `userEvent` mandate is overridden here** — `client/INSIGHTS.md` 2026-08-08 records `@testing-library/user-event` is not installed, so use `fireEvent` |
| `server/test/**` | `backend-onion-architecture` *(preloaded)* | §9 | row 38 | Ring 3 → `*.it.test.ts` with testcontainers; ring 5 → `buildApp({ overrides })` + `app.inject()`; ring 2 → `ContainerOverrides` + `adapters/mocks.ts` |
| `server/AGENTS.md` | — | — | row 68 | Edit `AGENTS.md`; `CLAUDE.md` stays a symlink (mode `120000`). English only |

## Execution

**Multi-agent, five `implementer` dispatches, strictly sequential.** Nothing runs
in parallel among the writing hops — Dispatches 2 and 3 own the same five files,
and the contract, migration and i18n orderings are all real dependencies. The
only parallel pair is the two read-only reviewers at the end.

**`Input artifact` is always a path.** Subagents share no context; a plan relayed
by paraphrase loses exactly the constraints it exists to carry
(`.claude/agents/README.md` §How they chain).

| # | Agent | Input artifact | Steps | Files owned | Output |
|---|---|---|---|---|---|
| 1 | `implementer` | `plans/2026-08-24-export-to-ci.md` | 1.1–1.6 | `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/adapters.ts`, `server/src/adapters/github/octokit.ts`, `server/src/adapters/mocks.ts`, `server/src/db/schema/ci.ts`, `server/src/db/migrations/0019_*.sql` (generated), `server/src/platform/config.ts`, `server/package.json`, `server/AGENTS.md` | ports, mock, constraints, migration, config, dependency, prerequisite note |
| 2 | `implementer` | the same path | 2.1–2.6 | `server/src/modules/ci/{constants,helpers,repository,service,routes}.ts`, `server/src/modules/index.ts` | generation + install endpoints |
| 3 | `implementer` | the same path | 3.1–3.5 | the same five `modules/ci/` files (extended, not replaced) | ingest + read endpoints |
| 4 | `plan-verifier` | the same path | — | none (read-only) | one row per plan item and per `AC-N`; `not-met` rows go back to Dispatch 2 or 3; `unverifiable` rows go to `test-writer` |
| 5 | `implementer` | the same path | 4.1–4.4 | `client/messages/en/ci.json`, `client/src/lib/hooks/ci.ts`, `client/src/lib/hooks/index.ts`, `client/src/app/agents/[id]/_components/ExportToCiWizard/**` | catalogue + data layer + wizard |
| 6 | `implementer` | the same path | 5.1–5.4 | `client/src/app/agents/[id]/_components/CiTab/**`, `.../AgentEditor/constants.ts`, `client/src/app/ci-runs/**`, `client/src/vendor/ui/nav.ts` | CI tab, CI Runs page, nav row |
| 7 | `test-writer` | the same path + the `AC-N` list in `## Acceptance-facing checks` + hop 4's `unverifiable` rows | — | `server/test/ci.it.test.ts`, `server/test/ci-routes.test.ts`, `client/src/**/*.test.tsx` for the new components | tests |
| 8 | `architecture-reviewer` ∥ security review | the changed-file list | — | none (read-only) | boundary findings ∥ security findings |

Notes on the shape:

- **`plan-verifier` runs at hop 4, before `test-writer`, not after.** It sits
  after all three server dispatches because that is where every stateful
  acceptance criterion lands; its `not-met` rows go back to a writing hop before
  any test is written against a half-built step. Hops 5 and 6 are UI and can
  proceed while its rows are being triaged only if it returned no `not-met` on
  the API surface those hops consume — otherwise fix first. A second
  `plan-verifier` run at the very end is worth scheduling only if hop 4 produced
  `not-met` rows.
- **`test-writer` is handed behaviours, not commands.** It gets the `AC-N`
  identifiers from `## Acceptance-facing checks` plus hop 4's `unverifiable`
  rows, which are precisely the criteria nothing currently makes observable. It
  never changes production code to make a test pass.
- **Why five implementer dispatches and not more.** Dispatches 2 and 3 are the
  same slice split by AC set. Merging them would put ~30 acceptance criteria and
  two external integrations into one context window. Splitting Dispatch 1 into
  three (ports / schema / config) would exceed the ceiling. Both merges are
  recorded with their tradeoff in `## Risks & open questions`.

## Steps

### Dispatch 1 — Foundations

#### Step 1.1 — Extend the `GitHubClient` port, in both copies, in one edit
- **Files:** `server/src/vendor/shared/adapters.ts` (canon),
  `client/src/vendor/shared/adapters.ts` (manual copy)
- **Change:** beside `RepoRef` (canon `:111`), add:
  ```ts
  /** One GitHub Actions workflow run, as GitHub itself describes it. This is
   *  the provenance for an ingested CI run (SPEC-05 AC-26) — never the
   *  uploaded result file. */
  export interface WorkflowRunSummary {
    id: number;
    /** `html_url` — the Actions job page. Always present (AC-28). */
    htmlUrl: string;
    headSha: string;
    /** `queued` | `in_progress` | `completed`. */
    status: string;
    /** `success` | `failure` | `cancelled` | … ; null while not completed. */
    conclusion: string | null;
    /** ISO-8601. */
    createdAt: string;
    /** PR numbers GitHub attributes to this run; empty for a run it cannot
     *  attribute. */
    pullRequestNumbers: number[];
  }
  ```
  Then add two methods to `interface GitHubClient` (after `findOpenPr`, canon `:176`):
  ```ts
  /** Recent runs of ONE workflow file, newest first, capped by `perPage`
   *  (SPEC-05 NFR-2). */
  listWorkflowRuns(
    repo: RepoRef,
    opts: { workflowFile: string; perPage: number },
  ): Promise<WorkflowRunSummary[]>;
  /** Raw bytes of the named artifact of a run, as a zip. `null` when the run
   *  uploaded no artifact of that name or it has expired. */
  downloadRunArtifact(repo: RepoRef, runId: number, name: string): Promise<Uint8Array | null>;
  ```
  Paste byte-identical text into the client copy at the equivalent position.
- **Skill:** `backend-onion-architecture` §3 — a port is a capability named for
  the conversation, not the library; and "Adding a port to ring 0 is a two-file
  commit… change the canon, port the copy in the same commit". Also §1: ring 0
  may import `zod` and nothing else — these are plain TS interfaces, so nothing
  new is imported.
- **Agent:** `implementer`
- **Verify:** `./scripts/check-shared-sync.sh` (must pass, **without**
  `--update`); `cd server && pnpm typecheck` (expected to FAIL until 1.2 and 1.3
  land — that failure is the proof the interface widened)
- **Done when:** `rg -n 'listWorkflowRuns' server/src/vendor/shared/adapters.ts client/src/vendor/shared/adapters.ts` prints one hit in each file, and `check-shared-sync.sh` exits 0.

#### Step 1.2 — Implement the two methods on `MockGitHubClient`
- **Files:** `server/src/adapters/mocks.ts`
- **Change:** in `MockGitHubClient` (`:135`), add `listWorkflowRuns` returning a
  seeded array (default `[]`) and `downloadRunArtifact` returning a seeded value
  (default `null`), both overridable through the class's existing seeding style
  so ring-2 tests can drive the ingest paths.
- **Skill:** `backend-onion-architecture` §9 — "Every new port needs a mock in
  `adapters/mocks.ts` that `implements` it, or ring 2 becomes untestable the
  moment it uses the port."
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck`
- **Done when:** `MockGitHubClient implements GitHubClient` compiles with no
  `TS2420` (missing-member) error.

#### Step 1.3 — Implement the two methods on `OctokitGitHubClient`
- **Files:** `server/src/adapters/github/octokit.ts`
- **Change:** using the existing `this.octokit` handle (`:30`) and the existing
  `withRetry` / `withTimeout` wrappers (`:15`), add:
  - `listWorkflowRuns` → `this.octokit.rest.actions.listWorkflowRuns({ owner, repo, workflow_id: opts.workflowFile, per_page: opts.perPage })`, mapped to
    `WorkflowRunSummary` (`id`, `html_url`, `head_sha`, `status`, `conclusion`,
    `created_at`, `pull_requests?.map(p => p.number) ?? []`). Return `[]` when
    GitHub 404s the workflow file — a repository where the setup PR has not been
    merged yet is a normal state, not an error.
  - `downloadRunArtifact` → `actions.listWorkflowRunArtifacts`, find the entry
    whose `name` matches, then `actions.downloadArtifact({ archive_format: 'zip' })`
    and return `new Uint8Array(res.data as ArrayBuffer)`. Return `null` when no
    artifact matches or the artifact has expired.
- **Skill:** `backend-onion-architecture` §3 (the adapter is the only place the
  library appears); `security` — this is an outbound call on an operator-supplied
  `owner/name`, so it must not log the token and must not follow a redirect to a
  non-GitHub host beyond what Octokit already does.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `pnpm typecheck` is clean and `pnpm arch` exits 0 with no new
  rule name in its output.

#### Step 1.4 — Add the CI constraints and index, and generate the migration
- **Files:** `server/src/db/schema/ci.ts`, then a generated
  `server/src/db/migrations/0019_*.sql`
- **Change:** convert both tables to the second-argument form and add:
  - `ciInstallations`: `uniqueIndex('ci_installations_agent_repo_uq').on(t.agentId, t.repo)` — this is what AC-20's "at most one installation per agent and repository" actually rests on, and it is the conflict target the Step 2.4 upsert needs.
  - `ciRuns`: `uniqueIndex('ci_runs_installation_url_uq').on(t.ciInstallationId, t.githubUrl)` — AC-25's "record every run it has not recorded before"; and `index('ci_runs_installation_ran_idx').on(t.ciInstallationId, desc(t.ranAt))` for the list read.
  Import `uniqueIndex`, `index` from `drizzle-orm/pg-core` and `desc` from
  `drizzle-orm`. Then `cd server && pnpm db:generate` and `cd server && pnpm db:migrate`.
- **Skill:** `postgresql-table-design` §Constraints — "UNIQUE … allows multiple
  NULLs"; both `ci_installation_id` and `github_url` are nullable columns, so the
  service must refuse to persist a run without a `github_url` (Step 3.3) or the
  unique index will not deduplicate. §Indexing — a composite index is used on its
  leftmost prefix. §Upsert-Friendly Design — `ON CONFLICT` needs an exact matching
  unique index. Plus `drizzle-orm-patterns` §Migrations: `generate` + `migrate`,
  never `push`.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm db:generate` then inspect the emitted SQL; `cd server && pnpm db:migrate`; `cd server && pnpm typecheck`
- **Done when:** a new `server/src/db/migrations/0019_*.sql` exists containing
  `ci_installations_agent_repo_uq`, `ci_runs_installation_url_uq` and
  `ci_runs_installation_ran_idx`, no pre-existing migration file is modified
  (`git diff --stat server/src/db/migrations/` shows only the new file), and
  `db:generate` completed non-interactively.

#### Step 1.5 — Add `runnerBundlePath` to `AppConfig` and `yaml` to the package
- **Files:** `server/src/platform/config.ts`, `server/package.json`
- **Change:**
  - In the `AppConfig` interface (near `cloneDir`, `:46`) add
    `runnerBundlePath: string;`. Populate it in the builder (near `:74`) from
    `parsed.RUNNER_BUNDLE_PATH`, defaulting to
    `resolve(process.cwd(), '..', 'agent-runner', 'dist', 'index.js')`, resolved
    to an absolute path with the same `isAbsolute`/`resolve` treatment
    `cloneDir` gets at `:68`. Add `RUNNER_BUNDLE_PATH` as an optional string to
    the env schema.
  - Add `"yaml": "^2.6.1"` to `server/package.json` `dependencies`, then
    `cd server && pnpm install`.
- **Skill:** `backend-onion-architecture` §1 — `platform/config.ts` is ring 4, the
  composition root, and the only place that resolves environment into typed
  config. `security` §A02 — the path is server-controlled config, not
  attacker-controlled input, so no traversal check is warranted; do not add one.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck`
- **Done when:** `rg -n 'runnerBundlePath' server/src/platform/config.ts` returns
  the interface field and its assignment, and `rg -n '"yaml"' server/package.json`
  returns a hit.

#### Step 1.6 — Record the runner-build prerequisite
- **Files:** `server/AGENTS.md`
- **Change:** add one row to §Read when (or the nearest equivalent section):
  *"Exporting an agent to CI (SPEC-05) — `agent-runner/dist/index.js` must exist
  first: `cd agent-runner && pnpm install && pnpm build`. It is git-ignored by
  `agent-runner/.gitignore`, so a fresh clone has none, and the export throws
  `ConfigError` until it is built. Override the location with
  `RUNNER_BUNDLE_PATH`."*
- **Skill:** none matched (`routing.md` row 68: edit `AGENTS.md`, never the
  `CLAUDE.md` symlink; English only)
- **Agent:** `implementer`
- **Verify:** `git ls-files -s server/CLAUDE.md` still shows mode `120000`
- **Done when:** the row is present in `server/AGENTS.md` and `server/CLAUDE.md`
  is still a symlink.

---

### Dispatch 2 — Server `ci` slice: generation and install

#### Step 2.1 — `modules/ci/constants.ts`
- **Files:** `server/src/modules/ci/constants.ts` (new)
- **Change:** the slice's public literals. At minimum:
  - `CI_BRANCH = 'devdigest/ci'`, `CI_DEFAULT_BASE = 'main'`
  - `CI_WORKFLOW_PATH = '.github/workflows/devdigest-review.yml'`
  - `CI_RUNNER_PATH = '.devdigest/runner/index.js'`
  - `CI_AGENTS_DIR = '.devdigest/agents'`, `CI_SKILLS_DIR = '.devdigest/skills'`,
    `CI_MEMORY_PATH = '.devdigest/memory.md'`
  - `CI_ARTIFACT_NAME = 'devdigest-result'`, `CI_RESULT_FILE = 'devdigest-result.json'`
  - `CI_TRIGGER_EVENTS = ['opened', 'synchronize', 'reopened'] as const` (AC-6)
  - `CI_MAX_RUNS_PER_REFRESH = 20` (NFR-2)
  - `CI_INSTALL_TIMEOUT_MS = 60_000` (NFR-1)
  - `CI_MAX_UNPACKED_BYTES = 512 * 1024` — the zip-bomb guard for the downloaded
    artifact, mirroring `modules/skills/constants.ts:26`
  - `PINNED_ACTIONS`: a frozen map of third-party action → `{ sha, version }`.
    AC-18 requires a **full 40-character commit SHA** with the human-readable
    version as a trailing comment. The implementer resolves the real SHA for
    `actions/checkout` (and any other action the workflow ends up using) with
    `gh api repos/actions/checkout/git/refs/tags/v4 --jq '.object.sha'`,
    dereferencing an annotated tag if needed. **A placeholder SHA fails AC-18.**
  - `CI_PR_TITLE` and `CI_PR_CHECKLIST`: the five fixed AC-21 items — the minimal
    permission block, the configured trigger list, the absence of secret values in
    any generated file, the provenance of the runner bundle, and the use of the
    non-privileged `pull_request` trigger.
- **Skill:** `backend-onion-architecture` §1, §13 — `constants.ts` is the slice's
  **public** surface and the one file another slice may import.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck`
- **Done when:** every `PINNED_ACTIONS` entry's `sha` matches `^[0-9a-f]{40}$`.

#### Step 2.2 — `modules/ci/helpers.ts` — the generators (pure)
- **Files:** `server/src/modules/ci/helpers.ts` (new)
- **Change:** pure functions only — no `fs`, no DB, no container, no `fetch`:
  - `parseRepoFullName(repo: string): { owner: string; name: string }` — rejects
    anything not matching `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$` with
    `ValidationError`. This is the sanitiser AC-16/AC-17 and `security` §A05 rest
    on: the value is operator-supplied and is interpolated into generated YAML.
  - `slugify(name: string): string` — the manifest filename, `[a-z0-9-]` only.
  - `buildAgentManifestYaml(input): string` — build the object, validate it with
    `AgentManifest.parse(...)` from `@devdigest/shared` **before** serialising,
    then `stringify` it with `yaml`. Using the same schema the runner validates
    against is what keeps the two ends from drifting (the contract's own docblock
    at `eval-ci.ts:309-316` states this intent).
  - `buildMemoryMarkdown(entries: string[]): string` — a human-readable
    `.devdigest/memory.md`. With no entries it carries a one-line empty-state
    sentence. Inert by design: nothing in `agent-runner` reads it (see
    `## Risks & open questions`).
  - `buildWorkflowYaml(input: { triggers: string[]; postAs: 'github_review' | 'pr_comment' | 'none' }): string` —
    the whole of the security AC set lands here:
    - **AC-14:** `on: pull_request: types: [<triggers>]`. The literal string
      `pull_request_target` must appear nowhere in the emitted text.
    - **AC-13:** exactly `permissions: { contents: read, pull-requests: write }`
      and nothing else.
    - **AC-15:** the review job carries
      `if: github.event.pull_request.head.repo.full_name == github.repository`,
      and a second, always-run step prints a readable skip reason for the fork
      case. The fork path publishes nothing, writes no artifact, and the job
      completes non-failing.
    - **AC-12:** the review step is `run: node .devdigest/runner/index.js`. No
      `uses:` line naming any `devdigest/*` action.
    - **AC-18:** every third-party `uses:` is `<action>@<40-char-sha> # v<version>`
      from `PINNED_ACTIONS`.
    - **AC-10:** the runner step's `env:` carries
      `DEVDIGEST_POST_AS: <postAs>` — this is the producer
      `agent-runner/insights/INSIGHTS.md` (2026-07-08) records as missing.
    - **AC-16 / AC-17:** `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`
      and `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. No other provider key name
      appears; no credential appears as a literal.
    - Artifact upload named `CI_ARTIFACT_NAME`, `if: always()` but only inside the
      non-fork branch.
  - `buildPrBody(input): string` — the AC-21 checklist plus the runner bundle's
    provenance sentence.
  - `validateTriggers(triggers: string[]): string[]` — non-empty subset of
    `CI_TRIGGER_EVENTS`; empty or unknown → `ValidationError`. This is the server
    half of AC-7; the client refusal is the other half.
- **Skill:** `backend-onion-architecture` §8 — "A pure transform →
  `modules/<name>/helpers.ts` — no I/O, no DB, no container"; §13 — this file is
  covered by `no-sql-in-service` and `no-http-below-the-edge` **because of its
  name**, which is the whole reason it is not `workflow.ts`. `security` §A05 —
  every operator-supplied string interpolated into YAML is validated against an
  allowlist first, never escaped ad hoc. `zod` `parse-validate-early` — validate at
  the boundary, once.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** for a generated workflow string `w`:
  `w.includes('pull_request_target') === false`; `/@[0-9a-f]{40}\b/.test(w)` for
  every `uses:` line; `w.includes('DEVDIGEST_POST_AS')`;
  `w.includes('OPENAI_API_KEY') === false`; the permissions block has exactly two
  entries. These are the assertions `test-writer` will formalise.

#### Step 2.3 — `modules/ci/repository.ts` — all SQL
- **Files:** `server/src/modules/ci/repository.ts` (new)
- **Change:** `export class CiRepository { constructor(private db: Db) {} }` —
  `Db`, not `Container`. Every method takes `workspaceId` and scopes on it by
  joining `ci_installations → agents.workspace_id` (neither `ci_*` table carries
  `workspace_id` of its own; that join **is** the tenancy boundary). Methods:
  - `upsertInstallation(workspaceId, { agentId, repo, targetType })` — verifies
    the agent belongs to the workspace, then
    `.onConflictDoUpdate({ target: [agentId, repo], set: { installedAt: new Date() } })`
    and `.returning()`. AC-20.
  - `listInstallationsForAgent(workspaceId, agentId)` — AC-33.
  - `listInstallationsForWorkspace(workspaceId)` — the refresh fan-out.
  - `upsertRun(workspaceId, values)` —
    `.onConflictDoNothing({ target: [ciInstallationId, githubUrl] })`. AC-25's
    "record every run it has not recorded before".
  - `updateRunResult(workspaceId, runId, { status, findingsCount, costUsd })` —
    used only when an artifact is accepted.
  - `listRunsForWorkspace(workspaceId, limit)` and
    `listRunsForAgent(workspaceId, agentId)` — both `ORDER BY ran_at DESC`
    explicitly (`server/INSIGHTS.md` 2026-08-21: a list feeding a mutated view
    with no `ORDER BY` reshuffles).
  Return plain rows/DTOs. No Drizzle chain, `SQL` fragment or transaction handle
  crosses the boundary.
- **Skill:** `backend-onion-architecture` §5 — all SQL here, constructor takes
  `Db`, every method workspace-scoped, nothing Drizzle-shaped in a signature.
  `drizzle-orm-patterns` §Upsert-Friendly Design — `ON CONFLICT` needs the exact
  unique index Step 1.4 created; `DO NOTHING` is cheaper than `DO UPDATE` when
  there is nothing to change.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `pnpm arch` exits 0, and no method signature in the file names a
  type imported from `drizzle-orm`.

#### Step 2.4 — `modules/ci/service.ts` — export and install
- **Files:** `server/src/modules/ci/service.ts` (new)
- **Change:** `export class CiService { constructor(private container: Container) {} }`.
  Reads `container.config`, `container.agentsRepo`, `await container.github()`;
  constructs `new CiRepository(container.db)` in its own constructor. It never
  reads `container.db` for a query of its own.
  - `buildBundle(workspaceId, agentId, input: CiExportInput): Promise<CiFile[]>` —
    1. `container.agentsRepo.getById(workspaceId, agentId)` → `NotFoundError` when
       absent. **This is the sanctioned cross-slice channel** (`backend-onion-architecture`
       §4); do not import `modules/agents/repository.ts`.
    2. `container.agentsRepo.linkedSkills(agentId)` → each row's `skill.body`
       becomes `.devdigest/skills/<slug>.md`.
    3. `readFile(container.config.runnerBundlePath, 'utf-8')` → `.devdigest/runner/index.js`.
       On `ENOENT`, throw `ConfigError` whose message names the path and the
       `cd agent-runner && pnpm build` remedy. `ConfigError` is a normal path here
       (`backend-onion-architecture` §4), and the route lets it become AC-5's
       error state — never a 500.
    4. The manifest, the memory file and the workflow from Step 2.2's helpers.
    Returns every file with full `contents` (Recommendation 2 declined) and
    `editable: false` on the runner.
  - `install(workspaceId, agentId, input): Promise<CiExport>` — wrapped in
    `withTimeout(..., CI_INSTALL_TIMEOUT_MS)` for NFR-1; on timeout throw an
    `ExternalServiceError` whose message names `CI_BRANCH`, so the operator is
    told the outcome could not be confirmed and given the branch to check rather
    than a generic "nothing happened".
    1. `buildBundle(...)`.
    2. `github.commitFiles(repoRef, { branch: CI_BRANCH, base: input.base, message, files })`
       — never a commit to the base branch (AC-19).
    3. `github.findOpenPr(repoRef, CI_BRANCH)`; when null,
       `github.openPullRequest(repoRef, { title: CI_PR_TITLE, head: CI_BRANCH, base: input.base, body: buildPrBody(...) })`.
       When non-null, reuse it — same branch, same PR (AC-20).
    4. **Only after both succeed**, `repo.upsertInstallation(...)`. Any throw
       above leaves no installation recorded (AC-23).
    Returns `CiExport { installation, files, pr_url }`.
- **Skill:** `backend-onion-architecture` §4 — never `new` an adapter outside the
  container; a ring-2 service may read `container.<port>` but must never read
  `container.db`. §2 — what crosses inward is plain data. `security` §A01 — the
  workspace scope is re-resolved on every call and the `agentId` in the URL is
  attacker-controlled; §A09 — never log the GitHub token or the bundle contents.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `rg -n 'container\.db' server/src/modules/ci/service.ts` returns
  only the `new CiRepository(container.db)` construction line, and `pnpm arch`
  exits 0.
- **Note on `node:fs` in a `service.ts`:** reading the runner bundle is I/O in
  ring 2. It follows existing house precedent —
  `server/src/modules/repo-intel/service.ts:29` and
  `server/src/modules/context/service.ts:1` both import `node:fs/promises` — and
  no `pnpm arch` rule forbids it (`no-sql-in-service` is about Drizzle,
  `no-http-below-the-edge` about `fastify`). It is called out here so
  `architecture-reviewer` can judge it rather than discover it.

#### Step 2.5 — `modules/ci/routes.ts` + register the slice
- **Files:** `server/src/modules/ci/routes.ts` (new), `server/src/modules/index.ts`
- **Change:** a default Fastify plugin, HTTP + Zod only, no logic and no SQL.
  ```
  POST /agents/:id/export-ci   body: CiExportInput   → CiExport
  ```
  with `action: 'files'` returning the preview (files only, `pr_url: null`,
  no installation written) and `action: 'open_pr'` performing the install. Both
  branches live in `service.ts`; the route only dispatches.
  - Declare `params: IdParams` and `body: CiExportInput` in the route's
    `schema:`. **No hand-rolled `Schema.parse(req.body)` in the handler.**
  - Resolve tenancy with `await getContext(container, req)`.
  - Own rate limit on the write path — `{ max: 10, timeWindow: '1 minute' }`,
    following `modules/eval/routes.ts:40`'s precedent (`security` §A06).
  - Throw `AppError` subclasses; never `reply.code(500).send()`.
  Then in `server/src/modules/index.ts`: one `import ci from './ci/routes.js';`
  and one `ci,` entry in the `modules` record. **Same dispatch** — a slice absent
  from the registry mounts nothing and every endpoint 404s, with no typecheck,
  test or gate saying a word.
- **Skill:** `backend-onion-architecture` §6 (validation in `schema:`, throw don't
  hand-craft, registration is static) and §13 (a slice is dead until
  `modules/index.ts` names it). `fastify-best-practices` `rules/schemas.md`,
  `rules/error-handling.md`. `security` §A01, §A06.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch && pnpm test`
- **Done when:** `rg -n "'./ci/routes.js'" server/src/modules/index.ts` returns a
  hit, `rg -n '^\s+ci,' server/src/modules/index.ts` returns a hit, and
  `pnpm arch` exits 0.

#### Step 2.6 — Gate the dispatch
- **Files:** none
- **Change:** none.
- **Skill:** none
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch && pnpm test`
- **Done when:** all three exit 0. Read the **test count**, not just the exit
  code — an `.it.test.ts` file reporting `N skipped` means unverified, not
  passing (`backend-onion-architecture` §9). Do **not** run
  `./scripts/pr-self-review.sh` (root `INSIGHTS.md` 2026-08-06).

---

### Dispatch 3 — Server `ci` slice: ingest and read

#### Step 3.1 — Artifact validation in `helpers.ts` (pure)
- **Files:** `server/src/modules/ci/helpers.ts` (extend)
- **Change:** add
  `parseResultArtifact(zipBytes: Uint8Array, expected: { prNumber: number | null }): CiResultArtifact | null`:
  1. `unzipSync(zipBytes)` inside a `try`; any throw → `null` (reject, do not
     crash the whole refresh).
  2. Sum every entry's `byteLength`; over `CI_MAX_UNPACKED_BYTES` → `null`.
     A zip bomb is small on the wire and huge once expanded, and the download-size
     check cannot see that (`server/INSIGHTS.md` 2026-08-05).
  3. Pick the `CI_RESULT_FILE` entry; missing → `null`.
  4. `JSON.parse` inside a `try` → `CiResultArtifact.safeParse(...)`; `!success`
     → `null`. **`safeParse`, never `parse`** — this file is written by a party
     DevDigest does not control.
  5. AC-27's provenance cross-check: when the artifact declares a `pr_number` and
     GitHub attributes a PR number to the run, a mismatch → `null`. The
     repository half of AC-27 is satisfied structurally rather than by field
     comparison — `CiResultArtifact` carries no repo field, and the artifact is
     only ever fetched *through* a run id GitHub attributes to this
     installation's repo, so a file naming another repository can never be
     reached. Say so in the function's docblock.
  Returning `null` means "reject the file and record the run with no result",
  which is exactly AC-27's stated behaviour.
- **Skill:** `zod` `parse-use-safeparse`, `parse-never-trust-json`. `security`
  §A08 (unvalidated content is not trusted) and the framework-quirks note that
  `JSON.parse` throws on malformed input. `backend-onion-architecture` §8 — a pure
  transform belongs in `helpers.ts`; the *fetch* stays in the service.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** the function has no `await`, no import from `node:*`, and returns
  `null` on each of the five rejection paths.

#### Step 3.2 — Status and cost mapping in `helpers.ts` (pure)
- **Files:** `server/src/modules/ci/helpers.ts` (extend)
- **Change:** `toRunRecord(run: WorkflowRunSummary, artifact: CiResultArtifact | null)`
  returning the persisted shape:
  - `github_url` ← `run.htmlUrl`. Always present, from GitHub's own description
    of the run — never from the artifact (AC-26, AC-28).
  - `pr_number` ← `run.pullRequestNumbers[0] ?? null`.
  - `ran_at` ← `run.createdAt`.
  - `source` ← `'ci'` (AC-31).
  - With **no** accepted artifact: `findings_count = null`, `cost_usd = null`,
    `status` derived from `run.status` / `run.conclusion` (`'running'` while not
    completed, otherwise `'failed'`). AC-28.
  - With an accepted artifact: `findings_count = artifact.findings_count`;
    `status = artifact.findings_count === 0 ? 'no_findings' : 'succeeded'` —
    a zero-finding review is a **success**, including the all-dropped-by-grounding
    case, and must not collapse into "no result" (AC-29);
    `cost_usd = artifact.cost_usd` **verbatim, including `null`**.
  - **`cost_usd` is never coerced to `0`.** AC-30 and root `INSIGHTS.md`
    (2026-08-02): unknown cost is `null`, never `0`. `CiResultArtifact.cost_usd`
    is `z.number().nullable()`, so `null` arrives legitimately.
  Status strings come from `CiRunStatus` in `@devdigest/shared`
  (`eval-ci.ts:370`); `ci_runs.status` is plain `text`, so the enum is the
  discipline, not the database's.
- **Skill:** `backend-onion-architecture` §8 (pure transform → `helpers.ts`)
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck`
- **Done when:** `rg -n 'cost_usd.*\?\?\s*0|costUsd.*\?\?\s*0' server/src/modules/ci/` returns nothing.

#### Step 3.3 — `service.ts` — refresh and read
- **Files:** `server/src/modules/ci/service.ts` (extend), `server/src/modules/ci/repository.ts` (extend if a query is missing)
- **Change:**
  - `refresh(workspaceId): Promise<{ ingested: number }>` —
    for each installation from `repo.listInstallationsForWorkspace(workspaceId)`:
    1. `github.listWorkflowRuns(repoRef, { workflowFile: 'devdigest-review.yml', perPage: CI_MAX_RUNS_PER_REFRESH })`
       — the NFR-2 cap of 20 per installation.
    2. For each run, `repo.upsertRun(...)` with `toRunRecord(run, null)`; skip any
       run whose `htmlUrl` is empty, because the unique index cannot deduplicate
       on `NULL` (`postgresql-table-design` §Constraints).
    3. For each run not yet carrying a result,
       `github.downloadRunArtifact(repoRef, run.id, CI_ARTIFACT_NAME)` →
       `parseResultArtifact(...)`; when non-null, `repo.updateRunResult(...)`.
    4. **Per-installation `try`/`catch`.** One unreachable repository must not
       abort the whole refresh, and previously recorded runs stay visible
       (NFR-5). Log and continue.
  - `listRuns(workspaceId)` and `listInstallations(workspaceId, agentId)` — thin
    reads.
  NFR-3 / NFR-4 are structural: no path in this method resolves
  `container.llm()`, and nothing here makes a model call.
- **Skill:** `backend-onion-architecture` §4 (`container.github()`; `ConfigError`
  is a normal path, not a 500) and §3 (a facade never throws on partial data —
  the same discipline applied to the refresh's per-installation degradation).
  `security` §A10 — fail closed on a rejected artifact: record the run with no
  result rather than trusting it.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** the per-installation loop body is inside a `try`/`catch`, and
  `rg -n 'container\.llm' server/src/modules/ci/` returns nothing.

#### Step 3.4 — `routes.ts` — the read and refresh endpoints
- **Files:** `server/src/modules/ci/routes.ts` (extend)
- **Change:**
  ```
  POST /ci/refresh                     → { ingested: number }     (AC-25)
  GET  /ci-runs                        → CiRun[]                  (AC-28…AC-32)
  GET  /agents/:id/ci-installations    → CiInstallation[]         (AC-22, AC-33)
  ```
  `params: IdParams` on the third. `POST /ci/refresh` takes no body; give it its
  own modest rate limit — it fans out to N GitHub calls (`security` §A06).
  Tenancy through `getContext` on all three.
- **Skill:** `backend-onion-architecture` §6; `fastify-best-practices`
  `rules/routes.md`, `rules/schemas.md`; `security` §A01, §A06
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch && pnpm test`
- **Done when:** all three routes are declared in the plugin and none imports
  `drizzle-orm` or `db/schema`.

#### Step 3.5 — Gate the dispatch
- **Files:** none
- **Change:** none.
- **Skill:** none
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch && pnpm test`; `./scripts/check-shared-sync.sh`
- **Done when:** all exit 0. Do not run `./scripts/pr-self-review.sh`.

---

### Dispatch 4 — Client: catalogue, data layer, Export wizard

#### Step 4.1 — Rewrite `messages/en/ci.json`
- **Files:** `client/messages/en/ci.json`
- **Change:** replace the file wholesale against SPEC-05. Specifically:
  - **Delete** `exportWizard.targets` (its `circle` / `jenkins` / `cli` entries
    contradict AC-1), `exportWizard.recommended`, and the entire `publishDialog`
    namespace (a superseded single-dialog design).
  - **Delete** `exportWizard.blockMergeDesc` ("Requires a GitHub App — not
    available with PAT in local mode") and replace it with AC-9's two statements:
    that blocking merges additionally requires marking the check as required in
    the repository's own branch protection, and that DevDigest does not configure
    branch protection.
  - **Keep and reuse** `exportWizard.steps.{target,preview,configure,install}` —
    they already match the approved rail — plus `back`, `continue`, `install`,
    `installing`, `filesToCreate`, `generating`, `editable`, `postAs.*`,
    `repoLabel`, `repoHint`, `repoPlaceholder`.
  - **Add**: AC-4's busy label; AC-5's single error state (a `{reason}`
    placeholder) and its retry label; AC-6/AC-7's three trigger labels and the
    "at least one trigger must stay selected" refusal message; AC-8's expected
    secret names and the instruction to add `OPENROUTER_API_KEY` to the
    repository's Actions secrets; AC-22's confirmation with a PR link; AC-28's
    "no result yet" wording; AC-30's unknown-cost placeholder; AC-33's single
    empty state naming the export action.
  - **Rewrite** `runs.table.*` to the columns this view actually renders, and
    delete `runs.filters.*` and `runs.autoRefresh` — filtering and auto-refresh
    are explicitly deferred by §Not in scope.
  - Every string is English (`CLAUDE.md` §Repo rules).
- **Skill:** `frontend-ui-architecture` §1 — "User-facing string → the i18n
  message catalogue, never inline"
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n 'GitHub App|circle|jenkins|publishDialog' client/messages/en/ci.json` returns nothing.

#### Step 4.2 — `src/lib/hooks/ci.ts` — the data layer
- **Files:** `client/src/lib/hooks/ci.ts` (new), `client/src/lib/hooks/index.ts`
- **Change:** `"use client"` at the top, following `hooks/eval.ts`'s shape exactly.
  - Keys: `ciRunsKey()`, `ciInstallationsKey(agentId)`.
  - `useCiRuns()` → `api.get<CiRun[]>('/ci-runs')`.
  - `useCiInstallations(agentId)` → `api.get<CiInstallation[]>(\`/agents/${agentId}/ci-installations\`)`, `enabled: !!agentId`.
  - `useExportPreview()` → mutation, `POST /agents/:id/export-ci` with
    `action: 'files'`.
  - `useInstallCi()` → mutation, `action: 'open_pr'`; `onSuccess` invalidates
    **both** `ciInstallationsKey(agentId)` and `ciRunsKey()`. AC-22 requires the
    new installation row to be visible without a manual reload, and that
    invalidation is the whole mechanism.
  - `useRefreshCiRuns()` → mutation, `POST /ci/refresh`; `onSuccess` invalidates
    `ciRunsKey()`.
  - **Do not set `retry: false`** on any of these queries. `client/INSIGHTS.md`
    (2026-08-09) records a `retry: false` query for a not-yet-existing resource
    caching its 404 for the whole session; a freshly created agent's
    installations list is exactly that shape.
  Add `export * from "./ci";` to the barrel.
- **Skill:** `frontend-ui-architecture` §In this repo — "The chosen data model is
  HTTP APIs… A new endpoint means a new hook in the matching domain file. A
  mutation must invalidate its query keys in `onSuccess`". `react-best-practices`
  §Data Fetching — all fetching in hooks, never in a component body.
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n 'retry: false' client/src/lib/hooks/ci.ts` returns
  nothing, and `rg -n './ci' client/src/lib/hooks/index.ts` returns a hit.

#### Step 4.3 — The 4-step Export to CI wizard
- **Files:** `client/src/app/agents/[id]/_components/ExportToCiWizard/`
  (`ExportToCiWizard.tsx`, `constants.ts`, `styles.ts`, `helpers.ts` if needed,
  `index.ts`)
- **Change:** a `"use client"` component (it is an interactive leaf, not a page).
  - Renders the vendored `ExportWizardSteps` from `@devdigest/ui` for the rail —
    **reuse as-is, no bespoke stepper, no edit to the vendored file.** It already
    renders `i + 1` and the label text, which is what satisfies AC-11.
  - **Step 1 — Target:** GitHub Actions is stated as the target; **no tile grid**
    (AC-1, and the deliberate tradeoff recorded in the spec's §Design & UX
    review). Captures `owner/name`, preselecting the shell's active repository
    when there is one and falling back to a free-text field (spec §Open questions
    Q1). Advance is disabled until a repository is present (AC-2).
  - **Step 2 — Preview:** on entry, fire `useExportPreview`. While pending, show
    the busy state and keep advance unavailable (AC-4). On success, list every
    file by its repository-relative path and render the workflow file's contents
    in the pane beside the list (AC-3).
  - **Step 3 — Configure:** the three trigger checkboxes with at least one
    selected on arrival (AC-6); deselecting the last one is **refused**, not
    merely warned about (AC-7). The publish-mode control writes
    `CiExportInput.post_as`, which becomes `DEVDIGEST_POST_AS` in the generated
    workflow (AC-10). The expected secret names are stated with the instruction
    to add `OPENROUTER_API_KEY` to the repository's Actions secrets, and **no
    field anywhere in the wizard accepts a secret value** (AC-8). Both AC-9
    statements are rendered.
  - **Step 4 — Install:** confirm → `useInstallCi`. On success the step becomes a
    confirmation naming the repository with a working link to the opened pull
    request (AC-22).
  - **Error handling:** one error state carrying the reported reason, with a
    retry, preserving every earlier choice — the wizard's step state is not reset
    on failure (AC-5). No per-cause screens.
  - **Pre-fill:** when opened from an existing installation's row, the repository,
    triggers and publish mode arrive as props and are preselected; the wizard acts
    on exactly that one repository (AC-24).
  - **State discipline:** `currentStep`, the form choices and the mutation state
    are the only stored state. "Can advance", the file list, the workflow text and
    the error message are all **derived during render**. No `useEffect` computes
    any of them.
  - Every string comes from `messages/en/ci.json` via `useTranslations('ci')`.
- **Skill:** `frontend-ui-architecture` §1 (one consumer → route-local
  `_components/<Name>/`), §2 (do not promote to `src/components/`), §9 (mark the
  interactive leaf). `react-best-practices` §Derive, Don't Store; §useEffect Rules
  ("no Effect is needed to transform data for rendering… react to a user event");
  §Conditional Rendering (`{count && …}` is banned where `count` can be `0`);
  §Accessibility (`aria-label` on icon-only controls, `aria-live` for the busy and
  error states). `CLAUDE.md` §Do not touch — `client/src/vendor/**` is reused,
  never edited.
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n 'circle|jenkins|Generic CLI' client/src/app/agents/` returns
  nothing (AC-1); `git diff --stat client/src/vendor/ui/ExportWizardSteps.tsx`
  is empty; no `type="password"` or secret-valued input exists anywhere in the
  wizard (AC-8).

#### Step 4.4 — Gate the dispatch
- **Files:** none
- **Change:** none.
- **Skill:** none
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** all three exit 0. Do not run `./scripts/pr-self-review.sh`.

---

### Dispatch 5 — Client: CI tab, CI Runs page, navigation

#### Step 5.1 — The agent's CI tab
- **Files:** `client/src/app/agents/[id]/_components/CiTab/` (new),
  `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`
- **Change:**
  - Add one row to `TABS`: `{ key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" }`.
    `editor.tabs.ci: "CI"` **already exists** at `client/messages/en/agents.json:52`
    — do not add it again. `Workflow` **is** in the vendored icon registry
    (`client/src/vendor/ui/icons.tsx:79`); `IconName` is that registry's key set,
    not lucide's export list (`client/INSIGHTS.md` 2026-08-05).
  - **Do not** add a second tab allowlist. `VALID_TABS` is already derived from
    `TABS` at `AgentEditorView/constants.ts:11`, precisely because a hand-kept
    copy once swallowed the `context` tab (`client/INSIGHTS.md` 2026-08-16).
  - `CiTab` renders `useCiInstallations(agentId)`:
    - no installations → **one** empty state naming the export action (AC-33).
      Not two, not a "no repository connected" pre-state.
    - otherwise → a plain list of installations with a plain count. **Never
      "Active in N repos"** — v1 does not distinguish an opened-but-unmerged setup
      PR from a running one (§Not in scope).
    - each row offers an update action that opens `ExportToCiWizard` pre-filled
      for that repository (AC-24).
- **Skill:** `frontend-ui-architecture` §1 placement. `react-best-practices`
  §Conditional Rendering — use `list.length > 0 && …`, never `list.length && …`.
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n '"ci"' "client/src/app/agents/[id]/_components/AgentEditor/constants.ts"`
  returns the new row, and navigating to `?tab=ci` renders the pane rather than
  falling back to `config`.

#### Step 5.2 — The `/ci-runs` route
- **Files:** `client/src/app/ci-runs/page.tsx` (new),
  `client/src/app/ci-runs/_components/CiRunsView/` (new)
- **Change:** `page.tsx` is a thin, non-`"use client"` route entry that renders
  `<CiRunsView />`, exactly matching `client/src/app/evals/page.tsx` — mark the
  interactive leaf, not the page. `CiRunsView` is `"use client"` and renders
  `useCiRuns()` plus a Refresh control wired to `useRefreshCiRuns()`.
  - Each row links to **both** its pull request and its GitHub Actions job
    (AC-32). The job link comes from `github_url`, which is always present.
  - A run with no accepted result shows the "no result yet" wording and its job
    link, and DevDigest does not attempt to explain the failure (AC-28).
  - A zero-finding run shows as succeeded with no findings — **not** failed and
    **not** resultless (AC-29).
  - `cost_usd == null` renders the unknown placeholder. **The digit `0` must not
    appear in that cell** (AC-30; root `INSIGHTS.md` 2026-08-02).
  - The source column distinguishes a CI-originated run (AC-31).
  - Repository, branch and file names returned by GitHub are rendered as text,
    never as markup (spec §Untrusted inputs 3). React's JSX escaping is the
    default safety net; no `dangerouslySetInnerHTML` anywhere.
  - No pagination, no filters, no auto-refresh (§Not in scope).
- **Skill:** `next-best-practices` `file-conventions.md`, `rsc-boundaries.md`,
  `directives.md`. `frontend-ui-architecture` §9 — "`'use client'` on a page or
  layout drags the whole subtree into the client graph; mark the leaf".
  `react-best-practices` §Conditional Rendering, §Key Prop Patterns (key rows by
  the run's `id`, never by array index). `security` §A05 XSS.
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n "'use client'" client/src/app/ci-runs/page.tsx` returns
  nothing, and the cost cell's null branch renders a placeholder constant rather
  than a numeric fallback.

#### Step 5.3 — Refresh wiring
- **Files:** `client/src/app/ci-runs/_components/CiRunsView/CiRunsView.tsx`
- **Change:** the Refresh control calls `useRefreshCiRuns()`, whose `onSuccess`
  invalidates `ciRunsKey()`. A failed refresh leaves the already-recorded runs
  rendered (NFR-5) — the error is surfaced beside the list, and the list is not
  cleared, emptied or replaced by an error screen.
- **Skill:** `frontend-ui-architecture` §In this repo — "A mutation must
  invalidate its query keys in `onSuccess`, or the screen keeps rendering stale
  data". `client/INSIGHTS.md` 2026-08-09 — the invalidator is what stops a
  not-yet-existing resource caching its miss.
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** the mutation's `onSuccess` invalidates `ciRunsKey()`, and the
  error branch renders alongside the list rather than instead of it.

#### Step 5.4 — The navigation row
- **Files:** `client/src/vendor/ui/nav.ts`
- **Change:** add to the `SKILLS LAB` group in `NAV`:
  ```ts
  { key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs", gKey: "i" },
  ```
  and the matching entry to `SHORTCUTS`:
  `{ keys: "g i", label: "Go to CI Runs", group: "Navigation" }` — a row carrying
  a `gKey` without a `SHORTCUTS` entry gives a shortcut the `?` help omits. Pick a
  `gKey` not already taken (`p`, `x`, `s`, `a`, `c`, `e`, `,` are in use).
  - `key` **must** be `"ci-runs"`: `activeKeyFor` already returns that for
    `/ci-runs` (`client/src/components/app-shell/helpers.ts:39`), and
    `useShellCommands.ts` builds the command-palette entry from
    `t(\`nav.${it.key}\`)`, which resolves against `shell.json`'s existing
    `nav["ci-runs"]: "CI Runs"` (`client/messages/en/shell.json:28`). A mismatched
    key renders a raw message key in the palette.
  - **This is the one and only thing that makes the screen appear.** A label plus
    an `activeKeyFor` branch is zero of the one thing required — both are
    *consumers* of a `NAV` row, and Project Context shipped complete and invisible
    for exactly this reason (`client/INSIGHTS.md` 2026-08-16).
  - **Nothing else in `src/vendor/**` is edited.** The same insight rules that
    `src/vendor/ui/README.md` classes `nav.ts` as route/shortcut config, and the
    repo rule bans *refactoring* vendored code, not adding a route to its route
    table.
- **Skill:** `frontend-ui-architecture` §In this repo (UI primitives are vendored
  — wrap, do not refactor); `client/INSIGHTS.md` 2026-08-16 for the explicit
  carve-out that makes this legal
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** `rg -n 'ci-runs' client/src/vendor/ui/nav.ts` returns both the
  `NAV` row and the `SHORTCUTS` row, and
  `git diff --stat client/src/vendor/` shows `nav.ts` as the only changed file.

## Verification plan

| Package | Command | Runs when |
|---|---|---|
| server | `cd server && pnpm typecheck` | Dispatches 1, 2, 3 |
| server | `cd server && pnpm arch` | Dispatches 1, 2, 3 — exit 0 only; never widen a glob or add a `pathNot` to quiet it |
| server | `cd server && pnpm test` | Dispatches 2, 3, and the test hop — read the **test count**, not the exit code |
| server | `cd server && pnpm db:generate` then `cd server && pnpm db:migrate` | Dispatch 1 only |
| client | `cd client && pnpm typecheck && pnpm lint && pnpm test` | Dispatches 4, 5 |
| — | `./scripts/check-shared-sync.sh` | Dispatch 1 (and again at the end). **Never with `--update`** |
| — | `git ls-files -s server/CLAUDE.md client/CLAUDE.md` shows mode `120000` | Dispatch 1 (Step 1.6 touches `server/AGENTS.md`) |

`reviewer-core` is not touched, so its lane does not run.
`./scripts/pr-self-review.sh` is **not** run in any hop — it `cd`s to the primary
worktree root and cannot gate a change built here (root `INSIGHTS.md`
2026-08-06).

## Acceptance-facing checks

Each row restates a criterion the spec already states, phrased so a command or a
`path:line` settles it. Nothing here is new. `AC-N` identifiers are the handoff
to `test-writer`.

| AC | Settled by |
|---|---|
| AC-1 | `rg -n 'circle\|jenkins\|Generic CLI' client/src/app/agents/ client/messages/en/ci.json` → no match |
| AC-2 | `ExportToCiWizard` step 1's advance control is disabled while the repository field is empty — a unit test on the rendered control's disabled state |
| AC-3 | The preview response's `files[]` contains the manifest, one entry per linked skill, the memory file, the workflow and the runner; the workflow's `contents` is rendered in the pane |
| AC-4 | While the preview mutation is pending, the busy indicator is in the document and the advance control is disabled |
| AC-5 | On a rejected preview or install mutation, the error text contains the server's reported reason and the step-1 repository value is unchanged |
| AC-6, AC-7 | On arrival at Configure, ≥1 trigger is checked; unchecking down to one and clicking that one leaves it checked |
| AC-8 | `OPENROUTER_API_KEY` and `GITHUB_TOKEN` are named in the Configure step; no input in the wizard subtree accepts a secret value |
| AC-9 | Both branch-protection statements are present in the Configure step |
| AC-10 | `buildWorkflowYaml({ postAs: 'pr_comment' })` contains `DEVDIGEST_POST_AS: pr_comment`; `'none'` contains `DEVDIGEST_POST_AS: none` |
| AC-11 | Satisfied by reuse — `git diff` on `client/src/vendor/ui/ExportWizardSteps.tsx` is empty and the wizard renders it |
| AC-12 | The generated workflow contains `node .devdigest/runner/index.js` and matches no `uses:.*devdigest/` |
| AC-13 | The generated workflow's `permissions:` block has exactly `contents: read` and `pull-requests: write` |
| AC-14 | The generated workflow contains `pull_request:` and does **not** contain the substring `pull_request_target` |
| AC-15 | The review job carries the same-repository `if:` guard; the fork path has no publish step, no artifact upload, and does not fail the job |
| AC-16 | The generated files contain `OPENROUTER_API_KEY` and match no `OPENAI_API_KEY` or other provider key name |
| AC-17 | Every credential in every generated file matches `\$\{\{ secrets\.[A-Z_]+ \}\}`; no literal value |
| AC-18 | Every `uses:` line naming a third-party action matches `@[0-9a-f]{40} # v` |
| AC-19 | `install` calls `commitFiles` with `branch: 'devdigest/ci'` and never with the base branch; then `openPullRequest` against `input.base` |
| AC-20 | Two consecutive `install` calls for one agent+repo leave one `ci_installations` row, one `commitFiles` branch and one `findOpenPr` reuse — a `ci.it.test.ts` case |
| AC-21 | `buildPrBody` output contains all five checklist items |
| AC-22 | On install success the wizard shows the PR link, and `useInstallCi.onSuccess` invalidates `ciInstallationsKey(agentId)` |
| AC-23 | When `commitFiles` or `openPullRequest` throws, `ci_installations` gains no row — a `ci.it.test.ts` case |
| AC-24 | The wizard opened with a pre-fill prop shows that repository selected with its previous triggers and publish mode, and `install` is called for that repo only |
| AC-25 | `refresh` requests at most `CI_MAX_RUNS_PER_REFRESH` per installation and upserts every run not already recorded |
| AC-26 | The persisted `github_url` equals `WorkflowRunSummary.htmlUrl`; no field of the record is read from the artifact except `findings_count` and `cost_usd` |
| AC-27 | A malformed artifact, an over-cap archive, and one whose `pr_number` disagrees with the run each yield a record with `findings_count: null` and `cost_usd: null` |
| AC-28 | A run with no accepted artifact renders the no-result wording plus a working job link |
| AC-29 | `toRunRecord(run, { findings_count: 0, … })` produces `status: 'no_findings'`, not `'failed'` and not a null-result record |
| AC-30 | `rg -n 'cost_usd.*\?\?\s*0\|costUsd.*\?\?\s*0' server/src/modules/ci/ client/src/app/ci-runs/` → no match; the null cost cell renders the placeholder |
| AC-31 | Every ingested record carries `source: 'ci'` |
| AC-32 | `rg -n 'ci-runs' client/src/vendor/ui/nav.ts` returns a `NAV` row; each rendered run offers a PR link and a job link |
| AC-33 | An agent with zero installations renders exactly one empty state, naming the export action |
| NFR-1 | `install` is wrapped in `withTimeout(..., 60_000)` and its timeout error message names `devdigest/ci` |
| NFR-2 | `listWorkflowRuns` is called with `perPage: 20` |
| NFR-3, NFR-4 | `rg -n 'container\.llm\|container\.embedder' server/src/modules/ci/` → no match |
| NFR-5 | A refresh that throws for one installation leaves that installation's previously recorded runs in the list |
| NFR-6 | Records persist — covered by the `ci.it.test.ts` upsert cases |
| NFR-7 | No requirement. Nothing to check |
| NFR-8 | No requirement beyond AC-20 |

## Recommendations not taken

- **Recommendation 2 (declined by the caller):** the Preview response carries the
  full runner-bundle bytes rather than an emptied `contents`. Simplicity was
  chosen over payload economy, and §Not in scope already defers byte-size caps
  and display entirely. Cost carried forward: the `POST /agents/:id/export-ci`
  preview response is multi-megabyte, TanStack Query will hold it in the mutation
  result, and every retry re-transfers it. Recorded as a risk below rather than
  worked around.

## Risks & open questions

1. **`agent-runner/dist/index.js` does not exist in a fresh clone.** It is
   git-ignored by `agent-runner/.gitignore:2`, which — being deeper — overrides
   root `.gitignore:5`'s `!agent-runner/dist/`. **Default:** the export throws
   `ConfigError` naming the path and the `cd agent-runner && pnpm install && pnpm build`
   remedy; the prerequisite is recorded in `server/AGENTS.md` (Step 1.6). The
   implementer must run that build before any manual end-to-end check, or every
   export fails at Step 2.4.
2. **Root `.gitignore:3-6` documents a superseded design.** It says the runner
   "ships as a JS GitHub Action — its bundled `dist/` MUST be committed (GitHub
   runs `action.yml main: dist/index.js`)". No `action.yml` exists anywhere, and
   AC-12 forbids a `devdigest/*` action. **Default:** leave the comment alone —
   root `.gitignore` is outside this worktree's `ci/` fence. Worth capturing with
   `engineering-insights`: a `.gitignore` negation is silently overridden by a
   deeper `.gitignore`, and this one's justifying comment describes a design that
   was dropped.
3. **`agent-runner/src/index.ts:5` and `agent-runner/insights/INSIGHTS.md:38`
   both name `server/src/modules/ci/workflow.ts`, which this plan deliberately
   does not create.** They will be stale documentation the moment Dispatch 2
   lands. **Default:** do not touch `agent-runner/**` (caller's instruction, and
   §Non-goals). Flag it for `doc-writer` after this ships.
4. **AC-3's memory file has no consumer.** `agent-runner/src/run.ts:93-94` loads
   only the manifest and the skill bodies. The generated `.devdigest/memory.md` is
   inert — a file a human reads in the target repository, nothing more.
   **Default:** generate it as agreed (Q4 → A). If a later version wants it read,
   that is a change to `agent-runner`, which is out of scope here.
5. **AC-27's repository half is structural, not a field comparison.**
   `CiResultArtifact` carries no repo field, so "names a repository that
   disagrees" cannot be checked by comparing values. **Default:** the artifact is
   only ever fetched *through* a run id GitHub attributes to this installation's
   repository, so a file naming another repository is unreachable by
   construction; the docblock on `parseResultArtifact` says so. If a reviewer
   wants a field-level check, it needs a contract change the caller declined.
6. **AC-31's "wherever the two are listed together".** This plan sets
   `ci_runs.source = 'ci'` and deliberately does **not** write `agent_runs`, whose
   `source` column already exists — writing it would reach into the reviews slice,
   which the caller fenced off to the sibling worktree. **Default:** CI Runs is a
   CI-only list, so the two are never listed together in v1. If a combined list
   is wanted, it is cross-worktree work.
7. **Two merges made to fit the five-dispatch ceiling.** Dispatch 1 spans rings 0,
   3 and 4 in one context, which is the shape `backend-onion-architecture` §2
   warns about; the mitigation is that its edits are almost entirely additive and
   `pnpm arch` runs at its end. The i18n rewrite is folded into Dispatch 4, so
   Dispatch 5's components depend on keys written by Dispatch 4 — an **ordering**
   constraint, not a parallelism hazard, since nothing runs in parallel.
8. **Multi-megabyte preview response** (Recommendation 2 declined). No cap, no
   truncation, and the runner bytes are re-sent on every retry. **Default:**
   accept it; §Not in scope defers size handling entirely. Revisit if a real
   runner bundle bothers a real repository.
9. **`react-testing-library` contradicts this repo.** The vendored skill mandates
   `userEvent`; `client/INSIGHTS.md` (2026-08-08) records that
   `@testing-library/user-event` is not installed here. **Default:** `fireEvent`.
   The repo insight wins, and `test-writer` must be told so explicitly.
10. **Sentinel paths:** no step touches `server/src/db/migrations/**` by hand
    (Step 1.4 *generates* a new file and edits none), `reviewer-core/src/grounding.ts`,
    or `INJECTION_GUARD` in `reviewer-core/src/prompt.ts`. `client/src/vendor/ui/nav.ts`
    is under `*/src/vendor/**` and is raised here deliberately: `client/INSIGHTS.md`
    (2026-08-16) explicitly rules that adding a route row is config rather than a
    refactor, but it is still a vendored file and `architecture-reviewer` should
    see it flagged rather than discover it.
11. **`pnpm arch` is not wired into CI** (root `INSIGHTS.md` 2026-08-02). Every
    server dispatch must run it by hand; a green typecheck proves nothing about
    the rings.
12. **Pinned action SHAs must be resolved for real.** AC-18 fails on a
    placeholder. `gh api repos/actions/checkout/git/refs/tags/v4 --jq '.object.sha'`
    resolves it; dereference an annotated tag if the first response is a tag
    object rather than a commit.

## Out of scope

- **Everything in the spec's §Not in scope for v1** — the twenty deferred items,
  each with its stated reason. Not partially, not "while we're here".
- **The multi-agent review service and the pull-request feed.** `modules/reviews/**`,
  `modules/pulls/**`, `modules/polling/**`, `client/src/app/repos/[repoId]/pulls/**`
  are owned by the sibling worktree `emdash/multi-agents-review-jhnh3`. Verified:
  no step in this plan needs them. If one turns out to, **stop and ask** — that
  needs explicit confirmation.
- **`agent-runner/**`.** Not edited, not rebuilt as part of the plan (only run as
  a prerequisite), not corrected for its two stale docblocks. Its review pipeline,
  its grounding gate and `reviewer-core` are all §Non-goals.
- **Any `contracts/*.ts` change in either `vendor/shared` copy.** Only
  `adapters.ts` changes, and in both copies together.
- **Root `.gitignore`.** Item 2 above stays as it is.
- **Documentation.** No `docs/` page and no `AGENTS.md` §Read when row beyond Step
  1.6's prerequisite note. `doc-writer` picks this up after the feature lands,
  and it is the natural home for items 2 and 3.
- **Insight capture.** Subagents return `## Insight candidates`; the main session
  writes `INSIGHTS.md` (`CLAUDE.md` §Session protocol).

## Handoff

For `architecture-reviewer`:
- A **new slice** `server/src/modules/ci/` and its `modules/index.ts` registration
  — check §13 compliance (five manifest filenames, no `workflow.ts`) and that
  `modules/ci/**` imports no other slice's private file.
- `node:fs/promises` in `modules/ci/service.ts` (Step 2.4) — I/O in ring 2, with
  `repo-intel/service.ts:29` and `context/service.ts:1` as the precedent. Judge it;
  I have not.
- A **ring-0 port widening** on `GitHubClient`, in both `vendor/shared` copies.
- One edit inside `client/src/vendor/**` (`nav.ts`), sanctioned by
  `client/INSIGHTS.md` 2026-08-16 as config rather than refactor.
- Separate any pre-existing `backend-onion-architecture` §12 debt from new
  findings — `modules/pulls/routes.ts` is the most copyable file in the repo and
  the CI slice must not have inherited it.

For the security review:
- **New generated artifacts that execute in a third party's CI**: the workflow,
  the manifest, the skill bodies, the memory file. AC-13 (two permissions),
  AC-14 (`pull_request`, never `pull_request_target`), AC-15 (fork skip),
  AC-18 (SHA pinning) are the load-bearing ones.
- **New untrusted input**: `devdigest-result.json`, a zip downloaded from a
  repository DevDigest does not control. Check `safeParse`, the
  `CI_MAX_UNPACKED_BYTES` zip-bomb guard, and the AC-27 provenance rejection.
- **New outbound calls**: `actions.listWorkflowRuns`, `listWorkflowRunArtifacts`,
  `downloadArtifact` on an operator-supplied `owner/name`.
- **New user input reaching generated files**: `repo`, `triggers`, `post_as`, and
  the agent's own `name` / `system_prompt` / skill bodies, all interpolated into
  YAML that will execute elsewhere. `parseRepoFullName` and `validateTriggers` are
  the allowlists.
- **Secrets**: no new secret is introduced; `OPENROUTER_API_KEY` is named and
  never read. Confirm no code path logs the GitHub token and that no generated
  file, artifact or log line can carry a credential value (AC-17).
- **New migration**: `0019_*.sql`, additive, two unique indexes and one composite
  index on previously unconstrained tables.

