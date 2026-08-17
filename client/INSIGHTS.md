# Insights — client

Lessons learned in this package: what broke, why, and how not to repeat it.
Cross-package lessons go in the root `INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

---

## Index

This file is ~14k tokens. **Read this table first, then open only the entries
whose `Scope` intersects the files you are about to change.** Rules and rationale
for the index are in root `INSIGHTS.md` §Index; **appending an entry means
appending its row here in the same edit.**

| Date | Section | Scope | Entry |
|---|---|---|---|
| 2026-08-17 | Patterns | `client/.../VerdictBanner/**`, `client/.../PrBriefSection/**`, `client/.../ReviewRunAccordion/**` | `VerdictBanner` gained three opt-in props only `PrBriefSection` ever passes — next one-caller prop should split the components instead |
| 2026-08-17 | Patterns | `client/.../PrBriefSection/**`, `client/.../ReviewRunAccordion/**`, `review.summary` vs `brief.what`/`why` | `PrBriefSection`'s text is `brief.what + brief.why`, NEVER `review.summary` — two summary-shaped strings answer different questions |
| 2026-08-17 | Patterns | `client/.../BriefBar/**`, `client/src/vendor/shared/contracts/review-api.ts`, `BriefRisk` | `BriefRisk.file_refs` was on the wire since SPEC-02 shipped and was never rendered anywhere — a contract field existing is not evidence a UI reads it |
| 2026-08-17 | Patterns | `specs/**`, `plans/**`, `client/.../BriefBar/**`, `client/.../IntentCard/**` | A shipped placement decision from a `specs/*.md`/`plans/*.md` can be reversed before the doc is ever updated — the markdown is not proof of the current UI |
| 2026-08-17 | Patterns | `client/src/app/**/_components/OverviewTab/**`, records carrying their own `stale` field | A record's own `stale` field is a snapshot from its last fetch — recompute client-side and fold it back in, don't trust it or add a new prop |
| 2026-08-16 | Patterns | `client/src/components/**`, `client/src/app/**/_components/**`, cross-route reuse | The cross-route promotion rule fires on a COMPONENT, not only on a pure helper |
| 2026-08-16 | Patterns | `client/src/components/document-preview/**`, shared components with nullable props | A shared preview component must not assume its caller's `repoId` is non-null, and an optional `onClose` changes every branch's shape, not just the happy one |
| 2026-08-16 | Patterns | `client/src/app/**/_components/**`, `client/src/lib/*.ts`, duplicated helpers | A deliberately duplicated COMPONENT does not exempt the duplicated HELPER beside it — §2 protects a design choice, not a directory |
| 2026-08-16 | Patterns | agent/skill editors, `client/src/lib/repo-context.tsx`, repo-scoped attachments | An agent and a skill have no repository binding, so any "attach a repo artefact" UI must borrow the shell's active repo |
| 2026-08-05 | Works | `client/src/lib/hooks/**`, reorderable lists | A drag-reorderable server list needs an OPTIMISTIC mutation, not local order state |
| 2026-08-03 | Works | `client/src/app/**/page.tsx`, `'use client'` | A `'use client'` page becomes a server wrapper with NO Suspense — every `useSearchParams` route here is dynamic |
| 2026-08-05 | Doesn't | `client/src/app/**/_components/**`, imports | Reaching a route-root `_components/` with `../../../`: `typecheck` passes, only `lint` catches it |
| 2026-08-10 | Patterns | `client/src/**` component props | An OPTIONAL callback prop no caller passes is a dead feature no gate can see |
| 2026-08-10 | Patterns | `client/src/app/**`, query params | "Open it in a new tab" decides state-vs-query-param for you |
| 2026-08-09 | Patterns | `client/src/lib/hooks/**`, query keys | Two panels of one screen reading two query keys go stale ASYMMETRICALLY |
| 2026-08-05 | Patterns | `client/src/components/**`, promotion rule | Promoting a component must move its CONSTANTS too, and the linter will not tell you |
| 2026-08-03 | Patterns | `client/src/app/**/_components/**` | Extracting a page into a View does NOT move the route's shared `constants.ts` / `styles.ts` / `helpers.ts` |
| 2026-08-02 | Patterns | `client/src/**` naming | Casing encodes WHAT a folder is: kebab = module, Pascal = component |
| 2026-08-02 | Patterns | `client/src/components/**` | A component shared by a fetching and a non-fetching caller takes DATA, not an id |
| 2026-08-02 | Patterns | `client/src/components/**` vs `_components/` | Cross-route components go in `src/components/` |
| 2026-08-02 | Patterns | `client/src/app/**`, filters and facets | A facet counter is computed between the filters, never around them |
| 2026-08-02 | Patterns | `client/src/app/**`, filters and facets | Page-wide selection + per-component counts: don't disable the zero option |
| 2026-08-17 | Tools | `client/src/components/diff-viewer/**`, `*.test.tsx` asserting focus | Unlike `scrollIntoView`, jsdom DOES implement `focus()` — no stub needed |
| 2026-08-10 | Tools | `client/src/**/*.test.tsx`, jsdom | jsdom 25 implements no `window.CSS` at all, so `CSS.escape` throws |
| 2026-08-10 | Tools | `client/src/**` effects | An Effect keeping a memoized list in its deps needs an `id:nonce` ref guard |
| 2026-08-11 | Tools | `client/src/**/styles.ts`, CSS custom properties | A CSS custom property that does not exist fails SILENTLY — read `styles.css`, never a neighbouring `styles.ts` |
| 2026-08-09 | Tools | `client/src/**/*.test.tsx` | `userEvent` unmounts a HOVER-gated control before your click lands |
| 2026-08-09 | Tools | `client/src/**/*.test.tsx` | `mock.contexts[0]` is how you assert WHICH element a stubbed DOM method was called on |
| 2026-08-09 | Tools | `client/src/**/*.test.tsx` | jsdom implements NO `Element.prototype.scrollIntoView` |
| 2026-08-05 | Tools | `client/src/vendor/ui/**`, icons | `IconName` is the vendored REGISTRY's key set, not lucide's export list |
| 2026-08-05 | Tools | `client/src/vendor/ui/**`, charts | `@devdigest/ui`'s `Donut` is a MONEY chart, and a mock inherited its `$` |
| 2026-08-03 | Tools | `client/eslint.config.mjs` | `pnpm lint` UNDER-reports deep relative imports: the rule is off in test files |
| 2026-08-03 | Tools | `client/eslint.config.mjs` | `import/no-cycle` makes `eslint .` unusable here (>5 min → 25s without it) |
| 2026-08-02 | Tools | `client/src/components/**`, severity chips | `SeverityBadge compact` renders NO label — icon and count only |
| 2026-08-16 | Errors | `client/messages/**`, `client/src/**` rendering engine output | A message reproducing engine output goes through `t.raw`, not `t()` — `<untrusted …>` throws INVALID_TAG |
| 2026-08-16 | Errors | `client/src/app/**` `?tab=` allowlists, editor tab bars | A duplicated `VALID_TABS` swallows every new tab: the URL changes, the pane does not |
| 2026-08-16 | Errors | `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/**`, new screens | A new screen does not appear in the left panel until it has a row in the vendored `NAV` array |
| 2026-08-11 | Errors | `client/src/app/**`, blast radius | `entry.symbol` is not a unique React key |
| 2026-08-09 | Errors | `client/src/lib/hooks/**` | A `retry: false` query for a resource that does not exist YET caches the 404 forever |
| 2026-08-09 | Errors | `client/src/**/*.test.tsx`, diff viewer | `getByText` normalizes whitespace, so an INDENTED diff line can never be matched by its literal text |
| 2026-08-08 | Errors | `client/package.json`, `client/src/**/*.test.tsx` | `@testing-library/user-event` is NOT installed here, so every interactive test uses `fireEvent` |
| 2026-08-02 | Errors | `client/src/**/styles.ts` | Dropping `border` is NOT enough: `borderColor` and `borderWidth` are shorthands too |
| 2026-08-02 | Errors | `client/messages/**`, i18n imports | Count the `../` for `messages/en/*.json` from the FILE, not from a sibling test |

Section keys as in root `INSIGHTS.md` §Index.

---

## What Works

### 2026-08-05 — A drag-reorderable server list needs an OPTIMISTIC mutation, not local order state

**Pattern:** for a list whose order lives on the server and is edited by dragging,
put the new order into the React Query cache in `onMutate` and render straight from
the query. Keep local state only for the drag gesture itself (which row is held,
which row it is over) — never for the list.

```ts
onMutate: async ({ agentId, skillIds }) => {
  const key = ["agent-skills", agentId];
  await qc.cancelQueries({ queryKey: key });
  const previous = qc.getQueryData<AgentSkillLink[]>(key);
  qc.setQueryData(key, skillIds.map((skill_id, order) => ({ agent_id: agentId, skill_id, order })));
  return { previous };                       // rollback in onError, or the UI
},                                           // shows an order that never saved
```

**Why:** the obvious implementation is `useState(orderedIds)` seeded by
`useEffect(..., [links])`, because dragging "needs" instant local feedback. That is
exactly the CRITICAL "store derived state, then patch it" bug this package already
paid for once in `ConfigTab` — see the 2026-08-03 entry below on `eslint-disable`
directives, and the load-bearing comment in `AgentEditor.tsx` explaining why
`ConfigTab` gets `key={agent.id}` instead of a sync Effect. The upstream lesson
branch's version of this tab reintroduces it verbatim.

An optimistic write gets the same instant feedback with no second source of truth,
so the component needs no `key` either: switching agents cannot leave it stale
because there is nothing to go stale. Two details that make it correct — return the
previous value from `onMutate` and restore it in `onError`, and have the pure
reorder helper return **the same array reference** when nothing moved, so a drag
that ends where it started fires no write at all.

Note this repo has **no** drag-and-drop library (no dnd-kit, no
react-beautiful-dnd); native HTML5 `draggable` + `onDragStart`/`onDragEnter`/
`onDragEnd` is the convention.

**Where:** hook `client/src/lib/hooks/skills.ts` (`useSetAgentSkills`); consumer
`client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx`;
the reference-equality rule is `.../SkillsTab/helpers.ts` (`reorder`), asserted in
`helpers.test.ts` ("returns the SAME array reference when nothing moves").

### 2026-08-03 — A `'use client'` page becomes a server wrapper with NO Suspense, because every `useSearchParams` route here is dynamic

**Pattern:** when you thin a page down to `return <TheView />` and move
`'use client'` into the view, do **not** pre-emptively wrap it in `<Suspense>`.
Check the `pnpm build` route table instead: a route marked `ƒ` (server-rendered
on demand) is never statically prerendered, so `useSearchParams` inside its
client subtree needs no boundary. Only a `○` (static) route would.

**Why:** the well-known Next rule — "`useSearchParams()` should be wrapped in a
suspense boundary" — fires *during static prerendering only*, and it is the
reason to expect this refactor to break. It didn't, for a reason worth writing
down: all three converted screens that call `useSearchParams` sit under a dynamic
segment (`[repoId]`, `[number]`, `[id]`), so Next already renders them on demand.
The one route that IS static, `/`, uses `useRouter` and no search params. Adding
Suspense "to be safe" would have bought nothing and put a loading boundary where
the design has none.

**The trap is that none of the three gates catch this.** `pnpm typecheck`,
`pnpm lint` and `pnpm test` all pass whether or not the boundary is needed —
only `pnpm build` knows, and it is not in the gate list. So after moving a
`'use client'` directive off a page, run `pnpm build` and read the `○`/`ƒ`
column; the build is the only place the RSC boundary is actually decided.

**Where:** the four thinned pages are `client/src/app/page.tsx` (`○`),
`client/src/app/repos/[repoId]/pulls/page.tsx`,
`client/src/app/repos/[repoId]/pulls/[number]/page.tsx` and
`client/src/app/agents/[id]/page.tsx` (all `ƒ`); the views that now carry
`'use client'` are the matching `_components/<Name>/<Name>.tsx`.

## What Doesn't Work

### 2026-08-05 — Reaching a route-root `_components/` from a nested route with `../../../` — `typecheck` passes, only `lint` catches it

**Tried:** importing a shared piece of a route from one of its nested routes the
way the path actually runs — from
`src/app/skills/[id]/_components/SkillEditorView/` up to the route root:

```ts
import { needsVetting, typeColor } from "../../../_components/SkillCard";
import { SKILL_TYPE_VALUES } from "../../../constants";
```

**Failed:** `no-restricted-imports` rejects it — "Deep relative import — use the
'@/' alias instead". The trap is the order the gates fail in: `pnpm typecheck` is
**green** on both lines, so the error only appears when `pnpm lint` runs, which is
easy to leave until last and easy to read as unrelated to the code you just wrote.
Two levels (`../../constants` from a sibling `_components/X/`) is fine; three trips
it, so the same logical import is legal from one depth and illegal from the next
one down.

**Instead:** address route-scoped modules through the alias, spelling out the route:

```ts
import { needsVetting, typeColor } from "@/app/skills/_components/SkillCard";
import { SKILL_TYPE_VALUES } from "@/app/skills/constants";
```

Which also means: when a nested route needs something, that something belongs at
the route root (`app/<route>/constants.ts`) rather than inside a sibling
component's folder — consistent with the 2026-08-03 entry below on a View
extraction not moving the route's shared `constants.ts` / `styles.ts` / `helpers.ts`.
Related: root `INSIGHTS.md` (2026-08-03) records that `pnpm lint` UNDER-reports
these because the rule is switched off in test files, so a green lint is not proof
that a test file is clean.

**Where:** rule at `client/eslint.config.mjs` (`no-restricted-imports`); the two
lines were in
`client/src/app/skills/[id]/_components/SkillEditorView/SkillEditorView.tsx`; the
shared constants live at `client/src/app/skills/constants.ts`.

## Codebase Patterns

### 2026-08-17 — `VerdictBanner` gained THREE opt-in props (`costUsd`/`tokensIn`, `onOpenRun`, and effectively regenerate lives beside it) that only `PrBriefSection` ever passes — a shared component is quietly becoming one caller's private layout

**Rule:** `VerdictBanner.tsx` is used by exactly two callers —
`ReviewRunAccordion` (Agent Runs tab, one banner per expanded run) and
`PrBriefSection` (Overview tab's top section). Across this session,
`PrBriefSection` needed three things `ReviewRunAccordion` never wants: a
cost/tokens line under the score gauge, a "View run details" button beside
the agent-name badge, and (in a sibling change) its own regenerate control.
Each was added as an OPTIONAL prop, gated on the prop being explicitly passed
(`costUsd !== undefined`, `onOpenRun &&`) rather than always rendering — so
`ReviewRunAccordion`'s call site is untouched and all of its tests still pass
unmodified. This is the right call for NOW (each addition is cheap, additive,
and independently gated), but if a FOURTH `PrBriefSection`-only prop shows up,
that is the signal to stop: at that point `VerdictBanner` is no longer "a
verdict banner two screens share," it is "`PrBriefSection`'s layout, with an
escape hatch for `ReviewRunAccordion`'s simpler needs" — and the fix is to
split them, not add a fourth optional prop.

**Where:** `client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/VerdictBanner.tsx`
(`costUsd`, `tokensIn`, `onOpenRun` — all optional, all undefined for
`ReviewRunAccordion.tsx:191-198`, all passed by
`client/.../PrBriefSection/PrBriefSection.tsx`). The regenerate control itself
is NOT a `VerdictBanner` prop — it lives in `PrBriefSection`'s own
`SectionLabel`'s `right` slot instead, specifically so a FOURTH one-caller
prop didn't have to go on `VerdictBanner` — worth remembering as the
alternative to reach for before adding prop number four there.

### 2026-08-17 — `PrBriefSection`'s narrative text is `brief.what + brief.why`, NEVER `review.summary` — two "summary-shaped" strings on this screen answer different questions

**Rule:** The Overview tab's top section (`PrBriefSection.tsx`) shows one
paragraph of prose beside the latest review's verdict/score/findings. There
are TWO candidate sources for that paragraph, and picking the wrong one is an
easy mistake because both are free-text and both plausibly "summarize the
PR": `review.summary` (`server/src/vendor/shared/contracts/findings.ts:125`,
what one agent's run says about ITS OWN findings — the system prompts
literally instruct "use `summary` to say what you checked",
`docs/agent-prompts/security-reviewer.md:84` and three siblings) vs.
`brief.what` + `brief.why` (`PrRiskBriefRecord`, "what this PR changes" /
"why", generated once by the separate `pr_brief` pipeline, independent of any
review ever running). The correct answer here is the LATTER — the feature
owner's explicit call — precisely because it decouples the text from any one
agent's run: the same sentence renders whether zero or five reviews have run,
and the review-derived chrome (verdict badge, findings/blockers count, agent
name, score) is ADDITIVE on top of it, never replacing it. Get this backwards
and the paragraph would silently reword itself every time a different agent
re-runs, and would disappear entirely on a never-reviewed PR — the opposite
of "the text is always there, the review info is what's conditional."

**Where:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefSection/PrBriefSection.tsx`
(`const text = \`${brief.what} ${brief.why}\`;`, passed as `VerdictBanner`'s
`summary` prop — `review.summary` is read nowhere in this file);
`client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:191-198`
(the OTHER `VerdictBanner` caller, on the Agent Runs tab, which correctly
still passes `review.summary` — that card IS about one specific run, so the
same field that would be wrong on Overview is right there). `brief.what`/`why`
moved out of `BriefBar` (`_components/BriefBar/BriefBar.tsx`) in the same
change — rendering them in two places at once was never the intent.

### 2026-08-17 — `BriefRisk.file_refs` was on the wire since SPEC-02 shipped and was never rendered anywhere — a contract field existing is not evidence a UI reads it

**Rule:** `BriefRisk` (`client/src/vendor/shared/contracts/review-api.ts:169-175`)
has carried `file_refs: string[]` and `endpoint_refs: string[]` since SPEC-02
shipped (`d47b0a2`) — every risk the model returns already names the files it's
about. Neither the original `BriefCard` nor its SPEC-03 successor `BriefBar`
ever rendered `file_refs`: both only ever destructured `r.title`,
`r.explanation` and `r.severity` per risk (compare the shipped renders at
`BriefBar.tsx` before this entry's fix, and the deleted `BriefCard.tsx:183-196`
per `plans/2026-08-17-pr-risk-brief-layout.md`'s own inventory table — neither
mentions `file_refs`). A field can ship on a Zod contract, survive two rounds
of client refactors, and still never reach a user, because nothing type-checks
"this field is unread." **Takeaway:** when asked to wire up navigation for a
list that already resembles `BlastRadiusCard`'s callers or `ReviewFocusSection`'s
focus entries, grep the CONTRACT for fields the rendering component doesn't
destructure — `rg -n "file_refs|endpoint_refs" client/src` before this fix
returned only the contract, the vendored copy, and test fixtures, never a
`.tsx` render.

**Where:** `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefBar/BriefBar.tsx`
(now renders each risk's `file_refs` as buttons calling `onOpenCaller(path, 1)`);
`client/src/vendor/shared/contracts/review-api.ts:169-175` (`BriefRisk`, the
source of the two unread arrays); `client/src/components/diff-viewer/useDiffLineTarget.ts`
(`goTo(path, line)` — confirmed safe with a line that has no matching rendered
anchor: it opens the file's card and silently no-ops the scroll, so a
guessed `line: 1` for a ref with no real line number is a legitimate, harmless
fallback, not a hack). `endpoint_refs` is NOT wired to anything — it names an
API endpoint string, not a file, and there is no navigation target for it in
this repo today.

### 2026-08-17 — A shipped placement decision from a `specs/*.md`/`plans/*.md` can be reversed before the doc is ever updated — the markdown is not proof of the current UI

**Rule:** `specs/2026-08-17-pr-risk-brief-layout.md` (SPEC-03, AC-47) and its
plan both state, as a deliberate decision (Q3-B), that the PR Risk Brief's
risks list renders inside `IntentCard`, not `BriefBar` — accepting that a PR
with no derived intent shows no risks at all. The feature owner reversed this
in the very next session: risks now render inside `BriefBar` instead, which
also undoes Q3-B's information-loss tradeoff since `BriefBar` has no
"intentless" branch that could hide them. Neither the spec nor the plan file
was updated in that pass (an inline code-only fix was explicitly requested) —
so both documents describe a layout the shipped UI no longer has, with no
"superseded" marker anywhere in them, because neither is the append-only
`INSIGHTS.md` convention. **Takeaway:** when a `specs/**`/`plans/**` file
states an AC about component placement, verify it against the actual
component tree (`rg` the prop, don't trust the doc) before treating the
markdown as ground truth — it can go stale the moment a feature owner changes
their mind, with nothing else in the repo forced to follow.

**Where:** `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefBar/BriefBar.tsx`
(now reads `brief.risks` directly, no new prop — it already receives the full
`PrRiskBriefRecord`); `.../IntentCard/IntentCard.tsx` (the `risks` prop and its
rendering block were removed entirely); `specs/2026-08-17-pr-risk-brief-layout.md`
AC-47 and `plans/2026-08-17-pr-risk-brief-layout.md` Steps 2 & 4 (describe the
now-superseded placement, unedited).

### 2026-08-17 — A record's own `stale` field is a snapshot from its LAST fetch — a sibling query key changing since then needs a client-side recompute too, folded into the record rather than a new prop

**Rule:** when a stored record already carries its own `stale: boolean` (as
`PrRiskBriefRecord` does, computed server-side from the PR's head commit and
the latest review at READ time), do not treat that field as sufficient once it
sits in the query cache. It is correct only until something else in the
cache — the PR's `headSha`, a completed review — changes without a refetch of
THIS record's own query key. That is exactly the 2026-08-09 asymmetric-staleness
trap below, one layer up: `PrIntentRecord` has the identical shape and
`OverviewTab.tsx` already recomputes its `stale` prop from `intent.head_sha`
vs. the PR's current `headSha` rather than trusting `intent.stale` — the brief
needed the same treatment, but the card's prop list
(`plans/2026-08-16-pr-why-risk-brief.md` Step 11: `brief`, `loading`,
`generating`, `result`, `onGenerate`, `onOpenFocus`) has no separate `stale`
prop the way `IntentCard` does. The fix is to fold the recomputed value INTO
the record before passing it down — `{ ...brief, stale: brief.stale ||
(headSha mismatch) }` — rather than adding a prop the plan's signature didn't
call for.

**Where:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
(`briefStale`/`briefWithStale`, alongside the pre-existing `stale` for intent);
`client/src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/BriefCard.tsx`
(reads `brief.stale` only, never re-derives it itself — the recompute is the
screen's job, per the rule below).

### 2026-08-16 — The cross-route promotion rule fires on a COMPONENT, not only on a pure helper

**Rule:** `client/src/components/**` vs `_components/**` (2026-08-02, "Cross-route
components go in `src/components/`") is not limited to pure functions. When a
route-local component under some route's `_components/` gains a second consumer
on a *different* route, move the whole folder — component, `styles.ts`,
`index.ts` — to `client/src/components/<kebab-name>/` in that same commit, same
as the promotion rule already requires for a duplicated helper
(2026-08-05, "Promoting a component must move its CONSTANTS too"). Casing stays
the existing convention: kebab folder, PascalCase file
(`client/src/components/agent-card/AgentCard.tsx`,
`client/src/components/repo-not-found/RepoNotFound.tsx`).

**Why:** `DocumentPreview` was built for the standalone Project Context page
(`client/src/app/repos/[repoId]/context/_components/DocumentPreview/`, SPEC-01
AC-12) and stayed route-local because it had exactly one caller. Adding the
"Preview" control to the agent and skill editors' Context tabs in one change
gave it a second and a third caller on two unrelated routes in the same commit —
past the promotion trigger before the component had even shipped once with a
single consumer. Leaving it under `context/_components/` would have meant
`../../../../repos/[repoId]/context/_components/DocumentPreview` reaching across
route boundaries, exactly the smell `client/eslint.config.mjs`'s deep-relative-import
rule exists to catch (2026-08-05, "`pnpm lint` UNDER-reports deep relative
imports... rule is off in test files" — production imports are still caught).

**Where:** `client/src/components/document-preview/{DocumentPreview.tsx,styles.ts,index.ts}`,
imported by `client/src/app/repos/[repoId]/context/_components/ContextView/ContextView.tsx:24`,
`client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx:23`
and `client/src/app/skills/[id]/_components/ContextTab/ContextTab.tsx:23`.

### 2026-08-16 — A shared preview component must not assume its caller's `repoId` is non-null, and an optional `onClose` changes every branch's shape, not just the happy one

**Rule:** when promoting a component whose prop originated from one page's
guaranteed-non-null value (`ContextView`'s `repoId` comes from `useParams()`,
always a `string`), widen the prop type to match the *weakest* caller
(`useActiveRepo()` returns `repoId: string | null`), not the strongest. And when
adding an optional callback like `onClose` so a component can render as either a
dismissible panel or a permanently-docked pane, give every early-return branch
(loading, error, empty) somewhere for that control to live — not only the
success branch — or the panel becomes uncloseable for as long as the fetch is
slow or fails.

**Why:** `DocumentPreview`'s loading and error branches originally returned a
bare `<Skeleton>` / `<ErrorState>` with no head row at all, because the one
caller that existed (`ContextView`) never needed to close it — the pane was
permanently docked beside the document list. The two new callers
(agent/skill `ContextTab`) open it as a dismissible panel from a "Preview"
button, so a slow or failing fetch without a close affordance would trap the
user until the request settled. Restructuring those two branches to share the
same head-row shape as the success branch was not scope creep on top of adding
`onClose` — it was the minimum to make `onClose` actually work in every state,
and it left `ContextView`'s rendering unchanged in substance (still a path row
above the body, just present a beat earlier).

**Where:** `client/src/components/document-preview/DocumentPreview.tsx` — the
`repoId` prop is typed `string | null | undefined`; the `onClose` prop is
optional and rendered as a close button in the loading, error and success
returns alike.

### 2026-08-16 — A deliberately duplicated COMPONENT does not exempt the duplicated HELPER beside it — §2 protects a design choice, not a directory

**Rule:** when a plan pre-authorises duplication under `frontend-ui-architecture`
§2 ("two copies are correct, the third is when to extract"), that authorisation
covers only the files that genuinely diverge. A pure-helper module copied
byte-for-byte alongside them is still a §1 placement violation
(`SKILL.md:38` — "Pure helper used by 2+ → shared `lib/<name>.ts`") and §2 itself
requires the move "in the same commit that adds the second use"
(`SKILL.md:58`).

**Why:** §2 exists to stop you guessing at an abstraction before you have seen
enough consumers to know its shape. A file with **zero** divergence between
copies has no shape left to guess at, so the rule it is usually cited to defend
does not apply to it. The two `ContextTab.tsx` components here really do differ —
different props (`agentId` vs `skillId`), different prose, different mutation
hooks — and keeping them separate is right. Their `helpers.ts` neighbours were
identical, confirmed by `md5 -q` returning the same digest for both. The trap is
that the authorisation is written per *feature* while the rule applies per
*file*, so a reviewer who accepts "this duplication is deliberate" once tends to
wave through the whole folder — and no gate catches it, because `pnpm arch`
cruises `server/` and `reviewer-core/` only and has no visibility into `client/`
duplication at all.

**Where:** `client/src/lib/context-docs.ts` (the promoted module, holding
`orderedPaths`, `reorder`, `filterByPath`, `missingPaths`), imported by
`client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx:30`
and `client/src/app/skills/[id]/_components/ContextTab/ContextTab.tsx:29`. Cheap
check when two sibling features ship together:
`md5 -q <a>/helpers.ts <b>/helpers.ts` — identical digests mean promote now, not
at the third consumer.

### 2026-08-16 — An agent and a skill have no repository binding, so any "attach a repo artefact" UI must borrow the shell's active repo

**Rule:** a UI that attaches a repository-scoped artefact to an `Agent` or a
`Skill` has no repository of its own to work from, and must read the shell's
currently selected repo via `useActiveRepo()`
(`client/src/lib/repo-context.tsx:58`) and name it on screen so the user knows
which mirror they are browsing. What gets persisted is the bare repo-relative
path; it is matched against the pull request's own repository at run time.

**Why:** `Agent` is workspace-scoped and carries no `repo_id`
(`client/src/vendor/shared/contracts/knowledge.ts:327`), while a context document
is identified by a path inside one repository's mirror. Nothing in the data model
closes that gap, so every such screen has to close it in the UI — and the choice
is invisible in the contracts, which is why it is worth writing down rather than
rediscovering. The consequence to keep in mind: the same attachment can resolve
in one repository and come back `missing` in another, which is a correct outcome
and not a bug.

**Where:** both Context tabs —
`client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx:39`
and `client/src/app/skills/[id]/_components/ContextTab/ContextTab.tsx`; the
active-repo source at `client/src/lib/repo-context.tsx:58`.

### 2026-08-10 — An OPTIONAL callback prop that no caller passes is a dead feature no gate can see — grep the call sites, not the type

**Rule:** when a feature's interactivity arrives as an optional callback on an
options object (`DiffFindingsApi.onFindingClick`, `commenting.onSubmit`, …),
finishing the component is not finishing the feature. Grep for a **caller that
actually supplies it** before calling the work done:

```sh
rg -n 'onFindingClick' client/src   # definition + branch + ... a provider?
```

If every hit is a type, a prop-drill or a `?.` guard, the feature does not exist
at runtime.

**Why:** L04 shipped the entire chip→finding chain except its first link.
`findings.ts` declared `onFindingClick?`, `FileCard` drilled it to `CodeLine`,
and `CodeLine` branched on it correctly — rendering a `<button>` when present and
a bare `SeverityBadge` when not. `SmartDiffViewer` then built
`const findingsApi: DiffFindingsApi = { findings }`. So every severity chip in
the Smart Diff was decoration, and the mentor's review is what found it, because
**nothing mechanical could**: the prop is optional, so `pnpm typecheck` is green;
the branch is exercised by the `else` arm, so coverage is green; and the existing
tests asserted `screen.getByText("Critical")` — which a non-interactive badge
satisfies exactly as well as a button.

The lesson generalizes past this prop. An optional callback is the one API shape
where "wired" and "unwired" are both type-correct, so the *only* proof is a test
that asserts the interaction, not the render. Two assertions, cheap, and they
pin both directions:

```ts
await user.click(screen.getByRole("button", { name: /Go to the finding:/ }));
expect(onFindingClick).toHaveBeenCalledWith(target);          // wired
expect(screen.queryByRole("button", { name: /Go to the finding:/ })).toBeNull(); // omitted ⇒ not a button
```

Also worth carrying: the acceptance criterion that *looked* like it covered this
did not. `specs/l04-smart-diff.md` criterion 5 is the file-level badge → line
jump, and it reads like "clicking things in the Smart Diff works". The badge and
the chip are two different targets — inside the diff vs. out to the findings
screen — and one passing does not imply the other.

**Where:** the optional prop is
`client/src/components/diff-viewer/findings.ts` (`DiffFindingsApi.onFindingClick`);
the branch that was never taken is
`client/src/components/diff-viewer/CodeLine/CodeLine.tsx` (the `anchored.map`);
the caller that omitted it was
`client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`
(`findingsApi`); the two tests that now pin it are in
`.../SmartDiffViewer/SmartDiffViewer.test.tsx`; the added criterion is
`specs/l04-smart-diff.md` §Acceptance 12.

### 2026-08-10 — "Open it in a new tab" decides state-vs-query-param for you, and it removes work rather than adding it

**Rule:** before choosing where a navigation target lives — React state or a
search param — settle *how* the reader gets there. A same-tab jump can use
state; anything that opens a new browser tab must use a param, because the new
tab is a cold load sharing no React tree with the one it came from. Do not reach
for `postMessage`, `localStorage` or a store to bridge the two.

**Why:** the chip → finding-card jump was built first as in-place navigation and
then changed to open a new tab, and the second version is strictly simpler:

| | same tab (state target) | new tab (`?finding=<id>`) |
|---|---|---|
| target survives | one React tree | any cold load, reload, shared link |
| repeat click | needs a nonce, so the Effect dep changes | nothing — one load, one jump |
| `?severity=` filter | must be **widened in the same URL write**, or the reader lands on a tab whose card is filtered out | fresh tab has no selection, so nothing filters |

That middle row is the trap worth remembering on its own: two `setParam` calls in
one handler do **not** compose. Each builds `new URLSearchParams(search.toString())`
from the `search` captured in the render that created the closure, so both start
from the pre-click URL and the second `router.replace` wins outright. One of the
two params simply never appears, and which one depends on call order — it reads
like the router rejected the first write. A same-tab version of this feature needs
a `setParams({ tab, severity })` multi-write for exactly that reason; the
new-tab version needs neither the multi-write nor the widening, because a fresh
URL carries no filter to fight.

Note the opposite precedent in the same screen and why it still stands: the
Timeline → run-accordion jump keeps its target in state (`targetRunId` /
`targetNonce`) because it navigates **in place**. The rule is not "params are
better" — it is that the target's lifetime has to match the navigation's.

**Where:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.tsx`
(`goToFinding` → `window.open`, and `search.get(FINDING_PARAM)` read back on
load); the param name is `.../PrDetailView/constants.ts` (`FINDING_PARAM`); the
in-place counter-example is `.../ReviewRunAccordion/ReviewRunAccordion.tsx`
(`targetRunId`); the severity helpers a same-tab version would have needed are
`.../SeverityFilterBar` (`toggleSeverity`, `serializeSeverityParam`).

### 2026-08-09 — Two panels of one screen reading two query keys go stale ASYMMETRICALLY — and the hook's docblock claimed a mitigation that was never built

**Rule:** when one visual pairing is fed by two query keys, the invalidation list
is a property of the **screen**, not of either hook. Smart Diff's "Files changed"
tab renders a per-file `N findings` badge next to per-line severity chips: the
badge counts `finding_lines` from `["smart-diff", prId]`, the chips come from
`usePrReviews` → `["reviews", prId]`. Every mutation that invalidates one must
invalidate the other, or half the screen refreshes and half does not.

**Why:** the failure is invisible in isolation and looks like a caching "feel"
problem rather than a bug. `hooks/reviews.ts` had four `["reviews", prId]`
invalidations — run finished, run deleted, review deleted, finding
accepted/dismissed — and none touched `["smart-diff", prId]`. With
`staleTime: 30_000` and `refetchOnWindowFocus: false`
(`src/lib/providers.tsx:28-29`), a completed Run Review repainted the chips while
the badges beside them kept the *previous* run's counts, for up to 30s, on the
same row. Nothing errors; the two numbers just disagree.

The part worth remembering is how it survived review. `hooks/smart-diff.ts`
carried a docblock asserting that "the consumer takes badge and chip data from
`usePrReviews` and uses this response for grouping and ordering only" — a real,
correct mitigation, written in the plan, and **never implemented**. The consumer
reads `entry.finding_lines.length` (`SmartDiffViewer.tsx:138`). So the code
documented itself as safe while being wrong, and every subsequent reader of that
hook was told the hazard was already handled.

**A docblock describing a mitigation is not evidence the mitigation exists.**
When a comment says "X is safe because the consumer does Y", grep for Y. If a
plan prescribes a mitigation and the implementation takes a different route, the
docblock is the first thing that goes stale and the last thing anyone rereads.

**Where:** the four paired invalidations are
`src/lib/hooks/reviews.ts:69-70`, `:95-96`, `:145,149`, `:175-176`; the corrected
docblock is `src/lib/hooks/smart-diff.ts`; the consumer that makes
`finding_lines` load-bearing is
`src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx:138`;
the defaults that set the staleness window are `src/lib/providers.tsx:28-29`.
Anticipated as Risk 5 of `specs/l04-smart-diff.md`, which prescribed exactly this
fix for exactly this condition — and the condition arrived in the same change.

### 2026-08-05 — Promoting a component to `src/components/` must move its CONSTANTS too, and the linter will not tell you

**Rule:** when a route-local component becomes shared, the literals it reads move
with it. `BodyEditor` went from
`src/app/skills/[id]/_components/BodyEditor/` to `src/components/body-editor/` so the
conventions extractor's create-skill modal could reuse it — and its
`CHARS_PER_TOKEN` / `TOKEN_ESTIMATE_DEBOUNCE_MS` had to move from
`src/app/skills/constants.ts` into `src/components/body-editor/constants.ts` in the
same step. A shared component that imports `@/app/<route>/constants` has the
dependency arrow backwards: the route now depends on the component AND the component
on the route.

**Why:** nothing catches this. `pnpm typecheck` is happy — `@/app/skills/constants`
resolves fine from anywhere. And `import/no-restricted-paths`
(`eslint.config.mjs:42-79`) only names `agents`, `repos`, `settings` and
`onboarding` as zones; **`skills` is not in the list**, so ESLint would not have
flagged `src/app/repos/**` importing `src/app/skills/**` either. Both gates pass on
the wrong layout, which is exactly why the rule has to be remembered rather than
enforced.

Leave a pointer where the constants used to be rather than deleting the lines
silently — the next reader of `app/skills/constants.ts` is looking for
`CHARS_PER_TOKEN` and needs to know it moved, not that it vanished.

Note the i18n namespace does NOT have to move: `BodyEditor` still calls
`useTranslations("skills")` for `editor.unsaved` / `editor.tokenEstimate`, and that
is correct — next-intl merges every namespace globally, and the strings genuinely
describe a *skill body*, whichever route is editing one.

**Where:** `src/components/body-editor/{BodyEditor.tsx,constants.ts,helpers.ts}`; the
pointer comment is at `src/app/skills/constants.ts`; the consumers are
`src/app/skills/[id]/_components/ConfigTab/ConfigTab.tsx:18` and
`src/app/repos/[repoId]/conventions/_components/CreateSkillFromConventionsModal/`.
Reinforces the 2026-08-02 entry below (cross-route components live in
`src/components/`).

### 2026-08-03 — Extracting a page into a View does NOT move the route's shared `constants.ts` / `styles.ts` / `helpers.ts`

**Rule:** when you thin `<route>/page.tsx` into
`<route>/_components/<Name>View/`, leave any `constants.ts` / `styles.ts` /
`helpers.ts` that already sits **at the route level** exactly where it is. Give
the new View its own narrow pair for what only it uses. Two files named
`constants.ts` at two depths is the correct outcome, not duplication to tidy up.

**Why:** the two extractions in this repo look alike and are not. `agents/` had
nothing at the route level, so `AgentsListView/` owns its `constants.ts`
(`TEMPLATES`) and `helpers.ts` (`filterAgents`) outright. `pulls/` is the other
shape: its route-level `constants.ts`, `styles.ts` and `helpers.ts` are imported
by **three** sibling components as `../../constants` — so the route folder *is*
their nearest shared ancestor. Dragging them into `_components/PullsView/` would
have forced `PRRow`, `FilterBar` and `FindingsCell` to reach sideways into
another `_components/` subtree, which is precisely the smell
`frontend-ui-architecture` §3 names ("reaching across two sibling trees is the
signal you picked the wrong home"). The typecheck would still have been green.

So the split is by consumer count, not by nesting level: shared by the route →
route level; used only by the View → beside the View.

**Where:** shared at `src/app/repos/[repoId]/pulls/constants.ts`, `styles.ts`,
`helpers.ts`; consumers `_components/PRRow/PRRow.tsx:9,11,13`,
`_components/FilterBar/FilterBar.tsx:7-8`,
`_components/FindingsCell/FindingsCell.tsx:16`. View-local at
`_components/PullsView/constants.ts` (`OPEN_STATUSES`, `DEFAULT_STATUS`) and
`_components/PullsView/helpers.ts` (`filterAndSortPulls`, `countOpen`,
`countNeedsReview`); `PullsView.tsx:19-24` imports from both depths. The
contrasting case is `src/app/agents/_components/AgentsListView/`.

### 2026-08-02 — Casing encodes WHAT a folder is: kebab = module, Pascal = component

**Rule:** there is one naming rule in this package, not two competing ones.
kebab-case names a **module or segment** — something you import *from*, or a bag
of things. PascalCase names a **component** — a folder that is one, or a file
that exports one.

| Kind | Case | Examples |
|---|---|---|
| Route segment (becomes a URL) | lowercase | `repos/`, `pulls/`, `[repoId]` |
| Module (imported as `@/components/x`) | kebab | `diff-viewer/`, `app-shell/`, `findings-hover-card/` |
| Segment inside a module/route | kebab | `_components/`, `hooks/`, `primitives/` |
| Folder that IS one component | Pascal | `FindingsPanel/`, `FileCard/`, `AgentEditor/` |
| File exporting a component | Pascal | `AppShell.tsx`, `SeverityBadges.tsx` |
| Everything else | lowercase | `helpers.ts`, `constants.ts`, `styles.ts`, `github-urls.ts` |

**Why:** stated as "`src/components/` is kebab, `_components/` is Pascal" it
reads like an arbitrary split you must memorize per location, and invites a
"let's unify it" refactor. It isn't a split — those two compare different
levels. `diff-viewer/` is kebab because it is a module; the component folders
*inside* it (`FileCard/`, `CodeLine/`, `DiffViewer/`) are Pascal, exactly like
`_components/FindingsPanel/`. Verified mechanically at the time of writing: 39
PascalCase component dirs, 7 kebab modules under `src/components/`, 70
PascalCase `.tsx` files, and **zero** violations. The only nested lowercase dir
is `components/app-shell/hooks` — a segment, so also per the rule.

Cost of "unifying" to all-kebab, for the record: 39 folder renames, ~70 file
renames if applied consistently, and it buys nothing — JSX tags stay
`<FindingsPanel />`, so mixed casing does not disappear, it just moves. It also
cannot reach `src/vendor/ui/` (PascalCase files, do-not-refactor), so the result
would be *less* uniform than today.

**Known exception:** `lib/providers.tsx`, `lib/theme.tsx`, `lib/toast.tsx`,
`lib/repo-context.tsx` export provider components but are lowercase. Intentional
— `lib/` is infrastructure; the Pascal rule applies inside `components/` and
`_components/` only.

**Where:** `src/components/` (7 modules), `src/app/**/_components/` (39
component dirs), `src/lib/` (the exception). To re-verify:
`find app components -type d | grep -E '/[A-Z][A-Za-z]*$' | wc -l`.

### 2026-08-02 — A component shared by a fetching and a non-fetching caller takes DATA, not an id

**Rule:** when one presentational component serves two screens that source the
same data differently, give it resolved data plus `loading`, and hand the caller
an `onOpenChange` (or equivalent) to gate its own request. Do not push the query
inside and pass it an id.

**Why:** `FindingsHoverCard` renders on the PR list, which holds only counts and
must fetch, and on the Review Runs header, where `review.findings` is already in
memory. The tempting shape — pass `prId`, call `usePrReviews` inside — forces
the accordion to refetch over the network what it is already holding, and makes
the "don't fetch until a hover commits" rule the card's problem instead of the
one caller that has it. With the split, `FindingsCell` keeps
`usePrReviews(open ? pr.id : null)` and the accordion passes an array; the card
knows nothing about either.

**Where:** `src/components/findings-hover-card/FindingsHoverCard.tsx`
(`findings` / `loading` / `onOpenChange` props); the two callers are
`src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.tsx` and
`.../pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx`.

### 2026-08-02 — Cross-route components go in `src/components/`, not a route's `_components/`

**Rule:** a component used by two different routes belongs in
`src/components/<kebab-case>/`, beside `app-shell` and `diff-viewer`.
`src/app/**/_components/<Name>/` is for ONE route's own logic, and importing
across two `_components/` trees is the signal you have picked the wrong home.

**Why:** the findings hover card is rendered by the PR list
(`pulls/_components/`) and the PR detail page (`pulls/[number]/_components/`).
Reaching from the second into the first would have worked — `pulls/` is a common
ancestor — and would have left a shared component named as if it belonged to the
list. Note the two naming conventions differ and both are load-bearing:
`src/components/` dirs are kebab-case, `_components/` dirs are PascalCase.

**Where:** `src/components/findings-hover-card/`; the convention is stated for
`_components/` in `client/AGENTS.md` but not for the shared case.

**Superseded by:** 2026-08-02 — the placement rule stands, but the naming note
("the two naming conventions differ and both are load-bearing") compares two
different levels and reads as a conflict. There is one rule: kebab = module,
Pascal = component. See the entry at the top of this section.

### 2026-08-02 — A facet counter is computed between the filters, never around them

**Rule:** when a toolbar shows counts next to a filter (the severity chips in
`FindingsPanel`), compute them AFTER every OTHER filter has been applied and
BEFORE the one they belong to. The invariant to hold: a chip's number equals the
number of rows you get by selecting that chip alone.

**Why:** the two obvious alternatives both produce a bar that lies. Count the
raw list and "hide low confidence" leaves a chip reading `2` above a single
visible row. Count the fully-filtered list and the chips renumber themselves as
you click them — selecting CRITICAL drops WARNING to `0`, which reads as "there
are no warnings" rather than "you filtered them out". The pipeline is therefore
`byConfidence` → `countBySeverity` → `visibleFindings`, and it is asserted
directly rather than left as a comment.

**Where:** `src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts`
(three exported steps) and `FindingsPanel.tsx:57-60` (the order they run in);
the guard is `FindingsPanel.test.tsx` — "counts respect hide-low-confidence but
not the severity selection".

### 2026-08-02 — Page-wide selection + per-component counts: don't disable the zero option

**Rule:** when one selection drives several component instances that each render
their OWN counts, a zero count in one instance must NOT disable the control. Dim
it, keep it clickable.

**Why:** the severity chips count per review run, but `?severity=` is a single
page-level selection shared by every accordion. A run with zero warnings sits
directly above one with three, so disabling WARNING in the first would block a
filter that is meaningful in the second — and the user has no way to know which
accordion to scroll to in order to find an enabled copy of the same chip.

**Where:** `.../_components/SeverityFilterBar/styles.ts` (`s.chip(empty)` — only
opacity, no `pointerEvents`); selection owner is
`.../pulls/[number]/page.tsx` (`parseSeverityParam` on `?severity=`), drilled
through `FindingsTab` → `ReviewRunAccordion` → `FindingsPanel`.

**Superseded by:** 2026-08-03 — the rule and the drill path are unchanged, but
the address moved: the page is now an 8-line wrapper and the selection owner is
`.../pulls/[number]/_components/PrDetailView/PrDetailView.tsx`
(`severities` / `onToggleSeverity`).

## Tool & Library Notes

### 2026-08-17 — Unlike `scrollIntoView`, jsdom DOES implement `HTMLElement.prototype.focus()` — no stub needed to assert focus landed

**Quirk:** `components/diff-viewer/useDiffLineTarget.ts`'s post-navigation
Effect calls both `scrollIntoView` and `focus({ preventScroll: true })` on two
different elements. `scrollIntoView` does not exist in jsdom and must be
stubbed with `vi.fn()` in every test that exercises the Effect (see the
`scrollIntoView` entry below) — but `focus()` is real DOM behaviour jsdom
already implements, including moving `document.activeElement`. A test can
assert `document.activeElement?.id === fileHeadingId(path)` directly, with no
stub, no `mock.contexts[0]` indirection. Reaching for a focus stub by analogy
with the `scrollIntoView` gap is wasted effort.

**Where:** `client/src/components/diff-viewer/useDiffLineTarget.ts:46-55`;
`DiffTab.test.tsx` and `SmartDiffViewer.test.tsx`'s focus assertions
(`plans/2026-08-16-pr-why-risk-brief.md` Step 10).

### 2026-08-10 — jsdom 25 implements no `window.CSS` at all, so `CSS.escape` throws — do not reach for it when building a selector

**Quirk:** `CSS.escape(id)` is the textbook way to interpolate a value into a
`querySelector`, and under this repo's test environment it is a `ReferenceError`.
jsdom does not ship the `CSS` interface:

```sh
node -e "const {JSDOM}=require('jsdom'); const d=new JSDOM('<div></div>');
         console.log(typeof d.window.CSS)"   # → undefined  (jsdom 25.0.1)
```

The failure mode is the same trap as `scrollIntoView` (entry below): production
code is correct, the test dies naming a DOM global, and it reads like a broken
environment rather than a line you wrote. Worse than `scrollIntoView`, in fact —
there is no obvious local stub, because escaping is *logic*, not layout, so
stubbing it with `vi.fn()` would silently change what the selector matches.

**Workaround:** don't escape — narrow the query instead. Hold a ref to the
container and look up the attribute inside it:

```ts
const listRef = React.useRef<HTMLDivElement | null>(null);
listRef.current?.querySelector(`[data-finding-id="${id}"]`)?.scrollIntoView(…);
```

Scoping to a ref is better than escaping anyway, for a reason unrelated to jsdom:
the PR page mounts several `FindingsPanel`s at once (one per review run), so a
`document`-wide query would happily walk into a sibling run's cards. The values
interpolated here are DB uuids, and an attribute selector inside a ref is not a
place a path or a title should ever be substituted — if that ever changes, the
answer is a ref map, not `CSS.escape`.

**Where:** the scoped lookup is
`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
(the navigation Effect, plus `ref={listRef}` on the list); the attribute it reads
is set by `.../FindingCard/FindingCard.tsx` (`data-finding-id`). Upstream:
`https://github.com/jsdom/jsdom/issues/1550`.

### 2026-08-10 — An Effect that must keep a memoized list in its deps needs an `id:nonce` ref guard, or every unrelated mutation re-fires it

**Quirk:** "scroll to X once, when asked" and "re-run when the list changes" pull
in opposite directions, and the React lint rule only enforces one of them. The
navigation Effect in `FindingsPanel` genuinely needs `shown` as a dependency —
when the target is hidden by the hide-low-confidence toggle it lifts the toggle
and relies on the re-run with the new `shown` to finish the jump. But `shown` is
`useMemo(…, [confident, severities])` over the `findings` prop, and
`useFindingAction` invalidates `["reviews", prId]`, so **every accept/dismiss
hands down a fresh `findings` array** and re-fires the Effect. The reader accepts
some other finding halfway down the list and the viewport yanks back to whatever
they navigated to earlier.

Dropping `shown` from the deps is the tempting fix and it is wrong twice: it lies
to `react-hooks/exhaustive-deps`, and it breaks the toggle retry that is the
reason the dep is there.

**Workaround:** guard on the *instruction*, not the data — a ref holding the
`id:nonce` already acted on:

```ts
const jumped = React.useRef<string | null>(null);
// …
const key = `${targetFindingId}:${targetFindingNonce}`;
if (jumped.current === key) return;
const idx = shown.findIndex((f) => f.id === targetFindingId);
if (idx === -1) { setHideLow(false); return; }   // NOT recorded — this pass did not jump
jumped.current = key;
```

The asymmetry is the whole trick: the early `return` for "filtered out" must
**not** record the key, so the retry after `setHideLow(false)` still runs, while
the successful jump does record it and every later `shown` identity change is a
no-op. One jump per click, and the caller's nonce is what makes the next click a
new instruction.

Note this is not the same thing as the `seq`/nonce in `SmartDiffViewer` or
`targetNonce` in `ReviewRunAccordion` — those exist to make a repeat click *fire*.
This ref exists to stop unrelated re-renders from firing. A feature that jumps
somewhere generally needs both.

**Where:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
(`jumped`, and the Effect's dep array ending in `shown`); the invalidation that
supplies the fresh array is `client/src/lib/hooks/reviews.ts` (`useFindingAction`);
the nonces that do the opposite job are `.../SmartDiffViewer/SmartDiffViewer.tsx`
(`ScrollTarget.seq`) and `.../ReviewRunAccordion/ReviewRunAccordion.tsx`
(`targetNonce`).

### 2026-08-11 — A CSS custom property that does not exist fails SILENTLY, and `IntentCard/styles.ts` already ships three of them — read `styles.css`, never a neighbouring `styles.ts`

**Quirk:** `color: "var(--text-tertiary)"` typechecks, lints, renders, and passes
every test — and does nothing, because `--text-tertiary` is **not defined**. The
design system declares `--text-primary`, `--text-secondary` and `--text-muted`
only (`src/vendor/ui/styles.css:15-17`, mirrored for light at `:55-57`). The
element silently inherits its parent's colour, which is close enough that nobody
notices in review.

Three more that plausible names get wrong: there is **no `--danger`/`--danger-bg`**
(the danger tokens are `--crit` / `--crit-bg`), **no `--bg-subtle`** (the raised
surfaces are `--bg-surface`, `--bg-elevated`, `--bg-hover`), and `--font-mono`
**does** exist (`:114`) so the usual `"var(--font-mono, ui-monospace), monospace"`
fallback chain is noise here.

This is the same class as the 2026-08-05 `IconName` entry below — read the
registry, not the docs and not a sibling — except worse in one way: a wrong
`IconName` is a typecheck error with a 64-name union in the message, while a wrong
CSS variable has **no gate at all**. Nothing in `pnpm typecheck`, `pnpm lint` or
`pnpm test` can see it, so it has to be checked by hand.

**Workaround:** grep the token block before writing a `styles.ts`, and do not copy
a colour from an adjacent component's styles:

```sh
grep -nE '^\s+--' client/src/vendor/ui/styles.css | sed -n '1,60p'
```

`IntentCard/styles.ts` is specifically the wrong file to copy from — it uses
`--text-tertiary` in `listTitle`, `meta` and `nodeFile`-equivalent positions.
Matching it visually means using `--text-muted`, which is what those labels
render as anyway. Left as-is rather than fixed as a drive-by; a deliberate sweep
is its own task.

**Where:** the token blocks are `src/vendor/ui/styles.css:10-45` (dark) and
`:49-80` (light), `--font-mono` at `:114`; the file carrying the undefined token
is `src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/styles.ts`; the
new file that uses only defined tokens is
`.../_components/BlastRadiusCard/styles.ts`, with the danger pair named in
`.../BlastRadiusCard/constants.ts` (`STATE_BADGE`). Related: the `IconName`
registry entry (2026-08-05) below — `Radar` is **not** registered, so a
blast-radius card icon has to be one of the ~90 keys that are (`Workflow` here).

### 2026-08-09 — `userEvent` unmounts a HOVER-gated control before your click lands, and the symptom is a silent no-op

**Quirk:** every `@testing-library/user-event` API call re-enters the pointer,
which dispatches `mouseout` on the *previous* target with `relatedTarget: null`.
React reads a null `relatedTarget` as "the pointer left this element", so a
control rendered behind `{hover && <button/>}` unmounts between your hover and
your click. `user.click(btn)` then dispatches at a detached node: no error, no
warning, the handler simply never runs and the assertion fails several lines
later on a state that never changed. A real pointer never does this, because it
stays inside the row.

Instrumenting it is the only way to see it — `btn.isConnected` is `false` by the
time the click is delivered.

**Workaround:** drop to `fireEvent` for exactly the hover-and-click step, supply
the `relatedTarget` the real browser would, and keep `userEvent` for everything
downstream:

```ts
fireEvent.mouseOver(add, { relatedTarget: line });  // userEvent's pointer
fireEvent.click(add);                               // re-entry would unmount `add`
await user.type(screen.getByRole("textbox"), "…");  // fine from here on
```

Write the reason in the file. Without it the next reader sees `fireEvent` in a
`userEvent` test and "tidies" it back into the bug — the 2026-08-08 entry below
tells them to, and it is right in general.

**Where:** the two sites are
`src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx:230`
and `src/components/diff-viewer/DiffViewer/DiffViewer.test.tsx:129`; the
hover-gated control is the inline-comment "+" in
`src/components/diff-viewer/CodeLine/CodeLine.tsx`. Upstream:
`https://testing-library.com/docs/user-event/pointer`.

### 2026-08-09 — `mock.contexts[0]` is how you assert WHICH element a prototype-stubbed DOM method was called on

**Quirk:** stubbing `Element.prototype.scrollIntoView = vi.fn()` gives you one
spy shared by every element, so `toHaveBeenCalled()` only proves *something*
scrolled. That is a much weaker claim than the feature makes: "clicking the badge
jumps to the first finding" is about **which** node scrolled, and a bug that
scrolls to the wrong line passes the naive assertion.

**Workaround:** `vi.fn()` records the `this` of each call in `mock.contexts`, so
the receiver is recoverable:

```ts
const scrolled = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>)
  .mock.contexts[0] as HTMLElement;
expect(scrolled.id).toBe(lineAnchorId(PATH, 1));
```

Pairs with the entry below: stub locally, assert on the spy (jsdom computes no
layout, so every element's scroll position is 0 and `toHaveBeenCalledTimes` plus
`contexts` is the whole of what you can check).

**Where:** `src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx:160-161`;
the id it checks is built by `src/components/diff-viewer/helpers.ts`
(`lineAnchorId`). Upstream: `https://vitest.dev/api/mock#mock-contexts`.

### 2026-08-09 — jsdom implements NO `Element.prototype.scrollIntoView`, and the repo's only pre-existing caller is untested

**Quirk:** the method does not exist in jsdom at all — it is layout, and jsdom
has none. A component that calls `el.scrollIntoView(...)` throws
`scrollIntoView is not a function` the moment a test triggers that path, and the
failure names the DOM API rather than your component, so it reads like a broken
test environment.

The trap is that nothing warns you first. `src/test/setup.ts` stubs
`ResizeObserver` and nothing else, and the repo's one existing caller —
`ReviewRunAccordion.tsx:63`, in the "expand then scroll to the target run"
effect — has **no test that reaches it**. So the gap survived until L04 added a
second scroller (the smart-diff badge → line navigation) and wrote the first
test that clicks it.

**Workaround:** stub it in the test file that needs it, not globally:

```ts
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
```

Local rather than in `src/test/setup.ts` on purpose: that is a shared file and
there is still exactly one consumer, so promoting it would be sharing on a
hypothetical second caller (`frontend-ui-architecture` §2). Promote it when
`ReviewRunAccordion` finally gets the test it is missing.

Assert on the spy (`toHaveBeenCalledTimes`), never on scroll position — jsdom
computes none, so every element is at 0.

**Where:** the untested caller is
`src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:63`;
the new caller is
`.../_components/SmartDiffViewer/SmartDiffViewer.tsx` (the effect keyed on the
navigation target); the stub and the two-click assertion are in
`.../SmartDiffViewer/SmartDiffViewer.test.tsx`; the setup file that does not
carry it is `src/test/setup.ts`.

### 2026-08-05 — `IconName` is the vendored REGISTRY's key set, not lucide's export list — and one key is aliased

**Quirk:** `icon="Pencil"` fails typecheck with a 64-name union in the error, even
though lucide exports `Pencil` and the string appears in `icons.tsx`. The registry
deliberately renames it: `Edit: Pencil` (`src/vendor/ui/icons.tsx:147`, comment
"prototype used 'Edit'; lucide exports Pencil/Edit — alias to keep API"). So the
usable name is `"Edit"`, and grepping the file for `Pencil` finds only the *import*.
Separately, plenty of plausible lucide icons are simply absent — `Wand2` is not
registered, so the "merged from conventions" banner uses `Sparkles`.

**Workaround:** read the keys of the `Icon` object, not the import list and not
lucide's docs:

```sh
node -e "import('./src/vendor/ui/icons.tsx')" # no — it's TSX; grep the object instead
sed -n '/satisfies Record<string, LucideIcon>/q;/^} satisfies/q' src/vendor/ui/icons.tsx
```

In practice: find the object literal and read the keys after it, watching for `X:`
aliases. Adding a missing icon means editing `src/vendor/ui/**`, which the root
`AGENTS.md` marks do-not-refactor — picking a registered icon is the cheap move, and
`pnpm typecheck` is the only thing that catches a wrong name (there is no runtime
error; `Icon[name]` would just be `undefined`).

**Where:** registry at `src/vendor/ui/icons.tsx` (alias at `:147`); `IconName` is
`keyof typeof Icon`; consumers `src/app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.tsx`
and `.../CreateSkillFromConventionsModal/CreateSkillFromConventionsModal.tsx`.

### 2026-08-05 — `@devdigest/ui`'s `Donut` is a MONEY chart, and a design mock inherited its `$`

**Quirk:** `charts/Donut.tsx` cannot render counts. Two hardcoded assumptions:

```tsx
valuePrefix = "$",          // default, not opt-in
{valuePrefix}{s.value.toFixed(2)}   // always two decimals
```

So a findings-by-category chart of 96 findings renders `$96.00`. Passing
`valuePrefix=""` removes the currency and leaves `96.00`, which is still wrong for
an integer — there is no prop for the decimals.

Worth knowing because it leaked **upstream into a spec**: an approved design for
the skill Stats tab showed a findings-by-category legend reading
`security $52.00`, `bug $20.00`. Those are not requirements, they are this
component's defaults showing through a mock that never overrode them. Check a
chart mock against the component's own defaults before implementing the pixels.

**Workaround:** do not "fix" the primitive — `src/vendor/**` is not ours to
refactor (root `AGENTS.md`). A ring is ~20 lines of SVG `stroke-dasharray`, so
draw it locally with the formatting the data actually needs. Bonus: hand-rolled
SVG avoids the recharts `width(0) and height(0)` warnings that the jsdom smoke
test already emits for every recharts mount.

Reach for `Donut` when the values ARE currency (spend by provider, cost by agent)
— that is what it is good at.

**Where:** the primitive is `client/src/vendor/ui/charts/Donut.tsx:19` (prefix
default) and `:52` (`toFixed(2)`); the local replacement is
`client/src/app/skills/[id]/_components/StatsTab/CategoryDonut.tsx`, with its
palette in that folder's `constants.ts` keyed by the `FindingCategory` enum. The
mock artifact is recorded in `specs/l02-skills.md` §"Mock artifacts".

### 2026-08-03 — `pnpm lint` UNDER-reports deep relative imports: the rule is switched off in test files

**Quirk:** `no-restricted-imports` is turned `off` for `**/*.test.{ts,tsx}` by
the last block of `eslint.config.mjs`, so the lint report is not a census of deep
relative imports — it is a census of them in **production** files. The gap is not
marginal: the deepest relatives in this package are in tests
(`../` × 8 to `messages/en/prReview.json`), and none of them appear in the
report. Phase 2a cleared "39 deep imports" per `pnpm lint`; a raw
`grep -rnE 'from "(\.\./){3,}'` still returns ~13 hits afterwards, all of them
test files, all of them correct.

**Workaround:** trust the lint count for what you must fix, and grep when you
want the true number — the two answers differ by design. Do **not** try to "fix"
the test ones with `@/`: `messages/` lives outside `src/`, so the `@/*` alias
cannot reach it and there is no alias that can (see the 2026-08-02 entry on
counting `../` for `messages/en/*.json` from the file itself). They are relative
by necessity, which is part of why the rule is off there.

**Where:** the override is `client/eslint.config.mjs:126-130`
(`files: ['**/*.test.{ts,tsx}', '**/test/**']` → `'no-restricted-imports': 'off'`);
the rule itself is at `:91`. Both `no-restricted-imports` and
`react-hooks/exhaustive-deps` are now `'error'` (`:38`, `:91`).

### 2026-08-03 — `import/no-cycle` makes `eslint .` unusable in this package (>5 min → 25s without it)

**Quirk:** with `import/no-cycle` enabled at `maxDepth: Infinity` plus the
TypeScript resolver, a full `eslint .` over this package's 259 files did not
finish inside a 5-minute timeout. Dropping that single rule brought the same run
to **25 seconds**. The cost is the rule walking the whole module graph through
`eslint-import-resolver-typescript`, not the file count on its own.

**Workaround:** leave `import/no-cycle` off in `eslint.config.mjs`. It is the
natural guard for the barrel cycles `frontend-ui-architecture` §7 warns about, so
the check still belongs somewhere — but its cheap home is a periodic
`dependency-cruiser` run (the server already has one wired as `pnpm arch`), not a
per-commit lint gate. As of this writing the audit found zero chained barrels in
owned code, so nothing is currently unguarded; `src/vendor/ui/index.ts` does
chain five barrels but is vendored and out of bounds.

If you re-enable it, do not just raise the timeout — measure first, and expect
CI minutes to go with it.

**Where:** `client/eslint.config.mjs` — the rule is absent, with a `NOTE:` block
in its place recording this measurement; `pnpm lint` is wired into
`.github/workflows/client.yml`.

### 2026-08-02 — `SeverityBadge compact` renders NO label — icon and count only

**Quirk:** `<SeverityBadge severity="WARNING" count={2} compact />` puts an icon
and the number `2` in the DOM and nothing else. The label ("Warning") is dropped
by `compact`; without `count` the badge contributes no text at all. The
`textTransform: "uppercase"` on the wrapper is therefore styling an empty
string in every compact use.

**Workaround:** assert on the count, never on the severity name — this is why
`PRRow.test.tsx` counts occurrences of `"2"` rather than looking for "Critical".
It also means adding compact badges to a screen cannot collide with an
`agent-browser` `find text "Warning"` step: e2e flow
`08-pr-severity-filter` targets the filter `Chip`, which DOES render its label,
and stayed unambiguous when the run header gained badges. If you need a name on
a compact badge, wrap it — do not edit the vendored primitive.

**Where:** `src/vendor/ui/primitives/Badge.tsx:52-88` (`{compact ? null :
s.label}`); consumers are `src/components/findings-hover-card/SeverityBadges.tsx`
and the card's own per-finding rows.

## Recurring Errors & Fixes

### 2026-08-16 — A message that reproduces engine output goes through `t.raw`, not `t()` — next-intl reads `<untrusted source="spec-N">` as a rich-text tag and throws

**Symptom:** the agent and skill Context tabs crashed the moment they rendered:
`INVALID_MESSAGE: INVALID_TAG (<untrusted source="spec-N">)` at
`ContextTab.tsx` `{t("serialization.wrapper")}`.

**Cause:** next-intl parses every message for ICU rich-text tags. The key is
`"<untrusted source=\"spec-N\">"` — an unpaired `<untrusted>` with no handler
passed to `t()`, so it throws rather than rendering. The copy is *correct*: it
mirrors `wrapUntrusted` (`reviewer-core/src/prompt.ts:33`) verbatim, which
AC-28 of SPEC-01 requires. The bug is the renderer, not the string.

**Takeaway:** `t.raw(key)` returns the message unparsed and is the right call
for any string that reproduces engine output — a wrapper, a heading, a prompt
fragment. The engine's syntax is not ICU's, and the overlap (`<`, `{`, `#`) is
not going away. Do not "fix" this by ICU-escaping the JSON: the value would stop
matching what the engine emits, which is the whole point of the panel, and a
translator would have no way to know why the quotes are there. The three
existing bracketed messages in `messages/` (`conformance.json`
`report.comparing`, `settings.json` `autoReviews.pollingNote` and
`plugins.intro`) are the opposite case — paired tags meant for `t.rich` — so
the presence of `<` alone does not decide it; ask whether the string is copy or
a reproduction.

**Where:** `src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx:217,220`,
`src/app/skills/[id]/_components/ContextTab/ContextTab.tsx:204,207`,
`messages/en/context.json` `serialization.wrapper`,
`../reviewer-core/src/prompt.ts:33`.

### 2026-08-16 — A duplicated `VALID_TABS` allowlist silently swallows every new tab: the URL changes, the pane does not

**Symptom:** clicking the agent editor's Context tab did nothing. No error, no
crash — `?tab=context` appeared in the address bar and the Config pane stayed.

**Cause:** `AgentEditorView` derives its tab from `?tab=` through an allowlist,
`VALID_TABS = ["config", "skills"]`, hand-written as a second copy of the tab
list that `AgentEditor/constants.ts` `TABS` already holds. `setTab("context")`
wrote the URL, the next render rejected `"context"` as unknown and fell back to
`DEFAULT_TAB`. The `tab === "context"` branch in `AgentEditor.tsx` was correct
throughout and simply unreachable. `SkillEditorView` had the same shape but
derived it — `VALID_TABS = TABS.map((t) => t.key)` — so the skill editor's
Context tab worked while the agent editor's did not, from identical-looking code.

**Takeaway:** a `?tab=` allowlist is derived from the tab bar's own list, never
retyped. Where the list lives in a child component, export it from that
component's barrel and import it — precedent is
`SeverityFilterBar/index.ts`, which exports `FILTER_SEVERITIES` and
`SEVERITY_PARAM` for exactly this reason. Failure mode to recognise: a control
that updates the URL and nothing else is a rejected value falling back, not a
dead handler — check the allowlist before the component.

**Where:** `src/app/agents/[id]/_components/AgentEditorView/constants.ts:4`,
`src/app/agents/[id]/_components/AgentEditorView/AgentEditorView.tsx:27`,
`src/app/agents/[id]/_components/AgentEditor/index.ts`,
`src/app/skills/[id]/_components/SkillEditorView/constants.ts:26`.

### 2026-08-16 — A new screen does not appear in the left panel until it has a row in the vendored `NAV` array — the label and the `activeKeyFor` branch are not the nav entry

**Symptom:** Project Context (SPEC-01) shipped complete — route
`src/app/repos/[repoId]/context/page.tsx` served 200, its API answered, the
agent and skill Context tabs rendered — and the sidebar showed nothing. Nothing
failed: no error, no 404, no type error. `pnpm typecheck` was clean throughout.

**Cause:** the sidebar is data-driven from one hardcoded array,
`NAV` in `src/vendor/ui/nav.ts`, which `Sidebar.tsx:45` maps over directly.
There is no injection point — `AppShell` passes only a context object to
`AppFrame`, never nav items. The screen had all three of its *satellite*
artefacts already in the repo: the `nav.context` label
(`messages/en/shell.json`), the `activeKeyFor` branch
(`src/components/app-shell/helpers.ts:30`) and the route. Its
implementation plan read those first two as evidence and recorded
"Sidebar nav entry `nav.context` — **reuse as-is**" and "no shell change is
needed" (`plans/2026-08-16-project-context.md:73,417`). Both artefacts are
*consumers* of a `NAV` row keyed `context`; neither creates one. A label with no
row is dead JSON and an `activeKeyFor` branch with no row highlights an item
that is never rendered, so both sit in the tree looking like a wired navigation
entry.

**Takeaway:** the nav entry is the row in `NAV`, and nothing else. When adding a
screen, grep `src/vendor/ui/nav.ts` for the key before concluding the shell is
wired — an inventory pass that finds `nav.<key>` in `shell.json` plus a branch
in `activeKeyFor` has found zero of the one thing required. Adding the row is
config, not a refactor of vendored code: `src/vendor/ui/README.md` classes
`nav.ts` as "route/shortcut config", and the repo rule bans refactoring
`src/vendor/**`, not adding a route to its route table. A row carrying a `gKey`
needs a matching `SHORTCUTS` entry in the same file or the shortcut works while
the `?` help omits it. Two consumers come free from the one row: `Sidebar`
renders `item.label` (the English literal in `nav.ts`), while
`useShellCommands.ts:24` builds the command-palette entry from
`t(\`nav.${it.key}\`)` — so the key must match the `shell.json` label key or the
palette renders a raw message key.

**Where:** `src/vendor/ui/nav.ts:33-34,64-65`,
`src/vendor/ui/shell/Sidebar.tsx:45,59`,
`src/components/app-shell/hooks/useShellCommands.ts:21-29`,
`src/components/app-shell/helpers.ts:30`, `messages/en/shell.json` `nav.context`.

### 2026-08-11 — Blast Radius: `entry.symbol` is not a unique React key — two changed symbols can share a bare name from different files

**Symptom:** `Encountered two children with the same key, 'renderWithIntl'` in
`BlastRadiusCard.tsx` — not synthetic, a real PR with two test files each
declaring a local `renderWithIntl` helper.

**Cause:** `DownstreamImpact` (the wire shape) carried only a `symbol` name,
which two changed symbols in different files can share. `SymbolNode` was keyed
on `entry.symbol` alone, `BlastGraph`'s `<g>` on `node.symbol` alone, and the
card guessed each entry's declaring file with
`changed_symbols.find(sym => sym.name === entry.symbol)`, which always
resolves to the FIRST matching file — silently mislabeling the second entry.

**Takeaway:** the contract now carries `file` on every `DownstreamImpact`
(synced in both `src/vendor/shared` and the server canon — root AGENTS.md).
Key on `` `${entry.file}:${entry.symbol}` ``, and read `entry.file` directly
instead of reconstructing it by matching on a name that is not guaranteed
unique. Full root-cause writeup — including why the server's persisted index
genuinely cannot attribute a caller to one of two same-named declarations —
is in `server/INSIGHTS.md` (2026-08-11).

**Where:** `src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx`,
`BlastGraph.tsx`.

### 2026-08-09 — A `retry: false` query for a resource that does not exist YET caches the 404 forever when no mutation invalidates its key

**Symptom:** open the Agent Runs tab while a review is running, wait for it to
finish, and the run's log stays blank. Reloading the page — or leaving the tab
and coming back — makes it appear. Nothing is wrong with the data: the trace is
in Postgres the whole time.

**Cause:** three things that are each reasonable alone.

1. `useRunTrace` (`lib/hooks/trace.ts:12`) is keyed `["run-trace", runId]` and
   carries `retry: false`. A grep for that key across `client/src` returns the
   hook and nothing else — **no mutation ever invalidated it.**
2. `run_traces` is written at the very END of a run (`run-executor.ts` completes
   `agent_runs` at :365 and only saves the trace at :417), so a drawer opened
   while the run is live fetches a trace that does not exist and gets a 404.
3. With `retry: false` and no invalidation, that 404 is the cached value for
   `["run-trace", runId]` for the rest of the session. Only a remount — which
   refetches because the default `staleTime` is 0 — clears it.

**Takeaway:** the house rule "a mutation must invalidate its query keys"
(`client/AGENTS.md` §Conventions) has a second half worth stating: **a query
whose resource is created asynchronously needs an invalidator even though no
mutation writes it directly.** The fix is one line in `useRunReview.onSuccess`
(`lib/hooks/reviews.ts`), and the placement is the load-bearing part —
that mutation resolves *after* the server persisted the trace, while
`useCancelRun` resolves while the run is still winding down and would only cache
a second miss. Use the **prefix** key `["run-trace"]`, not `["run-trace", runId]`:
`{ all: true }` fans out to one run per agent, so there is no single id to
target. Same class of bug as `server/INSIGHTS.md` 2026-08-08
("the run is marked DONE before the trace is written") — that entry is the
server-side face of this race; this is the UI-side one.

### 2026-08-09 — `getByText` normalizes whitespace, so an INDENTED diff line can never be matched by its literal text

**Symptom:** a diff-viewer test asserts a patch body line is on screen and dies
with `Unable to find an element with the text: "  lodash: 4.17.21"`, followed by
a full DOM dump that visibly **contains** that exact line. The dump makes it look
like a rendering bug — the text is right there.

**Cause:** RTL's default `normalizer` trims each element's text and collapses
runs of whitespace before comparing, and it does **not** normalize the string you
passed. So the DOM's `"  lodash: 4.17.21"` becomes `"lodash: 4.17.21"` and never
equals a needle that still carries its two leading spaces. Indentation is
exactly what a real diff body is full of, and `parsePatch` preserves it
(`helpers.ts` slices off only the leading `+`/`-`), so any fixture built from a
realistic patch walks straight into it.

**Takeaway:** in a diff fixture, use assertion lines with **no leading
whitespace** — it costs nothing and keeps the query literal. When the
indentation is the thing under test, pass a matcher instead of a string
(`getByText((_, el) => el?.textContent === RAW)`) or `{ normalizer: (s) => s }`,
and say in a comment why. Do not "fix" it by trimming the fixture and leaving
the reason unwritten: the next person re-derives it from the same misleading DOM
dump.

**Where:** the fixture comment is
`src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`
(`LOCK_BODY`); the code that preserves indentation is
`src/components/diff-viewer/helpers.ts` (`parsePatch`). Upstream:
`https://testing-library.com/docs/dom-testing-library/api-configuration/#normalizer`.

### 2026-08-08 — `@testing-library/user-event` is NOT installed here, so every interactive test uses `fireEvent` — copying that pattern spreads it

**Symptom:** you write a new component test, reach for the interaction API the
`react-testing-library` skill and the current RTL docs both tell you to use, and
`userEvent` does not resolve. The path of least resistance is to copy a
neighbouring test — and every neighbouring test uses `fireEvent`.

**Cause:** `client/package.json` carries `@testing-library/react` and
`@testing-library/jest-dom` but **not** `@testing-library/user-event`. All eight
interactive test files use `fireEvent` as a result, and one reaches into the DOM
directly (`fireEvent.click(container.querySelectorAll("button")[0]!)` at
`SkillCard.test.tsx:105` and `:115`). Three more read text through
`Array.from(card.querySelectorAll("span"))` instead of a role or text query.

The distinction that matters: `fireEvent` dispatches one DOM event, while
`userEvent` simulates the full interaction — pointer events, focus, the
keyboard sequence a real user produces. So a `fireEvent.click` on a control that
only responds after focus, or a disabled button, passes when the user's click
would not.

**Takeaway:** installing it is a **test-only devDependency** and is in scope for
a testing task, provided it is reported: `cd client && pnpm add -D
@testing-library/user-event`, then `userEvent.setup()` per test (not in a shared
`beforeEach`). Do not migrate the existing eight as a drive-by — that is its own
task with its own review. But do not copy them either: query by role or text,
and reserve `querySelectorAll` for the case where no accessible query exists,
saying so in a comment.

**Where:** `client/package.json` (the missing dependency); the eight files are
`SkillCard.test.tsx`, `ConventionCard.test.tsx`, `FindingCard.test.tsx`,
`FindingsPanel.test.tsx`, `ReviewRunAccordion.test.tsx`,
`RunTraceDrawer.test.tsx`, `RunHistory.test.tsx`, `FindingsCell.test.tsx`. The
rule is `.claude/skills/react-testing-library/SKILL.md` §Query Priority and
§userEvent, routed by `.claude/skills/pr-self-review/routing.md:18`; the
permitted-exception wording is `.claude/agents/test-writer.md`
§"The two permitted exceptions". Upstream:
`https://testing-library.com/docs/user-event/intro/`.

**Superseded by:** 2026-08-09 — the premise in the title no longer holds. L03
installed it (`client/package.json:31`, `@testing-library/user-event@^14.6.3`),
which is what this entry recommended, and new tests use it. Everything else
stands: the eight `fireEvent` files are still unmigrated, so they remain the
wrong thing to copy. One exception has since been found where `fireEvent` is the
correct choice, not a shortcut — hover-gated controls; see the Tool & Library
Notes entry of that date.

### 2026-08-02 — Dropping `border` is NOT enough: `borderColor` and `borderWidth` are shorthands too

**Symptom:** a red Next.js console overlay on the PR detail page — "Updating a
style property during rerender (borderColor) when a conflicting property is set
(borderLeftColor) can lead to styling bugs" — pointing at `FindingCard.tsx:55`.
Nothing renders wrong, and no test fails: the component suite never asserts on
React console warnings, so this shipped and sat there.

**Cause:** the style object was already the product of one attempt at this fix —
it carried the comment "All-longhand (never mix `border` shorthand with
`borderLeft`)" while setting `borderColor` + `borderLeftColor` and `borderWidth`
+ `borderLeftWidth`. `border` is not the only shorthand in play: `borderColor`
expands to the four `border<Side>Color` longhands and `borderWidth` to the four
widths, so both pairs are exactly the collision React rejects. Only the colour
warned, because `focused` makes it change between renders; the width pair is the
same defect and is silent because it is constant — so the warning under-reports
how many of these you have.

**Takeaway:** when a side needs to differ, go all the way to per-side longhands
(`borderTopWidth` / `borderRightWidth` / `borderBottomWidth` / `borderLeftWidth`
and the four `…Color`s). `borderStyle` alone stays fine — a shorthand only
collides when one of ITS longhands is also set. To sweep for others:
`grep -rln borderColor src/` then check each hit for a `border<Side>Color`.
There was exactly one such file at the time of writing.

**Where:** `src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/styles.ts:5`
(`s.card`).

### 2026-08-02 — Count the `../` for `messages/en/*.json` from the FILE, not from a sibling test

**Symptom:** a new component test dies at collection, before a single assertion:
`Failed to resolve import "../../../../../../messages/en/prReview.json"` —
`Test Files 1 failed | 12 passed`, `Tests 48 passed`, so the summary line still
shows only green test counts and the failure is easy to skim past.

**Cause:** the depth was copied from a neighbouring test. There is no shared
render helper and no alias for `messages/` (the vitest aliases cover `@`,
`@devdigest/shared` and `@devdigest/ui` only), so every test hard-codes the
relative path — and the two PR surfaces sit at different depths:

| Test location | Depth |
|---|---|
| `src/app/repos/[repoId]/pulls/_components/<X>/` | `../` × 7 |
| `src/app/repos/[repoId]/pulls/[number]/_components/<X>/` | `../` × 8 |

**Takeaway:** count from the test file's own directory up to `client/`, don't
copy the string. A quick check before running:
`ls src/app/.../<X>/../../../../../../../messages/en/prReview.json`.

**Where:** aliases at `client/vitest.config.ts`; the two depths in
`src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.test.tsx:10` (7) and
`.../pulls/[number]/_components/FindingsPanel/FindingsPanel.test.tsx:5` (8).

## Session Notes

_Empty so far._

## Open Questions

_Empty so far._
