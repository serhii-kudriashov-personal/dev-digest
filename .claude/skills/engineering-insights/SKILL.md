---
name: engineering-insights
description: Captures durable engineering insights into the INSIGHTS.md of the module the task touched. Use immediately whenever something non-obvious surfaces during a session — a trap, an approach that failed, a dependency quirk, a convention learned the hard way, a decision worth its reason, or a recurring error and its fix — and again as a wrap-up pass before reporting any non-trivial task done. Also use when the user says wrap up, retro, retrospective, capture learnings, or lessons learned.
user-invocable: true
---

# Engineering Insights

Append-only knowledge loop. Every module keeps its own `INSIGHTS.md` next to its
code, so the next session in that module reads its lessons, not everyone else's.

## When to write

Write when something cost real time, or when it would not be obvious to someone
reading the code. Skip trivial sessions — a rename or a config bump teaches
nothing.

**The test:** if it would be obvious to anyone reading the code, do not write it.

## Where to write

| The task touched | Append to |
|---|---|
| `client/**` | `client/INSIGHTS.md` |
| `server/**` | `server/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| two or more packages, or `scripts/`, CI, `docs/`, vendored contracts | root `INSIGHTS.md` |

**Append-only.** Never rewrite or delete an existing entry. A finding that turned
out wrong gets a new dated entry, plus a `**Superseded by:** YYYY-MM-DD` line
appended to the old one.

## How to write

Pick the section, then insert `## YYYY-MM-DD — title` at the top of it (newest
first) using that section's labels:

| Section | Labels |
|---|---|
| What Works | **Pattern:** · **Why:** · **Where:** |
| What Doesn't Work | **Tried:** · **Failed:** · **Instead:** |
| Codebase Patterns | **Rule:** · **Why:** · **Where:** |
| Tool & Library Notes | **Quirk:** · **Workaround:** · **Where:** |
| Recurring Errors & Fixes | **Symptom:** · **Cause:** · **Takeaway:** |
| Session Notes | one dated paragraph, no labels |
| Open Questions | **Question:** · **Blocked:** |

`**Where:**` is always `path/file.ts:42`. Without it the entry is a rumour.

Never skip **What Doesn't Work** — dead ends save more time than successes do,
and it is the section that gets left empty most often.

## Concrete, not generic

Each entry must be actionable cold: an agent reads it and knows what to do,
without re-investigating.

| ✗ Noise | ✓ Insight |
|---|---|
| "Promises can be tricky" | "`Promise.all()` over the ingest pipeline times out past 30 items — use `Promise.allSettled()` in batches of 10 (`server/src/ingest/run.ts:88`)" |
| "be careful with async state" | "checkout state always goes through Zustand (`cartStore.ts`) — three components share the cart, local state does not work here" |

## Wrap-up pass

Before reporting a non-trivial task done, walk the session once against the seven
sections, append what survives the test above, then say which files you appended
to and what you added.
