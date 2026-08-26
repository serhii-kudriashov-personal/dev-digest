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
| `mcp/**` | `mcp/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| two or more packages, or `scripts/`, CI, `docs/`, vendored contracts | root `INSIGHTS.md` |

**Append-only.** Never rewrite or delete an existing entry. A finding that turned
out wrong gets a new dated entry, plus a `**Superseded by:** YYYY-MM-DD` line
appended to the old one.

**Who writes.** The session that did the work — the main one. A subagent returns
its findings under `## Insight candidates` and appends nothing: three agents in
one task would otherwise write three overlapping entries into a file that is
append-only and therefore cannot be tidied afterwards. Collect the candidates
from every agent's report, merge the duplicates, and write once.

## The index

Three files carry a `## Index` table at the top — root `INSIGHTS.md` (~28k
tokens), `server/INSIGHTS.md` (~17k) and `client/INSIGHTS.md` (~14k). It exists
so a reader can decide which entries touch their change without reading the file:
`AGENTS.md` §Session protocol says read the index, then open only the rows whose
`Scope` intersects the files being changed.

**An entry appended to one of those three ships its index row in the same edit.**
An entry with no row is an entry nobody is ever told to open, which is the same
failure as not writing it. The row is:

| Column | What goes in it |
|---|---|
| `Date` | the entry's own `YYYY-MM-DD` |
| `Section` | `Works` · `Doesn't` · `Patterns` · `Tools` · `Errors` · `Open` |
| `Scope` | the path globs or topics the entry binds — what a reader matches their changed files against. `server/src/modules/repo-intel/**`, `.claude/agents/**`, `client/src/**/*.test.tsx`. Never a summary |
| `Entry` | the entry's title, trimmed to one line |

Place the row to mirror the entry: newest first, within its section's block. The
index is navigation, not content — a row is never edited to change what an entry
says, and the three small files (`reviewer-core/`, `mcp/`, `e2e/`) carry no index
because they are read whole.

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
sections — including every `## Insight candidates` line the subagents returned,
merged — append what survives the test above, then say which files you appended
to and what you added.

Each append to root, `server/` or `client/` `INSIGHTS.md` lands **two** edits:
the entry and its `## Index` row. Report both.
