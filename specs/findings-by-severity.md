# Findings by severity

## Why

A pull request with a dozen findings spread across three agents is a wall of
cards. The first question a reviewer asks — "how bad is this, and what has to
block the merge?" — takes scrolling and counting to answer, and the answer never
appears on screen as a number. Once it is answered, acting on it is just as
awkward: there is no way to say "show me the criticals" short of reading past
every suggestion.

The data is present at every layer and surfaced at none. `ReviewRunAccordion`
already computes a blocker count for its header
(`…/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:61`)
and throws the rest of the breakdown away. `reviewer-core` ranks severities
(`SEV_RANK`, `reviewer-core/src/output/to-review.ts:23`) and already renders
`"2 critical · 1 warning · 0 suggestion"` into the GitHub comment body — but as
a prose string, not as data. And `rollupSeverities`
(`server/src/modules/pulls/status.ts:23`) was written and unit-tested for
exactly this and then never called: its own docblock claims the PR list shows a
severity breakdown, while `server/src/modules/pulls/routes.ts:116` states the
opposite. The feature was designed, half-built, and pulled back.

This closes it. It is **aggregation and presentation only** — no new finding
data, no model calls, no change to how severity is assigned.

## Scope

### In

Four render sites:

| # | Screen | Placement | Source |
|---|---|---|---|
| 1 | PR detail → Agent runs → each run's `FindingsPanel` | counter bar at the left of the existing toolbar, opposite the hide-low-confidence toggle | `ReviewRecord.findings`, already on the page |
| 2 | Pull Requests list | new `FINDINGS` column, between `SCORE` and `STATUS`, plus a hover card over it | counts from `PrMeta.findings_by_severity` (new); the card lazily from `GET /pulls/:id/reviews` |
| 3 | PR detail → Agent runs → each run's **header row** | badges replacing the plain-text "N findings", plus the same hover card | `ReviewRecord.findings`, already on the page |
| 4 | PR detail → Agent runs → **Timeline**, each settled run row | badges replacing the plain-text "N finding(s)", plus the same hover card | `ReviewRecord.findings` joined to the run on the client by `run_id` |

Site 1 is interactive — three chips, icon plus count, multi-select. Sites 2, 3
and 4 do not **filter**: the list holds no finding rows at all, and the two
detail-page sites sit above a panel that has its own filter bar. What they do is
let you read the findings behind a number without opening anything, through a
hover card all three share.

**Site 1 — the per-run filter bar.**

- Counters are **per run**. Findings on this page are grouped into one accordion
  per agent run, each with its own `FindingsPanel`, and the useful question is
  "which agent found what" — a single PR-wide total erases it. The same chip
  therefore reads `2` in one accordion and `0` in another.
- The *selection*, unlike the counts, is **one page-level set**, held in the URL
  as `?severity=CRITICAL,WARNING` beside the existing `?tab` and `?trace` and
  owned by `page.tsx`'s `setParam`. Absent or empty means show everything.
  Clicking a lit chip clears it; several lit chips compose as OR.

  One selection rather than one per accordion is a deliberate trade. It keeps
  the URL short and shareable, and it keeps the state single — the alternative
  needs a run-keyed encoding (`?sev=<run8>:C,W&…`) that silently drops a filter
  when its run is deleted. The cost is that you cannot filter one run to
  CRITICAL while leaving its neighbour unfiltered.
- A run left with nothing to show renders the **existing** `EmptyState` —
  `panel.noMatchTitle` / `panel.noMatchBody`, whose copy already reads "Adjust
  the filters above". The accordion is not hidden and not auto-collapsed;
  a run silently disappearing would read as data loss.
- **Counts include accepted and dismissed findings.** The counter states what
  the review found. Dismissed cards already render struck-through and faded, so
  they remain visible under the filter, and a number that shrank as you triaged
  would put the header at odds with the list beneath it. Note this differs from
  the sibling `blockers` count in the accordion header, which *does* exclude
  dismissed (`severity === "CRITICAL" && !dismissed_at`) — the two answer
  different questions and are not being unified here.
- **Counts are computed after the confidence filter and before the severity
  selection.** So a chip's number is exactly the row count you get by selecting
  that chip alone: toggling "hide low confidence" moves the numbers, toggling a
  severity chip never does. Any other order produces a bar that either lies
  about what a click will show, or renumbers itself as you click it.
- Zero-count chips stay rendered and dimmed, but remain **clickable**. They are
  not disabled, because the selection is page-wide: a chip reading `0` in one
  accordion may read `3` in the one below it, so disabling it here would block a
  filter that is meaningful there. Keeping all three rendered also stops the bar
  reflowing as a live run streams findings in.

**Site 2 — the list column.**

- The count covers **every finding of every review of the PR** — all agents, all
  re-runs. This follows the `COST` column's "summed across every run" semantics
  rather than the `SCORE` ring's "latest review only", and matches site 1, where
  the visible findings are likewise the union of all runs.
- A level with a zero count is **omitted** from the cell; the design shows PR
  #455 as `⚠2 ◌4` with no critical badge at all.
- A PR that has never been reviewed renders `—`, like `score` and `cost_usd`. A
  reviewed PR that produced no findings renders `None`, not `—`: "clean" and
  "unknown" are different answers, and the cell has to say which one it means.
  `None` rather than three zero badges — the badges would read as a finding
  count of zero at three levels, which is the same fact stated three times.
- **A hover card lists the findings behind the counts.** Pointing at the cell
  (or focusing it — the row is keyboard-reachable) opens a popover with every
  finding of every run, worst-first, each with its severity, title, category,
  `file:line`, confidence and a two-line rationale. It answers "what are those
  two criticals?" without leaving the list.

  - The card **fetches on open, not on render**. The list endpoint carries only
    the counts; widening `GET /repos/:id/pulls` with every finding of every PR
    would ship a payload nobody reads until they point at it. The card calls
    the existing `GET /pulls/:id/reviews` — the same query the detail page uses,
    so TanStack has it cached afterwards, and navigating into the PR is warm.
  - Opening is **delayed by `HOVER_OPEN_DELAY_MS` (220 ms)**, and the delay
    gates the fetch as well as the render. Dragging the pointer down the table
    would otherwise flash a card over every row it crosses and fire one request
    per row.
  - A cell with no findings — `None` or `—` — is not hoverable at all: no
    `tabIndex`, no card, no request.
  - The card is `position: fixed` and flips above the anchor when the viewport
    has no room below, clamped so it never leaves the right edge. The table card
    sets `overflow: hidden` for its rounded corners, which would clip an
    absolutely-positioned child on the lower rows. It stays a DOM descendant of
    the cell so moving the pointer into it does not read as leaving the cell.
  - The row navigates on click; the card stops propagation, so clicking inside
    it lands on the findings rather than on the PR's overview tab.

**Site 3 — the run header row.**

Each `ReviewRunAccordion` header states its run's findings as prose:
`3 findings · 1 blocker`. That is the same breakdown the list column shows,
rendered differently and hard-coded in English besides — the header string is
built with a JS ternary, which the repo's "no hard-coded UI strings" rule
forbids. It becomes badges plus the same hover card as site 2.

- Counts are **that run's own**, matching the filter bar directly beneath it
  (site 1) rather than the PR-wide union the list column reports.
- **Nothing is fetched.** `review.findings` is already in memory — this is the
  same array the accordion body renders. Only the list has to fetch, so the
  fetch is the caller's business and not the card's.
- The card opens **whether the accordion is expanded or collapsed**. Suppressing
  it when open would avoid restating the list below, but it makes the same
  gesture do different things depending on state, and "same as the PR list" is
  the point.
- **`blockers` stays**, as a separate `· N blockers` next to the badges. It is
  not what the badges say: `blockers` excludes dismissed findings
  (`severity === "CRITICAL" && !dismissed_at`) because it drives the verdict,
  while the badges count everything the run found. The two disagreeing is the
  intended reading, not a bug — see site 1's note on the same tension.
- A run that found nothing reads `None`, and its anchor is inert: no tab stop,
  no card.

**Site 4 — the Timeline row.**

`RunHistory` renders every `agent_runs` row, and a settled one states
`3 finding(s) · 1 blockers` — the same prose problem as site 3. It gets the same
badges and the same card, with one difference that shapes the whole design:

- **`RunSummary` has no breakdown to render.** It carries `findings_count` and
  `blockers` — totals denormalized onto the run row at completion — and no
  severities and no findings. Rather than widen the contract and add a server
  join, the breakdown is joined **on the client**, keying this PR's reviews by
  `run_id`. That is the same move `FindingsTab` already makes for `costByRun`
  ("Cost lives on the RUN … both are already on this page, joined by `run_id`"),
  so this is its mirror image, `findingsByRun`.
- **A run can legitimately have no review row**, because a review can be deleted
  while its run row survives. Such a row keeps its plain-text
  `findings_count` — the denormalized number is still true, and it is better
  than a breakdown that silently reads `None`. `findingsByRun` is therefore
  optional on `RunHistory`, and absence means "fall back", not "empty".
- Only **settled** rows get badges. Running, failed and cancelled rows render no
  findings line today and still don't.
- Note the two numbers now come from different places: the badges are live (from
  the reviews) while `blockers` is the value denormalized at run time. They can
  disagree if findings are deleted after the fact. The badges match the run's
  accordion directly below, which is the more useful agreement of the two.

### Out

- **Filtering from the PR list.** There are no finding rows on that screen, so a
  click would have to navigate into the PR with a filter pre-applied. That is a
  different feature, and the URL param specified here would support it later.
- **A PR-wide counter bar on the detail page.** Superseded by per-run counters,
  see above.
- **Filtering by `category`** (`bug` / `security` / `perf` / `style` / `test`).
  The contract carries it and `CategoryTag` already renders it on every card, so
  a second facet is cheap — but it was not asked for, and shipping one facet
  first keeps the toolbar's layout question small.
- **Persisting the selection** across PRs, across sessions, or as a user
  preference. It lives in the URL and nowhere else.
- **Denormalisation or backfill.** No `findings_count` column on
  `pull_requests`; the list rollup is computed on read exactly like `score` and
  `cost_usd`.
- **`RunTraceDrawer`'s `FindingsSection`**, which re-declares its own
  `SEV_COLOR` map and maps `SUGGESTION` to `var(--accent)` instead of
  `var(--sugg)`. A genuine inconsistency, but pre-existing and unrelated.

## Contracts

Contracts are vendored twice. Edit `server/src/vendor/shared/` (canon) and port
to `client/src/vendor/shared/` **in the same commit**.

Do not verify with `diff -r` — the two trees carry ~120 lines of documented
pre-existing drift and that command can never come back empty (root
`INSIGHTS.md`, 2026-08-02). Diff only the files touched, ignoring comments:

```sh
diff <(grep -v '^\s*[/*]' server/src/vendor/shared/contracts/platform.ts) \
     <(grep -v '^\s*[/*]' client/src/vendor/shared/contracts/platform.ts)
```

`contracts/findings.ts`:

```ts
SeverityCounts = z.object({          // new
  CRITICAL:   z.number().int(),
  WARNING:    z.number().int(),
  SUGGESTION: z.number().int(),
})
```

Uppercase keys, matching the `Severity` enum in the same file. The shape already
exists twice inline — `AgentStats.findings_by_severity`
(`contracts/observability.ts:111`) and `AgentPerfRow.findings_by_severity`
(`contracts/productionize.ts:156`) — and both should be switched to reference
this schema, so the repo ends with one definition rather than three.

`contracts/platform.ts`:

```ts
PrMeta += findings_by_severity: SeverityCounts.nullish()   // list endpoint only
```

`.nullish()` for the same reason as its neighbours `score` and `cost_usd`: the
field is served only by `GET /repos/:id/pulls`, so every other producer of a
`PrMeta` omits the key entirely, and `.nullable()` rejects a *missing* key.
`null` means "never reviewed" and is distinct from a present object of zeros.

No endpoint is added or removed. `GET /repos/:id/pulls` gains one field and
nothing else changes on the wire — site 1's counters are derived in the browser
from `GET /pulls/:id/reviews`, which already returns every finding of every run.

`server/src/modules/pulls/status.ts` drops its local lowercase
`interface SeverityCounts` and has `rollupSeverities` return the shared
uppercase type. The helper has no production callers, so this costs nothing but
an update to `server/test/pulls-status.test.ts`.

### Aggregation

`GET /repos/:id/pulls` gains a third IN-query alongside the score and cost
rollups already at `server/src/modules/pulls/routes.ts:114-152`, in the same
shape those two use — one `inArray` query, then JS grouping into a
`Map<prId, …>`:

```ts
select({ prId: t.reviews.prId, severity: t.findings.severity })
  .from(t.findings)
  .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
  .where(inArray(t.reviews.prId, prIds))
```

grouped per PR and passed through `rollupSeverities`. The comment at
`routes.ts:116` ("the per-severity FINDINGS breakdown is intentionally not
surfaced on the list — findings live on the PR detail page") becomes false and
is replaced.

This is the first query in the codebase to join `findings`, and that table has
**no indexes at all** — `0000_init.sql:142-158` declares the `review_id` foreign
key but no index behind it, so the join is a full scan today. Add the index to
the Drizzle definition in `server/src/db/schema/reviews.ts` and run
`pnpm db:generate` / `pnpm db:migrate`. Applied migrations are never edited.

### Display

**Site 1.** A new `_components/SeverityFilterBar/` under
`client/src/app/repos/[repoId]/pulls/[number]/`, rendering one `Chip`
(`@devdigest/ui`) per severity — already a `<button>` with `active`, `icon`,
`color` and `count`, so no new primitive is needed:

```tsx
<Chip icon={SEV[sev].icon} color={SEV[sev].c} count={counts[sev]}
      active={selected.includes(sev)} onClick={() => onToggle(sev)}>
  {t(`panel.severity.${sev}`)}
</Chip>
```

New keys under `prReview.panel`: `severity.CRITICAL` / `.WARNING` /
`.SUGGESTION`, plus `severityFilter` for the group's `aria-label`. The labels do
not come from `SEV[…].label` in the vendored tokens, English though those
happen to be — UI copy goes through `next-intl`.

The bar mounts at the left of `FindingsPanel`'s existing toolbar;
`s.toggleGroup` already carries `marginLeft: "auto"`, so the confidence toggle
stays right-aligned with no layout change.

`visibleFindings` (`FindingsPanel/helpers.ts`) takes the selected severities and
filters on them after the confidence filter and before the existing
`SEVERITY_ORDER` sort. A sibling `countBySeverity` returns the `SeverityCounts`
for the bar, called on the confidence-filtered list.

The selection is parsed from `?severity=` in `page.tsx` and drilled through
`FindingsTab` → `ReviewRunAccordion` → `FindingsPanel`, the path `repoFullName`
and `headSha` already take. Unrecognised tokens in the param are ignored, not
an error.

**Sites 2 and 3 — one shared card.** Two screens showing the same card is two
copies unless it is factored out first, so the popover lives in
`client/src/components/findings-hover-card/` (cross-route components go under
`src/components/`, beside `app-shell` and `diff-viewer`; `_components/` is for
one route's own):

| Export | What it is |
|---|---|
| `FindingsHoverCard` | the anchor + card: open delay, flip-up placement, Escape, focus parity |
| `SeverityBadges` | non-zero levels as `SeverityBadge … compact count`, else `None` |
| `sortBySeverity` / `popoverPosition` | the two pure parts, unit tested |
| `SEVERITY_ORDER` | worst-first order, shared by the badges and the sort |

The card takes `findings` already resolved, plus `loading` and `onOpenChange`.
That split is what lets one component serve both callers: the **caller** owns
where findings come from — the list fetches lazily and gates the query on
`onOpenChange`, the accordion passes `review.findings` straight in — while the
card owns everything about presenting them. `popoverPosition` being a pure
function of anchor rect + viewport is what makes the flip-up and the right-edge
clamp testable rather than eyeballed at the bottom of a long list, the case that
never comes up in dev.

Messages sit under `prReview.findings` — `none`, `summary` (the anchor's
`aria-label`), `blockers` (ICU plural), and `popover.heading` / `.loading` /
`.empty`. Not under `prReview.list`, where they started: two different screens
render them now.

**Site 2.** `_components/FindingsCell/` under
`client/src/app/repos/[repoId]/pulls/`, rendered by `PRRow.tsx`, reduced to what
is genuinely list-specific — the never-reviewed `—` branch and the lazy
`usePrReviews` call gated on the card opening.

**Sites 3 and 4.** `ReviewRunAccordion.tsx` and `RunHistory.tsx` each swap their
hard-coded findings string for `FindingsHoverCard` + `SeverityBadges`, counting
with `countBySeverity` from `FindingsPanel/helpers` — the same helper the filter
bar uses, so none of the three can drift. The anchor carries `role="group"` and
an `aria-label`, matching `SeverityFilterBar`'s precedent; without a name,
tabbing onto it announces a bare run of numbers.

Site 4's map is built in `FindingsTab.tsx` beside `costByRun` and passed down;
`RunHistory` takes `findingsByRun` as an optional prop, so the component stays
renderable without it (its existing tests pass no map and still exercise the
plain-text path).

`COLUMN_KEYS`
(`client/src/app/repos/[repoId]/pulls/constants.ts:42`) gains `"findings"` after
`"score"`, `messages/en/prReview.json` gains `list.columns.findings`, and `GRID`
(`constants.ts:27`) gains a matching track:

```
"1fr 132px 92px 60px 118px 78px 78px"
"1fr 132px 92px 60px 104px 118px 78px 78px"
```

Header and rows read the same `GRID` constant, so both move together.

## Acceptance

1. `GET /repos/:id/pulls` returns `findings_by_severity` on every PR row.
2. It counts findings across **every** review of the PR, not just the latest.
3. It is `null` for a PR that has never been reviewed, and an object of zeros
   for a reviewed PR that produced no findings.
4. Accepted and dismissed findings are included in every count, on both sites.
5. The PR list renders a `FINDINGS` column between `SCORE` and `STATUS`, and
   header and rows stay column-aligned (both read `GRID`).
6. A zero-count level is omitted from a list cell; an all-zero cell renders
   `None` and a `null` field renders `—`.
7. Each `FindingsPanel` shows three chips carrying **that run's own** counts —
   two accordions on the same PR can show different numbers.
8. Clicking a chip filters that run's list to the selected severities; clicking
   it again clears it; two lit chips show the union.
9. The selection round-trips through `?severity=`: reload and link-sharing
   restore the same view, and an unknown token in the param is ignored.
10. A run with no matching finding shows the existing `EmptyState`. It is
    neither hidden nor auto-collapsed.
11. A chip's count equals the number of rows shown when only that chip is lit —
    counts move with "hide low confidence" and never with the severity
    selection.
12. `SeverityCounts` has exactly one definition, in `contracts/findings.ts`;
    `rollupSeverities`, `AgentStats` and `AgentPerfRow` all reference it.
13. `findings.review_id` is indexed, by a new migration; `0000_init.sql` is
    untouched.
14. The comment-stripped diff of `contracts/findings.ts` and
    `contracts/platform.ts` between the two `vendor/shared` copies is empty.
15. Hovering a findings cell opens a card listing every finding of every run,
    worst-first, with `file:line` and confidence; it fetches nothing until the
    open delay elapses, and a cell reading `None` or `—` never opens at all.
16. The card is reachable by keyboard focus and dismissed by Escape, and it
    stays inside the viewport for the last row of a long list.
17. Each run's header shows badges for the severities **that run** found, zero
    levels omitted, `None` when it found nothing.
18. Hovering a run header opens the same card over that run's own findings, and
    issues no request — they are already on the page.
19. A dismissed CRITICAL is counted by the header badges and not by the header's
    `blockers`; both are visible at once.
20. Opening or dismissing the header card never expands or collapses the
    accordion.
21. Each settled Timeline row shows badges for that run's severities and hovers
    to that run's own findings — two rows on screen open different cards.
22. A Timeline row whose run has no review record keeps its plain-text
    `findings_count` rather than rendering an empty breakdown.
23. Unsettled Timeline rows (running / failed / cancelled) show no findings line,
    exactly as before.
24. `FindingsHoverCard` has exactly one definition; sites 2, 3 and 4 all render
    it, and none owns a copy of the placement, delay or item markup.
25. No new endpoint, no model call, no denormalised column, no backfill, and no
    change to `RunSummary` — every card reuses findings the client already has
    or fetches from `GET /pulls/:id/reviews`.

## Open questions

- `Chip` renders no `aria-pressed`, so a lit chip reaches a screen reader as an
  ordinary button — its state is carried by border, background, text colour and
  the ever-present icon, but not semantically. Fixing it means editing
  `client/src/vendor/ui/primitives/Chip.tsx`, which the repo rules put
  off-limits to drive-by edits. Worth a deliberate vendor change?
- Should the list column follow `SCORE` (latest review only) rather than `COST`
  (every run summed)? As specified, a PR reviewed five times reads as having far
  more findings than any single review reported.
- The contract's `Severity` has three values; the UI token map
  (`vendor/ui/primitives/tokens.ts`) has a fourth, `INFO`, with colours already
  defined. If `INFO` ever reaches the contract the bar needs a fourth chip and
  the list column another width.
- Should the same bar appear in `RunTraceDrawer`'s findings section, which lists
  a run's findings a second time with its own divergent styling?
- The hover card renders its own compact finding row (severity, title, category,
  `file:line`, confidence, clamped rationale) rather than reusing `FindingCard`,
  which carries triage actions and a full rationale that a read-only card has no
  use for. Sites 2 and 3 now share one card, but that still leaves **three**
  renderings of a finding — `FindingCard`, `RunTraceDrawer`'s `FindingsSection`,
  and the card. A shared presentational row underneath all three is the obvious
  consolidation, and out of scope here.
- The run header now carries both a severity breakdown and a `blockers` count
  that deliberately disagree with it (dismissed criticals). It is correct, and
  it is still two numbers about criticals sitting side by side. If it reads as a
  bug to users rather than as a distinction, the fix is to drop `blockers` from
  the header and leave it to `VerdictBanner`, which shows it inside the run.
- Now that the URL carries a severity selection, should the list column's counts
  deep-link into it (`/pulls/482?tab=findings&severity=CRITICAL`)? That is the
  cheapest version of the "filter from the list" feature ruled out above.
