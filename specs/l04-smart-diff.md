# Smart Diff (L04)

## Task

Order a PR's changed files by risk — `core`, `wiring`, `boilerplate` — by deterministically joining the already-imported PR files with the findings of the PR's reviews; expose it as `GET /pulls/:id/smart-diff` returning the existing `SmartDiff` contract; and render it in the "Files changed" tab as a grouped, finding-aware diff with a Smart order / Original order toggle. **No new LLM call anywhere.**

---

## Context read

- root `INSIGHTS.md` (2026-08-05, "A lesson feature is mostly already scaffolded: inventory Part 0 before writing a line") — the governing entry, and it holds again. The `SmartDiff` contract, its `SmartDiffResponse` wire alias, a passing contract test, `pr_files` with `patch`, `findings` with `file`/`start_line`/`severity`, the whole diff-viewer module and the `brief` i18n namespace all already exist. **No migration and no contract change are needed** (inventory below).
- root `INSIGHTS.md` (2026-08-02, "A field added to a persisted-jsonb contract must be `.nullish()`") — binds only if the plan touches a contract. It does not (see Constraints); `SmartDiffFile.pseudocode_summary` is already `.nullish()` at `server/src/vendor/shared/contracts/brief.ts:84`.
- root `INSIGHTS.md` (2026-08-02, "`findings.confidence` is not calibrated — never gate on it") — Smart Diff must never sort, filter or rank by `confidence`. Ordering is by finding **count** and changed-line count only.
- root `INSIGHTS.md` (2026-08-02, "Stacking convention blocks into an agent's `system_prompt` made the review worse") — reinforces the feature's premise: classification is deterministic code, never a prompt instruction. No agent prompt is touched.
- root `INSIGHTS.md` (2026-08-01, "`@devdigest/shared` drifts silently between server and client") and (2026-08-02, "`diff -r` is the wrong check for the two `vendor/shared` copies") — checked: `server/src/vendor/shared/contracts/brief.ts` and `client/src/vendor/shared/contracts/brief.ts` are **byte-identical today**, so no port is required.
- root `INSIGHTS.md` (2026-08-02, "The `pnpm arch` boundary gate is not wired into CI") — `cd server && pnpm arch` must be run by hand; a green CI proves nothing about ring direction.
- root `INSIGHTS.md` (2026-08-08, "Every agent that needs 'which skill governs this file' reads `pr-self-review/routing.md`") — the skills table below is derived from that file, not from memory.
- `server/INSIGHTS.md` (2026-08-02, "The `findings` table has no indexes at all — a FK is not an index") — **superseded in fact**: `findings_review_id_idx` and `reviews_pr_kind_idx` now exist (`server/src/db/schema/reviews.ts:86-89`, `:33-41`). This plan adds **no new query**, so no new index is owed. Do not add one.
- `server/INSIGHTS.md` (2026-08-08, "`no-cross-slice-import` scopes its `from` to `^src/modules/`") — this is why the new slice must read reviews and PR files through `container.reviewRepo`, never by importing `modules/reviews/**`.
- `server/INSIGHTS.md` (2026-08-05, "`pnpm test` is red here for an environmental reason: 8 `*.it.test.ts` files start 8 Postgres containers at once") and (2026-08-03, "`--no-file-parallelism` makes the integration suite deterministic AND faster") — adding a 9th `*.it.test.ts` makes this worse; run the integration file on its own when verifying.
- `server/INSIGHTS.md` (2026-08-02, "`*.it.test.ts` SKIPPING silently reads as passing") — read the test **count**, not the exit code.
- `client/INSIGHTS.md` (2026-08-05, "Promoting a component to `src/components/` must move its CONSTANTS too") — the new route-local component keeps its own `constants.ts`; the shared `diff-viewer` constants stay in `client/src/components/diff-viewer/constants.ts`.
- `client/INSIGHTS.md` (2026-08-02, "Casing encodes WHAT a folder is: kebab = module, Pascal = component") — `SmartDiffViewer/` is Pascal (a component), `diff-viewer/` stays kebab (a module).
- `client/INSIGHTS.md` (2026-08-08, "`@testing-library/user-event` is NOT installed here") — **superseded by the L03 work in the tree**: `client/package.json:31` now has `@testing-library/user-event@^14.6.3` and `IntentCard.test.tsx` uses it. New tests use `userEvent`.
- `client/INSIGHTS.md` (2026-08-02, "Count the `../` for `messages/en/*.json` from the FILE, not from a sibling test") — the new component test imports `messages/en/brief.json` with **eight** `../`, same as `IntentCard.test.tsx:16`.
- `client/INSIGHTS.md` (2026-08-02, "`SeverityBadge compact` renders NO label — icon and count only") — the per-line severity chip must **not** use `compact`, or the mockup's `suggestion` / `warning` / `blocker` words disappear.
- `AGENTS.md` §Repo rules — Markdown in English; `@devdigest/shared` exists twice; a DB-backed test is `*.it.test.ts`; migrations are never applied on boot.
- `AGENTS.md` §Do not touch — `server/src/db/migrations/**`, `reviewer-core/src/grounding.ts`, `INJECTION_GUARD`, `*/src/vendor/**`. None is touched.
- `server/AGENTS.md` §Conventions — three layers per module; a new module is one file plus one import and one entry in `modules/index.ts`.
- `specs/l03-intent-layer.md` + `server/src/modules/intent/**` + `docs/intent-layer.md` — the structural precedent this plan follows: `constants.ts` / `helpers.ts` / `service.ts` / `routes.ts`, a hermetic `*-helpers.test.ts` plus one `*.it.test.ts`, a route-local card, a hooks file, and a `docs/*.md` registered in `AGENTS.md` §Read when.
- `specs/README.md` — the spec is the source of truth for implementation and acceptance.

---

## Inventory — what already exists

| Thing | Where | Verdict |
|---|---|---|
| `SmartDiff`, `SmartDiffGroup`, `SmartDiffFile`, `SmartDiffRole`, `ProposedSplit` Zod contracts | `server/src/vendor/shared/contracts/brief.ts:79-113` | **reuse, unchanged** — shape matches the brief exactly: `groups[{role, files[{path, pseudocode_summary?, additions, deletions, finding_lines[]}]}]` + `split_suggestion{too_big, total_lines, proposed_splits[]}` |
| The same contract in the client copy | `client/src/vendor/shared/contracts/brief.ts` | **reuse** — verified byte-identical to the canon (`diff` returned no output) |
| `SmartDiffResponse` wire alias | `server/src/vendor/shared/contracts/review-api.ts:110-111` (and the client copy) | reuse — this is the type the route returns and the hook consumes |
| Contract test for `SmartDiff` | `server/test/contracts.test.ts:160-171` | reuse — already green, no edit needed |
| PR files with `path`, `additions`, `deletions`, `patch` | table `server/src/db/schema/pulls.ts:36-50` (indexed on `pr_id`), served by `GET /pulls/:id` at `server/src/modules/pulls/routes.ts:221-313` | reuse |
| `PrFile` / `PrDetail` contracts | `server/src/vendor/shared/contracts/platform.ts:189-219` | reuse |
| Findings with `file`, `start_line`, `end_line`, `severity` | `server/src/db/schema/reviews.ts:44-90`, indexed `findings_review_id_idx` | reuse |
| A workspace-scoped reader for everything the feature needs — `getPull(workspaceId, prId)`, `getPrFiles(prId)`, `reviewsForPull(prId)` | `server/src/modules/reviews/repository.ts:30,38,79` → `repository/review.repo.ts:91-107` | **reuse via `container.reviewRepo`** — so the new slice needs **no repository, no SQL, no migration, no index** |
| Cross-slice access channel | `server/src/platform/container.ts:110-112` (`get reviewRepo()`) | reuse — the sanctioned channel (`backend-onion-architecture` §4) |
| Static module registry with a comment already reserving "intent/smart-diff" | `server/src/modules/index.ts:24` | extend — one import + one entry |
| `IdParams`, `getContext`, `NotFoundError` | `server/src/modules/_shared/schemas.ts`, `_shared/context.ts`, `platform/errors.ts` (used at `modules/intent/routes.ts:4-6`) | reuse |
| Unified-diff parser producing `oldNo`/`newNo` per line | `client/src/components/diff-viewer/helpers.ts:12-38` | reuse |
| `DiffViewer` → `FileCard` → `CodeLine` render chain, collapsible per file, `AUTO_EXPAND_MAX_LINES = 200` | `client/src/components/diff-viewer/**`, `constants.ts:4` | **extend** — add an optional findings overlay + controlled open, exactly mirroring the existing optional `DiffCommentApi` overlay |
| Optional-overlay precedent (`DiffCommentApi` threaded viewer → card → line) | `client/src/components/diff-viewer/comments.ts`, `FileCard.tsx:33-53`, `CodeLine.tsx:12-22` | reuse as the template for `DiffFindingsApi` |
| "expand then scroll to a target" precedent, incl. the repeat-click nonce | `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:58-65` | reuse as the template for badge → line navigation |
| Files-changed tab | `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` | extend — add the segmented order toggle and the smart branch |
| Findings already fetched for this PR | `usePrReviews` at `client/src/lib/hooks/reviews.ts:51-55`, query key `["reviews", prId]` | reuse — TanStack cache means calling it again in `DiffTab` costs nothing |
| `brief` i18n namespace | `client/messages/en/brief.json` (auto-loaded per file by `client/src/i18n/request.ts:17-24`) | extend — add a `smartDiff` block |
| `SeverityBadge`, `Badge`, `Chip`, `Button`, `SectionLabel`, `Toggle`, `Tabs` primitives | `client/src/vendor/ui/primitives/index.ts`, `kit/index.ts` | reuse (vendored — wrap, never edit) |
| A smart-diff module, service, helpers, constants, hook, or component | grepped: `rg -l -i "smart.?diff\|smartDiff"` returns only the two contract copies, the two barrels, `README.md`s, `modules/index.ts` (a comment), `server/test/contracts.test.ts`, `specs/l03-intent-layer.md`, and `repo-intel` (unrelated) | **new** |

**Headline:** the entire server side is one Fastify plugin plus two pure files. There is **no new SQL, no new table, no new column, no migration, no index, and no shared-contract change** in this plan.

---

## Constraints that bind

| Rule | Applies? | What the implementation must do |
|---|---|---|
| `@devdigest/shared` exists twice | **No** | `SmartDiff`, `SmartDiffFile`, `SmartDiffResponse` already exist in both copies and are byte-identical. **Do not edit either copy.** If a step ever seems to need a contract field, stop and raise it (Risks) — that turns this into a two-copy commit gated by `./scripts/check-shared-sync.sh`. |
| `.nullish()` on a jsonb-persisted contract field | **No** | No contract field is added. `SmartDiff` is not persisted anywhere (`pr_brief.json` stores `PrBrief`, which does not contain it — `contracts/brief.ts:115-122`). |
| DB-backed test named `*.it.test.ts` | **Yes** | `server/test/smart-diff.it.test.ts` — that exact suffix, or the CI unit/integration split breaks silently. The pure classifier test is `server/test/smart-diff-helpers.test.ts` (no suffix, no Docker). |
| A migration | **No** | Nothing in `server/src/db/**` changes. `server/src/db/migrations/**` is a do-not-touch sentinel and is not touched. |
| Ring / import direction (`backend-onion-architecture` §2, `pnpm arch`) | **Yes** | `modules/smart-diff/routes.ts` = ring 5: HTTP + Zod only. `service.ts` = ring 2: may read `container.reviewRepo`, **never `container.db`**, never `drizzle-orm`, never `fastify`. `helpers.ts` + `constants.ts` = ring 2, pure, no container. No cross-slice import of `modules/reviews/**`. Run `cd server && pnpm arch` — it is **not** in CI. |
| `reviewer-core` — zero I/O, `build` is `tsc --noEmit` | **No** | This plan puts nothing in `reviewer-core`. See Risks for why the classifier lives in the server slice rather than beside `scope.ts`. |
| New file placement in `client/` (`frontend-ui-architecture` §1, §2) | **Yes** | `SmartDiffViewer` has exactly **one** consumer (the PR detail route) → route-local `_components/SmartDiffViewer/`. The findings overlay has **two** consumers (both orders render through `FileCard`) → it is promoted into the already-shared `components/diff-viewer/` module in the same step that adds the second use. `useSmartDiff` goes in the data layer, `client/src/lib/hooks/smart-diff.ts`. |
| A secret | **No** | Nothing new is read or written; no `SecretsProvider` involvement. |
| `CLAUDE.md` / `AGENTS.md` | **Yes (one edit)** | Step 10 registers `docs/smart-diff.md` in root **`AGENTS.md`** §Read when. `CLAUDE.md` stays a symlink (mode `120000`) — never write to it. |
| Empty reserved tables (`ci_*`, `eval_*`, `memory`, `digests`, …) | **No** | None is read, dropped or "cleaned up". |
| A new rule in an agent `system_prompt` | **No** | No `agents.system_prompt` is touched, and no prompt slot is added. This is the whole point: the classifier is deterministic code. |

---

## Modules touched

| Package | Path | Ring / layer | Why |
|---|---|---|---|
| server | `src/modules/smart-diff/constants.ts` | 2 · application (literals) | every pattern and threshold, in one file — an explicit acceptance criterion |
| server | `src/modules/smart-diff/helpers.ts` | 2 · application (pure) | `classifyFile`, `buildSmartDiff`, `suggestSplit` — no I/O, no container |
| server | `src/modules/smart-diff/service.ts` | 2 · application | fetches through `container.reviewRepo`, maps rows → plain inputs, calls the helpers |
| server | `src/modules/smart-diff/routes.ts` | 5 · delivery | `GET /pulls/:id/smart-diff`, Zod `params`, `getContext`, `NotFoundError` |
| server | `src/modules/index.ts` | 5 · delivery | one import + one registry entry |
| server | `test/smart-diff-helpers.test.ts`, `test/smart-diff.it.test.ts` | outside the rings | ring-2 pure test; ring-5 route test on real Postgres |
| client | `src/lib/hooks/smart-diff.ts`, `src/lib/hooks/index.ts` | data layer | `useSmartDiff`, exported from the barrel |
| client | `src/components/diff-viewer/{findings.ts,helpers.ts,constants.ts,index.ts,FileCard/FileCard.tsx,CodeLine/CodeLine.tsx,styles.ts}` | shared module | the findings overlay, line anchors, controlled open |
| client | `src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/**` | route-local component | groups, subtitles, counts, badges, boilerplate collapsed |
| client | `src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` | route-local component | order toggle + header stats |
| client | `messages/en/brief.json` | i18n catalogue | all new user-facing strings |
| docs | `docs/smart-diff.md`, root `AGENTS.md` | documentation | the classification table has to be readable without opening the constants file |

---

## Skills — read by the planner, to be loaded by the implementer

| Path glob | Skill | Sections | routing.md row | Rule it imposes on this plan |
|---|---|---|---|---|
| `server/src/modules/smart-diff/routes.ts` | `backend-onion-architecture` **(preloaded)** | §6 the Fastify edge, §2 dependency rule | Backend, row 1 | Validation lives in `schema:`; no hand-rolled `parse(req.body)`; no logic and no SQL in the handler; throw `NotFoundError`, never `reply.code(404).send(...)`; register statically in `modules/index.ts`, never `@fastify/autoload`. |
| same | `fastify-best-practices` | `rules/routes.md`, `rules/schemas.md` | Backend, row 2 | Route-level `schema.params`; `config: { rateLimit }` is available per route. **Its TypeBox advice is vendored opinion, not house law** (routing.md §"Vendored severity is not house law") — this repo uses Zod through `fastify-type-provider-zod`, as at `modules/intent/routes.ts:2,24`. Follow the repo. |
| same | `security` | A01 Broken Access Control, A09 Logging | Backend, row 3 | Every read is workspace-scoped: resolve `workspaceId` via `getContext` and look the pull up with `reviewRepo.getPull(workspaceId, prId)` — an unscoped lookup by `:id` alone is an IDOR. Never log patch bodies or finding text. |
| `server/src/modules/smart-diff/{service,helpers,constants}.ts` | `backend-onion-architecture` **(preloaded)** | §1 rings, §8 where new code goes, §5 repositories | Backend, row "modules/** (service, helpers, anything else)" | A ring-2 service may read `container.<port>` but **never `container.db`**; all literals in `constants.ts`; pure transforms in `helpers.ts`; cross-slice data via `container.reviewRepo`, never an import of `modules/reviews/**`. |
| `server/test/**` | `backend-onion-architecture` **(preloaded)** | §9 testing per ring | Backend, last row | Ring 2 is tested directly and hermetically; ring 5 through `buildApp({ overrides })` + `app.inject()`; a DB-backed file **must** end `*.it.test.ts`; read the test count, because `N skipped` is not a pass. |
| `client/src/**/*.tsx` (`SmartDiffViewer`, `DiffTab`, `FileCard`, `CodeLine`) | `frontend-ui-architecture` **(preloaded)** | §1 placement, §2 promotion, §3 boundaries, §5 business logic, §7 barrels, §8 naming | Frontend, row 1 + barrel row | One consumer → route-local `_components/SmartDiffViewer/`; two consumers → promote the findings overlay into `components/diff-viewer/`; data fetching only in `lib/hooks/*`; no raw `fetch`; the shared module keeps **one shallow barrel** and its internals import siblings directly. |
| same | `react-best-practices` | Derive-don't-store, `useEffect` rules, keys, a11y, conditional rendering | Frontend, row 2 | Group counts, badge counts and open-by-default are **derived during render**, never `useState` + `useEffect`. The only legitimate Effect is the DOM scroll (an external system). Icon-only badge buttons need `aria-label`. `{count > 0 && …}`, never `{count && …}`. Its "container/presentational" and "max 200 lines" rules are on routing.md's **demotion list** — never blocking here. |
| `client/src/lib/hooks/smart-diff.ts`, `lib/hooks/index.ts` | `frontend-ui-architecture` **(preloaded)** | §1 placement, §6 constants, §7 barrels | Frontend, `client/src/lib/**` row | A new endpoint means a new hook in the matching domain file, going through `api`/`apiFetch`; export it from the existing `lib/hooks/index.ts` barrel. |
| `client/src/**/*.test.tsx` | `react-testing-library` | query priority, `userEvent`, async | Frontend, test row | `userEvent.setup()` (now installed — `client/package.json:31`), never `fireEvent` in the new file; `getByRole` first; assert what the user sees, not state; 1–3 flow tests, not a dozen one-assertion tests. MSW is **not** used in this repo — the new component takes props, so no network at all. |
| `client/src/app/**/{constants,styles}.ts` | `frontend-ui-architecture` **(preloaded)** | §1, §6 constants, §8 naming | Frontend, last row | Role colours/order/default-open are local `constants.ts` beside the component; styles in `styles.ts`; `SmartDiffViewer/` is PascalCase because it is a component. |
| `docs/**`, `specs/**`, `*AGENTS.md` | — | — | "Contracts, and everything else" | Repo rules only: English Markdown; edit `AGENTS.md`, never the `CLAUDE.md` symlink. |

Not loaded, deliberately: `zod` (no `z.object` is added or changed), `drizzle-orm-patterns` / `postgresql-table-design` (no schema, no query, no migration), `next-best-practices` (no `page`/`layout`/`route` file and no `'use client'` boundary moves — every file touched is already `"use client"`), `typescript-expert` (no type-level work).

---

## Steps

### Step 1 — Create the classification constants

- **Files:** `server/src/modules/smart-diff/constants.ts` (new)
- **Change:** every pattern and threshold the feature has, and nothing else. No imports except `@devdigest/shared` for `SmartDiffRole`. Export:
  - `BOILERPLATE_PATTERNS: RegExp[]` — lock files (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `composer.lock`, `go.sum`, `Gemfile.lock`), dependency manifests (`package.json`, `pnpm-workspace.yaml`), build output (`dist/`, `build/`, `out/`, `.next/`, `coverage/`, `node_modules/`), vendored trees (`/vendor/`), snapshots (`__snapshots__/`, `*.snap`), minified/generated (`*.min.js`, `*.min.css`, `*.generated.*`, `*.pb.go`), and binary/asset extensions (`png|jpg|jpeg|gif|svg|ico|woff2?|ttf|pdf`).
  - `WIRING_PATTERNS: RegExp[]` — barrels (`index.ts|tsx|js`), config (`*.config.{ts,js,mjs,cjs}`, `tsconfig*.json`, `.eslintrc*`, `*.env*`), CI and container files (`.github/workflows/`, `Dockerfile`, `docker-compose*`), SQL migrations, ambient types (`*.d.ts`), tests (`*.test.*`, `*.spec.*`, `/test/`, `/tests/`, `/__tests__/`), and Markdown (`*.md`).
  - `DEFAULT_ROLE: SmartDiffRole = 'core'` and `GROUP_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate']`.
  - `SPLIT_TOO_BIG_LINES = 400`, `SPLIT_TOO_BIG_CORE_FILES = 10`, `SPLIT_MIN_FILES_PER_PROPOSAL = 2`, `SPLIT_MAX_PROPOSALS = 4`, `SPLIT_DIR_DEPTH = 1`.
  - A docblock stating the **first-match order**: boilerplate → wiring → core, and that a lock file can therefore never be anything but `boilerplate` (the acceptance criterion). Also state, in one line each, why tests and Markdown are `wiring` ("supporting change, not the substance") and why `package.json` is `boilerplate` (it is mechanical, and the design mockup groups it there).
- **Skill:** `backend-onion-architecture` §8 — "A literal → `modules/<name>/constants.ts`"; §1 — ring 2, no I/O. Precedent: `server/src/modules/intent/constants.ts`.
- **Verify:** `cd server && pnpm typecheck`
- **Done when:** the file exports every symbol above, imports nothing but `@devdigest/shared`, and contains no logic.

### Step 2 — Write the pure classifier and builder

- **Files:** `server/src/modules/smart-diff/helpers.ts` (new)
- **Change:** pure functions over plain data — no container, no Drizzle, no Fastify:
  - `export interface SmartDiffFileInput { path: string; additions: number; deletions: number }`
  - `export interface SmartDiffFindingInput { file: string; start_line: number }`
  - `normalizePath(path: string): string` — strips a leading `./`, `a/` or `b/` so a diff-prefixed finding path still matches a `pr_files.path`.
  - `classifyFile(path: string): SmartDiffRole` — first match wins in the order of Step 1; returns `DEFAULT_ROLE` otherwise. Matching is on the **normalized** path.
  - `findingLinesFor(path, findings): number[]` — findings whose normalized `file` equals the normalized path, mapped to `start_line`, **deduplicated and sorted ascending**. Exact match only; no basename fallback (a fallback mis-attributes `index.ts` across directories).
  - `buildSmartDiff(files, findings): SmartDiff` — groups in `GROUP_ORDER` (a group with no files is still emitted, so the UI can render three stable sections); within a group files are sorted by `finding_lines.length` desc, then `additions + deletions` desc, then `path` asc — **fully deterministic, and never by `confidence`**. `pseudocode_summary` is `null` (no LLM in this feature). `split_suggestion` comes from `suggestSplit`.
  - `suggestSplit(files): SmartDiff['split_suggestion']` — `total_lines` = Σ(`additions + deletions`) over **all** files; `too_big` = `total_lines > SPLIT_TOO_BIG_LINES || coreCount > SPLIT_TOO_BIG_CORE_FILES`; `proposed_splits` = `[]` when not `too_big`, otherwise the **core** files grouped by their first `SPLIT_DIR_DEPTH` path segment, keeping groups with ≥ `SPLIT_MIN_FILES_PER_PROPOSAL` files, sorted by file count desc then name asc, capped at `SPLIT_MAX_PROPOSALS`.
- **Skill:** `backend-onion-architecture` §8 — "A pure transform → `modules/<name>/helpers.ts` — no I/O, no DB, no container"; §1 — ring 2 may import ring 0 only. Precedent: `server/src/modules/intent/helpers.ts`.
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `helpers.ts` imports only `@devdigest/shared` and `./constants.js`, and `pnpm arch` exits 0.

### Step 3 — Add the service

- **Files:** `server/src/modules/smart-diff/service.ts` (new)
- **Change:** `export class SmartDiffService { constructor(private container: Container) {} async build(workspaceId: string, prId: string): Promise<SmartDiff> }`.
  1. `const pull = await this.container.reviewRepo.getPull(workspaceId, prId)`; `if (!pull) throw new NotFoundError('Pull request not found')` — this is the workspace scoping (`security` A01).
  2. `const files = await this.container.reviewRepo.getPrFiles(prId)` → map to `SmartDiffFileInput` (`path`, `additions`, `deletions`). **Drop `patch` here** — the response must never carry diff bodies; the client already has them from `GET /pulls/:id`.
  3. `const reviews = await this.container.reviewRepo.reviewsForPull(prId)` → `reviews.flatMap(r => r.findings)` → map to `SmartDiffFindingInput`.
  4. `return buildSmartDiff(fileInputs, findingInputs)`.
  - Docblock must state the two load-bearing facts: **this service makes no LLM call and resolves no LLM port**, and it reads through `container.reviewRepo` rather than `container.db` or a cross-slice import.
- **Skill:** `backend-onion-architecture` §4 — "a ring-2 service may read `container.<port>` but must never read `container.db`"; "Cross-slice access goes through the container, not through an import" (and `server/INSIGHTS.md` 2026-08-08 on `no-cross-slice-import`). `security` A01 — deny-by-default, ownership checked on every read.
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** the file contains no `drizzle-orm`, no `container.db`, no `import … from '../reviews/…'`, and `pnpm arch` exits 0.

### Step 4 — Add the route and register the module

- **Files:** `server/src/modules/smart-diff/routes.ts` (new), `server/src/modules/index.ts` (edit)
- **Change:** a default Fastify plugin, modelled line-for-line on `server/src/modules/intent/routes.ts:23-32`:
  ```ts
  export default async function smartDiffRoutes(appBase: FastifyInstance) {
    const app = appBase.withTypeProvider<ZodTypeProvider>();
    const service = new SmartDiffService(app.container);
    app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req): Promise<SmartDiffResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.build(workspaceId, req.params.id);
    });
  }
  ```
  No `config.rateLimit` override — unlike `POST /pulls/:id/intent` this endpoint spends no money; the app-wide limiter is enough. In `modules/index.ts`, add `import smartDiff from './smart-diff/routes.js';` and one `smartDiff,` entry in the exported record (alphabetically irrelevant — append after `intent`, matching the "each lesson adds its own module here" comment at `:24`).
- **Skill:** `backend-onion-architecture` §6 — routes are HTTP and Zod, validation in `schema:`, registration is static; `fastify-best-practices` `rules/routes.md` — route-level `schema.params`.
- **Verify:** `cd server && pnpm typecheck && pnpm arch && pnpm exec vitest run routes-smoke`
- **Done when:** the app boots in `routes-smoke.test.ts` with the new module registered, and `pnpm arch` exits 0.

### Step 5 — Server tests

- **Files:** `server/test/smart-diff-helpers.test.ts` (new, hermetic), `server/test/smart-diff.it.test.ts` (new, **`.it.test.ts` suffix is mandatory**)
- **Change:**
  - **`smart-diff-helpers.test.ts`** — a table-driven `classifyFile` test that pins, at minimum: `pnpm-lock.yaml`, `package-lock.json`, `client/pnpm-lock.yaml` → `boilerplate`; `dist/index.js`, `__snapshots__/x.snap`, `client/src/vendor/ui/Badge.tsx`, `logo.svg` → `boilerplate`; `server/src/modules/x/index.ts`, `vitest.config.ts`, `server/test/x.test.ts`, `README.md` → `wiring`; `server/src/modules/x/service.ts`, `client/src/lib/api.ts` → `core`. Plus: `finding_lines` are deduplicated and ascending when two agents flag the same line; `buildSmartDiff` emits all three groups in `GROUP_ORDER` even when empty; within-group ordering puts the file with more findings first; `suggestSplit` returns `too_big: false, proposed_splits: []` below the threshold and a capped, deterministic list above it. Assert the output with `SmartDiff.parse(...)` so the contract itself is exercised.
  - **`smart-diff.it.test.ts`** — copy the harness of `server/test/intent.it.test.ts:1-32` (`startPg`, `dockerAvailable`, `const d = hasDocker ? describe : describe.skip`, the `console.warn`). Seed a PR with ~5 `pr_files` including `pnpm-lock.yaml` and `package.json`, insert one `reviews` row plus two `findings` on a core file, then `app.inject({ method: 'GET', url: '/pulls/<id>/smart-diff' })` and assert: 200; `groups[0].role === 'core'`; `pnpm-lock.yaml` appears **only** in the `boilerplate` group; the core file's `finding_lines` match the seeded `start_line`s; **no `patch` text appears anywhere in `res.body`** (the negative assertion — same spirit as the L03 "hunk headers but no patch body" test). Second case: **no model call** — build the app with a `MockLLMProvider` subclass whose `complete`/`completeStructured` throw, and assert the request still succeeds (a call would have thrown). Third case: a PR belonging to another workspace returns **404**, not its data.
- **Skill:** `backend-onion-architecture` §9 — ring 2 tested directly, ring 5 through `buildApp({ overrides })` + `app.inject()`; **"A DB-backed test must be named `*.it.test.ts`"**; "Read the test count, never just the exit code".
- **Verify:** `cd server && pnpm exec vitest run smart-diff-helpers` then `cd server && pnpm exec vitest run smart-diff.it.test --no-file-parallelism`
- **Done when:** both files pass and the integration file reports **run, not skipped** tests (`server/INSIGHTS.md` 2026-08-02). If Docker is unavailable, say so explicitly rather than reporting green.

### Step 6 — Client data hook

- **Files:** `client/src/lib/hooks/smart-diff.ts` (new), `client/src/lib/hooks/index.ts` (edit)
- **Change:** mirror `client/src/lib/hooks/intent.ts`:
  ```ts
  export function useSmartDiff(prId: string | null | undefined) {
    return useQuery({
      queryKey: ["smart-diff", prId],
      queryFn: () => api.get<SmartDiffResponse>(`/pulls/${prId}/smart-diff`),
      enabled: !!prId,
    });
  }
  ```
  Add `export * from "./smart-diff";` to the barrel. No mutation, so no `invalidateQueries` obligation — but note in a comment that the response changes when a review lands, and the `["reviews", prId]` invalidations in `reviews.ts:140,165` do **not** cover this key. Simplest correct answer: `DiffTab` derives badge counts from `usePrReviews` (already invalidated on every run/finding action) and uses `useSmartDiff` for **ordering and grouping only** — see Step 8.
- **Skill:** `frontend-ui-architecture` §1 placement / "a new endpoint means a new hook in the matching domain file", §7 one shallow barrel per shared module.
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `useSmartDiff` resolves from `@/lib/hooks` and from `@/lib/hooks/smart-diff`.

### Step 7 — Extend the shared diff-viewer with a findings overlay

- **Files:** `client/src/components/diff-viewer/findings.ts` (new), `helpers.ts`, `constants.ts`, `styles.ts`, `FileCard/FileCard.tsx`, `CodeLine/CodeLine.tsx`, `index.ts` (all edits)
- **Change:** the overlay is optional and additive — `DiffViewer`'s existing callers keep working untouched.
  - `findings.ts` — `export interface DiffFindingsApi { findings: FindingRecord[]; onFindingClick?: (f: FindingRecord) => void }`, plus pure `findingsForFile(path, findings)` and `findingsForLine(ln, fileFindings)` (a finding matches the row whose `newNo === start_line`; rows with `newNo` inside `[start_line, end_line]` get the coloured left border). Shape deliberately mirrors `comments.ts`'s `DiffCommentApi`.
  - `helpers.ts` — add `export function lineAnchorId(path: string, line: number): string` returning a DOM-id-safe string (e.g. `` `diff-${path.replace(/[^a-zA-Z0-9]/g, "-")}-L${line}` ``). **One definition**, used by both the anchor and the scroller (`frontend-ui-architecture` §6: name a value the moment it crosses a boundary).
  - `constants.ts` — add `SEVERITY_BORDER_COLOR: Record<Severity, string>` mapping to existing CSS vars. No new colour literals invented outside this file.
  - `CodeLine.tsx` — accept `findings?: FindingRecord[]`; set `id={lineAnchorId(path, ln.newNo)}` on rows that have a `newNo`; render the severity chip right-aligned using `SeverityBadge` **without `compact`** (`client/INSIGHTS.md` 2026-08-02) and the left border from `SEVERITY_BORDER_COLOR`.
  - `FileCard.tsx` — accept `findings?: DiffFindingsApi`, `defaultOpen?: boolean`, and an optional **controlled** pair `open?: boolean; onOpenChange?: (open: boolean) => void`. When `open` is passed, it wins; otherwise keep today's `AUTO_EXPAND_MAX_LINES` default, overridden by `defaultOpen` when given. Pass each line's findings down to `CodeLine`.
  - `index.ts` — export `DiffFindingsApi` and `lineAnchorId` alongside the existing two exports. Keep it one shallow barrel; internals keep importing siblings directly (`frontend-ui-architecture` §7).
- **Skill:** `frontend-ui-architecture` §2 promotion — the overlay has two consumers (both orders), so it belongs in the shared module, added in the same step as the second use; §7 barrels. `react-best-practices` — open state stays derived where it can be, no `useEffect` computing it; icon-only controls carry `aria-label`.
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** typecheck, lint and the existing client suite are green with no change to `DiffTab`'s current behaviour yet.

### Step 8 — `SmartDiffViewer`, the order toggle, and the copy

- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/{SmartDiffViewer.tsx,constants.ts,styles.ts,index.ts}` (new), `DiffTab/DiffTab.tsx` (edit), `client/messages/en/brief.json` (edit)
- **Change:**
  - `SmartDiffViewer/constants.ts` — `ROLE_ORDER: SmartDiffRole[] = ["core","wiring","boilerplate"]`, `ROLE_COLOR: Record<SmartDiffRole, string>` (CSS vars, matching the mockup's coloured squares), `ROLE_DEFAULT_OPEN: Record<SmartDiffRole, boolean> = { core: true, wiring: true, boilerplate: false }`.
  - `SmartDiffViewer.tsx` — props: `groups: SmartDiffGroup[]`, `files: PrFile[]` (for `patch`), `findings: FindingRecord[]`, `commenting?: DiffCommentApi`. It **renders**, it does not fetch (`frontend-ui-architecture` §4 "own the data boundary explicitly").
    - Build `filesByPath` with `useMemo`; a smart-diff entry with no matching `PrFile` renders header-only (defensive, and possible if the PR refreshed between the two requests).
    - Per group: coloured square, title, subtitle, right-aligned `N files` — all from i18n.
    - Per file: `FileCard` with `defaultOpen = ROLE_DEFAULT_OPEN[role] && (file.finding_lines.length > 0 || changedLines <= AUTO_EXPAND_MAX_LINES)`. **Boilerplate is always `false`**, regardless of findings — the acceptance criterion.
    - The "N findings" badge is a `<button>` with an `aria-label`, rendered only when `finding_lines.length > 0` (`{n > 0 && …}`, never `{n && …}`). Clicking it sets `target = { path, line: finding_lines[0], nonce: Date.now() }`.
    - Navigation reuses the precedent at `ReviewRunAccordion.tsx:58-65`: an effect keyed on `[target]` forces that file's `open` to `true` (controlled) and then calls `document.getElementById(lineAnchorId(path, line))?.scrollIntoView({ behavior: "smooth", block: "center" })`. The `nonce` is what makes a **second** click on the same badge work. This is the one legitimate Effect in the component — it synchronises with the DOM, an external system (`react-best-practices`, `frontend-ui-architecture` §5).
  - `DiffTab.tsx` — call `useSmartDiff(prId)` and `usePrReviews(prId)`; keep `usePrComments`. Header: `<> REVIEWER-ORDERED DIFF` via the existing `SectionLabel icon="Code"`, `{filesCount} files · +A -B` computed from `files` (derived during render, not stored), and a two-option segmented control on the right, `Smart order | Original order`, defaulting to **Smart**. `Original` renders today's `<DiffViewer>` unchanged. `Smart` renders `<SmartDiffViewer>`; while `useSmartDiff` is loading or errored, fall back to `<DiffViewer>` rather than showing an error — ordering is enrichment, the diff must always render.
  - `messages/en/brief.json` — add a `smartDiff` block: `title`, `order.smart`, `order.original`, `stats` (`"{files} files · +{additions} -{deletions}"`), `filesCount` (`"{count} files"`), `findings` (`"{count} findings"`), `summary`, and `roles.{core,wiring,boilerplate}.{title,subtitle}` with the mockup's exact copy — "The substance of the change — review closely", "Hooks the core into the app", "Generated / mechanical — skim". Severity chip labels go under the existing `shell` namespace (`diffViewer.severity.*`) because the shared diff-viewer already uses `useTranslations("shell")` (`FileCard.tsx:34`). **No hard-coded user-facing string anywhere** (`client/AGENTS.md` §Conventions).
- **Skill:** `frontend-ui-architecture` §1 placement (one consumer → route-local `_components/<Name>/`), §5 (fetching in hooks, never in components), §8 naming (Pascal folder = component); `react-best-practices` (derive don't store; Effects only for external systems; `aria-label` on icon-only buttons).
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** on a PR with a lock file the Smart order shows Core first with the lock file collapsed under Boilerplate, and the Original order renders exactly what it renders today.

### Step 9 — `SmartDiffViewer` component test

- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx` (new)
- **Change:** props-only, no network, wrapped in `NextIntlClientProvider locale="en" messages={{ brief: messages, shell: shellMessages }}` — import the JSON with **eight** `../` from this file (`client/INSIGHTS.md` 2026-08-02; `IntentCard.test.tsx:16` is the working count for this depth). **jsdom does not implement `Element.prototype.scrollIntoView`** — stub it at the top of the file (`vi.fn()`) and restore it in `afterEach`, or the navigation test throws `not a function`. Two or three flow tests, not more (`react-testing-library`, "fewer tests, real scenarios"):
  1. groups render in `core → wiring → boilerplate` with the right counts; the lock file's patch is **not** in the document (collapsed), while a core file's patch **is**;
  2. a badge click expands the target file, calls `scrollIntoView`, and the finding's line is rendered with its severity chip;
  3. a PR with no findings at all renders every group with no badges and no chips (the "before the first review" state).
  Use `userEvent.setup()` and `getByRole` — never `fireEvent`.
- **Skill:** `react-testing-library` — query priority, `userEvent`, assert what the user sees; `frontend-ui-architecture` §1 (a test sits beside the file it tests).
- **Verify:** `cd client && pnpm test`
- **Done when:** the three tests pass and no test asserts on internal state or CSS.

### Step 10 — Document it and register the document

- **Files:** `docs/smart-diff.md` (new), root `AGENTS.md` (edit — §Read when)
- **Change:** an English document following `docs/intent-layer.md`'s shape: the three sources and what each contributes; the **classification table** (role → patterns → why), stated as the readable version of `constants.ts`; the first-match order and why a lock file can never escape `boilerplate`; the deterministic ordering rule inside a group; the split-suggestion thresholds; and an explicit "no LLM call, nothing persisted, computed per request" paragraph. Add one row to root `AGENTS.md` §Read when: `` `docs/smart-diff.md` | working on reviewer-ordered diffs (L04) — the role classification table, the thresholds, or the badge→line navigation ``. **Edit `AGENTS.md`, never `CLAUDE.md`** — it is a symlink (mode `120000`).
- **Skill:** none matched (routing.md: `docs/**` and `*AGENTS.md` load no skill) — repo rules only: Markdown in English, `AGENTS.md` over `CLAUDE.md`.
- **Verify:** `git diff --stat` shows no mode change on any `CLAUDE.md`; `ls -l CLAUDE.md` still reports a symlink.
- **Done when:** `docs/smart-diff.md` exists, is in English, and is reachable from root `AGENTS.md` §Read when. This step is a clean handoff to `doc-writer` if the caller prefers.

---

## Verification plan

| Package | Command | Runs when |
|---|---|---|
| server | `cd server && pnpm typecheck` | `server/**` changed (Steps 1–5) |
| server | `cd server && pnpm arch` | same — the ring gate, **not wired into CI**, so it must be run by hand (root `INSIGHTS.md` 2026-08-02). Exit 0 or it is not green. |
| server | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | the hermetic lane, incl. `smart-diff-helpers.test.ts`, `contracts.test.ts`, `routes-smoke.test.ts` |
| server | `cd server && pnpm exec vitest run smart-diff.it.test --no-file-parallelism` | the new DB-backed file, run alone — `server/INSIGHTS.md` 2026-08-05 and 2026-08-03. **Read the test count**: `N skipped` is unverified, not passed. |
| client | `cd client && pnpm typecheck && pnpm lint && pnpm test` | `client/**` changed (Steps 6–9). `pnpm lint` is the only thing that catches deep relative imports (`client/INSIGHTS.md` 2026-08-05). |
| — | `./scripts/check-shared-sync.sh` | **not triggered** — no `*/src/vendor/shared/**` file changes. Run it anyway as a cheap negative check that nothing drifted. |

---

## Acceptance

1. `GET /pulls/:id/smart-diff` returns a payload that `SmartDiff.parse()` accepts, with all three groups present in the order `core`, `wiring`, `boilerplate`.
2. A lock file (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, …) is classified `boilerplate` **always**, appears in no other group, and its `FileCard` starts collapsed — even when it carries findings. Pinned by `smart-diff-helpers.test.ts` and by the `.it.test.ts` payload assertion.
3. Before any review exists, the endpoint still returns full ordering with every `finding_lines` empty, and the UI renders groups with no badges and no chips.
4. After Run Review, each affected file shows an "N findings" badge; `N` equals the number of distinct `start_line`s of that file's findings.
5. Clicking a badge expands the file (if collapsed) and scrolls the viewport to `lineAnchorId(path, line)`; a second click on the same badge works too (the nonce).
6. The response carries **no patch text** — asserted negatively in `smart-diff.it.test.ts`.
7. Rendering the Smart Diff view produces **no new model call**: the integration test builds the app with an `LLMProvider` that throws on every method and the request still returns 200. No `agent_runs` row is created and no cost is recorded.
8. Every threshold and pattern lives in `server/src/modules/smart-diff/constants.ts`; `helpers.ts`, `service.ts` and `routes.ts` contain no path literal and no numeric threshold.
9. A PR in another workspace returns 404, not data.
10. `cd server && pnpm arch` exits 0 with no new `pathNot` exemption added to `.dependency-cruiser.cjs`.
11. Switching to **Original order** renders exactly today's `DiffViewer` output, and inline commenting still works in both orders.

---

## Risks & open questions

1. **"Findings of the latest review" vs. all reviews — a deliberate deviation from the brief's wording.** The brief says "the findings of the latest review". This plan uses the findings of **every** review of the PR. Reasons: multiple agents each produce their own `reviews` row for a single "Run Review" click (`POST /pulls/:id/review` → `runs[]`, one per agent, `reviews/routes.ts`), so "the latest review" would silently show one agent's findings; and the repo already made this exact choice for the PR-list rollup — "Findings of EVERY review of this PR, tallied" (`contracts/platform.ts:182-185`) with the comment "the same union the PR detail page renders" (`modules/pulls/routes.ts:158-165`). Using all reviews also keeps the server's badge counts and the client's severity chips (from `usePrReviews`, which returns all reviews) from disagreeing. **Default: proceed with all reviews.** Flipping to latest-only is one line in `SmartDiffService.build` (take `reviews[0]` — `reviewsForPull` already orders `desc(createdAt)`); if the course grader requires the literal reading, make that change and add a test.
2. **Where the classifier lives — my judgement, not a cited rule.** `backend-onion-architecture` §8 says "Domain logic with no I/O at all → `reviewer-core/src/**`" and "when two rows seem to fit, take the inner one", which argues for putting `classifyFile` beside `reviewer-core/src/scope.ts`. I put it in `server/src/modules/smart-diff/helpers.ts` instead, because `reviewer-core` is *the review engine* (`reviewer-core/AGENTS.md`: prompt, grounding, reduce, score) and its public API grows only via `src/index.ts` — adding a classifier no engine path calls would grow that surface for a single server consumer. `scope.ts` is the counter-example precisely because `review/run.ts` consumes it. **This is the call the architecture reviewer should check first.** Default: proceed with the server slice.
3. **Test files and Markdown classified as `wiring`; `package.json` as `boilerplate`.** Defensible but arguable — the mockup only shows `package.json` and `package-lock.json` under Boilerplate. Both are single-line changes in `constants.ts`, which is exactly why the constants file is a separate acceptance criterion. Default: as specified in Step 1.
4. **jsdom has no `scrollIntoView`.** `ReviewRunAccordion.tsx:63` uses it today and `client/src/test/setup.ts` stubs only `ResizeObserver`, so nothing exercises it under test. The new test **must** stub `Element.prototype.scrollIntoView` locally. Do not add the stub to `src/test/setup.ts` without deciding it globally — that is a shared-file change with no second consumer yet (`frontend-ui-architecture` §2). Worth capturing with `engineering-insights`: "jsdom does not implement `scrollIntoView`; the repo's only caller is untested, so the first test that triggers a scroll must stub it."
5. **The `["smart-diff", prId]` query key is not invalidated by anything.** `reviews.ts` invalidates `["reviews", prId]` on run completion, delete and finding actions (`:140,:165`), but not this key. Step 8 works around it by taking badge/chip data from `usePrReviews`; the smart-diff response is used for grouping and ordering only, which does not change when findings do. If a later change makes `finding_lines` load-bearing on the client, add `qc.invalidateQueries({ queryKey: ["smart-diff", prId] })` next to each existing `["reviews", prId]` invalidation. Default: proceed as specified, and note it in the hook's docblock.
6. **`server/INSIGHTS.md` 2026-08-02 ("The `findings` table has no indexes at all") is out of date** — `findings_review_id_idx` now exists at `server/src/db/schema/reviews.ts:87`. This plan **contradicts** that entry's premise, and correctly adds no index because it adds no query. Insights are append-only: worth capturing with `engineering-insights` as a dated supersession rather than editing the old entry.
7. **A ninth `*.it.test.ts` file makes `pnpm test` worse.** `server/INSIGHTS.md` (2026-08-05) records that 8 integration files already start 8 Postgres containers at once and that this makes the full `pnpm test` red for environmental reasons. Default: keep the new file (the route deserves DB coverage), verify it alone with `--no-file-parallelism`, and do not treat a red full-suite run as this change's failure without checking which files failed.
8. **Sentinels:** none are touched. `server/src/db/migrations/**`, `reviewer-core/src/grounding.ts` and `INJECTION_GUARD` in `reviewer-core/src/prompt.ts` are all outside this plan, and `*/src/vendor/**` is read but never edited. If any step appears to need one of them, stop and raise it — `AGENTS.md` §Do not touch makes that a deliberate decision, never a drive-by edit.
9. **Open questions — resolved 2026-08-08, before implementation started:**
   - *"Does an upstream L04 lesson branch exist with the intended contract?"* — **UNRESOLVED.** The remote/branch inspection was not permitted in this environment. **Decision: proceed with the stated default** — build against the `SmartDiff` contract already in `server/src/vendor/shared/contracts/brief.ts`, which matches the brief's described shape exactly. If an upstream L04 branch later turns out to define a different contract, that is a replan, not a patch.
   - *"Is there a design mockup file in the repo, and does it show the `summary` chip's source?"* — **RESOLVED: no.** `find docs specs -name '*.png|jpg|svg|fig'` returns nothing; the only mockup is the image supplied in the request. **Decision: default stands** — render the `summary` chip only when `pseudocode_summary` is non-null (never in this lesson).
   - *"Is there a `.gitattributes` / `linguist-*` convention to classify generated and vendored files?"* — **RESOLVED: no.** The repo has no `.gitattributes`. **Decision: default stands** — the pattern list in `constants.ts` is the single source of classification; `.gitattributes` support stays out of scope.

---

## Out of scope

- **Generating `pseudocode_summary`.** It stays `null`. Filling it needs an LLM call, which this feature forbids by definition. A later lesson picks it up.
- **Persisting the smart diff.** No table, no `pr_brief` write, no cache. It is recomputed per request from data already in Postgres; both inputs are indexed.
- **Any change to `SmartDiff`, `SmartDiffFile`, or `SmartDiffResponse`.** If one becomes necessary, it is a two-copy commit (`server/` canon then `client/` mirror, same commit) gated by `./scripts/check-shared-sync.sh` — replan rather than improvising.
- **The review pipeline.** No prompt slot, no agent `system_prompt`, no `reviewer-core` change, no `run-executor` change. Smart Diff is a read-side view.
- **`GET /pulls/:id` and the `pulls` slice.** Its ~25 catalogued Drizzle-in-routes violations (`backend-onion-architecture` §12) are pre-existing debt; this plan neither copies nor fixes them.
- **e2e browser flows** (`e2e/**`) — no skill covers them and no row routes to them; `e2e/AGENTS.md` owns that decision.
- **Composing Smart Diff into `PrBrief`.** `PrBrief` is `{intent, blast, risks, history}` (`contracts/brief.ts:115-121`) and stays that way.
- **`.gitattributes` / `linguist-*` driven classification**, and any per-repo user-configurable pattern list. Patterns are the constants file.
- **Measuring whether the ordering improves review quality.** Smart Diff changes no model output, so `docs/l02-experiment.md` does not apply; do not claim an improvement in review quality on the strength of this change.

---

## Handoff

For the **architecture reviewer**:
- The new slice boundary `server/src/modules/smart-diff/` — specifically that `service.ts` reads `container.reviewRepo` and never `container.db`, and that no file in the slice imports `modules/reviews/**` (`no-cross-slice-import`, `no-sql-in-service`).
- The placement judgement in Risk 2: classifier in a ring-2 module helper rather than in `reviewer-core` ring 1.
- The shared/route-local split on the client: `DiffFindingsApi` + `lineAnchorId` promoted into `components/diff-viewer/` (two consumers), `SmartDiffViewer` kept route-local (one consumer), and the new controlled-`open` prop pair on the shared `FileCard`.
- The `client/src/components/diff-viewer/index.ts` barrel gaining two exports — still one shallow barrel, no chaining.
- `cd server && pnpm arch` must exit 0 with **no** new `pathNot` exemption; separate any pre-existing §12 debt it surfaces from this change's findings.

For the **security reviewer**:
- One new outbound-facing route, `GET /pulls/:id/smart-diff`. Its only user input is the `:id` path param, validated by the shared `IdParams` Zod schema, and the ownership check is `reviewRepo.getPull(workspaceId, prId)` — the IDOR surface (A01).
- The response is built from `pr_files.path` and `findings.file`, both of which originate outside the app (GitHub paths, and a model-authored path in the case of `findings.file`). They are used for classification and as a **DOM id seed** on the client (`lineAnchorId` sanitizes to `[a-zA-Z0-9-]`); they are never used to read a file, build a URL, or construct a query.
- Confirm the negative: the response carries no `patch` text, no secrets, and no finding prose — only paths, counts and line numbers.
- No new secret, no new `SecretsProvider` use, no new outbound network call, and no new migration.
