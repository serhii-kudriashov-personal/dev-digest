# Run cost badge (L01)

## Why

Every review run burns money, and right now none of it is visible. A user can
fire "Review all" across seven PRs with three agents each and have no idea
whether that cost two cents or two dollars — the number simply isn't on screen
anywhere.

The cost is already known. The LLM adapters compute it
(`server/src/adapters/llm/{openai,anthropic}.ts` via `estimateCost`;
`reviewer-core/src/llm/openrouter.ts` reads OpenRouter's *real* billed
`usage.cost`), and the engine accumulates it across map-reduce chunks and
returns it as `ReviewOutcome.costUsd`. The server then discards it: commit
`d45ab0d` removed the consumer and migration `0009` dropped
`agent_runs.cost_usd`, leaving the producer wired to nothing.

This feature closes that wire. It is **persistence and presentation only** —
no new cost arithmetic, no extra model calls, no new provider round-trips.

## Scope

### In

Four render sites, all reading the same per-run number:

| # | Screen | Placement | Source field |
|---|---|---|---|
| 1 | Pull Requests list | new `COST` column, between `STATUS` and `UPDATED` | `PrMeta.cost_usd` |
| 2 | PR detail → timeline row | second line under the timestamp: `9,119 tok · $0.0013` | `RunSummary.cost_usd` |
| 3 | PR detail → Review Runs accordion header | beside score + date: `38  $0.001  6/13/2026…` | `RunSummary.cost_usd`, matched by `run_id` |
| 4 | Run trace drawer → Stats | 4th tile, after `TOKENS`, before `FINDINGS` | `RunTrace.stats.cost_usd` |

Site 2 also introduces the run's **token count** in the timeline, which is not
displayed today — the design shows tokens and cost together as one line.

Restoring `agent_runs.cost_usd` (new migration; `0009` is superseded, never
edited) and threading it through the repository, the run executor, the run
trace document, and the PR-list endpoint.

### Out

- **The verdict banner.** An early summary slide showed a
  `$0.014 · 8.2K→1.3K` line there, but no approved screen does. Deferred.
- **Backfilling historical runs.** `tokens_in`/`tokens_out` survived migration
  `0009`, so cost *could* be recomputed from the price table — but that number
  would be an estimate from the static fallback table, not what the provider
  actually billed. Pre-existing runs stay `NULL` and render `—`.
- **Aggregate cost roll-ups** — per-PR totals, per-agent spend, budgets,
  cost-over-time charts. `AgentStats.total_cost_usd` and
  `MultiAgentRun.total_cost_usd` already exist in the contracts and are
  untouched here.
- **The `FINDINGS` column** visible in the PR-list mock. Unrelated feature.
- Changes to pricing itself. `PriceBook` and `estimateCost` stay as they are.

## Contracts

Contracts are vendored twice. Edit `server/src/vendor/shared/` (canon) and copy
to `client/src/vendor/shared/` **in the same commit** —
`diff -r server/src/vendor/shared client/src/vendor/shared` must come back
empty.

`contracts/trace.ts`:

```ts
RunStats   += cost_usd: z.number().nullish()   // NOT .nullable() — see below
RunSummary += cost_usd: z.number().nullable()
```

`contracts/platform.ts`:

```ts
PrMeta += cost_usd: z.number().nullish()   // list endpoint only, like `score`
```

`RunStats` is embedded in `RunTrace`, which is persisted as a **single jsonb
document** in `run_traces.trace`. Documents written before this change have no
`cost_usd` key at all, and `.nullable()` rejects a *missing* key — every
historical trace would fail to parse. `RunSummary` is rebuilt from columns on
each read, so `.nullable()` is correct there.

No endpoint is added or removed. The three existing reads —
`GET /repos/:id/pulls`, `GET /pulls/:id/runs`, `GET /runs/:id/trace` — each gain
one field.

### Semantics

- **Per run**, `cost_usd` is the sum of the costs of every LLM call that run
  made (single-pass: one call; map-reduce: one per changed file).
- **The PR-list column is the SUM of every run against the PR** — the question
  it answers is "what have I spent on this PR so far", so a re-run adds to the
  total rather than replacing it. Runs with an unknown cost are filtered out in
  SQL (`cost_usd IS NOT NULL`) rather than coerced to `0`, so they contribute
  nothing and a PR whose runs *all* lack a cost stays `—`, never `$0.0000`.

  > **Revised 2026-08-02.** This first shipped as "the latest run that has a
  > cost". Two consequences of the change are intended, not defects: repeated
  > re-runs make a PR look expensive even when a single review is cheap, and the
  > column is no longer comparable between PRs (a much-iterated small PR can
  > outrank a large one). If a "cost per review" reading is ever wanted back,
  > it belongs as a *second* column, not as a redefinition of this one.
- **Failed and cancelled runs persist `NULL`, not `0`.** These paths already
  zero the token counters; a `0` would render as "this run was free" when the
  truth is "unknown".

### Formatting

One helper, `formatCost` in `client/src/lib/format.ts`, used by all four sites:

| Input | Output |
|---|---|
| `null` / `undefined` | `—` |
| `0.00128` | `$0.0013` |
| `0.0141` | `$0.014` |
| `1.2431` | `$1.24` |

Precision widens as the number shrinks so that ~3 significant digits survive at
every magnitude. A fixed precision would either round sub-cent runs to `$0.00`
— the one output this feature must never produce — or make the list column
noisy. A genuine `0.0` renders `$0.0000`, which is honest; `—` is reserved for
*unknown*.

Note that the three source mocks are not self-consistent (`$0.06`, `$0.014`,
`$0.0013` for comparable values), and PR #482's list total `$0.014` does not
match its own timeline runs of `$0.0013`–`$0.0014`. The rule above is
authoritative, not the mock pixels.

## Acceptance

1. `agent_runs.cost_usd` exists again, added by a new migration; `0009` is
   untouched.
2. A completed review run persists a non-null `cost_usd` equal to
   `ReviewOutcome.costUsd`.
3. A failed or cancelled run persists `cost_usd = NULL`.
4. `GET /pulls/:id/runs` returns `cost_usd` on every run row.
5. `GET /runs/:id/trace` returns `stats.cost_usd`; a trace document persisted
   **before** this change still parses and returns `—` for cost.
6. `GET /repos/:id/pulls` returns `cost_usd` = the SUM of `cost_usd` over every
   run against the PR; `null` for a PR that has never been reviewed, and `null`
   (not `0`) for a PR whose runs all have an unknown cost.
7. All four render sites show the badge for a run that has cost data.
8. Every site renders `—` when cost is absent. `$0.00` appears nowhere.
9. Runs that pre-date this change render `—` (no backfill).
10. The PR-list header and rows stay column-aligned — both read the same `GRID`
    constant.
11. Zero additional model calls: cost is read from data the run already
    produced.
12. `diff -r server/src/vendor/shared client/src/vendor/shared` is empty.

## Open questions

- Should the verdict banner carry the cost line after all? It's a small
  addition if the design settles that way.
- Once per-run cost is stored, a per-PR **total** becomes cheap
  (`SUM(cost_usd) GROUP BY pr_id`). Worth surfacing as a second column or a
  header stat in a later lesson?
- Costs from `openrouter` are real billed amounts; costs from `openai` and
  `anthropic` are estimates from the static price table. The UI does not
  currently distinguish the two. Should it?
