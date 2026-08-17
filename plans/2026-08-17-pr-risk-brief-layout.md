# PR Risk Brief — Overview tab layout revision (SPEC-03) — implementation plan

## Task

Split the shipped single `BriefCard` into three client-side surfaces on the pull request's Overview tab — a status/header bar above a new side-by-side Intent + Blast Radius row, the brief's risks rendered inside `IntentCard`, and the review-focus list as its own section before the Description — with zero server, contract, or hook changes, and with every SPEC-02 acceptance criterion still pinned by a test after the component that housed it is deleted.

## Requirements source

`specs/2026-08-17-pr-risk-brief-layout.md` (SPEC-03), AC-46 – AC-50, plus the SPEC-02 criteria SPEC-03 §Traceability re-addresses to new locations: `specs/2026-08-16-pr-why-risk-brief.md` AC-20, AC-21, AC-25 – AC-45.

This plan implements those requirements; it does not define, extend, or amend them. Two findings from the intake that the caller resolved are recorded under `## Answers taken` and are the only places this plan goes beyond a literal reading of SPEC-03.

## Answers taken

- **Q1 → A.** Build the two-column grid so Intent and Blast Radius sit side by side. SPEC-03 §Problem asserts they already do; the repo shows a vertical stack (see `## Inventory`), so the row is built here rather than assumed.
- **Q2 → A.** Keep the shipped labelled `What` / `Why` prose block inside the bar. The bar is "slim" relative to a card, not a single line; no truncation rule is invented.
- **Q3 → B.** The risks list renders only when a derived intent exists. `IntentCard`'s `loading` and "no intent" branches render no risks. SPEC-03 adds no criterion for the intentless case, and putting a risks list under "Brief not available yet." would read as a contradiction. Recorded as a risk below.
- **Q4 → A.** Render `included_inputs` and `dropped_refs`, with two new copy keys. This closes SPEC-02 AC-20, which the shipped card does not meet.
- **Q5 → A.** No new `OverviewTab.test.tsx`. AC-49 is settled by a `path:line` (one `usePrBrief` call site); AC-50 by the three per-component suites.
- **Recommendations 1–4 accepted:** delete `BriefCard/` in favour of `BriefBar/` + `ReviewFocusSection/`; promote `RISK_COLOR` to a route-level `constants.ts`; split the test suite by surface with an explicit AC→file map; update `docs/pr-risk-brief.md` in the same pass.
- **Mode chosen: single-agent**, followed by one read-only `plan-verifier` pass.

## Context read

- `client/INSIGHTS.md` (2026-08-17, "A record's own `stale` field is a snapshot from its LAST fetch") — the `briefStale`/`briefWithStale` recompute in `OverviewTab.tsx:53-55` must survive the rewire and must keep feeding **all three** surfaces, not just the bar. The entry's own "Where" section names `BriefCard.tsx` as the reader; that reference goes stale with this change and the entry must not be rewritten (append-only), so the plan updates `docs/pr-risk-brief.md:167-171` instead.
- `client/INSIGHTS.md` (2026-08-05, "Promoting a component must move its CONSTANTS too, and the linter will not tell you") — `RISK_COLOR` gains a second consumer in this change. This is why Step 1 exists and why it runs first.
- `client/INSIGHTS.md` (2026-08-05, "Reaching a route-root `_components/` with `../../../`: `typecheck` passes, only `lint` catches it") — two levels of `../` is legal, three is not. Verified directly against `client/eslint.config.mjs:91-102`, whose pattern is `['../../../*']`. Step 1's import from a `_components/<Name>/` file is `../../constants` — two levels, legal.
- `client/INSIGHTS.md` (2026-08-08, "`@testing-library/user-event` is NOT installed here…" superseded by the note in `BriefCard.test.tsx:5-7`) — the package **is** a devDependency now, and new/edited test files use `userEvent`, never `fireEvent`. All three suites in this change are new-or-edited, so all three use `userEvent`.
- `client/INSIGHTS.md` (2026-08-05, "`IconName` is the vendored REGISTRY's key set, not lucide's export list") — the review-focus section's `SectionLabel` icon must be a registry key. `ListChecks` is verified present at `client/src/vendor/ui/icons.tsx:157`.
- `client/INSIGHTS.md` (2026-08-11, "A CSS custom property that does not exist fails SILENTLY") — **opened and rejected as non-binding**: every token this change uses (`--border`, `--bg-elevated`, `--bg-hover`, `--text-*`, `--crit*`, `--warn*`, `--sugg*`, `--accent`) is copied verbatim from `BriefCard/styles.ts`, which ships and renders. No new token is introduced.
- `client/INSIGHTS.md` (2026-08-16, "A message reproducing engine output goes through `t.raw`, not `t()`") — **opened and rejected**: no message in this change reproduces engine output; model-authored text (`what`, `why`, risk `title`/`explanation`, focus `reason`) is rendered as a JSX `{value}`, never looked up as a key, exactly as today.
- `client/INSIGHTS.md` (2026-08-11, "`entry.symbol` is not a unique React key") — bears on the risks list and the focus list: keep the existing composite keys (`` `${entry.path}:${entry.line}:${i}` `` for focus; index for risks, which is a fixed, non-reorderable, capped-at-five list rendered from one immutable document).
- root `INSIGHTS.md` (2026-08-02, "unknown cost is null, never zero") — the bar's `costUnknown` branch is preserved verbatim.
- `AGENTS.md` §Repo rules — all Markdown in English; `client/` is its own package, so every command runs from `client/`.
- `AGENTS.md` §Do not touch — `client/src/vendor/**` is vendored. This change consumes `@devdigest/ui` and `@devdigest/shared` and edits neither.
- `specs/2026-08-16-pr-why-risk-brief.md` AC-20 — **contradicts the shipped code**: it requires the dropped count "visible on the card", and the card never renders it. Step 2 closes this.
- `specs/2026-08-17-pr-risk-brief-layout.md` §Problem and user — **contradicts the repo**: it states the two cards are already side by side. They are not. Step 5 builds the row.
- `docs/pr-risk-brief.md:28`, `:167-171`, `:213-241` — the shipped feature doc, which describes one card and must describe three surfaces.

## Inventory — what already exists

| Thing | Where | Verdict |
|---|---|---|
| `usePrBrief` / `useGenerateBrief` | `client/src/lib/hooks/brief.ts:17-45` | **reuse, unchanged** — every field the three surfaces need is already on the returned `PrRiskBriefRecord` |
| `PrRiskBriefRecord`, `BriefRisk`, `BriefFocus`, `BriefRiskLevel`, `BriefInputLabel`, `BriefGenerationResult` | `client/src/vendor/shared/contracts/review-api.ts:155-240` | **reuse, unchanged** — no contract edit, therefore **no `shared:sync` step** |
| `dropped_refs`, `included_inputs` on the record | `client/src/vendor/shared/contracts/review-api.ts:221-223` | reuse — present on the wire, **rendered nowhere in the client today** (`rg -n "dropped_refs\|included_inputs" client/src` returns only the contract and `BriefCard.test.tsx:44-46`) |
| The full brief state ladder (empty / generating / not_configured / too_large / failed) | `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/BriefCard.tsx:41-101` | **move** into `BriefBar` wholesale |
| Risk-level badge, stale badge, index-incomplete badge, regenerate button, What/Why block, missing-inputs, model label, cost | `BriefCard.tsx:111-215` | **move** into `BriefBar` |
| Review-focus list, its `aria-label`, its long-path `title` | `BriefCard.tsx:154-176` | **move** into `ReviewFocusSection` |
| Risks list rendering | `BriefCard.tsx:178-198` | **move** into `IntentCard` |
| `RISK_COLOR` | `BriefCard/constants.ts:13-17` | **move** to a route-level `constants.ts` — two consumers after this change (`brief.risk_level` in the bar, `risk.severity` in `IntentCard`) |
| All brief styles | `BriefCard/styles.ts:1-121` | **split** across three `styles.ts` files |
| `IntentCard` scope-bullet block, the anchor AC-47 names | `IntentCard/IntentCard.tsx:86-109` | **extend** — risks go after this block, before the `sources` meta at `:111-120` |
| `IntentCard` early returns (`loading` → null; `!intent` → `EmptyState`) | `IntentCard.tsx:30`, `:32-48` | reuse — these are why Q3-B holds: risks are unreachable in both branches |
| Description block, the AC-48 anchor | `OverviewTab/OverviewTab.tsx:87-92` | reuse — `ReviewFocusSection` mounts immediately before it |
| `briefStale` / `briefWithStale` recompute | `OverviewTab.tsx:53-55` | reuse — now feeds three surfaces instead of one |
| The `?goto=` navigation AC-48 must preserve | `OverviewTab.tsx:25` (`onOpenCaller` prop) → `PrDetailView.tsx:205-207` (one `router.replace` carrying `tab` + `goto`) | **reuse, untouched** — `ReviewFocusSection` receives the same callback the card received |
| Focus-after-navigation (AC-31, AC-32) | `client/src/components/diff-viewer/{useDiffLineTarget.ts,helpers.ts,FileCard/}`, pinned by `DiffViewer.test.tsx`, `SmartDiffViewer.test.tsx`, `DiffTab.test.tsx` | **untouched** — SPEC-03 §Non-goals forbids changing it, and no file in this plan's set imports it |
| A two-column grid | no such thing on this screen — `OverviewTab.tsx:59-93` renders four sibling `<section>`s into `PrDetailView/styles.ts:13-20` (`flexDirection: "column"`, `gap: 24`) | **new** — grep: `rg -n "gridTemplateColumns" "client/src/app/repos/[repoId]/pulls/[number]"` returns nothing |
| A grid precedent to copy | `client/src/app/skills/[id]/_components/StatsTab/styles.ts:40` (`repeat(auto-fit, minmax(300px, 1fr))`), `client/src/app/repos/[repoId]/context/_components/ContextView/styles.ts:32` | reuse the pattern |
| A route-root `constants.ts` precedent | `client/src/app/repos/[repoId]/pulls/constants.ts:1-15`, `client/src/app/skills/constants.ts` | reuse the pattern |
| `formatCost` | `client/src/lib/format.ts:16-21` | reuse — note it returns `"—"` for null, which is why the null branch uses `t("riskBrief.costUnknown")` instead of calling it |
| `blast.reason.*` copy for the index-incomplete badge | `client/messages/en/blast.json:20-27` | reuse — `BriefBar` keeps the `useTranslations("blast")` second namespace |
| Copy keys for the bar's heading, included inputs, dropped refs | `client/messages/en/brief.json:66-111` | **new** — three keys; grep: `rg -n "includedLabel\|droppedLabel\|barTitle" client/messages` returns nothing |
| An `OverviewTab` test | `_components/OverviewTab/` holds only `OverviewTab.tsx`, `index.ts`, `styles.ts` | none, and none is added (Q5-A) |

## Constraints that bind

| Rule | Applies? | What the implementation must do |
|---|---|---|
| `@devdigest/shared` exists twice | **no** | No contract field is added or changed. `./scripts/check-shared-sync.sh` is not triggered and no `*/src/vendor/shared/**` file is touched. |
| A field on a jsonb-persisted contract (`.nullish()`, never `.nullable()`) | **no** | No schema edit. `dropped_refs` and `included_inputs` are already required fields on `StoredRiskBrief` (`review-api.ts:221-223`). |
| A DB-backed test must be `*.it.test.ts` | **no** | `client/` has no Postgres-backed tests; all three suites are `*.test.tsx` under `client/src/**`. |
| A migration | **no** | SPEC-03 §Non-goals: no ring 0–3 code. No `pnpm db:generate`, no `pnpm db:migrate`. |
| Ring / import direction (`pnpm arch`) | **no** | `pnpm arch` covers `server/` and `reviewer-core/` only. No file outside `client/` is touched, so it is not in the verification plan. |
| `reviewer-core` zero I/O | **no** | Not touched. |
| New file placement in `client/` (`frontend-ui-architecture` §1, §2) | **yes** | `BriefBar/` and `ReviewFocusSection/` are used by one route → they go in that route's `_components/<PascalName>/` beside `IntentCard/` and `BlastRadiusCard/`, each with `index.ts` + `styles.ts` (§1 rows 1, 11, 12; §8 naming). `RISK_COLOR` gains a second consumer → promoted to the nearest shared ancestor, the route root (§2, §6). Rendering stays inline in `IntentCard` — no `RiskList` component, per SPEC-03 §Open questions 1 and §2 ("never create a shared location for a hypothetical future consumer"). |
| A secret | **no** | Nothing in this change reads a credential. |
| Any `CLAUDE.md` / `AGENTS.md` | **no** | No agent instructions change. No symlink is touched. |
| Empty reserved tables | **no** | No DB access. |
| A new rule in an agent `system_prompt` | **no** | No prompt changes. |
| Data model — HTTP APIs, one hook per domain (`frontend-ui-architecture` §In this repo) | **yes** | AC-49 is satisfied structurally: `usePrBrief` is called exactly once, in `OverviewTab`, and all three surfaces take **resolved data plus flags**, never a `prId` (§4 "Own the data boundary explicitly"). No new hook, no `fetch` in a component. |
| User-facing strings in the catalogue, never inline (`frontend-ui-architecture` §1, SPEC-02 AC-45) | **yes** | The three new labels go in `client/messages/en/brief.json` under `riskBrief`. Model-authored text stays a JSX `{value}`. |
| Barrels are shallow and declare a public API (`frontend-ui-architecture` §7) | **yes** | Each new directory gets a one-line `index.ts` in the shape `BriefCard/index.ts:1` already uses. No barrel imports another barrel. |
| `'use client'` marks the leaf (`frontend-ui-architecture` §9) | **yes, trivially** | The whole subtree is already client code (`PrDetailView.tsx:6`). Both new components carry `"use client"` because they call `useTranslations`; every prop crossing into them is serializable data plus callbacks defined in `OverviewTab`, which is itself a client component — `next-best-practices` `rsc-boundaries.md` §2 does not apply. |
| Derive, don't store (`react-best-practices` §Derive) | **yes** | Nothing in this change adds `useState` or `useEffect`. Every value — `missing`, `costText`, `risk`, `outcome` — is computed in the render body, exactly as today. |
| Accessibility: icon-only buttons need a name; colour is never the only signal | **yes** | The regenerate `Button` keeps its text label; each focus row keeps its `aria-label` from `riskBrief.openFocus`; the risk level and each risk severity keep a text label beside the colour (AC-28). |
| Demotions in `routing.md` §"Vendored severity is not house law" | **yes** | `react-best-practices`' "container components fetch data" and "max 200 lines" are superseded by `frontend-ui-architecture` §4 and are not reasons to split or reshape anything here. |

## Modules touched

| Package | Path | Ring / layer | Why |
|---|---|---|---|
| `client` | `src/app/repos/[repoId]/pulls/[number]/constants.ts` | route-local shared constant | new home for `RISK_COLOR`, now two consumers |
| `client` | `src/app/repos/[repoId]/pulls/[number]/_components/BriefBar/{BriefBar.tsx,styles.ts,index.ts}` | route-local component | AC-46, AC-50 — the header row and the whole brief state ladder |
| `client` | `src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocusSection/{ReviewFocusSection.tsx,styles.ts,index.ts}` | route-local component | AC-48 — the standalone "read this first" section |
| `client` | `src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/{IntentCard.tsx,styles.ts}` | route-local component | AC-47 — renders a risks list it does not compute, fetch or validate |
| `client` | `src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/{OverviewTab.tsx,styles.ts}` | route-local composition | AC-46/48/49 ordering, and the two-column row |
| `client` | `src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/**` | route-local component | **deleted** — its five files are redistributed |
| `client` | `messages/en/brief.json` | i18n catalogue | AC-45 — three new fixed labels |
| `client` | three `*.test.tsx` files | tests | the AC→file map below |
| repo | `docs/pr-risk-brief.md` | documentation | the shipped doc describes one card |

## Skills — read by the planner, to be loaded by the executor

| Path glob | Skill | Sections | routing.md row | Rule it imposes on this plan |
|---|---|---|---|---|
| `client/src/app/**/*.tsx` | `frontend-ui-architecture` **(preloaded)** | §1 placement, §2 promotion, §3 boundaries, §4 splitting, §5 logic, §6 constants, §7 barrels, §8 naming, §9 client boundary | Frontend row 1 | Two new components go in **this route's** `_components/<PascalName>/`, not `src/components/`; `RISK_COLOR` is promoted the moment it has a second consumer; the risks rendering stays inline because it has one consumer; each surface takes resolved data plus flags. |
| `client/src/app/**/*.tsx` | `react-best-practices` | Derive-don't-store, hooks, keys, conditional rendering, accessibility, over-engineering | Frontend row 2 | No `useState`/`useEffect` added; no `renderThing()` factories — `BriefSection` stays a PascalCase component or is inlined; `{count && …}` is never used for `dropped_refs` (must be `> 0`); array index is acceptable only for the fixed capped risks list. |
| a `'use client'` line added | `next-best-practices` + `frontend-ui-architecture` §9 | `rsc-boundaries.md` | Frontend row 4 | Neither new component may be `async`; every prop is serializable data or a callback owned by the client parent. Both hold trivially — the parent tree is already client code. |
| `client/src/**/*.test.tsx` | `react-testing-library` | query priority, `userEvent`, assert-absence, anti-patterns | Frontend row 5 | `getByRole`/`getByText` over `getByTestId`; `userEvent.setup()` per test, never `fireEvent`; `queryBy…` with `.not.toBeInTheDocument()` for AC-50's absences; never assert on styles or internals. |
| `client/src/app/**/{styles,constants}.ts` | `frontend-ui-architecture` | §1, §6, §8 | Frontend row 8 | Styles live in a `styles.ts` beside each component; the promoted constant is lowercase `constants.ts` at the route root; folder casing is Pascal for a component, kebab for a segment. |
| `client/**/index.ts` | `frontend-ui-architecture` §7 | barrel files | Frontend row 7 | One shallow re-export line per new directory; no chained barrels; a component never imports its own sibling through the barrel. |
| `docs/**`, `plans/**` | — | — | "Contracts, and everything else" | Repo rules only: English. |

Not loaded, deliberately: `backend-onion-architecture` (preloaded, but **no row matches** — no `server/` or `reviewer-core/` file is touched, and opening it for a `.tsx` file invents constraints); `zod` (no `z.object(` added or changed); `typescript-expert` (no type-level change beyond one optional prop).

**No sentinel is touched.** `server/src/db/migrations/**`, `reviewer-core/src/grounding.ts`, `INJECTION_GUARD` in `reviewer-core/src/prompt.ts`, and `*/src/vendor/**` are all outside this change's file set.

## Execution

**single-agent.** One `implementer` run executes Steps 1–8 in order, writing the tests in the same pass. All eight steps live in `client/` plus one `docs/` file, and Steps 2, 3, 4, 5, 6 and 7 each touch `messages/en/brief.json` or `OverviewTab.tsx` or both, so there is no disjoint file set for a second writer to own.

| # | Agent | Input artifact | Steps | Files owned | Output |
|---|---|---|---|---|---|
| 1 | `implementer` | `plans/2026-08-17-pr-risk-brief-layout.md` | 1–8 | everything under `## Modules touched` | changes in the working tree, gates green |
| 2 | `plan-verifier` | the same path | — | none (read-only) | one row per plan item and per AC-46…AC-50 plus the relocated SPEC-02 criteria; `not-met` rows go back to hop 1, `unverifiable` rows are reported, not fixed |

Sequential throughout. Nothing runs in parallel.

## Steps

### Step 1 — Promote `RISK_COLOR` to the route root

- **Files:** create `client/src/app/repos/[repoId]/pulls/[number]/constants.ts`; delete `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/constants.ts`
- **Change:** move the `RISK_COLOR` map verbatim (`BriefCard/constants.ts:13-17` — `high`/`medium`/`low` → `{ c, bg, icon }`, importing `IconName` from `@devdigest/ui` and `BriefRiskLevel` from `@devdigest/shared`). Rewrite its docblock: it is no longer "local to this component — one consumer"; it now has two (`BriefBar` for `brief.risk_level`, `IntentCard` for each `risk.severity`), which is exactly why it moved. Keep the note that `low` borrows the `--sugg` tone rather than inventing a fourth token. Follow the file shape of `client/src/app/repos/[repoId]/pulls/constants.ts:1-15`.
- **Skill:** `frontend-ui-architecture` §2 — "second consumer appears → move up to the nearest shared ancestor, **in the same commit that adds the second use**"; §6 — a constant used by 2+ is promoted; §8 — the file is lowercase `constants.ts`.
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n "RISK_COLOR" client/src` shows exactly one `export const` — in `client/src/app/repos/[repoId]/pulls/[number]/constants.ts` — and no import of it uses three or more `../` levels (`client/eslint.config.mjs:91-102` forbids `../../../*`; from a `_components/<Name>/` file the correct specifier is `../../constants`).

### Step 2 — Create `BriefBar/` — the header row and the whole brief state ladder

- **Files:** create `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefBar/BriefBar.tsx`, `.../BriefBar/styles.ts`, `.../BriefBar/index.ts`
- **Change:**
  - `index.ts` is one line, mirroring `BriefCard/index.ts:1`: `export { BriefBar, BriefBar as default } from "./BriefBar";`
  - `BriefBar.tsx` starts with `"use client"` and takes exactly `{ brief: PrRiskBriefRecord | null | undefined; loading: boolean; generating: boolean; result: BriefGenerationResult | null | undefined; onGenerate: () => void }` — `BriefCard`'s props minus `onOpenFocus`. Carry over the docblock's key sentence: it takes **resolved data plus flags, never a `prId` it fetches from**, `brief` is the last stored document and `result` is the last `generate()` outcome.
  - Move the **entire** state ladder from `BriefCard.tsx:41-101` unchanged in behaviour: `if (loading) return null`; `const outcome = !generating ? result : null` with its comment (AC-27 — a leftover `result` must not flash while a new generation is in flight); then, under `!brief`, the five branches in this order — `generating` → `riskBrief.generating`; `not_configured` → `EmptyState` with title+body and **no CTA** (AC-39); `too_large` → `EmptyState` title+body, **no CTA** (AC-42's overflow sibling); `failed` → `EmptyState` with `riskBrief.retry` CTA calling `onGenerate` (AC-38); default → `riskBrief.empty.*` with the `riskBrief.generate` CTA (AC-26, AC-50).
  - Move the fresh-brief presentation from `BriefCard.tsx:111-215`: the risk-level `Badge` built from `RISK_COLOR` with its `Risk: <level>` text label (AC-28); the `stale` `Badge` (AC-34/35); the `!index_complete && index_reason` `Badge` reading `useTranslations("blast")`(`reason.${index_reason}`) (AC-36); the regenerate `Button` (`size="sm"`, `kind="tertiary"`, `icon="RefreshCw"`, `loading`/`disabled` on `generating`); the `staleHint` note; the labelled `What` / `Why` prose block **kept as prose** (Q2-A, AC-29); the `missing` badges with the defensive `pr_identity` filter and its comment (AC-37); the model-generated `Badge` and the cost line with the `cost_usd == null → riskBrief.costUnknown` branch (AC-40, AC-41).
  - **New in this step (AC-46, closing SPEC-02 AC-20):**
    - An **included-inputs** row beside the missing-inputs row: `{included_inputs.length > 0 && …}` rendering `t("riskBrief.includedLabel")` followed by one `Badge` per label using the existing `riskBrief.inputs.*` keys. Use `Badge`, not `Chip` — `Chip` renders a `<button>` and these labels are not interactive, the reason already recorded at `IntentCard.tsx:114-115`.
    - A **dropped-reference count**: `{brief.dropped_refs > 0 && <span>{t("riskBrief.droppedLabel", { count: brief.dropped_refs })}</span>}`. It must be `> 0`, never `{brief.dropped_refs && …}` — a `0` would render the literal `0` (`react-best-practices` §Conditional Rendering).
  - Wrap the whole thing in the shipped `<section>` + `<SectionLabel icon="Shield">` shape (`BriefCard.tsx:219-227`), but with the heading key changed from `t("block.risks")` to the new `t("riskBrief.barTitle")` — "Risks" now names the sub-section inside `IntentCard`, not this bar. Keep the wrapper as a PascalCase component (`BriefBarSection`) or inline it; do **not** turn it into a `renderSection()` factory (`react-best-practices` §Render Factories, CRITICAL).
  - `styles.ts` takes `card`, `header`, `headerLeft`, `whyBlock`, `why`, `note`, `sectionTitle`, `meta` from `BriefCard/styles.ts` verbatim. Every CSS custom property in them already ships.
- **Skill:** `frontend-ui-architecture` §1 (a component used by one route lives in that route's `_components/<Name>/`), §4 ("own the data boundary explicitly" — resolved data plus a flag, never an id), §7 (one shallow barrel line), §8 (Pascal folder, Pascal file, lowercase `styles.ts`); `react-best-practices` §Conditional Rendering (`> 0`, not truthiness), §Render Factories, §Accessibility (the regenerate control keeps a text label).
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n "dropped_refs|included_inputs" "client/src/app/repos/[repoId]/pulls/[number]/_components/BriefBar/BriefBar.tsx"` returns both, and `rg -n "onOpenFocus|review_focus|brief.risks" .../BriefBar/BriefBar.tsx` returns nothing — the bar owns none of the two lists.

### Step 3 — Create `ReviewFocusSection/` — the standalone "read this first" section

- **Files:** create `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocusSection/ReviewFocusSection.tsx`, `.../styles.ts`, `.../index.ts`
- **Change:**
  - `index.ts`: `export { ReviewFocusSection, ReviewFocusSection as default } from "./ReviewFocusSection";`
  - `"use client"`. Props: `{ brief: PrRiskBriefRecord | null | undefined; loading: boolean; onOpenFocus: (path: string, line: number) => void }`.
  - `if (loading || !brief) return null;` — this single line is AC-50 for this surface: a never-briefed PR shows neither review-focus content nor an error here. It renders **no** state ladder; every failure and empty state belongs to `BriefBar` (SPEC-03 AC-50, and its §Edge cases row "Brief never generated").
  - Otherwise render `<section>` + `<SectionLabel icon="ListChecks">{t("riskBrief.focusTitle")}</SectionLabel>` — `focusTitle` already reads "Review Focus — Read this first" (`messages/en/brief.json:96`), so **no new key**. `ListChecks` is verified present in the vendored registry at `client/src/vendor/ui/icons.tsx:157`; do not substitute a lucide name that is not a registry key (`client/INSIGHTS.md` 2026-08-05).
  - Then move `BriefCard.tsx:155-176` verbatim: `review_focus.length === 0` → `t("riskBrief.noFocus")` in a note (AC-21 — explicitly empty, never a blank gap); otherwise one `<button type="button">` per entry, keyed `` `${entry.path}:${entry.line}:${i}` ``, with `aria-label={t("riskBrief.openFocus", { path, line })}` (AC-33), `onClick={() => onOpenFocus(entry.path, entry.line)}` (AC-30), the `title={entry.path}` monospace path span rendering `{path}:{line}` (AC-44), and the `title={entry.reason}` reason span.
  - `styles.ts` takes `card`, `note`, `focusList`, `focusRow`, `focusPath`, `focusReason` from `BriefCard/styles.ts` verbatim.
- **Skill:** `frontend-ui-architecture` §1, §7, §8; §5 — the navigation stays a **callback the parent owns**, so this component holds no router knowledge and no state; `react-best-practices` §Accessibility (every focus row keeps its accessible name), §Key Prop Patterns (composite key, not a bare index).
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n "useRouter|useSearchParams|EmptyState|result" .../ReviewFocusSection/ReviewFocusSection.tsx` returns nothing — this surface neither navigates itself nor owns a generation state.

### Step 4 — `IntentCard` renders a risks list it does not compute

- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`, `.../IntentCard/styles.ts`
- **Change:**
  - Add one **optional** prop: `risks?: BriefRisk[] | null` (type imported from `@devdigest/shared`, which already exports it at `review-api.ts:176`). Document it in the interface: the card **renders** what it is given and does not fetch, validate, or cap it — SPEC-03 §Goals, and the same relationship the card already has with `intent.intent`.
  - Insert the risks sub-section in `IntentCard.tsx` **after** the `(in_scope.length > 0 || out_of_scope.length > 0)` scope-lists block (currently `:86-109`) and **before** the `sources.length > 0` meta block (`:111-120`). That position is AC-47's "beneath its in-scope and out-of-scope bullets".
  - The sub-section renders only when `risks != null`: a `<div style={s.sectionTitle}>{t("block.risks")}</div>` heading, then `risks.length === 0 ? <div style={s.note}>{t("noRisks")}</div>` (AC-43 — the explicit zero sentence, which is why the heading renders even at zero) `: risks.map(...)` producing the shipped risk rows from `BriefCard.tsx:183-196` — a `Badge` from `RISK_COLOR[r.severity]` carrying the severity's **text** label (AC-28's rule applied per risk), the risk `title`, and the `explanation` beneath.
  - **Do not** add the risks to the `loading` branch (`:30`) or the `!intent` `EmptyState` branch (`:32-48`) — Q3-B. Both already return before this point, so this is a property of where the block is inserted, not an extra guard.
  - `styles.ts` gains `sectionTitle`, `note`, `risks`, `risk`, `riskHeader`, `riskTitle`, `riskExplanation`, copied verbatim from `BriefCard/styles.ts:35-77`. `IntentCard/styles.ts` already has a `meta` key — do not clobber it; add only the keys it lacks.
  - Import `RISK_COLOR` from `../../constants` (two levels — legal per `client/eslint.config.mjs:91-102`; three would fail `pnpm lint` while `pnpm typecheck` stayed green, `client/INSIGHTS.md` 2026-08-05).
- **Skill:** `frontend-ui-architecture` §2 — the rendering stays **inline**, no `RiskList` component, because `IntentCard` is its only consumer (SPEC-03 §Open questions 1); §5 — the zero/many branch is computed in the render body, no state, no Effect; `react-best-practices` §Over-Engineering ("abstractions with only one consumer are premature").
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `IntentCard`'s prop count is 6 and the new one is optional, so no existing caller breaks; and `rg -n "usePrBrief|api\.|fetch\(" .../IntentCard/IntentCard.tsx` returns nothing — the card gained a rendering responsibility and no data responsibility.

### Step 5 — Rewire `OverviewTab`: three surfaces, one fetch, two columns

- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`, `.../OverviewTab/styles.ts`; delete `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/` (`BriefCard.tsx`, `BriefCard.test.tsx`, `styles.ts`, `index.ts` — `constants.ts` already went in Step 1)
- **Change:**
  - Replace the `BriefCard` import with `BriefBar` and `ReviewFocusSection`.
  - Keep `usePrBrief(prId)` and `useGenerateBrief(prId)` exactly as they are, called **once** (`OverviewTab.tsx:39-40`). This is AC-49 and it needs no code change — only protection.
  - Keep `briefStale` / `briefWithStale` (`:49-55`) and pass `briefWithStale ?? null` to **both** `BriefBar` and `ReviewFocusSection`, and `briefWithStale?.risks ?? null` to `IntentCard`. Update the comment at `:52`: the recompute is folded into the record so each surface still takes exactly one `brief`, and it is the *screen's* job, not a card's (`client/INSIGHTS.md` 2026-08-17).
  - Render, in this order — the order **is** AC-46 + AC-48:
    1. `<BriefBar brief={briefWithStale ?? null} loading={briefLoading} generating={generateBrief.isPending} result={generateBrief.data} onGenerate={() => generateBrief.mutate({ force: true })} />`
    2. `<div style={s.summaryRow}>` wrapping `<IntentCard … risks={briefWithStale?.risks ?? null} />` and `<BlastRadiusCard … />` unchanged otherwise
    3. `<ReviewFocusSection brief={briefWithStale ?? null} loading={briefLoading} onOpenFocus={onOpenCaller} />`
    4. the existing `prBody &&` Description `<section>` (`:87-92`), unmoved
  - `styles.ts` gains `summaryRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24, alignItems: "start" }`. `auto-fit` rather than `1fr 1fr` for two reasons: it collapses to one column on a narrow viewport, and it lets the surviving card expand when `BlastRadiusCard` returns `null` (which it does whenever `loading || !blast` — `BlastRadiusCard.tsx:43`) or `IntentCard` returns `null` (`IntentCard.tsx:30`). Precedent: `client/src/app/skills/[id]/_components/StatsTab/styles.ts:40`. The parent container is `max-width: 1080px` with `24px` gutters (`PrDetailView/styles.ts:13-20`), so two `340px` minimums fit and neither card's internals need to change.
  - Both cards already render a `<section>` at their root, so they become grid items with no edit to either component.
- **Skill:** `frontend-ui-architecture` §5 — "reads or writes the backend → the data layer, never a component"; the tab owns the query and hands resolved data down. §3 — no cross-`_components/` import: each surface is reached through its own barrel.
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -rn "BriefCard" client/src client/messages` returns **nothing**; `rg -c "usePrBrief" client/src` returns `1` for `OverviewTab.tsx` and `1` for `lib/hooks/brief.ts` and nothing else (AC-49); and `git status` shows the four `BriefCard/` files deleted.

### Step 6 — Three new copy keys

- **Files:** `client/messages/en/brief.json`
- **Change:** add to the `riskBrief` object (`:66-111`), leaving every existing key untouched:
  - `"barTitle": "Risk brief"` — the bar's `SectionLabel`, replacing the reused `block.risks` heading.
  - `"includedLabel": "Inputs used"` — the label before the included-input badges, phrased as the counterpart to the existing `"missingLabel": "Missing inputs"`.
  - `"droppedLabel": "{count} reference(s) dropped as unresolvable"` — an ICU `{count}` message, matching how `overlap` (`:10`) and `smartDiff.filesCount` (`:37`) already interpolate. SPEC-02 §Edge cases requires copy correct in the singular and the zero case; the zero case is handled by not rendering the element at all (Step 2), so the message covers 1 and n.
- **Skill:** `frontend-ui-architecture` §1 — user-facing strings live in the catalogue, never inline (SPEC-02 AC-45).
- **Verify:** `cd client && pnpm test` (every suite renders through `NextIntlClientProvider` with the real `brief.json`, so a missing or malformed key surfaces as a failing assertion, not a silent fallback) plus `jq -e '.riskBrief.barTitle and .riskBrief.includedLabel and .riskBrief.droppedLabel' client/messages/en/brief.json`
- **Done when:** `jq` exits 0, `en` remains the only locale directory (`ls client/messages` → `en`), and no user-facing English literal was added to a `.tsx` file in Steps 2–4.

### Step 7 — Redistribute the test coverage, surface by surface

- **Files:** create `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefBar/BriefBar.test.tsx` and `.../ReviewFocusSection/ReviewFocusSection.test.tsx`; edit `.../IntentCard/IntentCard.test.tsx`. (`BriefCard.test.tsx` was deleted in Step 5 — its 19 cases are accounted for below and none may be lost.)
- **Change:** carry over the fixture and the harness pattern from the deleted suite: the `BRIEF: PrRiskBriefRecord` literal (`BriefCard.test.tsx:20-50`) becomes each new file's local fixture; a local `renderX(props: Partial<React.ComponentProps<typeof X>> = {})` helper wraps in `<NextIntlClientProvider locale="en" messages={{ brief: messages, blast: blastMessages }}>`; `afterEach(cleanup)`; `userEvent.setup()` **per test**, never in a shared `beforeEach`; `vi.fn()` for every callback. `blastMessages` is needed only by `BriefBar` (the index-incomplete badge). Message imports use the deep relative path the existing suites use — the `no-restricted-imports` rule is switched **off** for test files (`client/eslint.config.mjs:127-130`), which is why `../../../../../../../../messages/en/brief.json` passes there and would fail anywhere else (`client/INSIGHTS.md` 2026-08-03).

  **AC → test-file map.** Every row is either a case moved from the deleted suite or a new case; no criterion may end this step without a home.

  | Criterion | Behaviour asserted | Home | Origin |
  |---|---|---|---|
  | — | renders nothing while the query is loading (`toBeEmptyDOMElement`) | `BriefBar.test.tsx` | moved (`BriefCard.test.tsx:69-72`) |
  | SPEC-02 AC-26 / SPEC-03 AC-50 | empty state names the generate action, and activating it calls `onGenerate` once | `BriefBar.test.tsx` | moved (`:74-82`) |
  | SPEC-02 AC-27 | generating with no brief shows "Generating…" and offers no generate button | `BriefBar.test.tsx` | moved (`:84-88`) |
  | SPEC-02 AC-27 | the previous brief stays readable while generating and the regenerate control is disabled | `BriefBar.test.tsx` | moved (`:90-95`) |
  | SPEC-02 AC-28 / SPEC-03 AC-46 | the risk level reads "Risk: Medium" — a text label, not colour alone | `BriefBar.test.tsx` | moved (`:97-100`) |
  | SPEC-02 AC-29 / SPEC-03 AC-46 | `What` and `Why` are labelled separately, each beside its own prose | `BriefBar.test.tsx` | moved (`:102-108`) |
  | SPEC-02 AC-41 / SPEC-03 AC-46 | the brief is labelled "Model-generated" | `BriefBar.test.tsx` | moved (`:115-118`) |
  | SPEC-02 AC-40 / SPEC-03 AC-46 | the cost renders, and reads "Cost: unknown" — never `$0.00` — when `cost_usd` is null | `BriefBar.test.tsx` | moved (`:120-128`) |
  | SPEC-02 AC-37 / SPEC-03 AC-46 | an absent optional input is named, not treated as an error | `BriefBar.test.tsx` | moved (`:166-171`) |
  | SPEC-02 AC-36 | incomplete downstream impact is named beside the risk level | `BriefBar.test.tsx` | moved (`:173-176`) |
  | SPEC-02 AC-34, AC-35 / SPEC-03 AC-46 | the stale marker renders and names regenerate as the fix | `BriefBar.test.tsx` | moved (`:178-184`) |
  | SPEC-02 AC-42 (overflow sibling) | `too_large` shows the state with no brief and no retry button | `BriefBar.test.tsx` | moved (`:186-191`) |
  | SPEC-02 AC-38 | a failure is retryable and retrying calls `onGenerate` | `BriefBar.test.tsx` | moved (`:193-202`) |
  | SPEC-02 AC-39 | `not_configured` names Settings and offers no retry | `BriefBar.test.tsx` | moved (`:204-211`) |
  | **SPEC-02 AC-20 / SPEC-03 AC-46** | a non-zero `dropped_refs` shows the count; `dropped_refs: 0` renders no count and no literal `0` | `BriefBar.test.tsx` | **new** — closes the shipped gap |
  | **SPEC-03 AC-46** | the inputs the brief *did* use are labelled, distinctly from the missing ones | `BriefBar.test.tsx` | **new** |
  | **SPEC-03 AC-46** | the bar renders neither the risks list nor the review-focus list (`queryByText(BRIEF.risks[0].title)` and `queryByText(/Read this first/)` both absent) | `BriefBar.test.tsx` | **new** — pins the split |
  | SPEC-02 AC-45 (label sub-heading) | the section reads "Review Focus — Read this first" | `ReviewFocusSection.test.tsx` | moved (`:110-113`) |
  | SPEC-02 AC-21 | zero focus entries state so explicitly rather than leaving a blank area | `ReviewFocusSection.test.tsx` | moved (`:135-138`) |
  | SPEC-02 AC-30, AC-33 | an entry has an accessible name and activating it calls `onOpenFocus` once with its path and line | `ReviewFocusSection.test.tsx` | moved (`:140-152`) |
  | SPEC-02 AC-44 | a long path stays readable with the full value reachable via `title` | `ReviewFocusSection.test.tsx` | moved (`:154-164`) |
  | **SPEC-03 AC-48, AC-50** | with `brief={null}` — and with `loading` — the section renders nothing at all: no heading, no error, no empty box | `ReviewFocusSection.test.tsx` | **new** |
  | SPEC-02 AC-43 / SPEC-03 AC-47 | "No notable risks flagged." renders inside the Intent card for `risks={[]}` | `IntentCard.test.tsx` | moved (`:130-133`) |
  | **SPEC-02 AC-42 / SPEC-03 AC-47** | a brief carrying three risks shows all three inside the Intent card, each with its severity as a text label, positioned after the out-of-scope bullets | `IntentCard.test.tsx` | **new** |
  | **SPEC-03 AC-47, AC-50** | with the `risks` prop omitted, the Intent card renders its intent and bullets and **no** risks heading; and with `intent={null}` the empty state carries no risks even when `risks` is supplied | `IntentCard.test.tsx` | **new** — pins Q3-B |

  Not in this change's suites, deliberately: **AC-31 and AC-32** (collapsed-group expansion and focus-after-navigation) are pinned by `client/src/components/diff-viewer/DiffViewer/DiffViewer.test.tsx`, `.../_components/SmartDiffViewer/SmartDiffViewer.test.tsx` and `.../_components/DiffTab/DiffTab.test.tsx`, none of which this plan touches — SPEC-03 §Non-goals forbids changing that behaviour. **AC-49** is settled by `path:line`, not a test (Q5-A). **AC-45** is covered transitively: every case above renders through the real `messages/en/brief.json`, so a hard-coded label fails.
- **Skill:** `react-testing-library` §Query Priority (`getByRole` for the buttons and their accessible names, `getByText` for prose, `getByTitle` only for the AC-44 long-path case where `title` *is* the behaviour, never `getByTestId`), §userEvent (`setup()` per test; no `fireEvent`), §Asserting absence (`queryBy…` + `.not.toBeInTheDocument()` for AC-50), §Anti-Patterns (assert what the user sees — never a style, a prop, or a hook call).
- **Verify:** `cd client && pnpm test`
- **Done when:** all three suites pass, `rg -n "fireEvent" client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/{BriefBar,ReviewFocusSection,IntentCard}` returns nothing, and every row of the table above maps to a real `it(...)` — the test names should carry their `AC-N` the way the deleted suite did, so `rg -n "AC-2[0-9]|AC-3[0-9]|AC-4[0-9]" client/src/app/repos/\[repoId\]/pulls/\[number\]/_components` shows the same criterion set as before plus AC-20, AC-46, AC-47, AC-48, AC-50.

### Step 8 — Update the shipped feature doc

- **Files:** `docs/pr-risk-brief.md`
- **Change:**
  - `:28` — the Mermaid node `UI["BriefCard<br/>(Overview tab)"]` names a component that no longer exists. Rename it to the three surfaces fed by one fetch, e.g. `UI["BriefBar + IntentCard risks<br/>+ ReviewFocusSection<br/>(Overview tab, one fetch)"]`, keeping the existing edge label `GET /pulls/:id/brief` — the one-fetch fact is AC-49 and the diagram is where it is legible.
  - `:167-171` — the client-side stale recompute paragraph says the record is folded "into the record it passes to `BriefCard`". Change to: the record is passed to all three surfaces, which is why the recompute stays in `OverviewTab` and not in any of them. Keep both `client/INSIGHTS.md` citations (2026-08-09, 2026-08-17) — those entries are append-only and must **not** be edited even though they name `BriefCard`.
  - `:213-223` (§Copy, and what is rendered as data) — replace "on the card" with the surface that now owns each label: fixed labels from the `riskBrief` namespace on all three; `risk_level` and cost in the bar; the zero-risk sentence inside the Intent card. Add the two new keys (`riskBrief.includedLabel`, `riskBrief.droppedLabel`) and note that the dropped count is the visible form of AC-20.
  - `:225-241` (§Where things are) — replace the single row `| The card | …/_components/BriefCard/ |` with four rows: the header row (`_components/BriefBar/`), the risks inside the intent card (`_components/IntentCard/`), the review-focus section (`_components/ReviewFocusSection/`), and the shared risk ramp (`[number]/constants.ts#RISK_COLOR`). Leave every server-side row untouched — none of it changed.
  - Add a short subsection recording the layout revision: SPEC-03 supersedes SPEC-02 for placement only; the three-surface order is bar → Intent + Blast Radius row → review focus → Description; and the Intent card renders risks it does not compute, fetch, validate or cap.
  - Do **not** add a `## Read when` row: `docs/pr-risk-brief.md` is already registered in the root `AGENTS.md` §Read when, and the document's identity has not changed.
- **Skill:** none — `routing.md` "Contracts, and everything else" gives `docs/**` no skill. Repo rule only: English (`AGENTS.md` §Repo rules).
- **Verify:** `rg -n "BriefCard" docs/ specs/2026-08-17-pr-risk-brief-layout.md` — the only remaining mentions must be historical references to what SPEC-02 shipped (SPEC-03's own prose at `specs/2026-08-17-pr-risk-brief-layout.md:12`, which is a spec and is not this plan's to edit), never a live "where things are" pointer.
- **Done when:** `docs/pr-risk-brief.md` names no path that `ls` cannot resolve: `rg -o "client/src/[^ )\`|]*" docs/pr-risk-brief.md | sort -u | while read p; do test -e "$p" || echo "MISSING $p"; done` prints nothing.

## Verification plan

| Package | Command | Runs when |
|---|---|---|
| client | `cd client && pnpm typecheck` | after Steps 1–5 and at the end |
| client | `cd client && pnpm lint` | after Steps 1–5 and at the end — this is the **only** gate that catches a deep relative import, and it is off in test files, so a green lint is not proof a test file is clean (`client/INSIGHTS.md` 2026-08-03) |
| client | `cd client && pnpm test` | after Steps 6 and 7 and at the end |
| — | `./scripts/pr-self-review.sh gates` | once at the end, per `.claude/agents/implementer.md` |

Not run, and why: `cd server && pnpm typecheck` / `pnpm test` / `pnpm arch` (no `server/**` or `reviewer-core/**` file changes); `./scripts/check-shared-sync.sh` (no `*/src/vendor/shared/**` change); `pnpm db:generate` / `pnpm db:migrate` (no schema change). Never run `./scripts/pr-self-review.sh` in review mode as a verification step — it writes a verdict file that gates `gh pr create`, which is not part of this plan.

## Acceptance-facing checks

Each criterion below is stated by SPEC-03 or by the SPEC-02 criteria SPEC-03 §Traceability re-addresses. Nothing here is new.

| # | Check | Settled by |
|---|---|---|
| AC-46 | All eight elements — what/why, risk level, regenerate, cost, included **and** missing input labels, dropped-reference count, stale marker, model-generated label — render in one region preceding both cards | the `BriefBar.test.tsx` rows of the Step 7 map, plus `OverviewTab.tsx` render order: `<BriefBar>` is the first child, `<div style={s.summaryRow}>` the second |
| AC-47 | Three risks show inside the Intent card; zero risks show AC-43's sentence there and never in a separate card | `IntentCard.test.tsx` new cases; and `rg -n "brief.risks\|BriefRisk" client/src/app/repos/\[repoId\]/pulls/\[number\]/_components` names only `IntentCard/` and `OverviewTab.tsx` |
| AC-48 | The review-focus section sits after the card row and before the Description, and activating an entry calls back with exactly `(path, line)`; zero entries render AC-21's sentence there | `ReviewFocusSection.test.tsx`; `OverviewTab.tsx` render order (`<ReviewFocusSection>` immediately precedes the `prBody &&` section); navigation unchanged at `PrDetailView.tsx:205-207` |
| AC-49 | One Overview load issues exactly one brief request, feeding all three surfaces | `rg -c "usePrBrief" client/src` → one call site (`OverviewTab.tsx`) and one definition (`lib/hooks/brief.ts`); no surface takes a `prId` prop — check each component's props interface |
| AC-50 | A never-briefed PR shows the generate action only in the bar; the Intent card and the review-focus area show nothing extra and no error | `BriefBar.test.tsx` (AC-26 case), `ReviewFocusSection.test.tsx` (`brief={null}` → `toBeEmptyDOMElement`), `IntentCard.test.tsx` (`risks` omitted → no risks heading) |
| SPEC-02 AC-20 | A non-zero dropped count is visible | `BriefBar.test.tsx`, new case — **this criterion is not met by the shipped code and becomes met here** |
| SPEC-02 AC-21, AC-25–AC-45 | Every criterion still holds, observed on a different component than the one it was written against | the AC→file map in Step 7; the `rg` on `AC-N` markers in its `Done when` is the mechanical set difference |
| SPEC-03 §Non-goals | No ring 0–3 code and no `useDiffLineTarget` change | `git diff --stat` names no path outside `client/src/app/repos/[repoId]/pulls/[number]/**`, `client/messages/en/brief.json`, and `docs/pr-risk-brief.md` |

## Recommendations not taken

None — all four were accepted.

## Risks & open questions

1. **The bar's own heading is my judgement, not a stated requirement.** SPEC-03 AC-46 lists eight elements for the header row and names no heading for it. The three sibling surfaces all render a `SectionLabel`, so a bar with none would read as unlabelled furniture; I chose a new `riskBrief.barTitle` ("Risk brief") to keep the pattern and to satisfy AC-45's "every fixed label from the catalogue". **Default:** ship the heading. If the feature owner wants a genuinely chrome-free slim row, drop the `<SectionLabel>` and the key — it is a two-line reversal and no test above depends on the heading text.
2. **Q3-B loses a brief's risks on a PR with no derived intent.** With no intent, `IntentCard` returns its `EmptyState` before the risks block, so the risks the brief computed are not shown anywhere. This is the reading AC-47 supports ("inside the Intent card, positioned beneath its in-scope and out-of-scope bullets" presupposes a rendered intent), and SPEC-03 states no criterion for the case, but it is a real information loss relative to the shipped `BriefCard`, which showed risks regardless. **Default:** proceed with Q3-B and pin it with the new `IntentCard` test so the behaviour is deliberate and visible rather than incidental. Worth raising with the feature owner as a possible SPEC-03 amendment; it is not this plan's to decide.
3. **`AC-47`'s anchor can be absent.** The scope-lists block only renders when at least one of `in_scope` / `out_of_scope` is non-empty (`IntentCard.tsx:86`). When both are empty, the risks sub-section renders directly beneath the intent prose. That still satisfies "beneath its bullets" vacuously, but a reviewer may read it as a gap. **Default:** accept it; do not synthesise an empty bullets block to give the risks something to sit under.
4. **The two-column row is a layout change SPEC-03 assumed already existed.** It is the one part of this plan that is not a relocation of shipped markup, and it is the part most likely to look wrong on a real screen — the two cards have very different natural heights, and neither was designed for a ~516px column. **Default:** ship `repeat(auto-fit, minmax(340px, 1fr))` with `alignItems: "start"`. This has no automated check (no visual test exists in `client/`); it needs one look at `http://localhost:3000/repos/<id>/pulls/<n>` before the PR. `pnpm test` passing is not evidence the row looks right.
5. **`client/INSIGHTS.md` (2026-08-17) will name a deleted file.** Its "Where" section points at `BriefCard/BriefCard.tsx`. `AGENTS.md` §Session protocol is append-only — the entry must not be edited or deleted. **Default:** leave it; Step 8 records the new locations in `docs/pr-risk-brief.md`, which is the document `AGENTS.md` §Read when routes people to. **Worth capturing with `engineering-insights`** at the end of the run, for the main session to write: *deleting a component named in an existing INSIGHTS entry's "Where" leaves a dangling pointer that append-only rules forbid fixing in place — the successor entry, or the feature doc, is the only place to record the move.*
6. **`docs/pr-risk-brief.md` §Copy claims the bar's labels come from the `riskBrief` namespace, and after Step 2 one label (the index-incomplete reason) still comes from `blast`.** That is pre-existing (`BriefCard.tsx:39`, `:123-127`) and correct — the reason strings belong to L06 and must not be duplicated. **Default:** note the second namespace in the doc rather than copying the keys.
7. **No `researcher` question and no upstream fact is in play.** Everything asserted here was read from this repo.

## Out of scope

- **Every server-side and contract concern.** `server/src/modules/brief/**`, `server/src/vendor/shared/contracts/review-api.ts` and its client copy, the prompt, the budget, the drop order, the caps, the validation, the redaction, the risk enum, single-flight, and the `pr_brief` table are all untouched (SPEC-03 §Non-goals). If any of them needs changing, that is a new spec, not this plan.
- **`client/src/lib/hooks/brief.ts`.** Verified to need no change; if a step appears to require one, that step has misread AC-49.
- **`useDiffLineTarget`, `fileHeadingId`, `FileCard`, `SmartDiffViewer`, `DiffTab`** and the focus-after-navigation behaviour AC-32 pinned — SPEC-03 §Non-goals names this explicitly. AC-31 and AC-32 keep their existing tests in `client/src/components/diff-viewer/**` and `.../_components/{SmartDiffViewer,DiffTab}/`.
- **A shared `RiskList` component or a `client/src/components/<kebab>/` promotion.** SPEC-03 §Open questions 1 decided against it and `frontend-ui-architecture` §2 forbids a shared home for a hypothetical second consumer. Revisit only when a second consumer actually appears.
- **An `OverviewTab.test.tsx`.** Q5-A. Whoever later needs a composition-level test for this screen picks it up; it would be the first in this route and needs three hook mocks.
- **Visual regression / e2e coverage of the new layout.** `e2e/` flows are not in this plan's file set; `e2e/AGENTS.md` owns that decision.
- **Locales beyond `en`.** `client/messages/` has one locale; adding others is not part of this change.
- **The commit, the `pr-self-review` verdict, the pull request, and any `INSIGHTS.md` append.** The main session does those; `implementer` stops at green gates.

## Handoff

For the architecture and security reviewers, once this lands:

- **New module boundaries:** two new route-local component directories (`BriefBar/`, `ReviewFocusSection/`) and one deleted (`BriefCard/`); one constant promoted from a component directory to the route root (`[number]/constants.ts#RISK_COLOR`), which is the first file at that route root other than `page.tsx`. Worth checking against `frontend-ui-architecture` §1/§2/§8 and against the `../../` import depth the `no-restricted-imports` rule allows.
- **A component gained a rendering responsibility for another feature's data:** `IntentCard` now renders `BriefRisk[]` supplied by its parent. The claim to check is that it computes, fetches, validates and caps none of it — no `usePrBrief`, no `api.`, no slicing.
- **A new composition-level layout primitive:** the `summaryRow` CSS grid in `OverviewTab/styles.ts`, and the fact that either child can render `null`.
- **No new outbound call, no new user input, no new secret, no new migration, no new endpoint, no contract field.** The only new data reaching the screen is two fields already on the wire (`included_inputs`, `dropped_refs`) that were previously fetched and discarded — worth one look at whether either can carry text the redaction pass at `server/src/modules/brief/helpers.ts` does not cover. `included_inputs` is a Zod enum of six literals (`review-api.ts:159-167`) and `dropped_refs` is an integer, so neither is free text; that is the claim to verify, not to assume.
- **Three new user-facing strings**, all fixed labels in `client/messages/en/brief.json`, none interpolating model output. The `droppedLabel` message interpolates an integer.
