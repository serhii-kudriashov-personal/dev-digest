# Project Context (SPEC-01) — implementation plan

## Task
Build the Project Context feature end to end: discover Markdown under per-repository configurable search roots in a repo's local mirror, preview it read-only with token estimates, attach documents to agents and skills in a user-controlled order, read and inject them at run time through the `specs` slot that `assemblePrompt` already exposes, and record what was read and skipped on the run trace and in the run drawer.

## Requirements source
`specs/2026-08-16-project-context.md` (SPEC-01) — 43 acceptance criteria (`AC-1`…`AC-43`), 10 non-functional requirements (`NFR-1`…`NFR-10`), 6 open questions. That document is the source of truth for **what** this feature does. This plan defines only **how** it is built here, and it neither amends nor restates the requirements. Where this plan names a criterion it cites its `AC-N`/`NFR-N` identifier so `plan-verifier` can do a mechanical set difference against the spec.

The spec's six open questions are all planned on their stated **Proceed on** defaults:
1. `.md` only (not `.mdx`) — diverging from `intent/helpers.ts:100` (`/\.mdx?$/i`), deliberately.
2. List cap = 500 documents.
3. The agent count and the preview control do not navigate.
4. `client/messages/en/context.json` is rewritten, not shipped as-is.
5. The search roots are shown, and editable, on the Project Context page (confirmed in scope by the caller).
6. No per-agent master switch for the project-context block; detaching is the off switch.

## Answers taken

| Question | Resolution |
|---|---|
| Q1 — trace shape for AC-38 | **A.** New `.nullish()` `project_context: { read: string[]; skipped: { path, reason }[] }` on `RunTrace`. `specs_read` stays **required** and keeps being populated as a legacy mirror. `TraceBody`'s row is re-pointed at the new field. **Root `INSIGHTS.md` 2026-08-02 (`.nullish()`) governs, NOT 2026-08-11 (sibling response schema)** — absence is the carrier of meaning here, so the field must be allowed to be absent. Do not "fix" this into a sibling schema. |
| Q2 — schema | **A.** Two tables `agent_context_docs` / `skill_context_docs`, composite PK, real FK, `order` integer, following `agent_skills` (`server/src/db/schema/agents.ts:51-64`). Plus a nullable `repos.context_roots jsonb`; NULL means the default glob. |
| Q3 — root editing | **B (user-confirmed).** Inline root editing is in scope: shown in the page subtitle and the AC-8 empty state, editable from there, with a `PUT` endpoint, Zod glob validation, a client mutation, and its own message keys. |
| Q4 — attachment endpoints | **A.** One whole-list replace per owner (`PUT /agents/:id/context-docs`, `PUT /skills/:id/context-docs`) carrying the full ordered path list; one optimistic mutation each. AC-26's limit refusal is a 422 on the replace, rendered through the **same** client code path as AC-23's save failure. |
| Q5 — AC-40 | **A.** Deterministic test that the document text lands inside `<untrusted source="spec-N">` under `## Project context`. AC-40 itself is an `unverifiable` row pointing at `docs/l02-experiment.md`. **This plan claims no review-quality improvement anywhere.** |
| Recommendations 1–4 | All accepted as written. |
| Execution mode | **multi-agent (user-confirmed).** |

## Context read

- root `INSIGHTS.md` (2026-08-16, "Shipped-but-unwired scaffolding also ships a stale product decision") — the direct source of the Part-0 inventory below; `context.json`'s `empty.body`, `chunks`/`indexStatus`/`kb` and `mode.edit`/`editor.save` are each a stale product claim, not a requirement.
- root `INSIGHTS.md` (2026-08-16, "The clone is a mirror that hard-resets on sync") — why every write control is out (AC-13) and why the preview is read-only.
- root `INSIGHTS.md` (2026-08-02, "A field added to a persisted-jsonb contract must be `.nullish()`") — **governs the new `project_context` field.**
- root `INSIGHTS.md` (2026-08-11, "A REQUIRED new field … goes on a sibling response schema") — read and **deliberately not applied**: it governs *required* fields, and this field must be absent on old traces.
- root `INSIGHTS.md` (2026-08-08, "A new prompt slot is TWO edits: `promptTokenCounts` is a hand-written list") — checked: `['specs', assembly.specs]` **already exists** at `server/src/modules/reviews/helpers.ts:111`. No edit is owed there. Verified, not assumed.
- root `INSIGHTS.md` (2026-08-05, "A skill body must NOT be `wrapUntrusted`-wrapped") — the mirror image of this feature. A project-context document **is** wrapped. The two attachment screens look alike and must not share handling.
- root `INSIGHTS.md` (2026-08-05, "A lesson feature is mostly already scaffolded") — the reason `reviewer-core` needs zero edits.
- root `INSIGHTS.md` (2026-08-09, "Phrase an acceptance criterion over FIELDS, never over serialized bytes") — every `Done when` below is a field or a command, never a byte string.
- root `INSIGHTS.md` (2026-08-02, "Stacking convention blocks into an agent's `system_prompt` made the review WORSE") — this feature adds no `system_prompt` text and no rule block. It adds data in an existing slot.
- `server/INSIGHTS.md` (2026-08-16, "A depth-agnostic discovery glob makes `EXCLUDED_DIRS` load-bearing — and `walk.ts` will not apply it for you") — binds Step 5.
- `server/INSIGHTS.md` (2026-08-08, "`no-cross-slice-import` scopes its `from` to `^src/modules/`") — why `platform/container.ts` may import `modules/context/service.ts`.
- `server/INSIGHTS.md` (2026-08-11, "`repo_index_state.status='partial'` does NOT mean a working index") — corroborates AC-10: nothing on this page reads index state.
- `server/INSIGHTS.md` (2026-08-05, "`db:generate` goes INTERACTIVE when one migration both drops and adds a column") — Step 2 only adds, so this does not bite; noted so the implementer does not panic at the prompt if it appears.
- `server/INSIGHTS.md` (2026-08-05, "`pnpm test` is red here for an environmental reason: 8 files start 8 Postgres containers at once") and (2026-08-02, "A SKIPPING integration suite silently reads as passing") — bind the verification plan: read the test **count**, not the exit code.
- `client/INSIGHTS.md` (2026-08-05, "A drag-reorderable server list needs an OPTIMISTIC mutation, not local order state") — binds Steps 11 and 12.
- `client/INSIGHTS.md` (2026-08-09, "A `retry: false` query for a resource that does not exist YET caches the 404 forever") — binds Step 8's response shape.
- `client/INSIGHTS.md` (2026-08-09, "Two panels of one screen reading two query keys go stale ASYMMETRICALLY — and the hook's docblock claimed a mitigation that was never built") — binds Step 10. **The invalidation set is prescribed as code, not as a comment.**
- `client/INSIGHTS.md` (2026-08-08, "`@testing-library/user-event` is NOT installed here, so every interactive test uses `fireEvent`") — binds the AC-22 test. **Contradicts** the vendored `react-testing-library` skill's "NEVER `fireEvent`"; `routing.md` §"Vendored severity is not house law" resolves it in favour of the house record.
- `AGENTS.md` §Repo rules — English-only Markdown; not a monorepo; `@devdigest/shared` exists twice; `*.it.test.ts`; migrations not applied on boot; secrets via `SecretsProvider`.
- `AGENTS.md` §Do not touch — `server/src/db/migrations/**`, `reviewer-core/src/grounding.ts`, `INJECTION_GUARD` in `reviewer-core/src/prompt.ts`, `*/src/vendor/**` (extend, never reorganise), the reserved empty tables.
- `docs/intent-layer.md:65-71` — the `isSafeSpecPath` allowlist precedent the spec names for AC-42.
- `docs/l02-experiment.md` — the only sanctioned way to claim a review-quality change; referenced, not invoked.

*Entries read and rejected:* `server/INSIGHTS.md` 2026-08-02 ("The `findings` table has no indexes at all") and 2026-08-09 ("`findings` and `reviews` ARE indexed now") — this change adds no query against `findings` or `reviews`, so neither binds. `client/INSIGHTS.md` 2026-08-11 ("a CSS custom property that does not exist fails SILENTLY") — noted for the new `styles.ts` files; read `client/src/app/globals.css` before inventing a variable name.

## Inventory — what already exists

| Thing | Where | Verdict |
|---|---|---|
| `specs` prompt slot, `## Project context` heading, `wrapUntrusted('spec-N', …)`, omit-when-empty | `reviewer-core/src/prompt.ts:47,104-106,131` | **reuse as-is — file not opened in this change** |
| `ReviewInput.specs` → `promptParts.specs` → `assemblePrompt` | `reviewer-core/src/review/run.ts:63,149,158` | **reuse as-is — the engine is already fully wired** |
| `promptTokenCounts` row for `specs` | `server/src/modules/reviews/helpers.ts:111` | **already-done** — no edit owed (root `INSIGHTS.md` 2026-08-08 satisfied) |
| `PromptAssembly.specs` (`.nullish()`) | `server/src/vendor/shared/contracts/trace.ts:41` | reuse as-is — carries AC-35's injected text and AC-36's expandable block |
| `PromptAssembly.token_counts` (`.nullish()` record) | `trace.ts:64` | reuse as-is — carries AC-35/NFR-6's block token count |
| `RunTrace.specs_read` (required array) | `trace.ts:106` | **reuse corrected** — cannot satisfy AC-38 (every stored trace holds a literal `[]` from `run-executor.ts:411`); kept as a legacy mirror |
| `specs_read: []` write sites | `server/src/modules/reviews/run-executor.ts:411`, `:569` | reuse corrected |
| Run drawer "Specs read" row, `length === 0 → none` | `…/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:41-55`; `client/messages/en/runs.json:35` | **reuse corrected** — that exact branch is what AC-38 forbids |
| Run drawer `Project context (dynamic)` block, gated `specs != null` | `TraceBody.tsx:84-86`; `runs.json:50` | **reuse as-is** — already satisfies AC-36 and AC-31 |
| `SpecFile` contract | `server/src/vendor/shared/contracts/platform.ts:254-260` | **discard (leave in place, unused)** — new `ContextDocument` lands beside it; `vendor/**` is extend-never-reorganise |
| `IndexStatus` contract | `platform.ts:262-269` | **discard (leave in place, unused)** — AC-10 forbids index status on the page |
| `useContextFiles` (`["context", repoId]`, `GET /repos/:id/context`) | `client/src/lib/hooks/core.ts:121-129` | **reuse corrected** — same key and URL, new response shape; moves to `hooks/context.ts` |
| `useReindexContext` | `core.ts:131-136` | **discard (delete)** — there is no Markdown index (Non-goals); AC-9's refresh is a re-scan |
| Sidebar nav entry `nav.context` | `client/messages/en/shell.json:19-21` | **reuse as-is** |
| `activeKeyFor` → `"context"` branch | `client/src/components/app-shell/helpers.ts:30` | **reuse as-is** — creating the route lights it up |
| `context.json` `chunks`, `indexStatus`, `reindex`, `indexing`, `kb`, `mode.edit`, `editor.*`, `empty.*` | `client/messages/en/context.json` | **discard / rewrite** (exact key table in Step 9) |
| `SkillsTab` + `useSetAgentSkills` optimistic reorder | `…/AgentEditor/_components/SkillsTab/SkillsTab.tsx`; `client/src/lib/hooks/skills.ts:182-210` | **reuse as the template** for both Context tabs |
| `agent_skills` table shape (composite PK + `order`) | `server/src/db/schema/agents.ts:51-64` | **reuse as the template** for the two new tables |
| `EXCLUDED_DIRS` | `server/src/modules/repo-intel/constants.ts:16-25` | **reuse as-is by direct import** — `constants.ts` is outside `SLICE_PRIVATE` (`server/.dependency-cruiser.cjs:65`); precedent `repos/service.ts:14` |
| `walkClone` / `SUPPORTED_EXT` | `repo-intel/pipeline/walk.ts:26-31,101` | **discard** — JS/TS extensions only. Grep: `rg -n "SUPPORTED_EXT" server/src` returns only `constants.ts:13` and `walk.ts:30` — no `.md` walker exists anywhere |
| `isSafeSpecPath` allowlist | `server/src/modules/intent/helpers.ts:98-109` | **reuse corrected by copy, never by import** — `helpers.ts` matches `SLICE_PRIVATE`, and it accepts `.mdx` |
| `container.tokenizer` (`TiktokenTokenizer`) | `server/src/platform/container.ts:154-156` | **reuse as-is** — local, deterministic, satisfies AC-43/NFR-7 |
| `getContext(container, req)` workspace resolution | `server/src/modules/_shared/context.ts:14` | reuse as-is |
| `api.get/put` + `apiFetch` | `client/src/lib/api.ts:21,65-74` | reuse as-is |
| `~{count, number} n` token-estimate copy | `client/messages/en/skills.json` | **reuse as-is** — AC-15's "convention already used for skill bodies" |
| Any attachment table, or any per-repository config store | — | **new.** Grep: `rg -n "pgTable" server/src/db/schema/*.ts` lists 20 tables; none is an attachment or a per-repo config table. `settings` (`db/schema/core.ts:34-48`) is keyed `(workspace_id, user_id, key)` — workspace-scoped, not repo-scoped |

## Constraints that bind

| Rule | Applies? | What the implementation must do |
|---|---|---|
| `@devdigest/shared` exists twice | **yes** | `server/src/vendor/shared/contracts/{platform,trace}.ts` is canon; `client/src/vendor/shared/contracts/{platform,trace}.ts` is a MANUAL copy. Both move in **Step 1, one agent, one step**. Gate: `./scripts/check-shared-sync.sh`. Do **not** verify with `diff -r` — the trees carry documented drift (root `INSIGHTS.md` 2026-08-01); diff only the two files you touched. |
| a field on a **jsonb-persisted** contract | **yes** | `RunTrace.project_context` is `.nullish()`. `specs_read` stays required. The skipped-reason enum is `.nullish()`-free only *inside* the nullish parent. Root `INSIGHTS.md` 2026-08-02. |
| a **required** new field on a jsonb contract → sibling response schema | **no** | Read and rejected: absence is the meaning (AC-38). Root `INSIGHTS.md` 2026-08-11 does not apply. Stated here so nobody "fixes" it. |
| a DB-backed test | **yes** | `server/test/project-context.it.test.ts` and any route test that hits Postgres must end `*.it.test.ts`, or the CI split breaks silently (`AGENTS.md` §Repo rules; `TESTING.md`). |
| a migration | **yes** | Generated with `cd server && pnpm db:generate`, applied by hand with `cd server && pnpm db:migrate`. **Never on boot.** `server/src/db/migrations/**` is append-only — an existing migration file is never edited (`AGENTS.md` §Do not touch). |
| ring / import direction | **yes** | New slice `modules/context/`. `routes.ts` = ring 5 (HTTP + Zod only). `service.ts`/`helpers.ts`/`constants.ts`/`types.ts`/`pipeline/` = ring 2. `repository.ts` = ring 3 (all SQL). Cross-slice reads go through `container.projectContext`, never an import. Gate: `cd server && pnpm arch` — which root `INSIGHTS.md` (2026-08-02) records is **not wired into CI**, so it must be run by hand. |
| `reviewer-core` | **yes, as a non-step** | `reviewer-core/**` is **not opened in this change.** `prompt.ts`, `grounding.ts` and `INJECTION_GUARD` are sentinels; the `specs` slot and its forwarding already exist (`prompt.ts:104-106,131`; `review/run.ts:63,149`). If any step seems to need a `reviewer-core` edit, that step is wrong — stop and report. |
| new file placement in `client/` | **yes** | Route-local components under `client/src/app/repos/[repoId]/context/_components/<Name>/`; the two Context tabs under their own editors' `_components/`. Two near-identical tabs are correct — promotion waits for a third consumer (`frontend-ui-architecture` §2). |
| a secret | **no** | This feature reads a local mirror and the DB. No new credential. |
| any `CLAUDE.md` / `AGENTS.md` | **yes, one file** | `AGENTS.md` §Read when gains a row for `docs/project-context.md` (Step 15). Edit `AGENTS.md`; `CLAUDE.md` stays a symlink, mode `120000`. |
| empty reserved tables | **yes, as a prohibition** | `ci_*`, `eval_*`, `memory`, `digests`, `onboarding` are **not** repurposed and **not** dropped. Two new tables are added instead. |
| a new rule in an agent `system_prompt` | **no** | Nothing in this change edits `agents.system_prompt` or `docs/agent-prompts/**`. |
| not a monorepo | **yes** | `pnpm install` is run inside a package, never at the root. This change adds **no new dependency** in any package — no dnd library, no glob library (the matcher is hand-written in `helpers.ts`). |
| all Markdown in English | **yes** | Every `.md` this change produces or edits. |
| no hard-coded UI strings | **yes** | Every user-facing string is a next-intl key in `client/messages/en/*.json`. |
| every client data read goes through a hook | **yes** | All reads and writes go through `client/src/lib/hooks/context.ts` via `apiFetch`. No `fetch` in a component. |

## Modules touched

| Package | Path | Ring / layer | Why |
|---|---|---|---|
| shared (canon) | `server/src/vendor/shared/contracts/platform.ts` | 0 | `ContextDocument`, `ContextListing`, `ContextDocContent`, `ContextAttachment`, `ContextRootsUpdate`, `ContextDocsUpdate` |
| shared (canon) | `server/src/vendor/shared/contracts/trace.ts` | 0 | `ProjectContextRecord` + `RunTrace.project_context` (`.nullish()`) |
| shared (copy) | `client/src/vendor/shared/contracts/{platform,trace}.ts` | 0 | manual copy, same step |
| server | `server/src/db/schema/project-context.ts` (new), `schema/repos.ts`, `schema.ts` | 3 | two attachment tables + `repos.context_roots` + barrel export |
| server | `server/src/db/migrations/**` (generated) | 3 | **sentinel — additive only** |
| server | `server/src/db/rows.ts` | 3 | row types for the two new tables |
| server | `server/src/modules/context/{constants,helpers,types,service,repository,routes}.ts`, `pipeline/walk-markdown.ts` | 2/3/5 | the new slice |
| server | `server/src/modules/index.ts` | 5 | one import + one registry entry |
| server | `server/src/platform/container.ts` | 4 | lazy `projectContext` facade + `ContainerOverrides` entry |
| server | `server/src/adapters/mocks.ts` | 3 | mock for the new facade (`backend-onion-architecture` §9) |
| server | `server/src/modules/reviews/run-executor.ts` | 2 | resolve → read → inject → record |
| client | `client/src/lib/hooks/context.ts` (new), `hooks/core.ts`, `hooks/index.ts` | data layer | the hooks; `useContextFiles`/`useReindexContext` leave `core.ts` |
| client | `client/messages/en/{context,agents,skills,runs}.json` | i18n | every string |
| client | `client/src/app/repos/[repoId]/context/**` | app | the Project Context page |
| client | `client/src/app/agents/[id]/_components/AgentEditor/**`, `client/src/app/skills/[id]/_components/**` | app | the two Context tabs |
| client | `…/RunTraceDrawer/_components/TraceBody/TraceBody.tsx` | app | AC-38 "not recorded" |
| docs | `docs/project-context.md`, `AGENTS.md` | — | the shipped-feature document and its §Read when row |

## Skills — read by the planner, to be loaded by the executor

Every row below is a skill I opened during planning. The last column is what it demands *here*.

| Path glob | Skill | Sections | `routing.md` row | Rule it imposes on this plan |
|---|---|---|---|---|
| `server/src/modules/**` (service, helpers, pipeline, types) | `backend-onion-architecture` **(preloaded)** | §1 rings, §2 dependency rule, §4 composition root, §8 placement | "`server/src/modules/**` (service, helpers, anything else)" | The fs walker is ring 2 by the `modules/repo-intel/{types,pipeline}` precedent; a service may read `container.<port>` but **never** `container.db`; cross-slice reads go through `container.projectContext`. |
| `server/src/modules/context/repository.ts` | `backend-onion-architecture` **(preloaded)** §5 | §5 repositories | "`server/src/modules/**/repository/**`" (nearest row) | All SQL here and nowhere else; constructor takes `Db`; every method workspace-scoped; nothing Drizzle-shaped in a return type. |
| same | `drizzle-orm-patterns` | schema definition, queries/joins, migrations | same row | `() => table.column` arrow references; `generate` + `migrate`, never `push`; index FK columns manually. |
| `server/src/db/schema/**`, `server/src/db/schema.ts` | `postgresql-table-design` + `drizzle-orm-patterns` | constraints, indexing, JSONB guidance | "`server/src/db/schema/**`" | FK columns are **not** auto-indexed — add them; `snake_case` identifiers; `jsonb` for the roots column with a `CHECK`-equivalent guard at the Zod edge; no polymorphic owner column (which is why Q2→A is two tables). |
| `server/src/modules/context/routes.ts` | `backend-onion-architecture` **(preloaded)** §6 | §6 the Fastify edge | "`server/src/modules/**/routes.ts`" | No SQL, no logic; validation in the route `schema:`; throw `NotFoundError`/`ValidationError`, never `reply.code(500).send`. |
| same | `fastify-best-practices` | `rules/schemas.md`, `rules/error-handling.md`, `rules/routes.md` | same row | Schema-first validation so bad input is rejected before the handler; async handlers throughout. |
| same, plus `run-executor.ts`, `helpers.ts` | `security` | A01 access control, A05 injection (path traversal), A09 logging | "`server/src/modules/**/routes.ts`" | Every read is workspace-scoped (A01); `path.join` with user input allows traversal — validate with a positive-shape allowlist **before** joining (A05, AC-42); **never log document content** (A09, AC-41). |
| `server/src/platform/container.ts` | `backend-onion-architecture` **(preloaded)** §4 | §4 composition root | "`server/src/platform/**`" | Lazy `??=`, no `new` outside the root, `ContainerOverrides` entry so ring 2 stays testable. |
| `*/src/vendor/shared/contracts/**`, any `z.object(` changed | `zod` | `object-optional-vs-nullable`, `schema-use-enums`, `type-export-schemas-and-types`, `parse-use-safeparse` | "`*/src/vendor/shared/**`" and "any `z.object(` added or changed" | `.nullish()` (optional **and** nullable), never `.nullable()`, on `project_context`; export both the schema and its `z.infer` type; the skip reason is a `z.enum`. |
| `server/test/**` | `backend-onion-architecture` **(preloaded)** §9 | §9 testing per ring | "`server/test/**`" | Ring 3 → `*.it.test.ts` with testcontainers; ring 5 → `buildApp({ overrides })` + `app.inject()`; ring 2 → `ContainerOverrides` + `adapters/mocks.ts`. |
| `client/src/app/**/*.tsx`, `client/src/components/**` | `frontend-ui-architecture` **(preloaded)** | §1 placement, §2 promotion, §3 boundaries, §5 business logic | "`client/src/app/**/*.tsx`" | Route-local under `_components/`; two near-identical tabs stay duplicated; no data fetching in a component. |
| same | `react-best-practices` | "Derive, Don't Store", hooks, keys, accessibility | same row | **No `useState` copy of the ordered list**; `aria-label` on the icon-only reorder controls; never an array index as a `key` for a reorderable list. Its "Container components fetch data" and "Max 200 lines" rules are on `routing.md`'s **demotion list** — never blocking here. |
| `client/src/app/repos/[repoId]/context/page.tsx` | `next-best-practices` | `file-conventions.md`, `rsc-boundaries.md`, `suspense-boundaries.md` | "`client/src/app/**/{layout,page,…}.tsx`" | Mark the interactive leaf, not the page, where possible; `_components/` opts the subtree out of routing. |
| `client/src/lib/hooks/**` | `frontend-ui-architecture` **(preloaded)** | §1 placement, §6 constants | "`client/src/lib/**`" | New endpoint → new hook in the matching domain file; a mutation invalidates its query keys in `onSuccess`. |
| `client/src/**/*.test.tsx` | `react-testing-library` | query priority, async | "`client/src/**/*.test.tsx`" | `getByRole` first; `findBy` for async. **Its "NEVER `fireEvent`" rule is overridden** by `client/INSIGHTS.md` 2026-08-08 — `user-event` is not installed. |
| `docs/project-context.md` | `mermaid-diagram` | flowchart, sequence | "`specs/**`" adjacent; the doc carries diagrams | Only for Step 15's document. |

**Not loaded, deliberately:** `typescript-expert` (no type-level change), `mcp` rows (no `mcp/**` file), `e2e` (no flow in scope). `pr-self-review` is not run by any step in this plan.

## Execution

**Multi-agent.** Sequential throughout except one read-only parallel pair. `Input artifact` is always a path, never a summary — subagents share no context, and a plan relayed by paraphrase loses the constraints it exists to carry (`.claude/agents/README.md` §How they chain).

| # | Agent | Input artifact | Steps | Files owned | Output |
|---|---|---|---|---|---|
| 1 | `implementer` | `plans/2026-08-16-project-context.md` | 1–8 (server + contracts) | `server/src/vendor/shared/contracts/{platform,trace}.ts`, `client/src/vendor/shared/contracts/{platform,trace}.ts`, `server/src/db/**`, `server/src/modules/context/**`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/src/adapters/mocks.ts`, `server/src/modules/reviews/run-executor.ts` | server changes in the working tree |
| 2 | `implementer` | the same path | 9–14 (client) | `client/messages/en/{context,agents,skills,runs}.json`, `client/src/lib/hooks/{context,core,index}.ts`, `client/src/app/repos/[repoId]/context/**`, `client/src/app/agents/[id]/_components/AgentEditor/**`, `client/src/app/skills/[id]/_components/**`, `client/src/app/**/RunTraceDrawer/**` | client changes in the working tree |
| 3 | `plan-verifier` | the same path | — | none (read-only) | one row per plan step and per `AC-N`/`NFR-N`, with typed evidence. **`not-met` and `partial` rows go back to hop 1 or 2. `unverifiable` rows are hop 4's worklist.** |
| 4 | `test-writer` | the same path + the `AC-N` worklist in §Acceptance-facing checks + the `unverifiable` rows from hop 3 | 15 | `server/test/**`, `client/src/**/*.test.tsx` | tests |
| 5a | `architecture-reviewer` | the changed-file list | — | none (read-only) | ring and placement findings; runs `pnpm arch` |
| 5b | security review | the changed-file list | — | none (read-only) | AC-41/AC-42/A01/A05 findings |
| 6 | `doc-writer` | the changed-file list + `specs/2026-08-16-project-context.md` | 16 | `docs/project-context.md`, `AGENTS.md` | the feature document and its §Read when row |

**Why hops 1 and 2 are sequential and not parallel:** hop 2 imports the contracts hop 1 writes, so their file sets are ordered even though they do not overlap. **5a and 5b are the only parallel pair** — both are read-only, so their outputs need no reconciliation (root `INSIGHTS.md` 2026-08-11).

**Hard orderings, non-negotiable:**
1. **Both `vendor/shared` copies move in the SAME step, under one owner** (Step 1). `server/src/vendor/shared` is canonical; `client/src/vendor/shared` is the manual copy. Gate: `./scripts/check-shared-sync.sh`.
2. **The migration lands before the repository that reads it** (Step 2 before Step 4).
3. **Contracts before consumers** (Step 1 before everything), **server before client** (hop 1 before hop 2).

**Fallback if a subagent dies on an account limit:** it returns **nothing**, not a partial result (root `INSIGHTS.md` 2026-08-08). Re-dispatch the same hop from the same artifact path; every hop is idempotent against the plan because the plan, not a conversation, is the input.

---

## Steps

### Step 1 — Extend both `@devdigest/shared` copies with the context and trace contracts
- **Files:** `server/src/vendor/shared/contracts/platform.ts`, `server/src/vendor/shared/contracts/trace.ts`, `client/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/trace.ts`
- **Change:** In `platform.ts`, **append below** the existing `SpecFile`/`IndexStatus` block (leave both untouched — `vendor/**` is extend-never-reorganise):
  - `ContextDocument` — `path: z.string()`, `dir: z.string()`, `root: z.string()` (the matched root label, AC-4), `size: z.number().int().nullish()`, `updated_at: z.string().nullish()`, `est_tokens: z.number().int().nullish()`, `truncated: z.boolean()`, `agent_count: z.number().int()` (AC-24), `missing: z.boolean()` (AC-39). Every field the mirror may fail to answer for is `.nullish()` so it renders as unknown, never as zero (§Contract promises).
  - `ContextListing` — a **discriminated union on `state`**: `{ state: 'not_synced' }` (AC-6) | `{ state: 'no_match', roots: string[] }` (AC-8) | `{ state: 'ok', roots: string[], documents: ContextDocument[], total: number, truncated: boolean, scanned_at: string }` (AC-10, AC-11). `zod` §`object-discriminated-unions`.
  - `ContextDocContent` — `{ path, content: z.string(), truncated: z.boolean() }` (AC-12, AC-16). **Content never rides the list** (§Contract promises).
  - `ContextAttachment` — `{ path: z.string(), order: z.number().int(), missing: z.boolean() }` (AC-39).
  - `ContextRootsUpdate` — `{ roots: z.array(z.string().min(1).max(300)).min(1).max(20) }` (AC-1, Step 8 validates the glob shape).
  - `ContextDocsUpdate` — `{ paths: z.array(z.string().min(1)).max(64) }`.
  Export the `z.infer` type beside every schema (`zod` §`type-export-schemas-and-types`).
  In `trace.ts`, add above `RunTrace`:
  ```ts
  export const ContextSkipReason = z.enum([
    'missing', 'unreadable', 'out_of_bounds', 'over_limit', 'deadline', 'not_markdown',
  ]);
  export const ProjectContextRecord = z.object({
    read: z.array(z.string()),
    skipped: z.array(z.object({ path: z.string(), reason: ContextSkipReason })),
  });
  ```
  and on `RunTrace`: `project_context: ProjectContextRecord.nullish(),`.
  **Write the reason for `.nullish()` into the field's docblock, in the shape `token_counts` already uses at `trace.ts:53-62`:** `RunTrace` is one jsonb document; every trace already on disk lacks this key; `.nullable()` accepts an explicit null but **rejects a missing key**, which would make the whole run history unparseable. Root `INSIGHTS.md` 2026-08-02. Add: *"this is deliberately NOT the 2026-08-11 sibling-response-schema case — absence is the meaning (AC-38)."*
  **`specs_read` is not touched.** It stays `z.array(z.string())`, required.
  Then port the identical edits into the two `client/src/vendor/shared/contracts/` files.
- **Skill:** `zod` §`object-optional-vs-nullable`, §`schema-use-enums`, §`type-export-schemas-and-types` — `.nullish()` means optional *and* nullable, which is the only shape that survives a missing jsonb key; `backend-onion-architecture` §1 — ring 0 imports `zod` and nothing else.
- **Agent:** `implementer`
- **Verify:** `./scripts/check-shared-sync.sh` && `cd server && pnpm typecheck` && `cd client && pnpm typecheck`. To eyeball the sync, diff **only the four files touched**, comments stripped — never `diff -r` (root `INSIGHTS.md` 2026-08-01).
- **Done when:** `RunTrace.safeParse(<a trace object with no project_context key>).success === true`, and `RunTrace.safeParse(<the same object with project_context: { read: [], skipped: [] }>).success === true`; `check-shared-sync.sh` exits 0.

### Step 2 — Add the two attachment tables and the per-repository roots column, then generate the migration
- **Files:** `server/src/db/schema/project-context.ts` (new — **not** `schema/context.ts`, which already exists and holds `code_chunks`/`symbols`/`references`/`onboarding`), `server/src/db/schema/repos.ts`, `server/src/db/schema.ts`, `server/src/db/rows.ts`
- **Change:**
  - `agentContextDocs = pgTable('agent_context_docs', { agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }), path: text('path').notNull(), order: integer('order').notNull().default(0) }, (t) => ({ pk: primaryKey({ columns: [t.agentId, t.path] }) }))` — the composite PK is what makes AC-21's "exactly once" a database invariant rather than application code.
  - `skillContextDocs` — the same shape against `skills.id`.
  - In `repos.ts`, add `contextRoots: jsonb('context_roots').$type<string[]>()` — **nullable**; NULL means the default glob (AC-1). Nullable, not defaulted, so "never configured" and "configured to the default" stay distinguishable and NFR-9 holds when the roots are narrowed.
  - `schema.ts`: add `export * from './schema/project-context';` beside the existing exports.
  - `rows.ts`: `export type AgentContextDocRow = typeof t.agentContextDocs.$inferSelect;` and the skill equivalent, so cross-cutting consumers name the row without importing the slice's data layer.
  - The composite PK's leading column indexes `agent_id`/`skill_id`; **no separate FK index is needed** for the `WHERE agent_id = ?` read, and none should be added speculatively. `postgresql-table-design` §Constraints.
  - Then: `cd server && pnpm db:generate`.
- **Skill:** `drizzle-orm-patterns` (schema definition, migrations — `generate` + `migrate`, never `push`; arrow-function `references()`); `postgresql-table-design` (constraints, `snake_case`, `jsonb`); `backend-onion-architecture` §5 — schema and row types are ring 3.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck`; the generated file appears under `server/src/db/migrations/`. Apply by hand: `cd server && pnpm db:migrate`.
- **Done when:** a **new** file exists under `server/src/db/migrations/` containing `create table "agent_context_docs"`, `create table "skill_context_docs"` and `alter table "repos" add column "context_roots"`; **no pre-existing migration file is modified** (`git diff --stat server/src/db/migrations` shows only additions). No reserved empty table (`ci_*`, `eval_*`, `memory`, `digests`, `onboarding`) is dropped or altered.

### Step 3 — `modules/context/constants.ts` and `helpers.ts` — the caps, the glob matcher and the path allowlist
- **Files:** `server/src/modules/context/constants.ts`, `server/src/modules/context/helpers.ts`
- **Change:**
  - `constants.ts`: `DEFAULT_CONTEXT_ROOTS = ['**/{specs,docs,insights}/**/*.md'] as const` (AC-1); `MAX_LISTED_DOCUMENTS = 500` (NFR-4, spec Open question 2); `MAX_DOCS_PER_AGENT = 8` (NFR-4); `MAX_DOCUMENT_CHARS = 8_000` (NFR-5); `RUNTIME_READ_BUDGET_MS = 5_000` (NFR-2); `CONTEXT_DOC_EXT = '.md'` (AC-2, spec Open question 1).
  - `helpers.ts` — pure, no I/O, no container, no DB:
    - `matchesRoots(relPath: string, roots: string[]): string | null` — returns the **root label** that matched (AC-4) or `null`. Hand-written; no glob dependency is added. It must match the configured directory names **at any depth** (AC-2: `packages/foo/docs/bar.md` matches, `lib/notes.md` does not) and return the label of the **first** root that matches, so a document reachable by two roots is labelled once (AC-5).
    - `dedupePaths(paths: string[]): string[]` — first occurrence wins (AC-5, AC-21).
    - `isSafeContextPath(p: string): boolean` — a **copy** of `isSafeSpecPath` (`server/src/modules/intent/helpers.ts:98-109`) with the extension test tightened from `/\.mdx?$/i` to `/\.md$/i`. Copied, **not imported**: `intent/helpers.ts` matches `SLICE_PRIVATE` (`server/.dependency-cruiser.cjs:65`) and importing it fails `no-cross-slice-import`. Keep the positive-shape regex as the last line — a blacklist is not equivalent.
    - `resolveEffectiveDocs(direct: {path,order}[], inherited: {path,order}[]): { injected: string[]; overflow: string[] }` — direct attachments first, then skill-inherited (AC-20), de-duplicated with the direct position winning (AC-21), truncated at `MAX_DOCS_PER_AGENT` with the surplus returned as `overflow` (AC-33).
    - `truncateForInjection(text: string): { text: string; truncated: boolean }` — hard cut at `MAX_DOCUMENT_CHARS` (NFR-5, AC-16).
- **Skill:** `backend-onion-architecture` §8 — "a pure transform → `modules/<name>/helpers.ts`, no I/O, no DB, no container"; `security` A05 — path traversal is stopped by a **positive-shape allowlist applied before any `path.join`**, never by a blacklist.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `pnpm arch` exits 0 with no `no-cross-slice-import` finding, and `helpers.ts` imports nothing from `drizzle-orm`, `node:fs` or any other `modules/*/`.

### Step 4 — `modules/context/repository.ts` — the only place SQL lives
- **Files:** `server/src/modules/context/repository.ts`
- **Change:** `class ContextRepository { constructor(private db: Db) {} }` — takes `Db`, never `Container` (`backend-onion-architecture` §4). Methods, each named for its use case and each workspace-scoped:
  - `getRoots(workspaceId, repoId): Promise<string[] | null>` and `setRoots(workspaceId, repoId, roots)` — reads/writes `repos.context_roots`, scoped by `repos.workspaceId`.
  - `getRepoForContext(workspaceId, repoId): Promise<{ clonePath: string | null } | null>` — the `clonePath` NULL check is AC-6's whole signal (`db/schema/repos.ts:16`).
  - `listAgentDocs(agentId)`, `listSkillDocs(skillId)` — ordered by `order`.
  - `replaceAgentDocs(workspaceId, agentId, paths)`, `replaceSkillDocs(workspaceId, skillId, paths)` — delete-then-insert inside one `db.transaction`, re-numbering `order` from the array index (AC-19). The transaction handle **never leaves the repository** (`backend-onion-architecture` §5).
  - `effectiveDocsForAgent(agentId): Promise<{ direct: {path,order}[]; inherited: {path,order}[] }>` — `agent_context_docs` for direct, and `agent_skills ⨝ skills ⨝ skill_context_docs WHERE skills.enabled = true` for inherited (AC-18, AC-34). Two ordered arrays out; the merge is `resolveEffectiveDocs` in ring 2.
  - `agentReachCounts(workspaceId, paths): Promise<Map<string, number>>` — **distinct** agent ids per path across both routes, excluding agents reached only through a disabled skill (AC-24, §Contract promises "a count of agents, never of attachments").
  Return rows and plain DTOs only — no query-builder chain, no `SQL` fragment, no transaction handle in any signature.
- **Skill:** `backend-onion-architecture` §5 — all SQL here, `Db` in the constructor, workspace-scoped, nothing Drizzle-shaped crossing the boundary; `drizzle-orm-patterns` (queries/joins, transactions).
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `pnpm arch` exits 0 (no `no-sql-in-service`, no `no-sql-in-routes`), and `rg -n "drizzle-orm" server/src/modules/context/` matches `repository.ts` and nothing else.

### Step 5 — `modules/context/pipeline/walk-markdown.ts` — the Markdown walker
- **Files:** `server/src/modules/context/pipeline/walk-markdown.ts`
- **Change:** `walkMarkdown(root: string, roots: string[]): Promise<{ files: { path, dir, root, size, mtime }[]; total: number; truncated: boolean }>`. Modelled on `repo-intel/pipeline/walk.ts` — recursive `readdir({ withFileTypes: true })`, never follow symlinks, swallow an unreadable directory and keep going, posix-normalised relative paths, stable alphabetical sort — but:
  - `import { EXCLUDED_DIRS } from '../../repo-intel/constants.js'` — **a direct import, and it is legal**: `constants.ts` is outside `SLICE_PRIVATE` (`server/.dependency-cruiser.cjs:65`), and `repos/service.ts:14` already does exactly this. Do **not** copy the list; a copy drifts. This exclusion is **load-bearing, not tidiness**: with roots matching at any depth, `node_modules/<pkg>/docs/readme.md` matches the default glob (AC-3; `server/INSIGHTS.md` 2026-08-16).
  - Extension filter is `CONTEXT_DOC_EXT` (`.md` only), not `SUPPORTED_EXT`.
  - Each surviving path goes through `matchesRoots` from Step 3; a `null` label means it is not listed.
  - `total` counts everything that matched; the returned `files` array is cut at `MAX_LISTED_DOCUMENTS` with `truncated: true` (AC-11, NFR-4).
- **Skill:** `backend-onion-architecture` §1 — `modules/*/pipeline` is ring 2 by the `modules/repo-intel/{types,pipeline}` precedent, even though it does fs; §2 — it returns plain data, so the caller decides what to do with it.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** the module's only `modules/*` import is `repo-intel/constants.js`, and `pnpm arch` exits 0.

### Step 6 — `modules/context/types.ts` and `service.ts` — the never-throw facade
- **Files:** `server/src/modules/context/types.ts`, `server/src/modules/context/service.ts`
- **Change:**
  - `types.ts` declares the facade port `ProjectContext`, following `RepoIntel` (`modules/repo-intel/types.ts`) — **it never throws on partial data**: object methods carry a state discriminator, array methods return `[]`. That degraded contract *is* NFR-3. Derive any delegated signature rather than re-typing it (`backend-onion-architecture` §3 — the `completeAgentRun` duplication at `modules/reviews/repository.ts` is the cautionary case).
    ```ts
    export interface ProjectContext {
      list(workspaceId: string, repoId: string): Promise<ContextListing>;
      read(workspaceId: string, repoId: string, path: string): Promise<ContextDocContent | null>;
      setRoots(workspaceId: string, repoId: string, roots: string[]): Promise<string[]>;
      agentDocs(agentId: string): Promise<ContextAttachment[]>;
      skillDocs(skillId: string): Promise<ContextAttachment[]>;
      replaceAgentDocs(workspaceId: string, agentId: string, paths: string[]): Promise<ContextAttachment[]>;
      replaceSkillDocs(workspaceId: string, skillId: string, paths: string[]): Promise<ContextAttachment[]>;
      /** Run-time resolve + bounded read. NEVER throws. */
      resolveForRun(agentId: string, repoId: string): Promise<{ texts: string[]; read: string[]; skipped: { path: string; reason: ContextSkipReason }[] }>;
    }
    ```
  - `service.ts` implements it over `ContextRepository`, `walkMarkdown`, the Step-3 helpers and `container.tokenizer`. Notes that bind:
    - `list()` returns `{ state: 'not_synced' }` when `clonePath` is NULL (AC-6), `{ state: 'no_match', roots }` when the walk found nothing (AC-8), otherwise `{ state: 'ok', … }`. **These are states, never thrown errors** (§The hops, as promises).
    - Token estimates come from `container.tokenizer.count(truncateForInjection(text).text)` — local tiktoken, **no model call anywhere** (AC-43, NFR-7), and computed on the *truncated* text (AC-16, NFR-5).
    - `replaceAgentDocs` computes the effective set and throws `ValidationError` naming `MAX_DOCS_PER_AGENT` when it would be exceeded (AC-26) — the route maps it to 422.
    - `resolveForRun` is the NFR-2/NFR-3 path: start a wall clock, walk `resolveEffectiveDocs`' `injected` list in order, and for each path — reject with `out_of_bounds` if `isSafeContextPath` fails **before opening the file** (AC-42); `missing`/`unreadable` on an fs error (AC-32); `deadline` once `RUNTIME_READ_BUDGET_MS` is spent (NFR-2). Every entry of `overflow` is recorded `over_limit` (AC-33). It **returns**, it never throws, and it never rejects (NFR-3).
    - **`service.ts` reads `container.tokenizer` but must never read `container.db`** — the `Db` handle goes to `ContextRepository`'s constructor (`backend-onion-architecture` §4).
    - **AC-41: no log call in this file, or anywhere downstream, takes document text as an argument.** Log paths, counts, token totals and skip reasons only.
- **Skill:** `backend-onion-architecture` §3 (a facade states its degraded contract; a signature is declared once), §4 (a ring-2 service may read `container.<port>`, never `container.db`); `security` A09 (never log content).
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `resolveForRun` has no `throw` on any path, and `rg -n "runLog|logger|\.info\(|\.warn\(" server/src/modules/context/service.ts` shows no call whose argument expression includes a document's content variable.

### Step 7 — Wire the facade into the composition root and give it a mock
- **Files:** `server/src/platform/container.ts`, `server/src/adapters/mocks.ts`
- **Change:** Add a **lazy** `get projectContext(): ProjectContext { this._projectContext ??= new ContextService(this); return this._projectContext; }` beside `repoIntel`/`agentsRepo`, plus a `projectContext?: ProjectContext` entry on `ContainerOverrides`. The container importing `modules/context/service.ts` is sanctioned: `no-cross-slice-import` scopes its `from` to `^src/modules/`, so `platform/**` is outside it (`server/INSIGHTS.md` 2026-08-08), and the container is *why* `agentsRepo`/`reviewRepo` exist there at all. Then add `MockProjectContext implements ProjectContext` to `adapters/mocks.ts` — without it, Step 8's ring-2 and ring-5 tests cannot run hermetically.
- **Skill:** `backend-onion-architecture` §4 (never `new` an adapter outside the root; lazy `??=`; `ContainerOverrides` is the test seam), §9 (every new port needs a mock in `adapters/mocks.ts` that `implements` it).
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `rg -n "new ContextService" server/src` matches `platform/container.ts` and nothing else; `MockProjectContext` satisfies `implements ProjectContext` under `pnpm typecheck`.

### Step 8 — `modules/context/routes.ts` and the module registry
- **Files:** `server/src/modules/context/routes.ts`, `server/src/modules/index.ts`
- **Change:** A default Fastify plugin, HTTP and Zod only — no SQL, no logic. Every handler resolves tenancy with `await getContext(container, req)` (`modules/_shared/context.ts:14`) before anything else (`security` A01: deny by default, and being on `/repos/:id/` is not proof of access).
  - `GET /repos/:id/context` → `ContextListing`. **Always 200, never 404**, including the not-synced case. The reason is recorded: a `retry: false` query for a resource that does not exist *yet* caches its absence for the session, and nothing invalidates the key (`client/INSIGHTS.md` 2026-08-09). A 404 here would make AC-7 unreachable. `{ state: 'not_synced' }` is a state, not an error (AC-6, §The hops "a repository with no mirror answers 'not synced', which is a state and not an error").
  - `GET /repos/:id/context/doc?path=…` → `ContextDocContent`; `NotFoundError` when the path is unsafe or absent (AC-12). Validation in the route `schema: { querystring }`.
  - `PUT /repos/:id/context/roots`, body `ContextRootsUpdate` → `{ roots }` (AC-1, AC-8, Open question 5). Zod validates each root as a non-empty string ≤300 chars containing no NUL or control character; a malformed glob is a 422 from the schema, before the handler runs.
  - `GET|PUT /agents/:id/context-docs`, `GET|PUT /skills/:id/context-docs`, body `ContextDocsUpdate` → `ContextAttachment[]` (AC-17, AC-18, AC-19, Q4→A). The over-limit `ValidationError` from Step 6 surfaces as **422 with the limit in `error.message`** (AC-26).
  - `POST /repos/:id/context/refresh` → re-runs `list()` and returns the fresh `ContextListing`; the same call re-evaluates `missing` markers (AC-9).
  Register: one import + one `context,` entry in `modules/index.ts`.
  Throw `NotFoundError`/`ValidationError` (`platform/errors.ts`) — never `reply.code(...).send(...)`, which bypasses the `{ error: { code, message, details } }` envelope.
- **Skill:** `backend-onion-architecture` §6 (routes are HTTP and Zod; validation in the route `schema:`; static registration; throw, don't hand-craft) — and explicitly **not** `modules/pulls/routes.ts` as a template, which is §12 catalogued debt with ~25 Drizzle call sites; `fastify-best-practices` `rules/schemas.md` + `rules/error-handling.md`; `security` A01 (workspace scoping on every route) and A05 (`path` is attacker-controlled query input).
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch && pnpm test -- routes-smoke`
- **Done when:** `pnpm arch` exits 0 with no `no-sql-in-routes` finding; `GET /repos/<a repo with clonePath NULL>/context` returns HTTP **200** with `body.state === 'not_synced'`.

### Step 9 — Inject at run time and record it on the trace
- **Files:** `server/src/modules/reviews/run-executor.ts`
- **Change:** In the success path, beside the existing `linkedSkills` resolution (~`:238-260`) and before `reviewPullRequest`:
  ```ts
  const projectContext = await this.container.projectContext.resolveForRun(agent.id, pull.repoId);
  ```
  Then add one spread to the `reviewPullRequest({...})` call, in the same style as the four already there (`:279-295`):
  ```ts
  ...(projectContext.texts.length > 0 ? { specs: projectContext.texts } : {}),
  ```
  That is the **entire** injection change — `ReviewInput.specs` already reaches `assemblePrompt` (`reviewer-core/src/review/run.ts:63,149`), which already emits `## Project context` and already wraps each document `wrapUntrusted('spec-N', …)` (`prompt.ts:104-106,131`). With zero documents the spread is absent and the assembled prompt is unchanged from a pre-feature run (AC-31).
  On the trace object (~`:397-412`), replace `specs_read: []` with:
  ```ts
  specs_read: projectContext.read,                                   // legacy mirror, stays required
  project_context: { read: projectContext.read, skipped: projectContext.skipped },
  ```
  **`project_context` is written on every new run, including one that read nothing** (`{ read: [], skipped: [] }`). That is exactly what makes AC-38 work: a *new* run with nothing attached reads as "no documents read", and only a run stored *before* this feature — which has no key at all — reads as "not recorded".
  Leave `prompt_assembly.token_counts` alone: `promptTokenCounts` already carries `['specs', assembly.specs]` at `helpers.ts:111`, so the block's token count appears automatically (AC-35, NFR-6). **Do not add a second row.**
  On the failed-run path (~`:565-570`), leave `specs_read: []` as-is and **do not** add `project_context` — a run that never reached resolution genuinely has no record, and AC-38's rendering is then correct by construction.
  Log a single line naming the counts only: `` runLog.info(`Project context: ${read.length} document(s) read, ${skipped.length} skipped`) `` — **never a path's content** (AC-41).
- **Skill:** `backend-onion-architecture` §2 (an outer ring may call an inner ring directly — no pass-through method is added to `reviews/service.ts`), §4 (`container.projectContext`, never a `modules/context/*` import); `security` A09.
- **Agent:** `implementer`
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `git diff --stat reviewer-core/` is **empty** — `reviewer-core/**` is not opened in this change; and `rg -n "from '\.\./context" server/src/modules/reviews/` returns nothing.

> **Non-step, stated so nobody drifts into it:** no file under `reviewer-core/` is edited in this plan. `prompt.ts` (its `INJECTION_GUARD`) and `grounding.ts` are sentinels under `AGENTS.md` §Do not touch, and the `specs` slot they expose is already complete. If a step appears to require a `reviewer-core` edit, that step is wrong — stop and report it rather than editing.

---

### Step 10 — Client hooks: `client/src/lib/hooks/context.ts`
- **Files:** `client/src/lib/hooks/context.ts` (new), `client/src/lib/hooks/core.ts`, `client/src/lib/hooks/index.ts`
- **Change:** Move `useContextFiles` out of `core.ts` (and **delete `useReindexContext`** — there is no reindex). New hooks, all through `api` from `@/lib/api`:
  - `useContextListing(repoId)` — key `["context", repoId]`, `queryFn: () => api.get<ContextListing>(\`/repos/${repoId}/context\`)`. **Add `refetchInterval: (q) => q.state.data?.state === 'not_synced' ? 5_000 : false`** — that poll is AC-7: the tab left open moves from not-synced to a populated list with no reload. It works precisely because Step 8 returns 200 rather than 404; a 404 would be cached for the session (`client/INSIGHTS.md` 2026-08-09). Do **not** set `retry: false`.
  - `useContextDoc(repoId, path)` — key `["context-doc", repoId, path]`, `enabled: !!path` (AC-12).
  - `useRefreshContext()` — `POST …/refresh`; `onSuccess` writes the response into `["context", repoId]` (AC-9).
  - `useSetContextRoots()` — `PUT …/context/roots`; `onSuccess` invalidates `["context", repoId]` (AC-1, AC-8).
  - `useAgentContextDocs(agentId)` — key `["agent-context", agentId]`; `useSkillContextDocs(skillId)` — key `["skill-context", skillId]`.
  - `useSetAgentContextDocs()` / `useSetSkillContextDocs()` — a direct clone of `useSetAgentSkills` (`client/src/lib/hooks/skills.ts:182-210`): **optimistic**, `onMutate` cancels the key and seeds the cache from `paths.map((path, order) => ({ path, order, missing: false }))`, `onError` restores `ctx.previous`, `onSuccess` writes the server's answer. That rollback is AC-23 **and** AC-26's 422 through one code path — a rejected replace is an error like any other, and the list returns to the order the server holds while the caller surfaces `error.message`.
  - **The AC-25 invalidation set, prescribed as code and not as a comment** — `onSettled` of both replace mutations does exactly:
    ```ts
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ["context"] });        // the document list + its agent_count
      qc.invalidateQueries({ queryKey: ["agent-context"] });  // the other owner's attachment list
      qc.invalidateQueries({ queryKey: ["skill-context"] });
      qc.invalidateQueries({ queryKey: ["agents"] });         // the agents list renders a per-agent count
    }
    ```
    The document list's `agent_count` and the owner's attachment list are **two keys on one screen**, and `client/INSIGHTS.md` (2026-08-09) records both that they go stale asymmetrically and that a docblock claiming a mitigation was written where the code was not. Write the invalidation, not the claim.
  - Re-export the new hooks from `hooks/index.ts`.
- **Skill:** `frontend-ui-architecture` §1 (data fetching is a hook in the data layer, never in a component), §In this repo (a mutation must invalidate its query keys); `react-best-practices` (Data Fetching — all fetching in custom hooks).
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n "useReindexContext|/context/reindex" client/src` returns nothing; both replace mutations contain an `onMutate` **and** an `onError` that restores `previous`.

### Step 11 — Message keys: the exact copy surface
- **Files:** `client/messages/en/context.json`, `client/messages/en/agents.json`, `client/messages/en/skills.json`, `client/messages/en/runs.json`
- **Change:** All copy in English (`AGENTS.md` §Repo rules). No string is hard-coded in a component.

  `context.json` — **discard these keys outright** (each asserts something the feature does not do): `chunks`, `reindex`, `indexing`, `indexStatus`, `kb`, `mode.edit`, `editor.loadError`, `editor.save`, `editor.saving`. Root `INSIGHTS.md` 2026-08-16 records why: `walk.ts` indexes JS/TS only so there is no chunk pipeline (AC-10), and the mirror hard-resets so nothing is editable (AC-13).

  **Keep as-is:** `title`, `loadError`, `mode.preview`, `resync`.

  **Rewrite:** `empty.title` / `empty.body` — the shipped body names `.devdigest/specs/`, a directory this feature does not privilege (spec Open question 4). It splits into two states.

  **New keys:**

  | Key | Serves |
  |---|---|
  | `subtitle` (names the effective roots) | AC-1, Open question 5 |
  | `roots.edit`, `roots.save`, `roots.cancel`, `roots.label`, `roots.invalid` | Open question 5, AC-8 |
  | `notSynced.title`, `notSynced.body` | AC-6 |
  | `noMatch.title`, `noMatch.body` (names the roots), `noMatch.action` | AC-8 |
  | `truncated` (`Showing the first {cap} of {total} documents.`) | AC-11 |
  | `summary` (`{count, plural, …} · scanned {when}`) | AC-10 |
  | `editInRepo` (documents are edited in the repository and picked up on the next sync) — rendered **including when no document matched** | AC-14 |
  | `refresh`, `refreshing` | AC-9 |
  | `tokenEstimate` (`~{count, number} tok`, matching `skills.json`) | AC-15 |
  | `docTruncated` | AC-16, NFR-5 |
  | `rootLabel` | AC-4 |
  | `missing` | AC-39 |
  | `agentCount` — **three distinct forms** via `{count, plural, =0 {…} one {…} other {…}}` | AC-24 |
  | `attach`, `detach`, `attachWarning` (the full text is sent to the configured model provider on every run of the affected agents) | AC-27 |
  | `serialization.title`, `serialization.heading` (`## Project context`), `serialization.wrapper` (`<untrusted source="spec-N">`), `serialization.note` | AC-28 |
  | `limitReached` (names `8`) | AC-26 |
  | `saveFailed` | AC-23 |
  | `reorder.up`, `reorder.down`, `reorder.hint` — `aria-label`s for the icon-only keyboard controls | AC-22, `react-best-practices` Accessibility |

  `agents.json` — add `editor.tabs.context` beside the existing `config`/`skills`/`evals`/`stats`/`ci` (`client/messages/en/agents.json:46-52`).
  `skills.json` — add the matching Context tab label for the skill editor's tab set.
  `runs.json` — add `trace.config.notRecorded` and `trace.config.skipped`. **`trace.config.none` is kept**, because a *new* run that read nothing still legitimately reads "none"; the two are different states (AC-38).
- **Skill:** `frontend-ui-architecture` §1 (user-facing string → the i18n catalogue, never inline), §10 (hard-coded string is an anti-pattern).
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** `rg -n "chunks|indexStatus|reindex|editor\.save" client/messages/en/context.json` returns nothing, and `rg -n "\.devdigest/specs" client/` returns nothing.

### Step 12 — The Project Context page
- **Files:** `client/src/app/repos/[repoId]/context/page.tsx`, `client/src/app/repos/[repoId]/context/_components/ContextView/{ContextView.tsx,styles.ts,constants.ts,index.ts}`, `_components/DocumentList/`, `_components/DocumentPreview/`, `_components/RootsEditor/`
- **Change:** The route is new; `activeKeyFor` (`client/src/components/app-shell/helpers.ts:30`) and `shell.json`'s `nav.context` already resolve to it, so no shell change is needed. `ContextView` switches on `listing.state`:
  - `not_synced` → the AC-6 copy, **presented as a state and not an error**.
  - `no_match` → the AC-8 copy, naming the roots, with the `RootsEditor` control inline (Open question 5). Distinct wording from `not_synced`, because the fix is different.
  - `ok` → the document list (path, `dir`, root label badge, `~N tok`, truncation marker, missing marker, agent count in its three forms) plus the summary line (count + scanned-at, and **nothing else** — no coverage score, no index status, no chunk count, AC-10), the truncation notice when `truncated` (AC-11), the refresh control (AC-9), and the `editInRepo` sentence (AC-14).
  The `editInRepo` sentence renders in **all three** states (AC-14: "including when no document matched").
  Selecting a document renders `DocumentPreview` from `useContextDoc` — formatted Markdown, read-only (AC-12). **No edit mode, no add-file, no new-folder, no upload control exists anywhere on this page** (AC-13). Category badges carry a colour **and** a word, never colour alone.
  `RootsEditor` is a small `'use client'` leaf calling `useSetContextRoots`; the page and layout are **not** marked `'use client'` wholesale (`frontend-ui-architecture` §9: mark the interactive leaf).
  No local `useState` mirrors any server value — everything renders from the query (`react-best-practices` "Derive, Don't Store").
- **Skill:** `frontend-ui-architecture` §1 placement (route-local under `_components/<Name>/`), §8 naming (kebab route segment, Pascal component folder), §9 (`'use client'` on the leaf); `next-best-practices` `file-conventions.md` (`_folder` opts the subtree out of routing), `rsc-boundaries.md`; `react-best-practices` (Derive-Don't-Store; Conditional Rendering — never `{count && <X/>}` when `count` can be 0; `aria-label` on icon-only buttons).
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** `rg -n "edit|upload|new-folder|add-file" client/src/app/repos/\[repoId\]/context/` finds no interactive write control; the three `listing.state` branches each render a distinct message key.

### Step 13 — The agent Context tab and the skill Context tab
- **Files:** `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/{ContextTab.tsx,helpers.ts,styles.ts,index.ts}`, `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` (tab registration), `client/src/app/skills/[id]/_components/ContextTab/…`, `client/src/app/skills/[id]/_components/SkillEditorView/SkillEditorView.tsx`
- **Change:** Both are structural clones of `SkillsTab` (`…/AgentEditor/_components/SkillsTab/SkillsTab.tsx`), which already carries the docblock explaining why. Copy its shape exactly:
  - **No `useState` copy of the ordered list.** The rendered order comes straight from `useAgentContextDocs` / `useSkillContextDocs`; the optimistic mutation from Step 10 writes the new order into the cache. Adding a `useState` + `useEffect([docs])` pair reintroduces the CRITICAL "store derived state, then patch it" bug (`client/INSIGHTS.md` 2026-08-05).
  - Local state is only the drag gesture (`dragFrom`, `dragOver`), exactly as `SkillsTab.tsx:29-31`.
  - Reorder by **native HTML5 `draggable`** — no dnd library is installed and none is added.
  - **AC-22, the genuinely new part:** each row's drag handle is a focusable `<button>` with `aria-label` from `context.reorder.up`/`down`, handling `ArrowUp`/`ArrowDown` (and `Home`/`End` if cheap) and calling the **same** `save(next)` the drag path calls. Order must be changeable with the keyboard alone, no pointer.
  - The attach action shows the AC-27 warning at the moment of attaching — that the document's full text will be sent to the configured model provider on every run of the affected agents. It is the only place in this feature where a user decision moves data off-machine, so it is the only place the warning belongs.
  - The AC-28 serialisation panel shows the **real** heading `## Project context` and the real `<untrusted source="spec-N">` wrapper. The design's `SERIALIZES AS ## Project specifications` is a design error (spec §Design review row 12); the panel is kept and corrected.
  - A `missing` attachment shows the missing marker here too, not only on the Project Context page (AC-39).
  - Both tabs render an error surface fed by the mutation's `error` — one path serving AC-23 (save failed) and AC-26 (422 with the limit).
  - **These are documents, not skill bodies.** A skill body is house-authored instruction and is *not* untrusted-wrapped (root `INSIGHTS.md` 2026-08-05); a project-context document is repository content and *is* wrapped. The two tabs look alike; their handling is opposite, and the AC-28 panel is where that is taught.
  Two near-identical tabs are the correct outcome — promotion waits for a third consumer (`frontend-ui-architecture` §2).
- **Skill:** `frontend-ui-architecture` §1, §2 promotion (duplication is cheaper than the wrong abstraction), §5 (business logic placement); `react-best-practices` (Derive-Don't-Store; Key Prop Patterns — never an array index as a key for a reorderable list; Accessibility — `aria-label` on icon-only buttons).
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** neither `ContextTab.tsx` contains a `useState` holding the document list; both register a new tab whose label comes from the Step-11 message key; the keyboard handler and the drag handler call the identical `save(next)`.

### Step 14 — Run drawer: "not recorded" is not "none"
- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`
- **Change:** Replace the `trace.specs_read`-driven row (`:41-55`) with a three-way branch on the new field:
  ```
  trace.project_context == null      → t("trace.config.notRecorded")   // AC-38
  project_context.read.length === 0  → t("trace.config.none")
  otherwise                          → the ordered paths (AC-19, AC-35)
  ```
  and add a skipped row rendering `project_context.skipped` as `path — reason` (AC-37), shown only when the record is present. The reason string comes from a message key per `ContextSkipReason` member, not from the raw enum value.
  The `Project context (dynamic)` prompt block (`:84-86`) is **unchanged** — it already gates on `prompt_assembly.specs != null` and already shows `token_counts.specs`, which is AC-36 and AC-35's token count.
- **Skill:** `frontend-ui-architecture` §1 (strings are keys); `react-best-practices` (Conditional Rendering — three states via early returns or explicit ternaries, never `{x && …}` on a possibly-zero value).
- **Agent:** `implementer`
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** the component renders `notRecorded` for a trace object with **no** `project_context` key, and `none` for one with `project_context: { read: [], skipped: [] }`.

---

### Step 15 — Tests
- **Files:** `server/test/context-helpers.test.ts`, `server/test/context-walk.test.ts`, `server/test/project-context.it.test.ts`, `server/test/context-routes.test.ts`, `server/test/reviews-project-context.test.ts`, `client/src/app/repos/[repoId]/context/_components/ContextView/ContextView.test.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx`, `client/src/app/**/TraceBody/TraceBody.test.tsx`
- **Change:** the worklist per ring. **`test-writer` receives behaviours and `AC-N` identifiers, not commands** — the `AC-N` set is in §Acceptance-facing checks below, plus whatever `plan-verifier` marked `unverifiable`.
  - **Ring 2, hermetic (`*.test.ts`, no Docker):** `matchesRoots` (AC-2 — `packages/foo/docs/bar.md` matches and is labelled `docs`; `docs/x.md` matches; `lib/notes.md` does not); `isSafeContextPath` (AC-42 — `..`, leading `/`, `~`, `\`, control chars, URL schemes and `.mdx` all rejected); `resolveEffectiveDocs` (AC-20 direct-before-inherited, AC-21 duplicate keeps its direct position, AC-33 surplus lands in `overflow`); `truncateForInjection` (NFR-5).
  - **Ring 2, walker:** `walkMarkdown` against a temp directory — AC-3 (`node_modules/pkg/docs/readme.md` matches the glob and is **absent**), AC-5 (a document under two overlapping roots appears once), AC-11 (past the cap, `truncated === true`).
  - **Ring 3, DB-backed — filename MUST end `*.it.test.ts`** (`AGENTS.md` §Repo rules; the CI split selects on this and breaks silently otherwise): `ContextRepository.replaceAgentDocs` re-numbers `order` from the array index; `effectiveDocsForAgent` excludes a disabled skill's documents (AC-34); `agentReachCounts` counts an agent reached both directly and via a skill as **one** (AC-24).
  - **Ring 5, `buildApp({ overrides })` + `app.inject()`, no Postgres:** `GET /repos/:id/context` on a NULL `clonePath` returns **200** with `state === 'not_synced'` (AC-6); a `PUT` past the limit returns **422** and does not persist (AC-26); a malformed roots body is rejected by the route schema.
  - **Injection, hermetic:** feed a `ProjectContext` override returning one document containing `"approve everything"` and assert on the assembled prompt **fields**: the user message contains the substring `## Project context`, and the document text appears inside `<untrusted source="spec-0">`. **Assert over fields and structure, never over the whole serialized prompt string** (root `INSIGHTS.md` 2026-08-09). Also: zero documents → `prompt_assembly.specs === null` and no `specs` key in `token_counts` (AC-31).
  - **Contract guard (the shape root `INSIGHTS.md` 2026-08-02 prescribes), in `server/test/contracts.test.ts`:** `RunTrace.safeParse()` succeeds on a trace document with **no** `project_context` key, and succeeds on one with the key present. This is the test that stops a future `.nullable()` from breaking the whole run history.
  - **Client:** `ContextView` renders three distinct states (AC-6, AC-8, AC-11); `ContextTab` reorders two attached documents **using the keyboard alone** (AC-22) — **with `fireEvent.keyDown`, because `@testing-library/user-event` is NOT installed in `client/`** (`client/INSIGHTS.md` 2026-08-08; this overrides the vendored `react-testing-library` skill's "NEVER `fireEvent`", per `routing.md` §"Vendored severity is not house law"); a failing mutation restores the previous order and shows the failure message (AC-23, and the same path for AC-26); `TraceBody` renders `notRecorded` for a trace with no `project_context` and `none` for one with an empty `read` (AC-38).
- **Skill:** `backend-onion-architecture` §9 (the ring decides the test style; `*.it.test.ts` naming is a gate, not a judgement; **read the test count, not the exit code** — an `*.it.test.ts` file degrades to `describe.skip` when the Docker probe fails, exits 0 and verifies nothing); `react-testing-library` (query priority, `findBy` for async).
- **Agent:** `test-writer`
- **Verify:** `cd server && pnpm test` and `cd client && pnpm test`
- **Done when:** every `AC-N` in §Acceptance-facing checks has at least one named test, and no `*.it.test.ts` file reports `N skipped`.

### Step 16 — Document the shipped feature
- **Files:** `docs/project-context.md` (new), `AGENTS.md`
- **Change:** A `docs/` document covering the discovery glob and its exclusions, the three list states, the three caps (500 list / 8 per agent / 8,000 characters) and what the user sees at each, the direct-before-inherited ordering rule, the run-time read path and its skip reasons, and how to read the trace — including that a run stored before this feature reads as "not recorded". Include the two Mermaid diagrams. English only. Register it with a row in `AGENTS.md` §Read when. Edit `AGENTS.md`; `CLAUDE.md` stays a symlink (mode `120000`).
  The document **must not** claim a review-quality improvement. If anyone wants that claim, `docs/l02-experiment.md` is how it is measured.
- **Skill:** `mermaid-diagram` (flowchart, sequence).
- **Agent:** `doc-writer`
- **Verify:** `git ls-files -s CLAUDE.md` still shows mode `120000`.
- **Done when:** `docs/project-context.md` exists, is English, and `AGENTS.md` §Read when has a row pointing at it.

---

## Verification plan

| Package | Command | Runs when |
|---|---|---|
| server | `cd server && pnpm typecheck` | `server/**` changed |
| server | `cd server && pnpm arch` | `server/**` changed — **not wired into CI** (root `INSIGHTS.md` 2026-08-02), so it must be run by hand, and green means exit 0, nothing less |
| server | `cd server && pnpm test` | `server/**` changed — **read the test count, not the exit code**; `N skipped` on an `*.it.test.ts` file means unverified (`server/INSIGHTS.md` 2026-08-02). `pnpm test` is also environmentally red here when 8 integration files start 8 Postgres containers at once (`server/INSIGHTS.md` 2026-08-05) — scope the run rather than re-running blindly |
| server | `cd server && pnpm db:migrate` | after Step 2 — **by hand; migrations are never applied on boot** |
| client | `cd client && pnpm typecheck && pnpm lint && pnpm test` | `client/**` changed |
| — | `./scripts/check-shared-sync.sh` | `*/src/vendor/shared/**` changed (Step 1) |

`reviewer-core` has no row: **no file under `reviewer-core/` is changed by this plan.**

## Acceptance-facing checks

Each row restates a criterion the spec already states, phrased over a **field** or a command so a verdict has typed evidence. Nothing here is new. This is `test-writer`'s worklist and `plan-verifier`'s checklist.

| AC / NFR | Settled by |
|---|---|
| AC-1 | `repos.context_roots` is NULL → `list()` uses `DEFAULT_CONTEXT_ROOTS`; a `PUT /repos/:id/context/roots` changes which documents `ContextListing.documents` contains, with no code change |
| AC-2 | `matchesRoots('packages/foo/docs/bar.md', DEFAULT)` returns `'docs'`; `matchesRoots('lib/notes.md', DEFAULT)` returns `null` |
| AC-3 | `walkMarkdown` over a fixture containing `node_modules/pkg/docs/readme.md` returns a `files` array not containing that path |
| AC-4 | every `ContextDocument` has a non-empty `root` and a `dir` |
| AC-5 | with two overlapping roots configured, each `path` appears exactly once in `ContextListing.documents` |
| AC-6 | `GET /repos/:id/context` with `clonePath === null` → HTTP **200**, `body.state === 'not_synced'` |
| AC-7 | `useContextListing` sets a `refetchInterval` while `data.state === 'not_synced'`, and the endpoint never returns 404 |
| AC-8 | walk found nothing → `body.state === 'no_match'` with a non-empty `roots`; the view renders `noMatch.*` and the `RootsEditor` |
| AC-9 | `POST …/context/refresh` returns a fresh `ContextListing` whose `documents` includes a newly added file and whose attachment `missing` flags are re-evaluated |
| AC-10 | `ContextListing` (state `ok`) carries `total` and `scanned_at` and **no** coverage/index/chunk field; `rg -n "chunk\|coverage\|indexStatus" client/src/app/repos/\[repoId\]/context/` is empty |
| AC-11 | past the cap, `truncated === true` and `documents.length === 500` |
| AC-12 | `GET …/context/doc?path=…` returns `ContextDocContent.content`; `DocumentPreview` renders it as Markdown |
| AC-13 | no write control exists on the page (grep, Step 12's `Done when`) |
| AC-14 | the `editInRepo` key renders in all three `listing.state` branches |
| AC-15 | `est_tokens` is rendered through the `~{count, number} tok` key |
| AC-16 | `truncated === true` on an over-limit document, and `est_tokens` is computed from `truncateForInjection(text).text` |
| AC-17, AC-18 | `resolveForRun` output `read` contains the direct path, and the skill-inherited path for an agent that never attached it directly |
| AC-19 | `project_context.read` is in the same order as `ContextAttachment.order` |
| AC-20, AC-21 | `resolveEffectiveDocs` unit test: direct first; a doubly-reached path appears once, at its direct index |
| AC-22 | `ContextTab` order changes via `fireEvent.keyDown` alone, no pointer event |
| AC-23 | on mutation failure the query cache holds `ctx.previous` and the failure message renders |
| AC-24, AC-25 | `agentReachCounts` returns 1 for an agent reached both ways; `onSettled` invalidates `["context"]`, `["agent-context"]`, `["skill-context"]`, `["agents"]` |
| AC-26 | replace past 8 → HTTP 422 naming the limit; the repository row count is unchanged |
| AC-27 | the `attachWarning` key is rendered at the attach action |
| AC-28 | the serialisation panel's heading string is `## Project context` and its wrapper string is `<untrusted source="spec-N">` |
| AC-29, NFR-8 | `resolveForRun` reads from disk inside the run; two concurrent runs each produce their own `read` array |
| AC-30 | the assembled user message contains `## Project context`, and the document text sits inside `<untrusted source="spec-0">` |
| AC-31 | zero documents → `prompt_assembly.specs === null` and `token_counts` has no `specs` key |
| AC-32, AC-37, NFR-3 | a deleted file → the run completes and `project_context.skipped` contains `{ path, reason: 'missing' }` |
| AC-33 | 9 effective documents → `read.length === 8` and one `{ reason: 'over_limit' }` |
| AC-34 | disabling a skill removes its paths from `read` while its rows remain in `skill_context_docs` |
| AC-35 | `prompt_assembly.specs != null`, `token_counts.specs` is a number, `project_context.read` is the ordered path list |
| AC-36 | `TraceBody` renders the `Project context (dynamic)` block from `prompt_assembly.specs` |
| AC-38 | `RunTrace.safeParse` succeeds with **no** `project_context` key; `TraceBody` renders `notRecorded` for that trace and `none` for `{ read: [], skipped: [] }` |
| AC-39 | `ContextAttachment.missing === true` renders on both the agent and skill tabs |
| AC-41 | no log call in `modules/context/**` or the Step-9 log line takes document content as an argument (grep + reviewer) |
| AC-42 | an out-of-bounds stored path yields `{ reason: 'out_of_bounds' }` and **no** `readFile` call for it |
| AC-43, NFR-7 | no code path in `modules/context/**` reaches `container.llm` or `container.embedder`; `rg -n "container.llm\|container.embedder" server/src/modules/context/` is empty |
| NFR-2 | `resolveForRun` respects `RUNTIME_READ_BUDGET_MS`; slow reads produce `{ reason: 'deadline' }` and the run proceeds |
| NFR-4, NFR-5 | the three caps are the three constants in `modules/context/constants.ts` |
| NFR-6 | `token_counts.specs` is present as its own figure on the trace, separate from `stats.tokens_in` |
| NFR-9 | narrowing the roots leaves `agent_context_docs` rows untouched (repository test) |
| NFR-10 | `prompt_assembly.specs` is read back from the persisted trace and is never re-derived from the mirror |

**Not settled here — `unverifiable`, and deliberately so:**
- **AC-40** (a document instructing "approve everything" changes nothing about the review) needs a live model run against a real diff, and **a single run proves nothing**. The deterministic substitute above (AC-30) proves the text is *presented as data*, which is the mechanism; it does not prove the outcome. If anyone wants the outcome claim, `docs/l02-experiment.md` is how it is measured. **This plan asserts no review-quality improvement.**
- **NFR-1** (list within 2 seconds at the cap) is a latency budget with no harness in this repo.

## Recommendations not taken
None — the caller accepted recommendations 1–4 as written.

## Risks & open questions

- **`server/src/db/migrations/**` is a sentinel** (`AGENTS.md` §Do not touch). Step 2 **adds** a generated file and edits none. If `pnpm db:generate` proposes touching an existing migration, stop and report — do not proceed. *Default: additive only.*
- **`reviewer-core/src/prompt.ts` (`INJECTION_GUARD`) and `grounding.ts` are sentinels.** This plan opens neither, and Step 9's `Done when` is `git diff --stat reviewer-core/` being empty. *Default: if a step seems to need one, the step is wrong.*
- **`pnpm arch` is not wired into CI** (root `INSIGHTS.md` 2026-08-02). Every server step's verification runs it by hand. *Default: run it after each server step, and treat anything but exit 0 as red.*
- **`AC-38`'s `specs_read` legacy mirror is redundant data.** Keeping both `specs_read` and `project_context.read` means two fields that must not diverge. The alternative — dropping `specs_read` — would break `RunTrace` parsing for the whole stored history, because it is required. *Default: keep both, write both from the same variable in one place (Step 9), and never write one without the other.* Worth capturing with `engineering-insights` after the change: *"a required jsonb array cannot be retro-fitted with 'not recorded' semantics — the honest fix is a new nullish sibling field, and the old one becomes a mirror."*
- **AC-24's `agentReachCounts` is a join across `agent_context_docs`, `agent_skills`, `skills` and `skill_context_docs`, run once per list request.** At 500 documents this is one query, not 500 — but it is unmeasured. *Default: one batched query taking the path list; if `architecture-reviewer` or a later profile flags it, the fix is an index on `skill_context_docs(path)`, in its own migration.*
- **NFR-1's 2-second budget is unmeasured** and this repo has no latency harness. *Default: proceed; the loading state stays visible past the budget, which is what NFR-1 actually requires.*
- **Two nearly identical Context tabs.** `frontend-ui-architecture` §2 says two copies are correct and the third is when to extract. A reviewer applying a naive DRY rule may flag it. *Default: keep them separate and cite §2.*
- **My own judgement, not a repo rule:** placing `walk-markdown.ts` under `modules/context/pipeline/` rather than in `service.ts`. The precedent is `backend-onion-architecture` §1 listing `modules/repo-intel/{types,pipeline}` as ring 2, but no rule mandates a `pipeline/` folder for a single file. *Default: `pipeline/`, for symmetry with `repo-intel`.*
- **My own judgement:** returning `{ state: 'not_synced' }` at HTTP 200 rather than a 404 or a 409. The spec calls it "a state and not an error" and `client/INSIGHTS.md` 2026-08-09 makes 404 actively harmful here, but the status-code choice itself is mine. *Default: 200.*

## Out of scope

- **Editing, creating, uploading or organising documents from DevDigest** — the mirror hard-resets on sync (root `INSIGHTS.md` 2026-08-16). A future editing feature is a separate spec and must solve a write-scoped credential, a commit-branch-push path, conflict handling, a PR surface and a validated write path. Owner: unassigned.
- **Versioning of documents** — history lives in the repository's own version control.
- **Indexing, chunking or embedding Markdown** — no `code_chunks` writer, no coverage score, no chunk count. `walk.ts`'s `SUPPORTED_EXT` stays JS/TS-only and is not widened.
- **The `memory` prompt slot** — the same wiring gap exists (root `INSIGHTS.md` 2026-08-02) and stays open. This change closes the `specs` third only.
- **Relevance-based document selection** — attachment is explicit and manual.
- **Reconciling the `.md` / `.mdx` divergence with `intent/helpers.ts:100`** — recorded as spec Open question 1, a decision and not an oversight. Whoever reconciles them later picks it up.
- **Any change to `INJECTION_GUARD`, `grounding.ts`, or any `agents.system_prompt`.**
- **`e2e/` flows** — no browser flow is added. `e2e/specs/` holds `*.flow.json`, not specs.
- **Measuring whether grounding improves review quality** — `docs/l02-experiment.md`, a separate exercise, and nobody's step here.

## Handoff

For `architecture-reviewer`:
- A **new slice** `server/src/modules/context/` — check the ring assignment of `pipeline/walk-markdown.ts` (fs in ring 2, against the `repo-intel/pipeline` precedent), that `service.ts` reads `container.tokenizer` but never `container.db`, and that `repository.ts` is the only file importing `drizzle-orm`.
- The **one deliberate cross-slice import**: `modules/context/pipeline/walk-markdown.ts` → `modules/repo-intel/constants.js`. It is legal (`constants.ts` is outside `SLICE_PRIVATE`) and precedented (`repos/service.ts:14`). Confirm `pnpm arch` agrees.
- A **new container entry** `projectContext` and its `ContainerOverrides` seam; a new mock in `adapters/mocks.ts`.
- A new consumer edge from `modules/reviews/run-executor.ts` → `container.projectContext` (not an import).
- `pnpm arch` must exit 0. Separate any pre-existing §12 debt from findings this change introduced.

For the security review:
- **AC-41 is a reviewable property.** The logging calls to check are: the single `runLog.info` added in Step 9 (`server/src/modules/reviews/run-executor.ts`, beside the existing skills line at ~`:262-266`), every `runLog`/`logger` call inside `server/src/modules/context/service.ts`, and the Fastify error path — a `ValidationError`/`NotFoundError` message must never embed document content. Paths, counts, token totals and skip reasons only.
- **AC-42 / A05 path traversal:** `isSafeContextPath` in `server/src/modules/context/helpers.ts` is the only gate between a stored path and `readFile`. Confirm it is applied **before** any `path.join`, that it is a positive-shape allowlist and not a blacklist, and that it is re-evaluated on **every** read rather than only at attach time.
- **A01 tenancy:** every route in `server/src/modules/context/routes.ts` resolves `getContext(container, req)` before touching data, and every repository method is workspace-scoped.
- **New untrusted input reaching a model:** third-party repository Markdown, injected through the existing `specs` slot. The guard (`INJECTION_GUARD`) is unchanged and unmodifiable; confirm the text is wrapped by `wrapUntrusted` and never concatenated into the system message.
- **New user input:** the `path` query parameter, the roots array, and the ordered path list on both replace endpoints.
- **New outbound calls:** none. **New secrets:** none. **New migration:** one, additive, two tables and one nullable column.
