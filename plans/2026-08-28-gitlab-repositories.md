# SPEC-06 GitLab repositories — implementation plan

## Task

Make DevDigest work against operator-registered GitLab instances — gitlab.com and self-managed alike — for instance registration, repository import, merge-request browsing, review posting and provider-correct labelling, without changing anything an existing GitHub user sees.

## Requirements source

`specs/2026-08-28-gitlab-repositories.md` (SPEC-06), all sections. This plan implements it and cites it; it does not restate, refine or amend it. Where this plan disagrees with the spec, the disagreement is in `## Risks & open questions` with its evidence, never resolved silently.

Note the spec-id hazard recorded in root `INSIGHTS.md` 2026-08-28: `SPEC-05` is used by two files, so refer to specs by **filename**, not by id, anywhere this plan is cross-referenced.

## Answers taken

Intake returned in the same turn; the caller answered nothing, so every question proceeds on its stated default and **each is an unconfirmed assumption**:

- **Q1 → B.** AC-34…AC-41, AC-48, NFR-3, NFR-8 are planned as **Stage E** and marked **blocked on a requirements decision** — NFR-3 names a GitHub cap that does not exist.
- **Q2 → A.** AC-43 is implemented as per-repository sync isolation on the existing manual poll. No scheduler is built.
- **Q3 → A.** `CiExportInput` gains a nullish `instance_id`; AC-48 refuses on a GitLab-resolved repository.
- **Q4 → A.** No test-only SSRF bypass. The GitLab adapter is tested against recorded HTTP fixtures; the live path is a manual `e2e/` flow.
- **Q5 → A.** `ForgeClient` is extracted; `GitHubClient extends ForgeClient` keeps the five CI-only methods.
- Recommendations 1–4 all proceed as specified (five staged PRs; `instance_key` column; `SecretsStatus` untouched; origin check in `clone()`).
- **Mode: multi-agent**, five sequential stages.

The intake block that produced these answers — including the requirements check that found five places where the spec's own claims about the repo do not hold — is preserved verbatim in `## Appendix — intake` at the end of this file.

## Context read

- Root `INSIGHTS.md` (2026-08-28, "GitLab's licensed TIER is unreadable by a non-admin credential") — the source of AC-7/AC-8/AC-9/AC-39 and of the `#L1-2` vs `#L1-L2` anchor difference (AC-30). Binds Steps A5, A6, D2.
- Root `INSIGHTS.md` (2026-08-28, "`rg '^Spec ID: SPEC-'` cannot detect a DUPLICATE spec id") — refer to specs by filename. Binds every doc reference in this plan.
- Root `INSIGHTS.md` (2026-08-16, "The clone is a mirror that hard-resets on sync") — `sync()` runs `reset --hard`, so a wrong clone location is destructive, not read-only. Binds Steps B4, B5.
- Root `INSIGHTS.md` (2026-08-11, "A REQUIRED new field on a jsonb-persisted contract goes on a sibling response schema") — applies to the post-back outcome (Step E5), **not** to `Repo`, which is a table-backed DTO.
- Root `INSIGHTS.md` (2026-08-02, "A field added to a persisted-jsonb contract must be `.nullish()`") — binds Step E5 only; no other contract in this plan is jsonb-persisted.
- Root `INSIGHTS.md` (2026-08-01 / 2026-08-02, "`@devdigest/shared` drifts silently" / "`diff -r` is the wrong check") — every contract step ships both copies and is verified with `./scripts/check-shared-sync.sh`, never `diff -r`. Binds A1, B1, C1, E1.
- Root `INSIGHTS.md` (2026-08-05, "A skill body must NOT be `wrapUntrusted`-wrapped") — read and **rejected as out of scope**: the spec's §Untrusted inputs cites it only to state the inverse rule, and this plan does not touch `reviewer-core/src/prompt.ts`.
- Root `INSIGHTS.md` (2026-08-02, "The `pnpm arch` boundary gate is not wired into CI") — `pnpm arch` must be run by hand in every server step; a green CI is not evidence.
- Root `INSIGHTS.md` (2026-08-25, "Splitting a plan into disjoint-file-ownership hops lets a renamed symbol's stale COMMENT survive") — Step C2 renames the port; the docblocks in `mocks.ts`, `container.ts` and `pulls/routes.ts` are named explicitly in that step's file list.
- `server/INSIGHTS.md` (2026-08-28, "The clone location is derived from two path segments and `clone()` REUSES any directory that already has a `.git`") — the exact hazard AC-17/AC-18 exist for. Binds B4, B5.
- `server/INSIGHTS.md` (2026-08-25, "`GET /runs/:id/trace` has NO workspace predicate") — read and **rejected**: pre-existing debt in a file this plan does not touch. Named for the security reviewer, not fixed here.
- `server/INSIGHTS.md` (2026-08-17, "A slice's `constants.ts` export is a sanctioned cross-slice import; a pure helper is not — promote to `modules/_shared/<name>.ts`") — binds Step B3, where `repos` needs the `instances` slice's admission helper.
- `server/INSIGHTS.md` (2026-08-08, "`no-cross-slice-import` scopes its `from` to `^src/modules/`") — why `container.forge()` in Step C3 is the sanctioned channel and a direct import is not.
- `server/INSIGHTS.md` (2026-08-02, "A SKIPPING integration suite silently reads as passing") and (2026-08-03, "the `*.it.test.ts` skip is a CONCURRENCY race") — read the test **count**, not the exit code, on every `*.it.test.ts` step.
- `client/INSIGHTS.md` (2026-08-09, "Two panels of one screen reading two query keys go stale ASYMMETRICALLY") — binds Step D6's instance/repository panels.
- `client/INSIGHTS.md` (2026-08-16, "A message reproducing engine output goes through `t.raw`") — read and **rejected**: no new message in this plan reproduces engine output.
- `client/INSIGHTS.md` (2026-08-16, "Shipped-but-unwired scaffolding also ships a stale product decision") — directly on point for `client/messages/en/compose.json`, which names GitHub four times and has **no consumer**. Binds Step D3.
- `AGENTS.md` §Repo rules — `@devdigest/shared` twice, secrets via `SecretsProvider` only, migrations never on boot, `*.it.test.ts` naming, English-only Markdown.
- `AGENTS.md` §Do not touch — `server/src/db/migrations/**`, `reviewer-core/src/grounding.ts`, `INJECTION_GUARD`, `*/src/vendor/**` ("extend, never reorganise").
- `docs/` — no document names GitLab; `docs/l02-experiment.md` is not relevant (no prompt change is proposed).

## Inventory — what already exists

| Thing | Where | Verdict |
|---|---|---|
| Repository import, URL parse, clone job | `server/src/modules/repos/{routes,service,helpers,constants,repository}.ts` | **extend** — single-host allowlist at `helpers.ts:45-47`, two-segment shape at `:51` |
| `repos` table | `server/src/db/schema/repos.ts` | **extend** — needs `provider`, `instance_id`, `instance_key`, `namespace_path`; unique index at `:32` must be replaced |
| Change-request store keyed by repo + integer | `server/src/db/schema/pulls.ts:16,31` | **reuse, unchanged** — spec §Contract promises is right; no new identifier |
| `GitClient` / `clonePathFor` | `server/src/adapters/git/simple-git.ts:37-39` | **extend** — clone path, reuse-if-exists guard |
| `RepoRef {owner,name}` | `server/src/vendor/shared/adapters.ts:107-110`, 11 files | **extend** — add an **optional** `instanceKey`; a required field breaks `CodeIndex`, `repo-intel`, `conventions`, `intent`, `brief` |
| `GitHubClient` (12 methods) | `server/src/vendor/shared/adapters.ts:172-215`; impl `adapters/github/octokit.ts` | **extend** — split into `ForgeClient` + GitHub-only remainder |
| `container.github()` (single lazy client) | `server/src/platform/container.ts:~200,300-304` | **extend** — add `container.forge(repoRow)`; keep `github()` for the `ci` slice |
| `container.git`, `codeIndex`, `repoIntel` | `container.ts:106-142` | **reuse** |
| `SecretsProvider` with open `SecretKey` (`string & {}`) | `adapters.ts:317`; `adapters/secrets/local.ts` | **reuse** — N per-instance keys need no contract change |
| Manual PR-list sync | `server/src/modules/polling/routes.ts:20` | **extend** — one repo, manual; **no scheduler exists** |
| Inline comments, live-fetched | `server/src/modules/pulls/routes.ts:331-384` | **extend** — id widening; note this file is §12 debt (~25 Drizzle sites in ring 5) |
| `PrReviewComment` / `PrCommentInput` (integer ids) | `contracts/platform.ts:227-253` | **extend** → strings (AC-23) |
| `ConnTestProvider`, `SecretsStatus` (closed) | `contracts/platform.ts:110-133` | **leave alone** (Recommendation 3) |
| `postReview` on the port | `adapters.ts:178`, `octokit.ts:138`, `mocks.ts:198` | **new in practice** — zero production callers; `rg -n "postReview" . -g '!node_modules'` → 5 hits, all port/adapter/mock/test |
| Export-to-CI | `server/src/modules/ci/{routes,service}.ts`; `CiExportInput` at `contracts/eval-ci.ts:339` | **extend** — refusal only (AC-47, AC-48) |
| Deep-link builders | `client/src/lib/github-urls.ts` **and** `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/helpers.ts:42` | **extend** — **two**, not one |
| GitHub literals in copy | 7 files: `shell`, `settings`, `prReview`, `blast`, `ci`, `compose`, `agents` (24 lines) | **extend** |
| Hard-coded import guidance | `client/src/app/onboarding/_components/AddRepoView/AddRepoView.tsx:79,94,99` | **extend** — move into the catalogue |
| Settings screen | `client/src/app/settings/[section]/**` | **extend** — new instances section |
| Client data layer | `client/src/lib/hooks/*.ts` (16 domain files) + `lib/api.ts` | **extend** — new `instances.ts` hook file |
| `git_instances` table / `instances` slice | — | **new**. `rg -n "instance" server/src/db/schema/*.ts` → no match; `ls server/src/modules` → 20 slices, none named `instances` |
| GitLab adapter | — | **new**. `rg -rni "gitlab" server/src client/src` → no match outside this spec |
| Per-instance rate-limit gate | `server/src/platform/resilience.ts` exists | **extend** |

## Constraints that bind

| Rule | Applies? | What the implementation must do |
|---|---|---|
| `@devdigest/shared` exists twice | **yes** | Every contract step edits `server/src/vendor/shared/**` (canon) **and** `client/src/vendor/shared/**` in the **same step**. Verify with `./scripts/check-shared-sync.sh`, never `diff -r` (root `INSIGHTS.md` 2026-08-01). `AGENTS.md` §Do not touch: extend `vendor/**`, never reorganise it. |
| Field on a **jsonb-persisted** contract | **Stage E only** | The post-back outcome is new required information about a run → a **sibling response schema** + its own table, never a new required key inside `run_traces` jsonb (root `INSIGHTS.md` 2026-08-11, and the spec's own §Contract promises). Any optional field added to an existing jsonb contract is `.nullish()`, never `.nullable()` (2026-08-02). |
| DB-backed test naming | **yes** | Every test touching Postgres is `server/test/<name>.it.test.ts`. Read the **count** — `N skipped` is unverified (`server/INSIGHTS.md` 2026-08-02, 2026-08-03). |
| Migration | **yes** | Generated with `cd server && pnpm db:generate`, applied by hand with `pnpm db:migrate`. Never on boot. **Existing files under `server/src/db/migrations/**` are never edited** — the next file is `0022_*`. `db:generate` emits DDL only; the backfill is achieved by a column **default**, not by hand-written DML (Recommendation 2). |
| Ring / import direction | **yes** | New `instances` slice is `routes → service → repository` + pure `helpers.ts`/`constants.ts` only (`backend-onion-architecture` §13 — an invented filename is outside every gate rule). Ports in ring 0, impls in `adapters/`, resolved from the container (§3, §4). Run `cd server && pnpm arch` — not wired into CI (root `INSIGHTS.md` 2026-08-02). |
| `reviewer-core` | **no** | Spec §Non-goals; nothing in this plan reaches `reviewer-core/src/**`, `grounding.ts` or `INJECTION_GUARD`. |
| New file placement in `client/` | **yes** | `frontend-ui-architecture` §1 placement, §2 promotion. A provider-aware link builder used by 5 surfaces across 2 route trees is a shared `client/src/lib/` module, not a route-local helper. |
| Secrets | **yes** | N per-instance credentials go through `SecretsProvider` under a derived key (`GITLAB_TOKEN_<instanceId>`). `SecretKey` is already `string & {}` — no contract change. Never in `git_instances`, never in `AppConfig` (`platform/config.ts:8-13` says so in its own docblock), never in a response (AC-10). Call `container.invalidateSecretCaches()` after a write. |
| `CLAUDE.md` / `AGENTS.md` | **yes, docs step only** | Edit `AGENTS.md`; `CLAUDE.md` stays a symlink (mode `120000`). |
| Empty reserved tables | **yes** | `ci_*`, `eval_*`, `memory`, `digests`, `onboarding` and `composed_reviews` are reserved. **Do not repurpose `composed_reviews` for the Stage E post-back record** — add a new table. |
| New rule in an agent `system_prompt` | **no** | No prompt change is proposed. |

## Modules touched

| Package | Path | Ring / layer | Why |
|---|---|---|---|
| server | `src/vendor/shared/contracts/instances.ts` *(new)*, `contracts/platform.ts`, `adapters.ts` | 0 | `GitInstance`, `RepoProvider`, `ApprovalCapability`, `InstanceTestResult`; `Repo` fields; `PrReviewComment` id widening; `ForgeClient` port |
| server | `src/db/schema/{instances.ts (new),repos.ts,schema.ts}`, `src/db/migrations/0022_*` | 3 | `git_instances`; `repos` provider/instance/namespace + unique index |
| server | `src/modules/instances/**` *(new slice)* | 2 · 3 · 5 | Register, verify, probe, test, list, delete |
| server | `src/modules/_shared/forge-url.ts` *(new)* | 2 | Origin admission + namespace parse, shared by `repos` and `instances` (`server/INSIGHTS.md` 2026-08-17) |
| server | `src/modules/repos/{helpers,service,constants,repository}.ts` | 2 · 3 | Instance-aware import, clone key, dedupe |
| server | `src/modules/{pulls,polling}/routes.ts` | 5 | Forge resolution, string comment ids, per-repo sync isolation |
| server | `src/modules/{intent,brief}/pipeline.ts` | 2 | Both call `container.github()` directly |
| server | `src/modules/ci/{service,routes}.ts` | 2 · 5 | AC-48 refusal |
| server | `src/adapters/gitlab/**` *(new)*, `adapters/git/simple-git.ts`, `adapters/github/octokit.ts`, `adapters/mocks.ts` | 3 | GitLab REST client, clone isolation, port conformance, new mock |
| server | `src/platform/{container,resilience}.ts` | 4 · 3 | `container.forge()`, per-instance rate gate |
| client | `src/vendor/shared/**` | 0 | Manual copy of every canon change |
| client | `src/lib/{forge-urls.ts (new),github-urls.ts,hooks/instances.ts (new)}` | shared | Provider-aware links; instances data layer |
| client | `src/app/settings/[section]/**`, `src/app/onboarding/.../AddRepoView/**`, `src/app/repos/[repoId]/**` | app | Instances screen; neutral import guidance; provider labels and links |
| client | `messages/en/{shell,settings,prReview,blast,ci,compose,agents,onboarding}.json` | copy | AC-28, AC-32 |
| mcp | `src/tools.ts`, `src/handlers.ts`, `src/index.ts` | — | Provider-neutral wording (spec §Contract promises, last row) |

## Skills — read by the planner, to be loaded by the executor

| Path glob | Skill | Sections | routing.md row | Rule it imposes on this plan |
|---|---|---|---|---|
| `server/src/modules/**/routes.ts` | `backend-onion-architecture` *(preloaded)* | §6, §13, §2 | Backend row 1 | A new slice is `routes.ts` + **one import and one entry in `modules/index.ts`** — without it every endpoint 404s and no gate says a word |
| same | `fastify-best-practices` | `rules/schemas.md`, `rules/error-handling.md`, `rules/routes.md` | Backend row 2 | Zod lives in the route `schema:`; a hand-rolled `.parse(req.body)` in a handler is forbidden. Throw `AppError` subclasses, never `reply.code(500)` |
| same, and `server/src/adapters/**` | `security` | A01, A05, A06, A10, "Framework Security Quirks → Node.js" | Backend rows 3, 8 | AC-2…AC-5/AC-11 are the SSRF control: the operator's base URL decides an outbound destination, so it is validated **before any request**, fail-closed, and never echoed. `path.join()` with user input allows traversal — the clone destination must be `resolve()`-checked against `cloneDir` |
| `server/src/modules/**/repository.ts` | `backend-onion-architecture` §5 | §5 | Backend row 4 | Constructor takes `Db`, not `Container`; nothing Drizzle-shaped crosses the boundary; every method workspace-scoped |
| same | `drizzle-orm-patterns` | `references/migrations.md`, queries | Backend row 5 | `generate` + `migrate`, never `push` |
| `server/src/db/schema/**` | `postgresql-table-design` | Constraints, Indexing, Safe Schema Evolution | Backend row 6 | `TIMESTAMPTZ`, `TEXT`, **FK columns are not auto-indexed**, and `UNIQUE` treats NULLs as distinct — which is exactly why `instance_key` is `NOT NULL DEFAULT` rather than a nullable `instance_id` in the index |
| same | `drizzle-orm-patterns` | schema definition | Backend row 6 | `.references(() => t.col)` as an arrow function |
| `server/src/db/migrations/**` | — | — | Backend row 7 | **sentinel** — see `## Risks & open questions` |
| `server/src/modules/**` (service/helpers) | `backend-onion-architecture` *(preloaded)* | §1, §5, §8, §13 | Backend row 8 | A ring-2 service may read `container.<port>` but **never `container.db`**; a pure transform goes in `helpers.ts`; an invented filename is a `.dependency-cruiser.cjs` change, not a file change |
| `server/src/adapters/**` | `backend-onion-architecture` §3 | §3, §4 | Backend row 9 | Name the capability, not the library — `ForgeClient`, never `GitLabRestWrapper`. **Every new port needs a mock in `adapters/mocks.ts` that `implements` it** |
| `server/src/platform/**` | `backend-onion-architecture` §4 | §4 | Backend row 11 | Never `new` an adapter outside `container.ts`; `ConfigError` from a resolver is a normal path, not a 500 |
| `server/test/**` | `backend-onion-architecture` §9 | §9 | Backend row 12 | Ring 3 → `*.it.test.ts` with real Postgres; ring 5 → `buildApp({ overrides })` + `app.inject()`; the filename is the CI split |
| `*/src/vendor/shared/**`, any `z.object(` | `zod` | `parse-use-safeparse`, `object-optional-vs-nullable`, `schema-use-enums`, `error-custom-messages` | Contracts rows 1–2 | `.nullish()` on a jsonb-persisted field; a closed set is `z.enum`; a rejection reason is a typed code, not prose |
| `client/src/app/**/*.tsx`, `client/src/components/**` | `frontend-ui-architecture` *(preloaded)* | §1, §2, §3, §5 | Frontend row 1 | A builder used by two route trees is promoted to `src/lib/` in the same commit as the second consumer |
| same | `react-best-practices` | "Derive, Don't Store", Accessibility, Conditional Rendering | Frontend row 2 | AC-31's provider label must be **text in the accessible name**, not an icon or colour — same rule as `aria-label` on icon-only buttons |
| `client/src/lib/**` | `frontend-ui-architecture` | §1, §2, §6 | Frontend row 6 | A value encoding an external contract (a provider's URL shape) earns a shared home |
| `client/src/**/*.test.tsx` | `react-testing-library` | Query priority, `userEvent`, "What to Test / What to Skip" | Frontend row 5 | Assert the rendered `href` and the accessible name; never a CSS class |
| `mcp/src/**` | `security` | input handling, untrusted content | MCP row 1 | Tool text is data; provider wording change must not alter what the tool trusts |
| `server/src/db/migrations/**`, `reviewer-core/src/grounding.ts`, `INJECTION_GUARD` | — | — | sentinels | See `## Risks & open questions` |

## Execution

**Multi-agent, five sequential stages.** Each stage is one `/impl plans/<slug>.md` invocation, one PR, and one review cycle. Stages do not overlap in files; **within** a stage the hops are strictly sequential because every stage begins with a contract or schema change its own later steps consume.

| # | Agent | Input artifact | Steps | Files owned | Output |
|---|---|---|---|---|---|
| A1 | `implementer` | `plans/2026-08-28-gitlab-repositories.md` §Stage A | A1–A7 | `server/src/vendor/shared/contracts/instances.ts`, `client/src/vendor/shared/contracts/instances.ts`, `*/src/vendor/shared/index.ts`, `server/src/db/schema/instances.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/0022_*`, `server/src/modules/instances/**`, `server/src/modules/_shared/forge-url.ts`, `server/src/modules/index.ts`, `server/src/adapters/gitlab/**`, `server/src/adapters/mocks.ts`, `server/src/platform/{container,resilience}.ts` | working tree |
| A2 | `plan-verifier` | the same path | — | none (read-only) | conformance table; `not-met` → back to A1 |
| A3 | `test-writer` | the same path + `AC-1…AC-12`, `AC-45`, `AC-46`, `NFR-1`, `NFR-2` + A2's `unverifiable` rows | A7 | `server/test/instances-admission.test.ts`, `server/test/instances.it.test.ts`, `server/test/gitlab-adapter.test.ts` | tests |
| A4 | `architecture-reviewer` ∥ security review | changed-file list | — | none (read-only) | boundary + SSRF findings |
| B1 | `implementer` | §Stage B | B1–B6 | `*/src/vendor/shared/contracts/platform.ts`, `*/src/vendor/shared/adapters.ts`, `server/src/db/schema/repos.ts`, `server/src/db/migrations/0023_*`, `server/src/modules/repos/**`, `server/src/adapters/git/simple-git.ts` | working tree |
| B2–B4 | `plan-verifier` → `test-writer` → `architecture-reviewer` ∥ security | as above | B6 | `server/test/repos-url.test.ts`, `server/test/clone-isolation.test.ts`, `server/test/repos-instances.it.test.ts` | — |
| C1 | `implementer` | §Stage C | C1–C7 | `*/src/vendor/shared/adapters.ts`, `*/src/vendor/shared/contracts/platform.ts`, `server/src/adapters/{gitlab,github,mocks}`, `server/src/platform/container.ts`, `server/src/modules/{pulls,polling,intent,brief}/**` | working tree |
| C2–C4 | `plan-verifier` → `test-writer` → `architecture-reviewer` ∥ security | as above | C7 | `server/test/gitlab-mr.test.ts`, `server/test/pulls-comments.it.test.ts`, `server/test/forge-resolution.it.test.ts` | — |
| D1 | `implementer` | §Stage D | D1–D8 | `client/src/lib/**`, `client/src/app/**`, `client/messages/en/*.json`, `mcp/src/**`, `server/src/modules/ci/**` (AC-47 read path only) | working tree |
| D2–D4 | `plan-verifier` → `test-writer` → `architecture-reviewer` | as above | D8 | `client/src/lib/forge-urls.test.ts`, `client/src/app/**/*.test.tsx` | — |
| D5 | `doc-writer` | changed-file list + this plan | — | `docs/gitlab-repositories.md`, `AGENTS.md` §Read when, `server/AGENTS.md`, `client/AGENTS.md` | documentation |
| E* | **blocked** | — | E1–E6 | — | see Q1 / `## Risks` |

Three rules this table satisfies:

- **`Input artifact` is a path**, never a summary — subagents share no context (`.claude/agents/README.md` §How they chain).
- **`test-writer` is given `AC-N` behaviours plus `plan-verifier`'s `unverifiable` rows**, never a command list. AC-4, AC-11 and AC-25 will land in that bucket (Q4).
- **`Files owned` sets are disjoint per hop.** The only parallel pair anywhere is `architecture-reviewer` alongside the security review — both read-only. Three combinations are explicitly **never** parallel here: the two `vendor/shared` copies (one agent, one step), the migration and the repository that reads it, and the contract and its consumer. Ordering is therefore: contracts → migration → repository → service → routes → client.

## Steps

### Stage A — instance registry (PR 1)

Covers **AC-1…AC-12, AC-45, AC-46, AC-10, NFR-1, NFR-2, NFR-5, NFR-6, NFR-10, NFR-11, NFR-12 (partial)**.

#### Step A1 — Ring-0 contracts for an instance

- **Files:** `server/src/vendor/shared/contracts/instances.ts` *(new)*, `server/src/vendor/shared/index.ts`, `client/src/vendor/shared/contracts/instances.ts` *(new, manual copy)*, `client/src/vendor/shared/index.ts`
- **Change:** define, in canon then copy: `RepoProvider = z.enum(['github','gitlab'])`; `ApprovalCapability = z.enum(['permitted','refused','unknown'])`; `InstanceRejectionCode = z.enum(['not_https','credentials_in_url','private_address','tls_untrusted','cross_origin_redirect','unreachable','credential_rejected','capability_missing'])`; `GitInstance = z.object({ id, workspace_id, provider: RepoProvider, base_url, label, version: z.string().nullable(), edition: z.string().nullable(), approval_capability: ApprovalCapability, verified_at: z.string().nullable(), created_at })` — **no credential field of any kind** (AC-10); `GitInstanceInput = z.object({ base_url: z.string().url(), label: z.string().min(1).max(120), credential: z.string().min(1) })`; `InstanceTestResult = z.object({ instance_id, ok, code: InstanceRejectionCode.nullable(), message, version, edition, approval_capability })`. Export all from both `index.ts` barrels.
- **Skill:** `zod` `schema-use-enums` + `error-custom-messages` — a closed rejection set is an enum carrying a code, so AC-3/AC-4/AC-45 can be told apart by a consumer rather than by string-matching prose. `backend-onion-architecture` §1 — ring 0 imports `zod` and nothing else.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch` · `cd client && pnpm typecheck` · `./scripts/check-shared-sync.sh`
- **Done when:** `check-shared-sync.sh` exits 0 and `rg -n "credential" server/src/vendor/shared/contracts/instances.ts` matches only `GitInstanceInput`.
- **Covers:** AC-7, AC-8, AC-9, AC-10, AC-12, AC-46 (contract shape)

#### Step A2 — `git_instances` table and migration

- **Files:** `server/src/db/schema/instances.ts` *(new)*, `server/src/db/schema.ts`, `server/src/db/migrations/0022_*.sql` *(generated)*
- **Change:** `pgTable('git_instances', { id uuid pk defaultRandom, workspaceId uuid notNull references(() => workspaces.id, {onDelete:'cascade'}), provider text notNull, baseUrl text notNull, instanceKey text notNull, label text notNull, version text, edition text, approvalCapability text notNull default 'unknown', verifiedAt timestamptz, createdBy uuid references(() => users.id), createdAt: now() })` with `uniqueIndex('git_instances_ws_base_uq').on(workspaceId, baseUrl)`, `uniqueIndex('git_instances_ws_key_uq').on(workspaceId, instanceKey)` and `index('git_instances_ws_idx').on(workspaceId)`. Register in `db/schema.ts`. Generate with `cd server && pnpm db:generate`; apply with `pnpm db:migrate`.
- **Skill:** `postgresql-table-design` §Constraints — **PostgreSQL does not auto-index FK columns**, so `workspaceId` gets its own index; `TIMESTAMPTZ` and `TEXT`, never `timestamp`/`varchar(n)`. `drizzle-orm-patterns` §Constraints — `.references()` as an arrow function.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm db:generate` produces exactly one new `0022_*.sql`; `pnpm db:migrate`; `pnpm typecheck`
- **Done when:** `ls server/src/db/migrations/0022_*.sql` returns one file, no file `0000`–`0021` appears in `git diff --stat`, and `rg -n "credential|token|secret" server/src/db/schema/instances.ts` returns nothing.
- **Covers:** AC-10, NFR-12

#### Step A3 — Pure admission helpers

- **Files:** `server/src/modules/_shared/forge-url.ts` *(new)*
- **Change:** pure functions, no I/O: `normalizeBaseUrl(raw)` → `{ origin, pathPrefix }` or a typed rejection; `admitBaseUrl(raw)` returning `InstanceRejectionCode | null` for `not_https` (AC-2), `credentials_in_url` (AC-5: `u.username || u.password`), and `private_address` when the **host is an IP literal** in a loopback / link-local / unique-local / RFC1918 range (AC-4, syntactic half); `instanceKeyFor(baseUrl)` → a filesystem-safe slug (`host` + `_<port>` when non-default + `_`-joined path segments, each `encodeURIComponent`d, with `.`/`..` rejected); `matchOrigin(repoUrl, instances)` → the instance whose origin **and** path prefix the URL starts with, or `null` (AC-13, AC-14); `namespacePathFrom(repoUrl, instance)` → the remainder at any depth, trailing `.git` stripped, rejecting any segment that is `.` or `..` (AC-13, NFR-4).
- **Skill:** `backend-onion-architecture` §8 — a pure transform goes in a ring-2 helper, and `server/INSIGHTS.md` 2026-08-17 says a cross-slice pure helper is promoted to `modules/_shared/<name>.ts`, because a slice's `helpers.ts` is private while its `constants.ts` is not. `security` §Framework Security Quirks — `path.join()` with user input allows traversal, so the `.`/`..` rejection is here, not later.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `admitBaseUrl('http://x/')`, `admitBaseUrl('https://u:p@x/')`, `admitBaseUrl('https://127.0.0.1/')`, `admitBaseUrl('https://10.1.2.3/')` and `admitBaseUrl('https://[::1]/')` each return their distinct code, and `namespacePathFrom` accepts a four-segment path.
- **Covers:** AC-2, AC-4 (syntactic), AC-5, AC-13, AC-14, NFR-4

#### Step A4 — Per-instance rate gate

- **Files:** `server/src/platform/resilience.ts`
- **Change:** add a gate keyed by instance id that records a reported reset (`RateLimit-Reset` / `Retry-After`) and defers only that key's next request; other keys are unaffected. No global lock.
- **Skill:** `backend-onion-architecture` §1 — `platform/resilience.ts` is ring-3 platform machinery, so it may hold this; a service may not.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** a unit test shows key A paused past its reset while key B proceeds immediately.
- **Covers:** NFR-10, NFR-11

#### Step A5 — GitLab instance adapter: verify and probe

- **Files:** `server/src/adapters/gitlab/http.ts` *(new)*, `server/src/adapters/gitlab/instance.ts` *(new)*, `server/src/adapters/gitlab/index.ts` *(new barrel)*
- **Change:** `http.ts` — one `fetch` wrapper for a registered instance: `redirect: 'manual'`, treating any 3xx as `cross_origin_redirect` **without following it** (AC-11); `AbortSignal.timeout(30_000)` per request (NFR-2); a distinguishable TLS failure mapped to `tls_untrusted` by inspecting the `cause.code` (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `SELF_SIGNED_CERT_IN_CHAIN`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `CERT_HAS_EXPIRED`) — distinct from `unreachable` (AC-3); the per-instance rate gate from A4; and **the credential in a header only, never in a URL, never in a thrown message** (AC-10). It also performs the **runtime half of AC-4**: `dns.lookup(host, {all:true})` before the first request, rejecting `private_address` when any resolved address is loopback / link-local / unique-local / private-range, and naming the rejected host in the message. `instance.ts` — `verify(baseUrl, credential)` calling `GET {base}/api/v4/metadata` for `version` + `enterprise` (AC-7) then `GET {base}/api/v4/user` for identity, and `probeApproval()` mapping **404 → `unknown`, never `refused`** (AC-9), 200 → `permitted`, 403 → `refused`. Overall budget 10 s (NFR-1). No LLM call anywhere in this file (NFR-6).
- **Skill:** `security` A05/A10 + "Framework Security Quirks" — fail-closed: an unclassifiable error is `unreachable`, never a pass. `backend-onion-architecture` §3 — the port is named for the capability; this file is its GitLab implementation and lives in `adapters/`.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** the 404 branch returns `'unknown'` and there is **no** code path from a 404 to `'refused'` (`rg -n "refused" server/src/adapters/gitlab/instance.ts` shows only the 403 branch); root `INSIGHTS.md` 2026-08-28 is cited in the file's docblock.
- **Covers:** AC-3, AC-4 (runtime), AC-7, AC-8, AC-9, AC-11, AC-46, NFR-1, NFR-2, NFR-6, NFR-10

#### Step A6 — `instances` slice

- **Files:** `server/src/modules/instances/{routes,service,repository,helpers,constants}.ts` *(all new)*, `server/src/modules/index.ts`, `server/src/platform/container.ts`
- **Change:** routes — `POST /instances` (register: admit → verify → probe → persist, credential written via `container.secrets.set(instanceSecretKey(id))` then `container.invalidateSecretCaches()`), `GET /instances`, `POST /instances/:id/test` → `InstanceTestResult` (AC-12), `DELETE /instances/:id`. Every handler resolves `workspaceId` via `getContext` and scopes on it. Validation lives entirely in the route `schema:` (`GitInstanceInput`, `IdParams`). Rate-limit the register and test routes following `modules/ci/routes.ts:23-28`'s precedent. `constants.ts` holds ``instanceSecretKey(id) => `GITLAB_TOKEN_${id}` `` and the timeouts. `service.ts` never reads `container.db`. **`modules/index.ts` gets one import and one entry** — without it every endpoint 404s and no gate notices. `container.ts` gains `instancesRepo` if any other slice needs it (Stage B does).
- **Skill:** `backend-onion-architecture` §6 (route = HTTP + Zod, no logic, no SQL; throw `AppError` subclasses), §13 (the five manifest filenames — an invented sixth is a `.dependency-cruiser.cjs` change), §4 (`container.<port>`, never `container.db` in a service), and **"a slice is dead until `modules/index.ts` names it"**. `fastify-best-practices` `rules/schemas.md` — 422 before the handler runs. `security` A01 — deny by default; the `:id` in the URL is attacker-controlled and is scoped by `workspaceId` in the repository, not the route.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch && pnpm exec vitest run --exclude '**/*.it.test.ts'`
- **Done when:** `rg -n "instances" server/src/modules/index.ts` returns the import **and** the registry entry; `pnpm arch` exits 0; `rg -n "container.db" server/src/modules/instances/service.ts` returns nothing.
- **Covers:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-45, AC-46

#### Step A7 — Mock and tests for Stage A

- **Files:** `server/src/adapters/mocks.ts`, `server/test/instances-admission.test.ts` *(new)*, `server/test/gitlab-adapter.test.ts` *(new)*, `server/test/instances.it.test.ts` *(new)*
- **Change:** a `MockGitLabInstanceClient` in `adapters/mocks.ts` that `implements` the new adapter interface. Hermetic tests for `_shared/forge-url.ts` (one case per rejection code) and for the adapter against recorded fixtures (redirect, self-signed, 404-probe, 403-probe). One `*.it.test.ts` for the route round-trip through `buildApp({ overrides })`, asserting that the credential appears in **no** response body and in no error message (AC-10), and that testing instance 1 leaves instance 2's stored result untouched (AC-12).
- **Skill:** `backend-onion-architecture` §9 — every new port needs a mock or ring 2 becomes untestable; ring 3 is `*.it.test.ts` and ring 5 is `app.inject()`. Read the test **count**, not the exit code (`server/INSIGHTS.md` 2026-08-02).
- **Agent:** `test-writer`
- **Verify:** `cd server && pnpm test`
- **Done when:** the run reports **0 skipped** for `instances.it.test.ts`, and an assertion greps every response body for the fixture credential and finds nothing.
- **Covers:** AC-2…AC-5, AC-9, AC-10, AC-11, AC-12

---

### Stage B — repository identity and clone isolation (PR 2)

Covers **AC-13…AC-19, AC-42, NFR-4, NFR-9**. This is the **highest-risk stage**: it changes a live unique index and a ring-0 parameter type used by three ports.

#### Step B1 — `Repo` contract and `RepoRef`

- **Files:** `server/src/vendor/shared/contracts/platform.ts`, `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/adapters.ts`
- **Change:** `Repo` gains **required** `provider: RepoProvider`, `namespace_path: z.string()`, `instance_label: z.string()`, `web_url: z.string()` and `instance_id: z.string().nullable()` (null = the built-in github.com host, so no DML backfill is needed). `Repo` is a table-backed DTO, **not** a jsonb document, so required is correct here and root `INSIGHTS.md` 2026-08-11 does not apply. `owner`, `name`, `full_name` are **kept unchanged** for AC-19/AC-27 and for the spec's §Contract promises row ("remains meaningful for GitHub repositories"). `RepoRef` gains **optional** `instanceKey?: string` — optional because a required field breaks `CodeIndex`, `repo-intel/{service,pipeline/full,pipeline/incremental}`, `conventions/extract-pipeline`, `intent/pipeline` and `brief/pipeline`, all of which construct `{owner,name}` literals. Both copies in the same step.
- **Skill:** `zod` `object-optional-vs-nullable` — `instance_id` is `.nullable()` (a value that is legitimately absent), not `.nullish()`, because it is always serialized. `backend-onion-architecture` §3 — extend `vendor/**`, never reorganise it.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch` · `cd client && pnpm typecheck` · `./scripts/check-shared-sync.sh`
- **Done when:** `check-shared-sync.sh` exits 0, and `rg -n "RepoRef" server/src | wc -l` is unchanged — no call site was forced to add the new field.
- **Covers:** AC-15, AC-19

#### Step B2 — `repos` schema and migration

- **Files:** `server/src/db/schema/repos.ts`, `server/src/db/migrations/0023_*.sql` *(generated)*
- **Change:** add `provider text('provider').notNull().default('github')`, `instanceId uuid('instance_id').references(() => gitInstances.id, { onDelete: 'restrict' })`, `instanceKey text('instance_key').notNull().default('github.com')`, `namespacePath text('namespace_path').notNull().default('')`. **Replace** `uniqueIndex('repos_ws_fullname_uq').on(workspaceId, fullName)` with `uniqueIndex('repos_ws_instance_path_uq').on(workspaceId, instanceKey, namespacePath)`, and add `index('repos_instance_idx').on(instanceId)`. Generate and apply.
- **Skill:** `postgresql-table-design` §Constraints — `UNIQUE` allows multiple NULLs, which is precisely why the index uses the `NOT NULL DEFAULT` `instance_key` and not the nullable `instance_id`; and PostgreSQL does not auto-index FK columns, so `instance_idx` is explicit. §Safe Schema Evolution — a **non-volatile** default backfills without a table rewrite, which is what makes AC-19 free.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm db:generate && pnpm db:migrate && pnpm typecheck`
- **Done when:** exactly one new `0023_*.sql` exists, it contains no `UPDATE` or `INSERT`, and `git diff --stat server/src/db/migrations/` shows only the new file and `meta/`.
- **Covers:** AC-15, AC-16, AC-19, AC-42

#### Step B3 — Instance-aware import

- **Files:** `server/src/modules/repos/{helpers,service,constants,repository}.ts`
- **Change:** `helpers.ts` — replace the single-host `parseRepoUrl` with `resolveRepoUrl(url, instances)`: match the origin against the supported GitHub host **or** a registered instance via `_shared/forge-url.ts#matchOrigin`; on no match throw an `AppError` whose message **names the registered instances** (AC-14). Keep a `parseRepoUrl`-shaped GitHub branch so AC-19/AC-27 behaviour is byte-identical. Add `toRepoDto` fields from B1, deriving `provider`/`instance_label`/`web_url` for a null `instance_id` as `github`/`github.com`/`https://github.com/{full_name}` (AC-15, AC-19). `withGitHubToken` gains a sibling `withInstanceToken(url, credential)` gated on the instance's own origin — same host-equality discipline as `helpers.ts:66`. `service.ts#add` — dedupe on `(workspaceId, instanceKey, namespacePath)`, wrap insert-then-enqueue so a unique-violation returns the existing row rather than a 500 (NFR-9), and pass `instanceKey` into the clone payload. `service.ts#refresh` — rebuild the clone URL from the owning instance's base URL, not the hard-coded `https://github.com/${fullName}.git` at `service.ts:121`.
- **Skill:** `backend-onion-architecture` §5 — no SQL leaves `repository.ts`; the unique-violation catch belongs in the repository, returning a row. `security` A05/A08 — the repository URL is untrusted and may only select from an already-registered destination; it can never introduce one.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `rg -n "github.com" server/src/modules/repos/service.ts` returns no hard-coded clone URL, and the rejection message for an unmatched origin contains every registered instance's base URL.
- **Covers:** AC-13, AC-14, AC-15, AC-16, AC-19, NFR-4, NFR-9

#### Step B4 — Clone location per instance

- **Files:** `server/src/adapters/git/simple-git.ts`
- **Change:** `clonePathFor(repo)` returns `join(cloneDir, repo.owner, repo.name)` when `instanceKey` is absent **or equal to `'github.com'`** — this legacy branch is what makes AC-19 true for every clone already on disk — and `join(cloneDir, repo.instanceKey, repo.owner, repo.name)` otherwise (AC-17). Immediately after computing it, `resolve()` the result and throw unless it is inside `resolve(cloneDir)`; a nested GitLab namespace makes `repo.owner` a multi-segment, user-influenced path.
- **Skill:** `security` §Framework Security Quirks — "`path.join()` with user input allows traversal"; the containment check is the mitigation, and `_shared/forge-url.ts` already rejects `.`/`..` segments upstream (defence in depth). Root `INSIGHTS.md` 2026-08-16 — this path is where a mirror hard-resets, so a wrong answer destroys data.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** a unit test asserts `clonePathFor({owner:'a',name:'b'})` is byte-identical to today's value, and `clonePathFor({owner:'../..',name:'x',instanceKey:'k'})` throws.
- **Covers:** AC-17, AC-19

#### Step B5 — Foreign-remote guard on reuse

- **Files:** `server/src/adapters/git/simple-git.ts`
- **Change:** in `clone()`, before the existing reuse-and-`fetch()` branch at `:57-61`, run `git remote get-url origin` in the destination and compare its origin+path to the requested URL with the credential stripped. On mismatch, throw an `AppError` naming the collision and **fetch nothing** (AC-18). Applies to the GitHub path too (Recommendation 4).
- **Skill:** `backend-onion-architecture` §3 — the adapter owns this because it is I/O; the service only surfaces the error. Root `INSIGHTS.md` 2026-08-16 and `server/INSIGHTS.md` 2026-08-28 — the reuse branch feeds a mirror that later hard-resets, so today's behaviour is a live data-loss path, not a theoretical one.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm test`
- **Done when:** a test creates a clone of remote X at the destination, requests a clone of remote Y there, asserts the throw, and asserts `git remote get-url origin` still returns X and the worktree is unmodified.
- **Covers:** AC-18

#### Step B6 — Stage B tests

- **Files:** `server/test/repos-url.test.ts` *(extend)*, `server/test/clone-isolation.test.ts` *(new)*, `server/test/repos-instances.it.test.ts` *(new)*
- **Change:** hermetic cases for `resolveRepoUrl` (four-segment namespace, unmatched origin naming instances, GitHub back-compat) and for `clonePathFor`/`clone()` isolation. Integration cases for: the same namespace path from two instances yielding two rows and two clone paths (AC-16, AC-17); a pre-feature repository row reporting `provider: 'github'` with no re-import (AC-19); two concurrent `POST /repos` of one URL yielding one row (NFR-9); two repositories on two instances carrying independent `last_polled_at` (AC-42).
- **Skill:** `backend-onion-architecture` §9 — DB-backed ⇒ `*.it.test.ts`, or the CI split breaks silently.
- **Agent:** `test-writer`
- **Verify:** `cd server && pnpm test`
- **Done when:** `repos-instances.it.test.ts` reports **0 skipped**.
- **Covers:** AC-13, AC-14, AC-16, AC-17, AC-18, AC-19, AC-42, NFR-4, NFR-9

---

### Stage C — forge port and GitLab read path (PR 3)

Covers **AC-20…AC-25, AC-43 (as answered in Q2), AC-44, AC-45, AC-46, NFR-5, NFR-6, NFR-7, NFR-10, NFR-11**.

#### Step C1 — Split the port; widen comment identity

- **Files:** `server/src/vendor/shared/adapters.ts`, `server/src/vendor/shared/contracts/platform.ts`, and both `client/src/vendor/shared/**` copies
- **Change:** extract `ForgeClient` with the seven provider-neutral methods — `listPullRequests`, `getPullRequest`, `listReviewComments`, `createReviewComment`, `getIssue`, `currentLogin`, and (Stage E) `publishReview` — and declare `interface GitHubClient extends ForgeClient` retaining `postReview`, `openPullRequest`, `commitFiles`, `findOpenPr`, `listWorkflowRuns`, `downloadRunArtifact`. In `platform.ts`, change `PrReviewComment.id` to `z.string()`, `in_reply_to_id` to `z.string().nullable()`, and `PrCommentInput.in_reply_to` to `z.string().optional()` (AC-23). **Rewrite the `is_outdated` docblock** at `platform.ts:239` so it no longer claims GitHub's rule as the field's definition — it becomes "this note no longer anchors to the current diff; derived per provider" (spec §Contract promises). Both copies in this step.
- **Skill:** `backend-onion-architecture` §3 — name the capability, not the library; and "a signature is declared once", so `GitHubClient` **extends** rather than re-declaring the seven. Root `INSIGHTS.md` 2026-08-25 — a renamed symbol's stale comment survives an ownership split, which is why `platform.ts:239` is named explicitly here.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch` · `cd client && pnpm typecheck` · `./scripts/check-shared-sync.sh`
- **Done when:** `rg -n "GitHub couldn't anchor" server/src client/src` returns nothing, and `check-shared-sync.sh` exits 0.
- **Covers:** AC-23, AC-24 (contract)

#### Step C2 — Conform the existing adapters

- **Files:** `server/src/adapters/github/octokit.ts`, `server/src/adapters/mocks.ts`
- **Change:** stringify GitHub's integer comment ids at the adapter boundary (`String(c.id)`, `c.in_reply_to_id == null ? null : String(...)`) and parse back to `Number()` on `createReviewComment`, so GitHub behaviour is unchanged above the adapter (AC-27). Update `MockGitHubClient` to the same shape and add a `MockForgeClient`. Update the docblocks in both files that say "GitHub" where the type is now `ForgeClient`.
- **Skill:** `backend-onion-architecture` §9 — a port without a mock makes ring 2 untestable. §3 — the adapter absorbs the provider's representation; the port does not.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch && pnpm exec vitest run --exclude '**/*.it.test.ts'`
- **Done when:** `server/test/adapters.test.ts` passes unchanged in intent, and `pnpm arch` exits 0.
- **Covers:** AC-23, AC-27

#### Step C3 — `container.forge(repo)`

- **Files:** `server/src/platform/container.ts`
- **Change:** add `async forge(repo: { provider: string; instanceId: string | null }): Promise<ForgeClient>` — returns the cached Octokit client for `provider === 'github'`, otherwise builds (and per-instance caches) a `GitLabForgeClient` from the instance row plus `secrets.get(instanceSecretKey(instanceId))`. Missing credential throws `ConfigError`, which is a **normal path** callers catch. Extend `invalidateSecretCaches()` to clear the per-instance map. Add `forge?: ForgeClient` to `ContainerOverrides`. Keep `github()` as-is for the `ci` slice.
- **Skill:** `backend-onion-architecture` §4 — the composition root is the only place that knows an interface *and* its implementation; `ContainerOverrides` is the test seam and one direct `new` destroys it. `ConfigError` is not a 500.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `rg -n "new GitLab" server/src --glob '!platform/container.ts'` returns nothing.
- **Covers:** AC-20, AC-45

#### Step C4 — GitLab read adapter

- **Files:** `server/src/adapters/gitlab/forge.ts` *(new)*, `server/src/adapters/gitlab/index.ts`
- **Change:** `GitLabForgeClient implements ForgeClient` over `_shared`-admitted base URL + `http.ts` from A5. Map: `GET /projects/:enc/merge_requests?state=opened` → `PrMeta[]`, using `iid` as `number` (AC-21 — the store already keys by repo + integer, `db/schema/pulls.ts:31`, so **no new identifier**), and `changes_count`/diff stats for additions, deletions and file count (AC-20); `GET /merge_requests/:iid/changes` → `PrDetail.files` with patches; `/commits` → `PrCommit[]`; `GET /merge_requests/:iid/closes_issues` → `linked_issue`, **empty array ⇒ `null`, never a placeholder** (AC-22); `GET /merge_requests/:iid/discussions` → `PrReviewComment[]` with **string** `id` (`discussion.id`) and string `in_reply_to_id` (AC-23), `is_outdated` **derived** by comparing each note's `position.head_sha`/`base_sha`/`start_sha` against the MR's current `diff_refs` (AC-24, spec Open question 4). Project path is `encodeURIComponent(namespacePath)` — GitLab's URL-encoded id form, which is what makes an arbitrary-depth namespace work (AC-13, NFR-4). Every request carries the 30 s abort and the per-instance rate gate. **No model call anywhere** (NFR-6); no cost attributed (NFR-5).
- **Skill:** `backend-onion-architecture` §7 boundary — the adapter never returns a provider-shaped object across the port; only `PrMeta`/`PrDetail`/`PrReviewComment`. `security` A05 — MR titles, descriptions and note bodies are third-party text and are returned as data; nothing in them selects a URL, a project or an instance.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `closes_issues: []` yields `linked_issue: null`, and the outdated derivation reads only the note's stored revision ids and the MR's current `diff_refs` — no field named `outdated`/`resolvable` from the instance is consulted.
- **Covers:** AC-20, AC-21, AC-22, AC-23, AC-24, NFR-4, NFR-5, NFR-6, NFR-10

#### Step C5 — Route the read path through the forge

- **Files:** `server/src/modules/pulls/routes.ts`, `server/src/modules/polling/routes.ts`
- **Change:** replace all five `await container.github()` sites (`pulls/routes.ts:42,240,338,361`, `polling/routes.ts:28`) with `await container.forge(repo)`, passing `{ owner: repo.owner, name: repo.name, instanceKey: repo.instanceKey }` as the `RepoRef`. Preserve the existing local-first `try/catch` shape exactly — a forge failure serves the persisted snapshot rather than failing the read. Add a persisted `last_sync_error` + `last_polled_at` write so the client can distinguish "stale snapshot" from "empty" and from "loading" (AC-44, NFR-7). In `polling/routes.ts`, isolate the per-repository failure so one repository's error never aborts another's (AC-43 as answered in Q2). Do **not** refactor this file's ~25 Drizzle sites — they are catalogued §12 debt and out of scope.
- **Skill:** `backend-onion-architecture` §12 — `modules/pulls/routes.ts` is the most-copied file in the repo and its Drizzle-in-ring-5 violations are debt, **not precedent**; this step must not add a new one. §4 — cross-slice reads go through the container.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch && pnpm test`
- **Done when:** `rg -n "container.github\(\)" server/src/modules/{pulls,polling}` returns nothing, and `pnpm arch` reports no **new** `pathNot` entry in `.dependency-cruiser.cjs`.
- **Covers:** AC-20, AC-21, AC-42, AC-43, AC-44, AC-45, NFR-7

#### Step C6 — Forge-aware enrichment pipelines

- **Files:** `server/src/modules/intent/pipeline.ts:89`, `server/src/modules/brief/pipeline.ts:236`
- **Change:** both call `container.github()` directly; switch to `container.forge(repo)` with the same `ConfigError`-tolerant `catch` they already have. No behavioural change for GitHub.
- **Skill:** `backend-onion-architecture` §12 — both are **off-manifest filenames** (`pipeline.ts`), so no `modules/` gate rule sees them; the reviewer checks the filename before trusting a green `pnpm arch`.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `rg -n "container.github\(\)" server/src/modules` returns only `ci/service.ts` (SPEC-05's GitHub-Actions-only path).
- **Covers:** AC-20 (parity of enrichment)

#### Step C7 — Stage C tests

- **Files:** `server/test/gitlab-mr.test.ts` *(new)*, `server/test/pulls-comments.it.test.ts` *(extend)*, `server/test/forge-resolution.it.test.ts` *(new)*
- **Change:** fixture-driven hermetic cases for every mapping in C4, especially `closes_issues: []` → `null` (AC-22) and the outdated derivation across a superseded revision (AC-24). Integration cases through `buildApp({ overrides: { forge } })` for: a GitLab repository's list carrying all nine `PrMeta` fields (AC-20); string comment ids for both providers and a reply landing in its thread (AC-23); one instance offline leaving another's `last_polled_at` newer (AC-43); a failed sync producing a snapshot state distinguishable from empty and from loading (AC-44, NFR-7).
- **Skill:** `react-testing-library` is **not** loaded here (server). `backend-onion-architecture` §9 — ring 5 via `app.inject()`, ring 3 via `*.it.test.ts`; check the count.
- **Agent:** `test-writer`
- **Verify:** `cd server && pnpm test`
- **Done when:** both `.it.test.ts` files report **0 skipped**.
- **Covers:** AC-20, AC-22, AC-23, AC-24, AC-43, AC-44, NFR-7

---

### Stage D — vocabulary, labelling, links, settings (PR 4)

Covers **AC-1/AC-7/AC-12 (UI), AC-26…AC-33, AC-44 (UI), AC-47, NFR-7**.

#### Step D1 — Instances data layer

- **Files:** `client/src/lib/hooks/instances.ts` *(new)*, `client/src/lib/hooks/index.ts`
- **Change:** `useInstances()`, `useRegisterInstance()`, `useTestInstance()`, `useDeleteInstance()` over `apiFetch`, following the shape of the 16 existing domain files. Every mutation invalidates its query keys in `onSuccess`.
- **Skill:** `frontend-ui-architecture` §In this repo — the chosen data model is HTTP APIs; a new endpoint means a new hook in the matching domain file, and a mutation that does not invalidate leaves the screen rendering stale data. `client/INSIGHTS.md` 2026-08-09 — two panels reading two query keys go stale asymmetrically, which is why the register mutation invalidates **both** the instances key and the repos key.
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** no component under `client/src/app/**` calls `fetch` for an instance endpoint.
- **Covers:** AC-1, AC-7, AC-12

#### Step D2 — Provider-aware link builders

- **Files:** `client/src/lib/forge-urls.ts` *(new)*, `client/src/lib/github-urls.ts`, `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/helpers.ts`, `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/index.ts`
- **Change:** new `forge-urls.ts` exporting `changeRequestUrl(repo, number)` and `blobUrl(repo, sha, file, startLine?, endLine?)`, both built **from the owning repository's `web_url`** (AC-29) — never from a constant. GitLab shapes: `{base}/{namespace}/-/merge_requests/{iid}` and `{base}/{namespace}/-/blob/{sha}/{path}#L{start}-{end}`. **The end line has no repeated `L`** — `#L1-2`, not `#L1-L2` (AC-30; root `INSIGHTS.md` 2026-08-28, and no gate in this repo can see this error). Add `safeExternalHref(target, repo)` returning `null` unless the target is `https:` **and** shares the repository's registered origin (AC-25). Re-point the three `lib/github-urls.ts` consumers (`PrDetailView.tsx:196`, `FindingCard.tsx:74`, `BlastRadiusCard.tsx:263`) and **the second, independent builder** at `ConventionCard/helpers.ts:42` consumed by `ConventionsView.tsx:188` — the spec's design row 9 names only the first. Delete `lib/github-urls.ts` once empty.
- **Skill:** `frontend-ui-architecture` §2 promotion — the conventions helper now has a second consumer's shape, so it moves to `src/lib/` in the same commit; §1 — a value encoding an external contract belongs in shared. `react-best-practices` §Accessibility / Conditional Rendering — a null href renders no clickable element, not a disabled-looking one.
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** `rg -n "https://github.com" client/src --glob '!*.test.*'` returns no URL-building constant, and `rg -n "github-urls" client/src` returns nothing.
- **Covers:** AC-25, AC-29, AC-30

#### Step D3 — Copy catalogues

- **Files:** `client/messages/en/{shell,settings,prReview,blast,ci,compose,agents,onboarding}.json`
- **Change:** make every provider-scoped string take the provider/instance as an ICU argument, and every provider-neutral string neutral. **Eight files, 24 lines** — the spec's design row 10 enumerates five files and misses `compose.json:4,7,9,10` and `agents.json:77`, plus `settings.json:15,43,68,84,89-91` and `ci.json:68,75`. Add a `changeRequest`/`changeRequests` term pair plus an identifier prefix (`#` / `!`) resolved per repository (AC-26, AC-27). Add the `onboarding.json` keys D4 needs. `compose.json` has **no consumer** in `client/src`; per `client/INSIGHTS.md` 2026-08-16 its copy is a stale product decision, not a requirement — neutralise it, do not build a screen from it.
- **Skill:** `frontend-ui-architecture` §1 / §10 — a hard-coded user-facing string is untranslatable and unreviewable. Repo rule: all Markdown and all copy in English.
- **Agent:** `implementer`
- **Verify:** `rg -ni "github" client/messages/en/*.json` lists only strings on GitHub-scoped screens · `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -ni "github" client/messages/en/{prReview,blast,shell}.json` returns nothing, and every remaining hit is either an ICU argument default or a GitHub-Actions string in `ci.json`/`agents.json`.
- **Covers:** AC-26, AC-27, AC-28, AC-32

#### Step D4 — Provider-neutral import screen

- **Files:** `client/src/app/onboarding/_components/AddRepoView/AddRepoView.tsx`
- **Change:** replace the three hard-coded English strings at `:79` (the "Paste a GitHub repository URL" paragraph), `:94` (`hint="e.g. https://github.com/acme/payments-api"`) and `:99` (`placeholder="https://github.com/owner/repo"`) with `useTranslations('onboarding')` keys that name **no** provider (AC-32). Surface the AC-14 rejection verbatim, so the registered instances are listed on the screen.
- **Skill:** `frontend-ui-architecture` §1 — user-facing strings come from the catalogue, never inline. `react-best-practices` §Accessibility — the error is linked to the field with `aria-describedby`.
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** `rg -n "GitHub" client/src/app/onboarding/_components/AddRepoView/AddRepoView.tsx` returns nothing.
- **Covers:** AC-14 (UI), AC-32

#### Step D5 — Provider and instance as text in three places

- **Files:** `client/src/components/**` or the owning `_components/` for the repository card, the change-request list row, and `.../PrDetailHeader/**`
- **Change:** render the provider and instance as **text inside the element's accessible name** in all three surfaces — never an icon or a colour alone (AC-31). Apply the `#`/`!` identifier prefix and the merge-request/pull-request term from D3 (AC-26, AC-27). Truncate a long namespace path **from the front**, showing the project and its nearest groups, with the full path reachable on the screen — a `title` plus a visible expand, not a tooltip alone (AC-33).
- **Skill:** `frontend-ui-architecture` §1 placement / §2 promotion — a component used by two routes goes in `src/components/<kebab>/`, and `client/INSIGHTS.md` 2026-08-16 records that the cross-route promotion rule fires on a **component**, not only on a pure helper. `react-best-practices` §Accessibility — the same rule as the severity chips (spec design row 11).
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** a test asserts the accessible name of the list row contains the instance host as text, with no reliance on `toHaveClass`.
- **Covers:** AC-26, AC-27, AC-31, AC-33

#### Step D6 — Instances settings screen

- **Files:** `client/src/app/settings/[section]/**` (+ a new `_components/InstancesSection/`)
- **Change:** zero / one / many states (spec design row 8). Register form (base URL + label + credential). Per-instance row showing **detected version and edition** after a successful test (AC-7), an **explicitly unknown** approval capability that never reads as "unavailable" (AC-8, AC-9), and a per-instance test button whose result names that instance and leaves the others untouched (AC-12). Register and test both show a bounded pending state that clears within 10 s (NFR-1). The credential input is write-only and is never re-rendered from a response (AC-10). Leave the existing GitHub card and the four `SecretsStatus` booleans **untouched** (AC-19, AC-27; Recommendation 3).
- **Skill:** `frontend-ui-architecture` §9 — mark the interactive leaf `'use client'`, not the page or the layout. `react-best-practices` §Derive, Don't Store — the capability label is computed during render from `approval_capability`, never mirrored into state by an Effect. `client/INSIGHTS.md` 2026-08-09 — the instances panel and the repositories panel read two query keys and go stale asymmetrically; the register mutation invalidates both.
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** with two instances rendered, testing one changes only that row's result text.
- **Covers:** AC-1, AC-7, AC-8, AC-9, AC-10, AC-12, NFR-1

#### Step D7 — Export-to-CI unavailable, both ends

- **Files:** `client/src/app/repos/[repoId]/**` (the export entry point), `client/messages/en/ci.json`, `server/src/vendor/shared/contracts/eval-ci.ts` + client copy, `server/src/modules/ci/{routes,service}.ts`
- **Change:** client — the entry point stays **reachable**, states the reason, and offers no action for a GitLab repository (AC-47). Contract — `CiExportInput` gains `instance_id: z.string().nullish()` (Q3 default A; `.nullish()` because `ci_installations` rows already on disk carry no such key — root `INSIGHTS.md` 2026-08-02). Server — `CiService.preview`/`install` resolve the repository and throw a stated `AppError` **before generating or committing anything** when the provider is not GitHub (AC-48). Both `vendor/shared` copies in this step.
- **Skill:** `zod` `object-optional-vs-nullable` + the routing.md jsonb rule — `.nullish()`, never `.nullable()`, on a contract with documents already persisted. `backend-onion-architecture` §6 — the refusal is thrown as an `AppError`, not hand-crafted with `reply.code`.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch` · `cd client && pnpm typecheck && pnpm lint` · `./scripts/check-shared-sync.sh`
- **Done when:** an integration test shows the refusal returns before any `commitFiles` or `openPullRequest` call on the mock (assert the mock's call log is empty).
- **Covers:** AC-47, AC-48

#### Step D8 — Client tests and MCP wording

- **Files:** `client/src/lib/forge-urls.test.ts` *(new)*, the three `_components/**/*.test.tsx` touched in D5, `mcp/src/{tools,handlers,index}.ts`
- **Change:** tests asserting the rendered `href` for both providers, including the `#L1-2` vs `#L1-L2` difference (AC-30) and the off-origin target rendering no link (AC-25); accessible-name assertions for AC-31; the empty/stale/loading three-state distinction on the change-request list (AC-44, NFR-7). MCP — make the tool descriptions and the two error strings at `handlers.ts:49,64` provider-neutral ("change request" / the repository's own term), per the spec's §Contract promises last row. The MCP server's own instructions string at `tools.ts:142` names GitHub and must be neutralised.
- **Skill:** `react-testing-library` §Query priority — `getByRole('link', { name })` and `toHaveAttribute('href', …)`; never `container.querySelector` and never `toHaveClass`. `security` (MCP row) — the wording change must not alter what the tool treats as untrusted; `sanitize.ts` stays as it is.
- **Agent:** `test-writer` (tests) then `implementer` (MCP wording)
- **Verify:** `cd client && pnpm test` · `cd mcp && pnpm test`
- **Done when:** `rg -ni "pull request" mcp/src/tools.ts mcp/src/handlers.ts` returns only provider-scoped strings, and the `#L1-2` assertion exists and passes.
- **Covers:** AC-25, AC-30, AC-31, AC-44, NFR-7, spec §Contract promises (MCP row)

---

### Stage E — posting a review back (PR 5) — **BLOCKED, see Q1**

Covers **AC-34…AC-41, AC-48 (server half, already in D7), NFR-3, NFR-8, NFR-12**. Planned so the shape is visible; **do not dispatch** until NFR-3's cap is decided, because there is no GitHub baseline to match (`## Appendix — intake` requirements-check row 1).

- **E1 — Contract.** `PostBackOutcome = z.enum(['posted_verdict_applied','posted_verdict_not_applied','partially_published','not_posted'])` plus `reason: z.string().nullable()`, on a **new sibling response schema** `ReviewPostBack`, never as a new required key inside a jsonb document already on disk (root `INSIGHTS.md` 2026-08-11; the spec says the same). Both `vendor/shared` copies. *(AC-39, AC-41, NFR-12)*
- **E2 — Table.** New `review_postbacks` (`runId`, `prId`, `outcome`, `reason`, `notesPublished`, `createdAt`), migration `0024_*`. **Do not repurpose `composed_reviews`** — it is a reserved empty table (`AGENTS.md` §Do not touch). *(NFR-12)*
- **E3 — Port.** `publishReview(repo, n, payload)` on `ForgeClient`, returning the four-state outcome; GitHub's dormant `postReview` becomes its implementation. *(AC-34, AC-39)*
- **E4 — GitLab publication.** Summary as an MR-level note; each finding as a diff note anchored with `base_sha`/`start_sha`/`head_sha` plus `old_path`/`new_path`, an added line by `new_line` and a removed line by `old_line` (AC-35). `POST .../approve` on `approve`, `POST .../unapprove` on `request_changes` when DevDigest holds the approval (AC-36, AC-37) — approvals are **free tier**, so a `403` means *not an eligible approver*, which is the common case and gets its own reason (AC-38; root `INSIGHTS.md` 2026-08-28). A failure after ≥1 note lands is `partially_published` (AC-40). A `request_changes` outcome states in words that GitLab carries the verdict in the note (AC-41).
- **E5 — Route + concurrency.** `POST /pulls/:id/post-review`, single-flight per `(runId, prId)` so two concurrent posts publish at most one set (NFR-8), notes capped at the value decided in Q1 with the truncation stated to the user (NFR-3).
- **E6 — Client.** Render exactly one of the three user-facing outcomes with its reason (AC-39), surviving a reload (NFR-12).

## Verification plan

| Package | Command | Runs when |
|---|---|---|
| server | `cd server && pnpm typecheck` | `server/**` changed (every stage) |
| server | `cd server && pnpm arch` | same — **not wired into CI** (root `INSIGHTS.md` 2026-08-02), so run it by hand and require exit 0 |
| server | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | fast loop within a step |
| server | `cd server && pnpm test` | end of each server stage — read the **count**, not the exit code |
| server | `cd server && pnpm db:generate && pnpm db:migrate` | Steps A2, B2, E2 only |
| client | `cd client && pnpm typecheck && pnpm lint && pnpm test` | `client/**` changed (Stage D) |
| mcp | `cd mcp && pnpm test` | Step D8 |
| — | `./scripts/check-shared-sync.sh` | Steps A1, B1, C1, D7, E1 — **never** `diff -r` (root `INSIGHTS.md` 2026-08-01) |
| — | `./scripts/pr-self-review.sh gates` | before each PR; note it selects by path **prefix**, so a docs-only edit under `server/` still fires typecheck and arch (root `INSIGHTS.md` 2026-08-14) |

`reviewer-core` runs nothing: no step touches it (spec §Non-goals).

## Acceptance-facing checks

Restated from criteria the spec already states, each as something a command or a `path:line` settles. Nothing here is new.

| Check | Source | How it is settled |
|---|---|---|
| An `http://` base URL leaves no instance registered, with that reason | AC-2 | `instances-admission.test.ts` — `admitBaseUrl` returns `not_https`; route test asserts 0 rows |
| A self-signed instance reports a certificate reason distinct from unreachable and from invalid-credential | AC-3 | `gitlab-adapter.test.ts` — three fixtures, three distinct `InstanceRejectionCode` values |
| An IP-literal or private-range host is rejected **at registration**, naming the host | AC-4 | `instances-admission.test.ts` + the A5 DNS branch; the message contains the host |
| No response or message contains the credential | AC-10 | `instances.it.test.ts` greps every response body and error for the fixture credential |
| Testing one of two instances leaves the other's result untouched | AC-12 | `instances.it.test.ts`; `InstancesSection.test.tsx` |
| `group/subgroup/team/project` imports and lists under its full path | AC-13, NFR-4 | `repos-url.test.ts` + `repos-instances.it.test.ts` |
| One namespace path from two instances ⇒ two repositories, two clone paths | AC-16, AC-17 | `repos-instances.it.test.ts` asserts two rows and two distinct `clone_path` values |
| A destination holding a different remote fails the import, clone untouched | AC-18 | `clone-isolation.test.ts` asserts the throw and that `git remote get-url origin` is unchanged |
| A pre-feature repository is listed, syncable and reported as GitHub with no re-import | AC-19, AC-27 | `repos-instances.it.test.ts` inserts a legacy row and asserts `provider === 'github'` and an unchanged `clonePathFor` |
| An MR closing no issue shows no linked issue, not a placeholder | AC-22 | `gitlab-mr.test.ts` — `closes_issues: []` → `linked_issue === null` |
| Inline-comment ids are strings for both providers | AC-23 | `pulls-comments.it.test.ts` asserts `typeof id === 'string'` on both fixtures |
| An off-origin link target renders no clickable element | AC-25 | `forge-urls.test.ts` — `safeExternalHref` returns `null`; component test asserts no `role="link"` |
| A GitLab two-line range writes `#L1-2`, GitHub writes `#L1-L2` | AC-30 | `forge-urls.test.ts` — both asserted literally (root `INSIGHTS.md` 2026-08-28) |
| The import screen names no provider and sources its strings from the catalogue | AC-32 | `rg -n "GitHub" .../AddRepoView.tsx` returns nothing |
| One instance offline leaves the others' repositories newer-synced | AC-43 *(as answered in Q2)* | `forge-resolution.it.test.ts` |
| A failed sync's list is distinguishable from empty and from loading | AC-44, NFR-7 | three rendered states asserted in the list component test |
| Export-to-CI on a GitLab repository is reachable, stated, and refused before anything is generated | AC-47, AC-48 | client test + a server test asserting the CI mock's call log is empty |
| Verification returns within 10 s in every case | NFR-1 | the adapter's overall budget, asserted with fake timers |
| Registering, importing, syncing, linking and posting spend no money and make no model call | NFR-5, NFR-6 | `rg -n "container.llm\|completeStructured\|embed(" server/src/modules/instances server/src/adapters/gitlab` returns nothing |

**NFR-3 has no check** — see `## Risks & open questions`.

## Recommendations not taken

None declined; all four were left to their default ("proceed as specified") because the caller answered nothing, and all four are therefore folded into the steps above. Recommendation 1's split is delivered as five staged PRs inside one plan document rather than five plan files — say the word and I will re-emit it as five.

## Risks & open questions

1. **NFR-3 cannot be met as written.** It requires "the same limit already applied when posting to GitHub"; no post-back path and no cap exist (`server/src/vendor/shared/adapters.ts:178` has zero production callers). **Default:** Stage E is not dispatched until a numeric cap is stated. If forced, proceed with 20 and record the divergence.
2. **AC-43 describes a polling cycle that does not exist** (`server/src/modules/polling/routes.ts:9-20`, "MANUAL refresh"; `polling_interval_min` at `contracts/platform.ts:93` has no reader). **Default:** Q2 answer A — per-repository sync isolation on the manual poll. A scheduler is out of scope and would be its own spec.
3. **AC-48's "names a repository" is ambiguous once AC-16 lands** (`contracts/eval-ci.ts:340` carries a free `"owner/name"` string). **Default:** Q3 answer A — a nullish `instance_id` on `CiExportInput`.
4. **AC-4 makes the GitLab happy path unautomatable in `server/test/**`.** No local instance may be contacted, so the adapter is verified against recorded fixtures and the live path is a manual `e2e/` flow. **Default:** Q4 answer A — no test-only SSRF bypass, because a gate disabled under test goes unverified (root `INSIGHTS.md` 2026-08-02) and `security` §A02/§A06 argue against shipping the escape hatch.
5. **Sentinel — `server/src/db/migrations/**`.** Steps A2, B2 and E2 each add a **new** file (`0022`, `0023`, `0024`). No existing file is edited. `pnpm db:generate` emits DDL only, so the AC-19 backfill is achieved by a **column default**, never by hand-written DML in a generated file. If a future step genuinely needs DML, that is a deliberate decision under `AGENTS.md` §Do not touch, not a drive-by edit. **Default:** proceed with defaults-only.
6. **Sentinel — none of `reviewer-core/src/grounding.ts` or `INJECTION_GUARD` is touched**, matching the spec's §Non-goals. If any step appears to need them, stop and escalate.
7. **`RepoRef.instanceKey` is optional, and that is load-bearing.** Eleven files construct `{owner,name}` literals (`rg -ln RepoRef server/src`). Making it required is a same-day refactor of `CodeIndex`, `repo-intel`, `conventions`, `intent` and `brief`. **Default:** optional, with the legacy `github.com` clone-path branch in B4 as the AC-19 guard. The cost is that a forgotten `instanceKey` silently falls back to the legacy path — B6's test is the only thing that catches it. **Worth capturing with `engineering-insights`** once B lands.
8. **`pulls/routes.ts` is §12 debt (~25 Drizzle sites in ring 5) and Step C5 edits it.** The step must add no new violation and must not attempt the extraction. `architecture-reviewer` will need the pre-existing/new distinction made explicitly.
9. **`compose.json` is unwired scaffolding that names GitHub four times** and has no consumer in `client/src`. Per `client/INSIGHTS.md` 2026-08-16, its copy is a stale product decision, not a requirement — do not build Stage E's UI from it without re-deciding the wording.
10. **Needs `researcher`:** whether GitLab's discussions API returns `position.head_sha` on every note shape (AC-24's derivation depends on it), and whether the near-atomic note publication mechanism of Open question 1 exists on a minimum-supported instance. **Proceeding on:** AC-24 derives from `position` when present and marks `is_outdated: false` when absent; AC-34 publishes notes individually, which the spec says changes no criterion.
11. **Two `pnpm arch` blind spots** the reviewer must check by hand: `modules/{intent,brief}/pipeline.ts` are **off-manifest filenames** matched by no `modules/` rule (Step C6), and `pnpm arch` is not in CI at all (root `INSIGHTS.md` 2026-08-02). A green gate is a floor, not a verdict.
12. **Everything in `## Answers taken` is an unconfirmed assumption.** Five of them (Q1–Q5) change steps materially. `plan-verifier` should treat any step whose `Covers:` includes AC-43, AC-48, NFR-3 or NFR-8 as conditional on those answers.

## Out of scope

- **Export-to-CI parity for GitLab** (spec §Non-goals). Only the stated-unavailable state is built (AC-47, AC-48). A follow-up spec picks it up.
- **A polling scheduler.** `polling_interval_min` stays unread. Whoever builds automatic reviews owns it.
- **Enforcing approval rules, code-owner gating or an aggregate approval state** (spec §Non-goals).
- **Bitbucket, Gitea, Azure DevOps**; **SSH-form GitLab URLs**; **migrating an existing GitHub repository to another provider** (spec §Non-goals).
- **Any change to `reviewer-core`**, `grounding.ts` or `INJECTION_GUARD` (spec §Non-goals).
- **Extracting `pulls/routes.ts` into a service + repository.** Catalogued §12 debt; whoever pays it down does so in its own PR.
- **Closing the ~120 lines of existing `vendor/shared` drift.** `check-shared-sync.sh` freezes today's baseline; this plan adds none and fixes none.
- **Renumbering the duplicate `SPEC-05`** (root `INSIGHTS.md` 2026-08-28). Append-only history.
- **Stage E**, until Q1 is answered.

## Handoff

For the architecture reviewer:
- A **new slice** (`modules/instances/**`) and a new `modules/_shared/forge-url.ts` — check the §13 manifest filenames and the `modules/index.ts` registry entry.
- A **port split** (`ForgeClient` / `GitHubClient extends ForgeClient`) and a new container resolver `container.forge(repo)` — check §3 naming and §4 (nothing `new`ed outside the composition root).
- Step C5 edits `modules/pulls/routes.ts`, a §12 debt file: separate pre-existing Drizzle-in-ring-5 findings from anything new.
- Step C6 edits two **off-manifest** filenames (`intent/pipeline.ts`, `brief/pipeline.ts`) that no `pnpm arch` rule governs.
- `RepoRef` gained an optional field in ring 0 — check that no ring-2 file now reads `db/schema` to obtain it.

For the security reviewer:
- **New outbound destination class.** The operator's base URL decides where the server connects and where a credential goes. Review `_shared/forge-url.ts#admitBaseUrl` (AC-2, AC-4, AC-5) and `adapters/gitlab/http.ts` (DNS re-resolution, `redirect: 'manual'` AC-11, TLS classification AC-3, the 30 s abort NFR-2). Confirm every rejection happens **before** the first request and is fail-closed.
- **New secrets.** N per-instance credentials under `GITLAB_TOKEN_<instanceId>` via `SecretsProvider` only. Confirm none reaches `git_instances`, `AppConfig`, a log line, an error message or a response (AC-10), and that `invalidateSecretCaches()` is called after every write.
- **New path construction from user-influenced input.** `clonePathFor` now joins a multi-segment namespace; confirm the `resolve()` containment check in B4 and the `.`/`..` rejection in A3 (`security` §Framework Security Quirks).
- **Widened request contract.** `PrCommentInput.in_reply_to` becomes a string passed to a third-party API.
- **New migrations** `0022`, `0023` (and `0024` in Stage E), and a **replaced unique index** on a live table — confirm the dedupe invariant still holds for GitHub after the swap.
- **New user input surfaces:** `POST /instances`, `POST /instances/:id/test`, and the widened `POST /repos` body.

---

## Appendix — intake

The `## Before I plan` block returned by `implementation-planner`, preserved because its requirements check is the evidence behind `## Answers taken` and `## Risks & open questions`.

**What was read:**
- `server/src/modules/repos/helpers.ts:15-29,45-47,51` and `constants.ts:31` — the single-host allowlist and the exactly-two-segment shape.
- `server/src/adapters/git/simple-git.ts:37-39,56-61,84-87` — `clonePathFor` = `join(cloneDir, owner, name)`, reuse-if-`.git`-exists, `reset --hard` on sync.
- `server/src/db/schema/repos.ts:32` (`repos_ws_fullname_uq` on `workspaceId, fullName`) and `server/src/db/schema/pulls.ts:31` (`pr_repo_number_uq` on `repoId, number`).
- `server/src/vendor/shared/adapters.ts:105-215` (`RepoRef`, the 12-method `GitHubClient`) and `contracts/platform.ts:93,110-133,145-155,225-253`.
- Root `INSIGHTS.md` §Index + the 2026-08-01/02/05/11/16 and both 2026-08-28 entries; `server/INSIGHTS.md` §Index incl. its new 2026-08-28 row; `client/INSIGHTS.md` §Index (2026-08-09 asymmetric staleness, 2026-08-16 unwired-scaffolding copy).
- `.claude/skills/pr-self-review/routing.md` — then `security`, `zod`, `drizzle-orm-patterns`, `postgresql-table-design`, `fastify-best-practices`, `react-best-practices`, `react-testing-library`.

### Requirements check

48 AC + 12 NFR in; only the rows where the repo says something the spec does not are listed. **Every AC not in this table verified clean against the anchors above** — the spec's citations are accurate, which is unusual and worth saying.

| # | Requirement (quoted) | What the repo shows | Verdict | Evidence |
|---|---|---|---|---|
| 1 | NFR-3: inline notes "capped at the same limit already applied when posting to GitHub" | **There is no post-back path and no cap, for any provider.** `postReview` exists on the port, in the Octokit adapter and in the mock, and has **zero production callers** — no route, no service. `client/messages/en/compose.json` ("Post review to GitHub") is read by no file under `client/src`. | **contradicted** | `server/src/vendor/shared/adapters.ts:178`; `server/src/adapters/github/octokit.ts:138`; `server/src/adapters/mocks.ts:198`; only caller `server/test/adapters.test.ts:24`; `rg -n "postReview" . -g '!node_modules'` returns 5 hits, none production |
| 2 | AC-43: "IF one instance is unreachable during a **polling cycle**, THEN the system shall complete that cycle for repositories on every other instance" | **There is no polling cycle.** `POST /repos/:id/poll` is manual and single-repo; its own docblock says "MANUAL refresh". `polling_interval_min` is a stored setting with no reader. | **contradicted** | `server/src/modules/polling/routes.ts:9-20`; `server/src/vendor/shared/contracts/platform.ts:93`; `rg -n "polling_interval_min\|setInterval\|cron\|schedule" server/src` → contract, `db/seed.ts:78`, and unrelated `extract.ts` heuristics only |
| 3 | AC-16: "the same namespace path … once per instance within one workspace" | Today the unique index is `(workspace_id, full_name)`, so two instances sharing `acme/api` collide at insert. Needs a migration, which the spec does not mention. | verified (gap is real; cost understated) | `server/src/db/schema/repos.ts:32` |
| 4 | Design row 9: "Every deep-link derives from **one** constant … consumed by five surfaces" | There are **two** independent builders. `client/src/lib/github-urls.ts` (3 consumers + 1 test) **and** a second, unrelated `githubBlobUrl` in `.../conventions/_components/ConventionCard/helpers.ts:42`, consumed by `ConventionsView.tsx:188`. The second does not import from `lib/`. | **contradicted** | `rg -n "githubBlobUrl\|githubPrUrl" client/src`; `client/src/app/repos/[repoId]/conventions/_components/ConventionCard/helpers.ts:42` |
| 5 | Design row 10 / AC-28: the GitHub literals | The count "seven catalogues" in §Problem is right but the enumeration is under-inclusive. `rg -ni github client/messages/en/*.json` also returns `compose.json:4,7,9,10`, `agents.json:77`, `settings.json:15,43,68,84,89-91`, `ci.json:68,75`. `compose.json` is a **repo-scoped** post-review screen — squarely inside AC-28. | **contradicted** | `rg -ni "github" client/messages/en/*.json` (7 files, 24 lines) |
| 6 | AC-48: "IF an export-to-CI request **names a repository** belonging to a GitLab instance…" | `CiExportInput.repo` is a free string `"owner/name"`, not a repo id — and AC-16 makes that string ambiguous once two instances can hold one path. The endpoint is keyed by `agentId`, not `repoId`. | **underspecified** → Q3 | `server/src/vendor/shared/contracts/eval-ci.ts:339-347`; `server/src/modules/ci/routes.ts:35` |
| 7 | AC-17/AC-18 clone isolation | Correct, and **worse than stated**: `RepoRef {owner,name}` is the shared parameter type of `GitClient`, `GitHubClient` **and** `CodeIndex`, constructed in 6 module files. Changing repository identity is not a `simple-git.ts` edit. Also `clone()` does `mkdir(join(cloneDir, repo.owner))` with no path-containment check — a nested GitLab namespace makes `owner` a multi-segment, user-influenced path. | verified (+ new SSRF/traversal surface) | `server/src/vendor/shared/adapters.ts:107-110`; `rg -ln RepoRef server/src` → 11 files; `simple-git.ts:56` |
| 8 | AC-23: inline-comment ids become strings; "not persisted in any table" | Confirmed — fetched live per request, no table. But `PrCommentInput.in_reply_to` is a **request body** the client sends, so the widening is a breaking client change too, not read-only. | verified (one consequence added) | `server/src/modules/pulls/routes.ts:334-384`; `contracts/platform.ts:239-253` |
| 9 | AC-15/AC-19: instance "present on every repository … including every repository that already exists" | `Repo` is a DTO mapped from a real table (`toRepoDto`), **not** a jsonb document — so root `INSIGHTS.md` 2026-08-11 does **not** apply here and a required field is correct. It *does* apply to the post-back outcome, exactly as the spec says. | verified | `server/src/modules/repos/helpers.ts:78-90`; `db/schema/repos.ts` |
| 10 | AC-4: reject loopback / private-range hosts | Correct as a rule, and it makes the GitLab happy path **unautomatable in this repo**: no `*.it.test.ts` can point at a local instance. Open question 6's "no opt-out" assumption is therefore a *test-strategy* decision, not only a product one. | verified (consequence not stated) | AC-4 vs `server/test/helpers/pg.ts` testcontainers pattern; `TESTING.md` lanes |
| 11 | AC-12 / design row 8: "the secrets status is a fixed object with one boolean per provider" | Confirmed. But the fix is **not** widening `SecretsStatus`/`ConnTestProvider` — an instance carries its own `verified_at`. Widening a closed enum the existing Settings screen keys off would put AC-19/AC-27 at risk. | verified (design implication is the planner's) | `contracts/platform.ts:110-133`; `server/src/modules/settings/routes.ts:80-90` |
| 12 | Non-goal: "does not touch `reviewer-core`" | Holds. `reviewer-core/src/**` contains no provider string and no `RepoRef`; the engine takes a diff. | verified | `rg -n "github\|RepoRef" reviewer-core/src` → no adapter coupling |
| 13 | Open questions 1, 2, 3, 4, 5, 7, 9 | Each states an assumption that the plan can implement without an answer, and none changes a step. **OQ-6 and OQ-8 are the only two with build consequences** (OQ-6 → test strategy above; OQ-8 → AC-47/48 scope). | verified | spec §Open questions; the step mapping in this plan |

### Questions and their defaults

1. **NFR-3 and AC-34…AC-41 have no GitHub baseline to match (row 1).** Options: **A** — keep post-back in scope, pick an explicit cap (proposed: 20 inline notes) and accept the asymmetry; **B** — cut AC-34…AC-41 + NFR-3 + NFR-8 into a separate spec that adds post-back for *both* providers; **C** — build GitLab post-back and wire the dormant `postReview` for GitHub in the same change. **Default: B.**
2. **AC-43 asks a nonexistent polling cycle to degrade gracefully (row 2).** Options: **A** — restate AC-43 as per-repository isolation on the existing manual `POST /repos/:id/poll`; **B** — build a scheduler as part of SPEC-06. **Default: A.**
3. **AC-48's "names a repository" is ambiguous once AC-16 lands (row 6).** Options: **A** — add `instance_id` (nullish) to `CiExportInput`; **B** — refuse on any `repo` string matching *any* GitLab repository in the workspace; **C** — resolve by `repoId` (breaking). **Default: A.**
4. **Open question 6 blocks the test strategy, not the product (row 10).** Options: **A** — accept it; recorded-fixture unit tests plus a manual `e2e/` flow; **B** — a `NODE_ENV=test`-only bypass of the private-address check. **Default: A** — B ships an SSRF escape hatch, and root `INSIGHTS.md` 2026-08-02 records that gates disabled under test go unverified.
5. **Should the plan rename `GitHubClient` to a provider-neutral `ForgeClient`?** Options: **A** — split: `ForgeClient` (7 provider-neutral methods) + `GitHubClient extends ForgeClient` (keeps the 5 CI-only ones); **B** — leave `GitHubClient` alone and add a parallel `GitLabClient`, branching at each of the 8 `container.github()` call sites. **Default: A** — B puts a provider `switch` in `pulls/routes.ts`, already the repo's most-copied §12 debt file.

### Recommendations

1. **Ship this as five plans/PRs, not one** — stages A–E, each independently verifiable. Stage B alone touches a shared unique index, a ring-0 parameter type used by three ports, and 11 files. **Default:** one plan document with the PR cut lines marked, each stage dispatched as its own `/impl` run.
2. **Solve the unique index, the clone path and the DTO with one column** — `repos.instance_key TEXT NOT NULL DEFAULT 'github.com'` beside a nullable `instance_id`; unique index on `(workspace_id, instance_key, namespace_path)`; `instance_key` as the clone-path segment. No DML in the migration, no `NULLS NOT DISTINCT` subtlety, AC-19 falls out of the default. **Default:** proceed as specified.
3. **Do not widen `SecretsStatus` or `ConnTestProvider`** — leave both closed enums alone; `GitInstance.verified_at` is the per-instance status, with a new `POST /instances/:id/test`. Keeps AC-19 and AC-27 trivially true. **Default:** proceed as specified.
4. **Add a `git remote get-url origin` check to `clone()` before the reuse branch** — apply it to the GitHub path too; the current reuse branch is a live data-loss path (root `INSIGHTS.md` 2026-08-16). **Default:** proceed as specified.
