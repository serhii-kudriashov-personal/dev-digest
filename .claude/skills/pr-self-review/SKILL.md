---
name: pr-self-review
description: "Reviews all open local changes against this repo's own skills and rules before a pull request is opened, and blocks `gh pr create` / `gh pr merge` while a CRITICAL finding stands. Use when the user says self-review, review my changes, check before PR, pr self review, or is about to open or merge a pull request; the PreToolUse hook also demands it before `gh pr create` and `gh pr merge`. Routes each changed file to the skills that can speak about it — UI skills on UI files, backend architecture skills on backend files — runs the deterministic repo gates (typecheck, lint, `pnpm arch`, shared-contract sync, test naming, symlink integrity), and writes a verdict the hook can verify. Does NOT review a pull request already on GitHub (that is `/review`), and does not change any DevDigest agent's system_prompt."
user-invocable: true
version: 1.0.0
---

# PR Self Review

One question: **may these open changes become a pull request?**

The answer is a verdict — `pass` or `block` — plus the findings behind it. A
block is enforced: `.claude/settings.json` runs `scripts/pr-self-review.sh gate`
as a `PreToolUse` hook on `Bash`, and that hook denies `gh pr create` and
`gh pr merge` until a fresh verdict says `pass`.

Scope is *local* changes. A pull request that already exists on GitHub is
`/review`'s job, and the DevDigest engine's own review of a PR is a different
system entirely — this skill never touches `agents.system_prompt`.

## Severity

| Tag | Meaning | Blocks? |
|---|---|---|
| **CRITICAL** | Breaks the architecture, a repo rule, or a gate. A boundary that cannot be undone cheaply. | **yes** |
| **HIGH** | Costs real time later — churn, untestable code, a bug class that keeps coming back. | no |
| **MEDIUM** | Consistency and readability. | no |

Same vocabulary as `backend-onion-architecture` and `frontend-ui-architecture`,
so the report reads as one set with the skills it cites.

**State a severity on every finding.** Root `INSIGHTS.md` (2026-08-02) records
what unstated severity does: the same class of maintainability issue came back
CRITICAL instead of WARNING purely because the rule did not say. A self-review
that blocks on everything is a self-review that gets switched off.

---

## The procedure

Six steps, in order. Do not skip step 2 to save time — the gates are cheaper
than the reading, and a gate failure is a fact rather than a judgement.

### 1. Collect the diff

```sh
./scripts/pr-self-review.sh state    # base/head/tree identity — keep this output
./scripts/pr-self-review.sh files    # TSV: <status>\t<path>
```

`files` covers committed-on-branch **plus** staged, unstaged, and untracked work:
"before opening a PR" means the tree as it will be pushed. Three statuses:

| Status | What to do |
|---|---|
| `review` | route it through §3 |
| `sentinel:<what>` | route it **and** raise the matching finding in §4 |
| `skip:<why>` | do not review it; list it in the coverage footer |

Never re-derive this list with your own `git diff` — the hook recomputes
`tree_hash` with the script's algorithm, and a verdict written against a
different file set is a verdict for a tree that does not exist.

### 2. Run the deterministic gates

```sh
./scripts/pr-self-review.sh gates    # TSV: <status>\t<name>\t<detail>
```

Exit code is non-zero when any gate failed; `detail` is the log path. Read the
log before writing the finding — report the actual error, not "typecheck failed".

**Every `fail` here is a CRITICAL**, with no judgement involved. `gates.md` says
what each one is and why it earns that severity.

### 3. Route the diff to skills

Read `routing.md` and match every `review` / `sentinel` path against its table.
The union of the matched rows is what you load — **nothing else**. A skill that
no row selected must not be opened: `backend-onion-architecture` has nothing to
say about a `.tsx` file, and reading it anyway spends context and invents
findings.

Then read the matched skills. Only the sections a row names, not whole files.

### 4. Review

Per changed file, against the skills that matched it. Rules that always apply,
whatever the routing says:

- **A CRITICAL must cite `file:line`, and that line must appear in the collected
  diff.** An uncitable CRITICAL is reported as HIGH and marked `grounded: false`.
  This mirrors `reviewer-core/src/grounding.ts`, the engine's mandatory citation
  gate, for the same reason. Note what it does not prove: that the claim about
  the cited line is true.
- **Never gate on a confidence number.** Root `INSIGHTS.md` (2026-08-02):
  `findings.confidence` is uncalibrated — the model emitted `1.0` for a
  hallucinated "missing `await`" on a line reading `await fetch(...)`. Do not
  filter, rank, or act on confidence anywhere.
- **A vendored skill cannot raise a CRITICAL on its own.** See §"Vendored
  severity is not house law" in `routing.md`, and its demotion list.
- **`sentinel:` paths** are the `## Do not touch` list from `AGENTS.md`:

  | Sentinel | Finding |
  |---|---|
  | `sentinel:migrations` | CRITICAL — an applied migration is never edited, only superseded. A *new* migration file is fine: say so and downgrade to a note. |
  | `sentinel:grounding` | CRITICAL — quality gate. Requires a test covering every behavioural change. |
  | `sentinel:injection-guard` | CRITICAL **only if `INJECTION_GUARD` itself changed** — `prompt.ts` has other content. Diff the block before deciding. |

- **Deduplicate.** A raw Drizzle query in `routes.ts` is one finding, whether it
  came from `pnpm arch`, from `backend-onion-architecture` §6, or from both.
  Merge into one entry and cite every source.

### 5. Decide

One surviving CRITICAL ⇒ `block`. HIGH and MEDIUM never block.

### 6. Write the verdict, then report

Write `.devdigest/pr-self-review.json` in the format `report.md` specifies,
copying `base_sha`, `head_sha` and `tree_hash` **verbatim** from step 1. Then
report in chat, CRITICAL first, ending with the coverage footer.

The footer is not decoration. Root `INSIGHTS.md` (2026-08-03): a per-item receipt
is the only cheap way to tell "nothing matched" from "the run broke". Say which
routing rows matched, which skills loaded, which gates ran, and what was skipped.

---

## Blocking, and the way out

The hook denies `gh pr create` and `gh pr merge` when:

- there is no verdict file,
- the verdict is unreadable,
- `head_sha` or `tree_hash` no longer match the tree (a stale `pass`),
- the verdict is `block` and no override is recorded.

It exempts one case: `gh pr merge` while on the default branch, where there are
no local open changes to review.

It fires on commands that *run* `gh pr create` / `gh pr merge`, including after a
`&&`, and not on commands that merely mention them — an `echo` or a `grep` for the
string passes through untouched. `gh pr list` and `gh pr view` are not gated.

**The override is deliberate and audited.** If the user waives a CRITICAL, set
`overridden_by_user: true` and keep the waived findings in `findings` — the hook
then allows the call and says an override was used. Requirements:

- the user must say so explicitly, in this session, after seeing the findings;
- never set it pre-emptively, never infer it from impatience;
- never delete the verdict file or edit `head_sha` / `tree_hash` to get past the
  hook. That is not an override, it is forging the gate.

An inescapable local gate gets deleted; an audited one leaves a trace.

## What this skill cannot do

**It cannot block the merge button on GitHub.** Only branch protection and
required checks can. This gate covers the local `gh` path, and a PR opened
through the GitHub web UI bypasses it entirely — say so rather than implying
coverage the hook does not have. Root `INSIGHTS.md` (2026-08-02) has the matching
open question: `pnpm arch` is not wired into CI either, which is why this skill
is currently the only thing that runs it on a change.

## Cost

| Diff size | How to run it |
|---|---|
| ≤ 10 `review` files, one package | inline, single pass |
| > 10 files or ≥ 2 packages | one subagent per skill group in parallel, then merge |

Fan-out multiplies token spend, so it is a decision, not a default: say you are
doing it and why. Routing is the real control — a one-file client change loads
three skills, not twelve.

## Read when

| Read | When |
|---|---|
| `routing.md` | always — step 3 is that table |
| `gates.md` | a gate failed and you need its severity and rationale |
| `report.md` | writing the verdict file or the chat report |
| `../../../AGENTS.md` | checking a repo rule the routing table cites |
| `../../../INSIGHTS.md` | before changing this skill's severity or blocking rules |
