# Insights — client

Lessons learned in this package: what broke, why, and how not to repeat it.
Cross-package lessons go in the root `INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

---

## What Works

_Empty so far._

## What Doesn't Work

_Empty so far._

## Codebase Patterns

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
`_components/` in `client/CLAUDE.md` but not for the shared case.

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

## Tool & Library Notes

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
