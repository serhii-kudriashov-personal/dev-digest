# PR Self Review — skill plan

Plan only. No skill files are written by this document.

## Why

DevDigest reviews a pull request *after* it exists on GitHub. Nothing reviews the
change while it is still local, so the first feedback on a boundary violation
arrives once the PR is open, named, and visible to the team.

Meanwhile the repo already carries a body of house law that nobody runs on a
diff: two authored architecture skills (`backend-onion-architecture`,
`frontend-ui-architecture`), ten vendored ones, ~20 `AGENTS.md` rules, and a
`pnpm arch` boundary gate that root `INSIGHTS.md` records as **not wired into
CI** — "a PR that puts Drizzle back into a new `routes.ts` is green in CI today".

`pr-self-review` closes that window: one command, run before `gh pr create`,
that picks the skills the diff actually implicates, reviews the change against
them, and refuses to open the PR while a CRITICAL stands.

## Scope

### In

- A skill at `.claude/skills/pr-self-review/` — ours, not vendored, absent from
  `skills-lock.json`.
- Manual invocation as `/pr-self-review`, plus an enforced automatic run before
  `gh pr create`.
- Diff collection covering **all open changes**: committed-on-branch, staged, and
  unstaged.
- A path-glob → skill routing table, so UI skills read UI files and backend
  skills read backend files, and nothing loads a skill for files it cannot
  speak about.
- Deterministic repo-rule gates (typecheck, lint, `pnpm arch`, shared-contract
  sync, test naming, symlink integrity).
- A verdict artifact and a hard local block on PR creation when a CRITICAL
  survives.

### Out

- **A GitHub-side merge block.** A local skill cannot gate the merge button;
  branch protection and required checks are the only mechanisms that can. What
  this skill blocks is the local `gh pr create` / `gh pr merge` path, and it can
  post its report as a PR comment. Wiring a real required check (and the CI
  half of the `pnpm arch` open question) is a separate task.
- Changing any DevDigest review agent's `system_prompt`. Root `INSIGHTS.md`
  (2026-08-02) records that stacking convention blocks into a prompt made the
  reviews *worse* — this skill reviews locally and touches no `agents` row.
- New runtime code in `server/`, `client/`, or `reviewer-core/`.

## Deliverables

| File | What it holds |
|---|---|
| `.claude/skills/pr-self-review/SKILL.md` | the procedure: collect diff → route → gate → review → verdict |
| `.claude/skills/pr-self-review/routing.md` | the glob → skill table (§3), as data |
| `.claude/skills/pr-self-review/gates.md` | the deterministic commands per touched package (§4) |
| `.claude/skills/pr-self-review/report.md` | report and verdict-file format (§6) |
| `.claude/settings.json` | the `PreToolUse` hook that enforces the run (§2) — file does not exist yet; only `settings.local.json` does |
| `.claude/skills/README.md` | one catalog row |
| `.gitignore` | ignore the verdict artifact |
| root `INSIGHTS.md` | wrap-up entry once it lands |

Frontmatter follows `engineering-insights`: `name`, a `description` naming the
trigger phrases, `user-invocable: true`.

## 1. Collect the diff

```sh
BASE=$(git merge-base HEAD origin/main)
git diff --name-status "$BASE" HEAD      # committed on the branch
git diff --name-status                   # unstaged
git diff --name-status --cached          # staged
```

Union of the three, deduplicated. "Before opening a PR" means the tree as it will
be pushed, so uncommitted work counts — reviewing only `BASE..HEAD` would miss
exactly the edits the user is about to `git commit -am` and push.

Per root `INSIGHTS.md` (2026-08-03): the file list is written to a file and read
line by line with the variable quoted. No `grep -lZ | while read -d ''` pipeline
— `grep` here is ugrep, where `-Z` means fuzzy matching, so that shape exits 0
with no output and is indistinguishable from "nothing to review". Route paths
contain `[brackets]`, so every expansion is quoted.

**Skipped from review** (still listed in the report as skipped, never silently):
`*/node_modules/**`, lockfiles, `*/src/vendor/**` (vendored, do not refactor),
vendored skills under `.claude/skills/**` that appear in `skills-lock.json`.

**Not skipped — these are findings in themselves** (§5): any change under
`server/src/db/migrations/**`, `reviewer-core/src/grounding.ts`, or the
`INJECTION_GUARD` block of `reviewer-core/src/prompt.ts`.

## 2. Triggers

**Manual:** `/pr-self-review`, optionally with a base ref.

**Automatic:** a `PreToolUse` hook in `.claude/settings.json`, matched on
`Bash` commands containing `gh pr create` (and `gh pr merge`). The hook denies
the call and tells the user to run `/pr-self-review` unless a **fresh** verdict
file says `pass`.

Freshness is the whole point of the hook — a stale `pass` from before the last
three commits is worse than no gate. The verdict file records `head_sha` plus a
hash of `git status --porcelain` + `git diff` of the tree it reviewed; the hook
recomputes both and rejects on any mismatch.

A skill `description` alone cannot carry this. Description-based triggering is
advisory — the model may or may not load the skill — and "must run before every
PR" is not advisory. The hook is what makes it real.

**Not covered:** a PR opened in the GitHub web UI, or `git push` followed by the
web "Compare & pull request" button. State this limitation in the skill rather
than implying coverage it does not have.

## 3. Routing — diff paths to skills

The table is the mechanical core: each changed file matches one or more rows,
the union of the `Skills` column is what gets loaded, and a skill that no row
selected is never opened. Written as data in `routing.md`, first-match-wins
within a group, most specific glob first.

| Changed path | Skills / rules |
|---|---|
| `client/src/app/**`, `client/src/components/**` (`.tsx`) | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` |
| `client/src/app/**/{layout,page,route,loading,error}.tsx`, `'use client'` added or removed | `next-best-practices` (RSC boundary, file conventions) |
| `client/src/**/*.test.tsx`, `client/src/test/**` | `react-testing-library` |
| `client/src/lib/**`, `client/src/i18n/**` | `frontend-ui-architecture` (placement, promotion rule) |
| `server/src/modules/**/routes.ts` | `fastify-best-practices`, `backend-onion-architecture`, `security` |
| `server/src/modules/**/*.repo.ts`, `server/src/db/schema/**`, `server/src/db/schema.ts` | `drizzle-orm-patterns`, `postgresql-table-design`, `backend-onion-architecture` |
| `server/src/modules/**` (services, other) | `backend-onion-architecture` |
| `server/src/adapters/**`, `server/src/platform/**` | `backend-onion-architecture` (ports/adapters, composition root), `security` |
| `reviewer-core/src/**` | `backend-onion-architecture` (§ pure core, zero I/O), `typescript-expert` |
| `**/vendor/shared/**`, any `*.contracts.ts`, any `z.object` touched | `zod` |
| `e2e/**` | `e2e/AGENTS.md` conventions (no skill covers this yet) |
| `.github/workflows/**`, `*.test.ts` naming | `TESTING.md` |
| `**/*.md` | repo rule: all Markdown in English |
| `*.ts`/`*.tsx` anywhere | `typescript-expert`, lowest priority, only when the change is type-level |

Two rules keep the table honest:

- **No skill matched → say so.** A diff of only `docs/` and `scripts/` loads
  almost nothing; the report says which rows matched and which did not. Silence
  must never read as "reviewed and clean".
- **A skill never reviews a file its own scope excludes.** Both architecture
  skills state their non-scope explicitly (`backend-onion-architecture` defers
  Fastify/Drizzle/Postgres/Zod mechanics; `frontend-ui-architecture` defers
  rendering and performance). The routing respects that split instead of
  handing every skill every file.

## 4. Deterministic gates

Run before the model reads anything — they are cheap, objective, and a failure
here is a fact, not a judgement. Only for packages the diff touches:

| Condition | Command | On failure |
|---|---|---|
| `server/**` or `reviewer-core/**` | `cd server && pnpm typecheck` | CRITICAL |
| `server/**` or `reviewer-core/**` | `cd server && pnpm arch` | CRITICAL — this is the gate CI does not run |
| `client/**` | `cd client && pnpm typecheck && pnpm lint` | CRITICAL |
| `reviewer-core/**` | `cd reviewer-core && pnpm typecheck` | CRITICAL |
| `**/vendor/shared/**` | `./scripts/check-shared-sync.sh` | CRITICAL |
| a new DB-backed test | filename must be `*.it.test.ts` | CRITICAL (the CI split breaks silently) |
| any `CLAUDE.md` / `AGENTS.md` touched | `git ls-files -s '*CLAUDE.md'` — every row `120000` | CRITICAL (a flattened symlink silently drops all project instructions) |
| `reviewer-core/src/grounding.ts`, `prompt.ts` `INJECTION_GUARD`, `server/src/db/migrations/**` | changed at all | CRITICAL unless the run was invoked with an explicit acknowledgement |

`check-shared-sync.sh` is used deliberately instead of `diff -r`: root
`INSIGHTS.md` (2026-08-02) records that `diff -r` over the two `vendor/shared`
copies can never be empty — ~120 lines of documented pre-existing drift — so it
fails on every run and teaches nothing.

Gates run per package because this is **not a monorepo**: four independent
`package.json`, and `pnpm install` at the root is a repo rule violation.

## 5. Severity and the blocking rule

Vocabulary is the one the two architecture skills already share —
**CRITICAL / HIGH / MEDIUM** — so the report reads as one set with the skills it
cites.

**Blocking rule:** one surviving CRITICAL ⇒ verdict `block`. HIGH and MEDIUM are
reported and never block.

Three qualifiers, each from a recorded insight:

1. **Every finding must state its own severity explicitly.** Root `INSIGHTS.md`
   (2026-08-02): a rule that leaves severity unstated comes back CRITICAL. A
   self-review that blocks on everything gets bypassed within a day, and an
   unstated severity is the fastest way there.

2. **A CRITICAL must cite `file:line` that exists in the collected diff.** An
   uncitable CRITICAL is downgraded to HIGH and marked ungrounded. This mirrors
   `reviewer-core/src/grounding.ts`, the engine's mandatory citation gate, and
   for the same reason. Note what grounding does *not* prove: that the claim
   about the cited line is true.

3. **A vendored skill cannot raise a CRITICAL on its own.** Root `INSIGHTS.md`
   (2026-08-02): a vendored skill's severity tag is the vendor's confidence, not
   evidence, and two of `react-best-practices`' CRITICAL rules are positions
   their own authors have retracted — the container/presentational split (`:24`)
   and the 200-line component cap (`:26`). Those two go on an explicit demotion
   list in `routing.md`. A vendored-skill CRITICAL blocks only when it also
   violates an authored skill (`backend-onion-architecture`,
   `frontend-ui-architecture`), a rule in `AGENTS.md`, or a deterministic gate.
   Otherwise it lands as HIGH.

**Never gate on a confidence number.** Root `INSIGHTS.md` (2026-08-02):
`findings.confidence` is uncalibrated — the model emits `1.0` for a
hallucination as readily as for a real defect. No filtering, ranking, or
auto-acting on confidence anywhere in this skill.

**Override.** A block is escapable, deliberately: the user types an explicit
confirmation, and the verdict file records `overridden_by_user` with the
findings that were waived. An inescapable local gate gets disabled; an audited
one leaves a trace. Recommended default is to require the override to be typed
out, not a `-y` flag.

## 6. Output

Two artifacts.

**In chat:** grouped by severity, CRITICAL first. Per finding — `file:line`, the
skill and section that raised it, the rule in one line, the fix in one line.
Then the coverage footer: which routing rows matched, which skills loaded, which
gates ran, what was skipped. Per root `INSIGHTS.md` (2026-08-03), a per-item
receipt is the only cheap way to tell "nothing matched" from "the run broke".

**On disk:** `.devdigest/pr-self-review.json` (gitignored, and `~/.devdigest/`
is already the secrets home so the name is familiar):

```json
{
  "created_at": "…", "base_sha": "…", "head_sha": "…", "tree_hash": "…",
  "files": [{ "path": "…", "matched_rows": ["client-app"], "skipped": false }],
  "gates": [{ "name": "server:arch", "status": "pass" }],
  "findings": [{ "severity": "CRITICAL", "file": "…", "line": 42,
                 "source": "backend-onion-architecture#4",
                 "grounded": true, "rule": "…", "fix": "…" }],
  "verdict": "block",
  "overridden_by_user": false
}
```

The hook in §2 reads exactly `head_sha`, `tree_hash`, and `verdict`.

## 7. Cost

Routing is the first control — a one-file client change loads three skills, not
twelve. Beyond that, a ladder in `SKILL.md`:

| Diff size | How it runs |
|---|---|
| ≤ 10 files, one package | inline, single pass |
| > 10 files or ≥ 2 packages | one subagent per skill group, in parallel, results merged |

Subagent fan-out is opt-in and stated in the skill, not implicit — it multiplies
token spend, and a course repo should show the cost, not hide it.

## 8. Acceptance

Fixtures are already in the repo — `origin/demo/agent-summary-endpoint`,
`origin/demo/repo-activity-summary`, `origin/demo/review-share-webhook`, and
`upstream/demo/security-review-fixture` carry planted defects (the SSRF in
`review-share-webhook` is documented in root `INSIGHTS.md`).

| Case | Expect |
|---|---|
| `demo/review-share-webhook` | CRITICAL — SSRF, cited, `security` + `backend-onion-architecture` loaded; verdict `block` |
| a `docs/`-only diff | `pass`, zero skills loaded, coverage footer says so |
| a change to a `routes.ts` with a raw Drizzle query | CRITICAL from `pnpm arch` *and* from `backend-onion-architecture`; deduplicated to one finding |
| a 210-line component, nothing else | **not** blocked — demotion list holds (§5.3) |
| `pass`, then one more edit, then `gh pr create` | hook denies on `tree_hash` mismatch |
| override path | PR is created, verdict file records the waived findings |

Per root `INSIGHTS.md` (2026-08-02), **a single run is evidence of nothing** —
run-to-run variance exceeded the effect of most prompt edits in that experiment.
Each fixture runs at least twice, and the routing/gate half (deterministic by
construction) is what carries the acceptance weight.

## Status

Implemented 2026-08-04. `gh pr create` **and** `gh pr merge` are both gated
(question 1 below, decided by the user). Merge is exempt on the default branch,
where there are no local open changes to review.

Files as built: `.claude/skills/pr-self-review/{SKILL,routing,gates,report}.md`,
`scripts/pr-self-review.sh` (the deterministic half — `state` / `files` / `gates`
/ `gate`), the `PreToolUse` hook in `.claude/settings.json`, and the `.gitignore`
entries for the verdict and gate logs.

## Open questions

1. ~~**`gh pr merge` too, or only `gh pr create`?**~~ Both. Blocking creation
   matches the stated intent; blocking merge also covers the case where the PR
   already exists and picked up new commits.
2. **Post the report to the PR?** `gh pr comment` after creation would make the
   self-review visible to reviewers. Needs a decision on noise.
3. **Should this skill be the place `pnpm arch` finally runs on every change,
   or does the CI open question get closed first?** They are complementary; the
   local gate is not a substitute for a required check.
4. **`e2e/` has no skill.** The routing row points at `e2e/AGENTS.md`. Leave it,
   or author an `e2e-flows` skill later.
