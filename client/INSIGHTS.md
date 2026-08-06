# Insights — client

Lessons learned in this package: what broke, why, and how not to repeat it.
Cross-package lessons go in the root `INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

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
