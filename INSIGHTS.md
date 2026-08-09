# Insights — repo-wide

Lessons that span the whole repo: what broke, why, and how not to step on it
twice. Package-level lessons live in `<pkg>/INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

---

## What Works

### 2026-08-09 — Build a demo PR fixture with a temporary `GIT_INDEX_FILE`, so a half-finished lesson in the working tree is never in the way

**Pattern:** several lessons need a *demo pull request* that exists on GitHub so
the app can import it — L04 Smart Diff needs a large one carrying a lock file.
The awkward part is timing: the fixture branch has to fork from `origin/main`,
but by the time you want to record the demo, the lesson's own work is sitting
uncommitted on `lab/lab0N`. Build the commit with plumbing and a throwaway
index; nothing is checked out, so the dirty tree is irrelevant:

```sh
export GIT_INDEX_FILE=/tmp/fixture.index && rm -f "$GIT_INDEX_FILE"
git -C "$REPO" read-tree origin/main
for f in ...; do
  sha=$(git -C "$REPO" hash-object -w "$STAGING/$f")
  git -C "$REPO" update-index --add --cacheinfo 100644,"$sha","$f"
done
tree=$(git -C "$REPO" write-tree)
commit=$(git -C "$REPO" commit-tree "$tree" -p origin/main -F msg.txt)
git -C "$REPO" update-ref refs/heads/demo/<slug> "$commit"
```

Two things that bite: every `git` call needs `-C "$REPO"` (the loop `cd`s into
the staging directory, and a bare `git` there is "not a git repository"), and
`GIT_INDEX_FILE` must be exported *before* `read-tree`.

**Why:** the alternatives both cost something. `git switch -c demo/x
origin/main` drags the uncommitted lesson across a branch that differs in
hundreds of files, and refuses outright where a modified file would be
overwritten. `git worktree add` is clean but materialises a second checkout,
which is a lot of ceremony for ten files — and note that `git worktree remove`
is permitted here while `git branch -D` is not, so a worktree can strand the
branch it created.

**Where:** the fixtures live as `demo/*` branches in the **fork**, not upstream
— `origin` is `serhii-kudriashov-personal/dev-digest` (PRs #1–#3, #5). Before
building one, check it will actually group the way the demo needs: run the real
classifier, `classifyFile` at
`server/src/modules/smart-diff/helpers.ts`, over the intended file list rather
than reasoning about the patterns in
`server/src/modules/smart-diff/constants.ts:40` by eye. The pre-existing `demo/*`
PRs are all 3–6 files with no lock file, so none of them can demonstrate the
L04 acceptance criterion at `specs/l04-smart-diff.md:280`.

### 2026-08-08 — A spec-conformance checker must extract the obligations FIRST — and must never be asked to "explain the problem and suggest a fix"

**Pattern:** when writing any agent or prompt that checks code against a written
spec, plan or acceptance list, fix this order and enforce it structurally:

1. extract every obligation into a numbered list, quoting the source verbatim,
   **before opening a single source file**, and end the list with a count;
2. per item, state what it *requires*, then what the code *does*, then compare;
3. emit exactly one row per item, one verdict from a **closed** enum, and an
   evidence cell that is a `path:line` actually read or verbatim command output
   — prose in that cell is itself a defect;
4. make the row count the receipt: `N` items in, `N` rows out, counts summing
   to `N`.

And explicitly **forbid** the familiar framing "find the problems and propose
fixes".

**Why:** that framing is not neutral — it measurably makes the checker worse.
[arXiv:2508.12358](https://arxiv.org/html/2508.12358v1) reports GPT-4o's
rate of correctly recognising *correct* code collapsing from 52.4% to 11.0% on
HumanEval when the prompt asked it to explain problems and propose fixes,
recovering to 72.0% with a two-phase reflective prompt and 85.4% with a
behavioural-comparison prompt (summarize spec behaviour and actual behaviour
independently, then compare). The mechanism is intuitive once seen: the model
starts hunting for defects before it has committed to a verdict, and it finds
them whether or not they exist. Anthropic's own
[best-practices](https://code.claude.com/docs/en/best-practices) says the same
thing from the other side — "a reviewer prompted to find gaps will usually
report some, even when the work is sound".

Two supporting results worth carrying: checklist decomposition beats one
holistic verdict on agreement and variance (CheckEval,
[arXiv:2403.18771](https://arxiv.org/abs/2403.18771)), and LLM judges are
self-inconsistent across identical repeated runs — Krippendorff's α 0.265–0.563
— with few-shot and CoT making no difference
([arXiv:2510.27106](https://arxiv.org/html/2510.27106v1)). So if a verdict ever
gates something here, run it twice and escalate disagreement rather than
trusting one pass.

This generalises past the one agent: it is the same shape as
`reviewer-core/src/grounding.ts`, which keeps a finding only when its cited
lines exist in the diff. The non-LLM half of the check is the half that cannot
be talked out of its answer.

**Where:** the rules are `.claude/agents/plan-verifier.md` §Method (steps 1–6)
and its `## Conformance` / `## Counts` template; the ban on advice is its
§"Hard constraints" (`Banned output`) and the two-case admissibility test under
`## Findings outside the plan`. Sources catalogued in
`.claude/agents/README.md` §"External evidence — the reviewers and the test
writer"; the design record is `specs/four-subagents.md`.

### 2026-08-05 — To make the model report a new field, `.describe()` the shared contract — then validate the answer server-side

**Pattern:** two halves, and both are needed.

1. **Ask through the schema, not the prompt.** `reviewer-core` hands the shared
   `Review` contract straight to `completeStructured` (`schema: ReviewSchema`), so
   a `.describe()` on any field of `Finding` / `Review` **is** an instruction the
   model reads. Add the field `.nullish()`, put the instruction in `.describe()`,
   and you have changed what the model returns with **zero** edits to
   `prompt.ts`, `INJECTION_GUARD`, or any agent's `system_prompt`.
2. **Never store the answer unchecked.** Validate it against something the server
   knows for itself, and record what you rejected.

L02's skill attribution is the worked example. `Finding.skill` asks for a slug
from the `## Skills / rules` section; the server keeps it only when that slug
names a skill actually injected into *that* run, stores `NULL` otherwise, and
logs the discarded claims. The gate is deliberately the same shape as
`grounding.ts`, which refuses a finding citing a line absent from the diff.

**Why:** the prompt route is the expensive one and the measured-worse one. Root
`INSIGHTS.md` (2026-08-02) recorded a `system_prompt` block *crowding out*
findings a previous run had caught (3 → 2, one hallucinated, score 41 → 30), and
`prompt.ts`'s guard is on the do-not-touch list. A schema field description costs
no prompt real estate and cannot descope the review.

The validation half is not optional paranoia — the same file records
`findings.confidence` returning `1.0` for a hallucination, so anything the model
says about its own output is a claim, not data. Two consequences worth stating:
log the rejects (a model that mis-attributes systematically must not look like one
that never attributes), and be precise about what the gate proves — that the skill
was *present and could have* produced the finding, never that it did.

Three plumbing facts that make this cheap, all verified: `reduceReviews` merges
with `partials.flatMap(p => p.findings)` and grounding does `kept.push(finding)`,
so an unknown field survives both untouched; and the labelling that gives the
model something to cite (`### <slug>` before each body) is a server-side string
built before `reviewPullRequest`, so `PromptParts.skills?: string[]` is unchanged
and `reviewer-core` needs no edit at all.

**Where:** field + instruction at
`server/src/vendor/shared/contracts/findings.ts` (`Finding.skill`, ported to the
client copy); schema handed to the model at
`reviewer-core/src/review/run.ts:174`; the gate is
`resolveSkillAttribution` in `server/src/modules/reviews/helpers.ts` (pure, unit
tested in `server/test/reviews-helpers.test.ts`); the deterministic side it
validates against is `run_skills` (`server/src/db/schema/runs.ts`); end-to-end
proof in `server/test/reviews.it.test.ts` ("DISCARDS an attribution naming a skill
that was NOT injected"). Field-survival points: `reviewer-core/src/review/reduce.ts:43`
and `reviewer-core/src/grounding.ts:68`.

### 2026-08-05 — A lesson feature is mostly already scaffolded: inventory Part 0 before writing a line

**Pattern:** before implementing a course lesson, grep for the feature's nouns
across schema, contracts, routes, UI primitives and `messages/` — and check
`git diff --stat main...upstream/lesson-N-lab/<name>` for the file list upstream
touched. The starter ships the *shape* of every later lesson with the middle
removed, so the real task is usually one wire, not a subsystem.

**Why:** L02 "Skills" looked like a full-stack feature. Almost all of it existed:

| Already there | Where |
|---|---|
| `skills`, `skill_versions`, `agent_skills` tables | `server/src/db/schema/skills.ts`, `.../agents.ts:52` |
| `Skill`, `SkillType`, `SkillSource`, `AgentSkillLink` | `server/src/vendor/shared/contracts/knowledge.ts:114-199` |
| `GET/POST /agents/:id/skills` + `setSkills`/`linkSkill`/`linkedSkills` | `server/src/modules/agents/{routes,service,repository}.ts` |
| `ReviewInput.skills?: string[]` → `## Skills / rules` | `reviewer-core/src/review/run.ts:55`, `prompt.ts:88,109` |
| the trace **already renders** the skills block, colour reserved | `.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx:76`, `constants.ts:16` |
| `AgentCard` accepts + renders `skillCount`, with a passing test | `client/src/components/agent-card/AgentCard.tsx:20,70` |
| the whole page's copy, incl. import + vetting strings | `client/messages/en/skills.json` |
| `AgentEditor` `?tab=` state + a `TABS` extension point | `.../AgentEditor/{AgentEditor,constants}.tsx` |

So the feature needed **no migration at all** and the behavioural change was six
lines in the run executor. Two concrete traps this avoids: `agent_skills` has only
`(agent_id, skill_id, order)` and *no* `enabled` column, which decides the whole
enablement model (attachment = row existence, `skills.enabled` = the single gate) —
guess wrong and you write a migration you did not need; and `skills.type` is
already a fixed enum (`rubric|convention|security|custom`) matching the design
mockup's badges, so inventing a free-text `type` would have broken the mock.

Read the upstream lesson branch for the intended *contract*, not as code to copy —
its `SkillsTab` reintroduces the Effect-copies-server-state bug this repo already
fixed, hardcodes inline styles, uses deep relative imports the linter rejects, and
ignores the i18n file it also ships.

**Where:** inventory table above; the upstream branch is
`upstream/lesson-2-lab/skills`; the spec that records what was in and out is
`specs/l02-skills.md`.

### 2026-08-03 — To blame a refactor for a test failure, rebuild the state just BEFORE it — `HEAD` is the wrong baseline here

**Pattern:** this repo's working tree carries several uncommitted phases at once
(Phase 0 guardrails + Phase 1 fixes + Phase 2a refactor). When a test fails and
you need to know whether *your* phase caused it, do **not** `git show HEAD:<file>`
to get a baseline. Reconstruct the state as of the phase immediately before yours:
keep every earlier phase's changes, and undo only your own.

**Why:** restoring `HEAD`'s `pulls/[number]/page.tsx` to test a Phase-2a
extraction produced a file that could not compile against the tree — Phase 1 had
changed `FindingsTab`'s props from `cancelMutation` to `onCancelRuns`/`cancelling`,
so the 203-line `HEAD` page passed a prop that no longer exists. A baseline that
does not build tells you nothing, and the failure it produces looks like evidence.
The working baseline was instead built from the extracted view itself — inline its
body back into `page.tsx`, restore `'use client'`, repoint `../X` to
`./_components/X` — which holds Phases 0 and 1 constant and varies only the one
thing under suspicion. `pnpm typecheck` on the baseline is the gate that proves it
is a fair comparison.

That comparison is what settled the question: on the same harness the refactor
scored `6/8` and `7/8` while the baseline scored `4/8`, and the flow that failed
on both (`08`) was thereby cleared. Note the second half of that — a single run
of a flaky suite attributes nothing; flow `05` failed once and passed on the next
run with no code change.

**Where:** the phases are described in
`~/.claude/plans/parallel-hugging-giraffe.md`; the prop change that broke the
`HEAD` baseline is
`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx`
(Phase 1, item 1.9); the flakiness is catalogued in `e2e/INSIGHTS.md`
(2026-08-03).

### 2026-08-03 — Introducing a linter: grep its own disable directives FIRST

**Pattern:** before adding a linter to a package that never had one, run
`grep -rn "eslint-disable" src/` (or the equivalent for the tool). Every hit is a
suppression written against a linter that never ran, so none of them were ever
validated — and each one is a claim that a rule was considered and waived.

**Why:** adding ESLint to `client/` surfaced exactly two, and they were not
equivalent. `ConfigTab.tsx` carried
`// eslint-disable-line react-hooks/exhaustive-deps` on the Effect that copied
nine props into state — the CRITICAL anti-pattern of the whole audit. The comment
made it read as deliberate and reviewed, which is why it survived; a reader sees a
suppression and assumes someone already weighed it. The second, in
`ReviewRunAccordion.tsx`, was simply unused — the rule reports nothing there —
and was only detectable *because* the linter now runs and flags unused
directives.

So the order matters: audit the suppressions, then turn the rules on. Doing it the
other way round means the pre-existing suppressions silently become part of the
baseline you declare green.

**Where:** config at `client/eslint.config.mjs`; the two directives were at
`client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx`
and `.../pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:65`
(both removed).

## What Doesn't Work

### 2026-08-08 — Racing `researcher` against `planner` and patching the plan by `SendMessage` mid-flight: the message lands too late, or never

**Tried:** two ways of getting external research into a `planner` run without
paying for the round trip twice.

1. Launching `researcher` (repo inventory) and `researcher` (external practices)
   in parallel, then `planner` after them.
2. After the first attempt died, launching `researcher` (external) and `planner`
   **concurrently**, then `SendMessage`-ing the research findings to the running
   `planner` as soon as they arrived.

**Failed:** both, differently.

1. Both `researcher` runs terminated with
   `Agent terminated early due to an API error: You've hit your session limit`.
   Neither returned partial output — a subagent that dies this way returns
   **nothing**, not a truncated report, so the whole run is lost rather than
   degraded. The main session kept working normally, which makes the limit look
   like an agent-specific fault rather than an account-wide one.
2. `SendMessage` is queued "for delivery at its next tool round". A `planner`
   that is already composing its final message has no next tool round, so the
   message was never read: the returned plan still carried "the slug is
   unverified — **needs `researcher`**" as an open question, for a fact that had
   been verified minutes earlier. The plan is not wrong, it is just stale, and
   nothing in it says so.

**Instead:** sequence research → plan, and treat the research report as an
*input* you paste into the planner prompt, not as an update you send later. A
subagent's prompt is the only channel guaranteed to be read. If you must run them
concurrently, plan to reconcile the two outputs **yourself** afterwards and
budget for it — folding four verified findings into a finished plan by hand cost
more than serializing would have.

Two smaller consequences worth carrying:

- Give the planner the inventory you already have (`path:line`) and ask it to
  *verify and correct* rather than rediscover. That worked well here — it
  returned six corrections to line numbers and claims, including five stale
  docblocks where the brief said two.
- When a subagent dies on an account limit, its work is gone; there is no resume
  that recovers a partial report. Doing the inventory inline in the main session
  is the cheaper fallback, not a re-launch.

**Where:** the plan produced this way is `specs/l03-intent-layer.md`; the
findings that had to be folded in by hand are its §"External findings of record".
Agent definitions are `.claude/agents/{researcher,planner}.md`; the set and its
registration surfaces are `.claude/agents/README.md`.

### 2026-08-06 — `pr-self-review` cannot gate a PR built in a secondary git worktree — the script `cd`s to the primary root

**Tried:** building a deliberately-broken demo PR in a detached worktree
(`git worktree add --detach … origin/main`, branch `demo/api-contract-break`) so
the primary tree's uncommitted work stayed untouched, then committing, pushing,
and running `gh pr create` for that branch.

**Failed:** the hook denied with
`the verdict is for commit ae5a53f4, HEAD is now 2c1fd2ea`. Both SHAs describe the
PRIMARY tree (`lab/lab02`, carrying unrelated uncommitted work) — not the branch
the PR is for, whose six files the gate never looked at. The denial reads like a
stale review of your PR; it is actually a fresh review of a different tree.

The cause is structural, not a cwd accident. `scripts/pr-self-review.sh:24` runs
`cd "$(dirname "$0")/.."` before anything else, and the hook invokes it as
`"${CLAUDE_PROJECT_DIR:-.}/scripts/pr-self-review.sh" gate`. So `head_sha` and
`tree_hash` always describe the primary repo root. Issuing `gh pr create` from
inside the worktree does not help, and no flag repoints it.

**Instead:** three in-policy exits; which one is right depends on why the worktree
exists.

- Build the branch in the primary tree after all, when the PR is real work that
  the gate *should* read.
- Open it through the GitHub web UI. `SKILL.md` §"What this skill cannot do"
  already states the web path is uncovered, so this is a documented limitation
  rather than an evasion — say so out loud when you use it.
- Review the primary tree and land a fresh verdict — honest only when those open
  changes are genuinely part of this PR.

**Not** an exit: deleting the verdict or editing `head_sha` / `tree_hash`.
`SKILL.md` §"Blocking, and the way out" calls that forging the gate, and
`overridden_by_user` requires the user to have seen real findings first — and
there are none, because the gate never read the diff it blocked.

Worth writing down because this repo teaches the opposite reflex elsewhere:
`server/INSIGHTS.md` (2026-08-05, `reviews.it.test.ts` / `prompt_assembly`)
recommends a detached worktree for clean-tree reproduction. That advice is right
for tests and collides with this gate the moment the worktree's branch is meant
to become a pull request.

**Where:** unconditional chdir at `scripts/pr-self-review.sh:24`; verdict written
at `:72-78`, re-checked by the hook at `:334-344`; `tree_hash()` at `:57`; hook
wiring in `.claude/settings.json` (`PreToolUse` → `Bash`); the documented web-UI
gap at `.claude/skills/pr-self-review/SKILL.md` §"What this skill cannot do"; the
colliding worktree advice in `server/INSIGHTS.md` (2026-08-05).

### 2026-08-04 — A freshness gate cannot hash a tree that contains its own verdict file

**Tried:** making `pr-self-review`'s verdict unforgeable by recording a
`tree_hash` of every open change — `git status --porcelain`, `git diff HEAD`, and
a `git hash-object` per untracked file — so the `PreToolUse` hook could recompute
it and reject a `pass` written before the last three edits.

**Failed:** every `pass` read as stale the instant it was written. The verdict
lands at `.devdigest/pr-self-review.json`, which is *inside* the tree being
hashed, so writing it changed the hash it had just recorded. The symptom is
maximally confusing: the hook denies with "the working tree changed since the
review" when nothing changed but the review itself. Adding the path to
`.gitignore` is necessary but not sufficient on its own — the gate must not
depend on a file anyone can edit for its correctness.

**Instead:** exclude the directory by **pathspec** in every git command the hash
reads, `':(exclude).devdigest'`, and keep the `.gitignore` entry as well. The rule
generalizes: any check that hashes the working tree to prove its own freshness has
to exclude its own output, and belt-and-braces is right here because a `.gitignore`
edit would otherwise silently break the gate rather than trip it.

Worth knowing for the same reason: `git status --porcelain` reports untracked
files by **name only**, so untracked content must be hashed per file or editing a
brand-new file after a passing review does not invalidate it.

**Where:** `scripts/pr-self-review.sh:29` (`EXCL`) and `:57` (`tree_hash`);
`.gitignore` (`.devdigest/pr-self-review.json`).

### 2026-08-04 — A command gate that matches substrings denies `echo "gh pr create"` — and denied its own tests

**Tried:** enforcing `pr-self-review` with a `PreToolUse` hook on `Bash` that
decided from the command string, first pass
`grep -Eq '\bgh\b.*\bpr\b[[:space:]]+(create|merge)\b'`.

**Failed:** it fires on any command that *mentions* the phrase. The failure
arrived from an unexpected direction — the hook went live the moment
`.claude/settings.json` was written, and then blocked the very Bash calls testing
it, because those calls carried `gh pr create` inside an `echo`. The tool result
came back as a bare denial reason with none of the expected output, which reads
like the script crashed rather than like the gate working correctly.

**Instead:** split the command on `&&`, `||`, `|`, `;` and require a part to
*start* with `gh`; a mention inside an argument belongs to some other program.
`gh pr list` and `gh pr view` stay ungated. Two practical consequences:

- Test a live command-matching hook from a script **outside** the repo, passing
  payloads through a file, so the strings under test never appear in a command
  the hook itself inspects. `.claude/skills/*/SKILL.md` and settings are picked up
  without a restart, so "not wired up yet" is not a safe assumption.
- Fail **closed** on internal error but **silent** on non-match: the gate emits
  nothing and exits 0 for the 99% of Bash calls it does not care about, after a
  single cheap `grep` pre-filter on the raw payload (~12ms; ~95ms when it does
  evaluate).

**Where:** `scripts/pr-self-review.sh:260` (`pr_verb`), hook wiring in
`.claude/settings.json`; 13 behaviour cases in
`.claude/skills/pr-self-review/SKILL.md` §"Blocking, and the way out".

### 2026-08-03 — A `grep -l | perl -pi` sweep fails silently here: `grep` is ugrep, and route paths contain `[brackets]`

**Tried:** rewriting deep relative imports to `@/` across ~16 files with the
usual one-liner, twice.

1. `FILES=$(grep -rlE ... src) && perl -pi -e 's{...}{...}g' $FILES`
2. `grep -rlZ ... | while IFS= read -r -d '' f; do perl -pi ... "$f"; done`

**Failed:** both, for two unrelated reasons, and **neither reported failure in a
way you would notice**.

1. The unquoted `$FILES` expansion collapsed into one argument, and perl died
   with `File name too long` — *after* printing a plausible-looking list of
   filenames, so the output reads like partial success. Nothing was modified.
   Every path in `src/app/repos/[repoId]/pulls/[number]/…` also carries glob
   metacharacters, which is what makes quoting non-optional here in the first
   place.
2. `grep` on this machine is **ugrep**, where `-Z` means *fuzzy matching*, not
   `--null`. So the pipeline produced no NUL-separated records, the `while` loop
   body never ran, and the command exited **0 with no output** — indistinguishable
   from "there was nothing to change".

**Instead:** write the list to a file and loop over lines, quoting the variable:

```sh
grep -rlE 'PATTERN' src --include='*.ts' --include='*.tsx' > /tmp/f.txt
while IFS= read -r f; do perl -pi -e 's{...}{...}g' "$f" && echo "ok $f"; done < /tmp/f.txt
```

The `echo "ok $f"` is the point: a per-file receipt is the only cheap way to tell
"nothing matched" from "the pipeline broke". Then re-run the original `grep` to
confirm zero hits — do not trust the sweep's own exit code. (Filenames in this
repo contain no newlines, so line-based reading is safe; `ugrep` also accepts
`--null` spelled out if you want NUL separation.)

**Where:** the sweep covered `client/src/app/**` and
`client/src/components/app-shell/hooks/*`; the bracket-path routes are
`client/src/app/repos/[repoId]/pulls/[number]/` and
`client/src/app/settings/[section]/`.

### 2026-08-02 — A second web instance can't verify a UI change against the running API

**Tried:** verifying a client change in a real browser without disturbing the
user's dev stack, by starting a second Next dev server on `:3100` pointed at the
existing API on `:3001` (`PORT=3100 pnpm dev`, then
`NEXT_PUBLIC_API_BASE=http://localhost:3001`).

**Failed:** twice, for two unrelated reasons.

1. `PORT=` is ignored — `client/package.json`'s `dev` script is literally
   `next dev -p 3000`, so it booted on 3000 and died with `EADDRINUSE`.
2. Once on the right port, every request was blocked by CORS. `webOrigin` is a
   SINGLE origin computed as `http://localhost:${WEB_PORT}`, and the API
   registers `cors` with `origin: [config.webOrigin]`. The API running on `:3001`
   was started with `WEB_PORT=3000`, so `:3100` is not allowed — and the UI
   surfaces this as "Cannot reach the DevDigest engine", which reads like the API
   is down when it is up and answering `curl` fine.

**Instead:** run a matched PAIR against the same DB —
`API_PORT=3002 WEB_PORT=3100 pnpm dev` in `server/`, then
`NEXT_PUBLIC_API_BASE=http://localhost:3002 pnpm exec next dev -p 3100` in
`client/`. Both read the same `.env` `DATABASE_URL`, so the seeded data is
already there, and the user's `:3000`/`:3001` stack is untouched. Tear down with
`kill $(lsof -ti :3100) $(lsof -ti :3002)`.

**Where:** script at `client/package.json` (`"dev": "next dev -p 3000"`);
CORS at `server/src/app.ts:90`; origin derivation at
`server/src/platform/config.ts:77`.

### 2026-08-02 — Stacking convention blocks into an agent's `system_prompt` made the review worse

**Tried:** teaching `General Reviewer` this repo's conventions by appending a
`# Project conventions` section to its `system_prompt` in the Agent editor, then
a second `## Outbound I/O` subsection on top of it. Target was a one-file PR
(`upstream/demo/review-share-webhook`, +40 lines) carrying a planted SSRF.

**Failed:** both blocks landed, but the third run was worse than the second.

| Run | Prompt | Findings | Score | `tokens_in` |
|---|---|---|---|---|
| 1 | stock | 1 — SSRF | 65 | 3709 |
| 2 | `+ ## Three-layer modules` | 3 — SSRF, SQL-in-routes (conf 1.0), reliability | 41 | 3957 |
| 3 | `+ ## Outbound I/O` | 2 — bare-`fetch` (conf 1.0), **hallucinated** missing-`await` (conf 1.0) | 30 | 4025 |

Run 3 dropped both the SSRF and the SQL-in-routes finding, and invented a
"Missing `await` on `fetch`" defect — the reviewed line literally reads
`await fetch(req.body.url, {`. The stock prompt's own `# Findings discipline`
("report only DISTINCT issues", "there is no minimum") seems to make the model
stop once it has a couple of fresh issues, so a newly added rule crowds out what
the previous run caught.

**Instead:** add one rule at a time, re-run, and treat a single run as evidence
of nothing. Control group from the same session: `Performance Reviewer`, prompt
untouched (`tokens_in` identical at 4139 in every run), went 1 → 4 → 3 findings
and 97 → 0 → 50 score. Run-to-run variance is larger than most prompt edits, so
scoring a prompt change needs the eval harness (`eval_cases` / `eval_runs`), not
eyeballing two runs.

**Where:** the live prompt is `agents.system_prompt`, read at
`server/src/modules/reviews/run-executor.ts:193`.

### 2026-08-02 — `diff -r` is the wrong check for the two `vendor/shared` copies

**Tried:** verifying the canon/copy sync rule with
`diff -r server/src/vendor/shared client/src/vendor/shared`, expecting empty
output (this is what the L01 plan specified as its acceptance gate).

**Failed:** it can never be empty. The two trees carry ~120 lines of documented
pre-existing drift — `openrouter` missing from the client's `Provider` unions,
`AgentManifest`, `AgentVersionConfig`, `CommitFilesPayload`, `sessionId`, plus
divergent comment wording in `trace.ts`. A blanket `cp -r` "fixes" the diff but
silently ships unrelated contract changes far outside the task's scope.

**Instead:** diff only the files you touched, and ignore comments when you do:
`diff <(grep -v '^\s*[/*]' server/src/vendor/shared/<f>) <(grep -v '^\s*[/*]' client/src/vendor/shared/<f>)`.
Green means *your* change is synced, which is the actual rule. Closing the
historical drift is its own task.

**Where:** the drift is catalogued in "Recurring Errors & Fixes" below
(2026-08-01); the copies are `server/src/vendor/shared` and
`client/src/vendor/shared`.

## Codebase Patterns

### 2026-08-09 — Purity is not an address: a pure function does NOT belong in `reviewer-core` just because it has no I/O

**Rule:** when deciding between `reviewer-core/src/**` (ring 1) and
`server/src/modules/<name>/helpers.ts` (ring 2) for a deterministic function, ask
what it operates on, not whether it touches I/O. `backend-onion-architecture`
§8's row "domain logic with no I/O at all → `reviewer-core/src/**`" means **the
review engine's** domain — prompt, grounding, reduce, scoring. Purity is a
property every ring-2 helper also has.

**Why:** the skill's tiebreak, "when two rows seem to fit, take the inner one",
reads as an instruction to push anything pure inward, and it only engages when
both rows genuinely fit. `reviewer-core/src/scope.ts` is the case that looks like
a precedent for inward and is not: it earns ring 1 because it consumes `Finding`
and gates what a review emits — `review/run.ts` calls it. Smart Diff's
`classifyFile` is equally pure but consumes `pr_files` and produces a **UI
transport contract** no engine path calls, so moving it inward would widen ring
1's public API (which grows only via `src/index.ts`) for exactly one ring-2
consumer, in a package whose `build` is `tsc --noEmit` and whose reason to exist
is the review pipeline.

The judgement recurs on every deterministic feature, so carry the **flip
condition** rather than the verdict: if the review pipeline ever wants the same
computation, it *moves* to `reviewer-core` — it is not duplicated there. Two
copies across the package boundary is the outcome to refuse; one copy in the
wrong ring is cheap to relocate.

Note `pnpm arch` is silent on this. Both placements pass every rule — the gate
enforces import *direction*, never whether a module is at the right address. So
this is a judgement that has to be made deliberately and written down, which is
why it is here rather than left to the linter.

**Where:** the ring-2 placement is `server/src/modules/smart-diff/helpers.ts`
(`classifyFile`), consumed by `service.ts` in the same slice; the ring-1
counter-example is `reviewer-core/src/scope.ts`, consumed by
`reviewer-core/src/review/run.ts`; the rows in tension are
`.claude/skills/backend-onion-architecture/SKILL.md` §8 (placement table) and §7
(ring 1 as a functional core). Reasoning of record: `specs/l04-smart-diff.md`
§Risks 2, upheld by the architecture review of that change.

### 2026-08-08 — Adding a prompt slot to `reviewer-core` is TWO edits: `promptTokenCounts` is a hand-written list, not a loop

**Rule:** when you add an optional section to `assemblePrompt` — the `intent`
slot, or whatever comes after it — add a matching row to the `sections` array in
the server's `promptTokenCounts` **in the same change**. Adding only the slot
compiles, passes every test, renders correctly in the trace drawer, and silently
omits that section from `prompt_assembly.token_counts`.

**Why:** the function looks like it derives its keys from the assembly, and the
`PromptAssembly` contract it consumes is a Zod object it could iterate. It does
not — it is an explicit eight-pair literal (`system`, `skills`, `memory`,
`specs`, `callers`, `repo_map`, `pr_description`, `user`), and its loop skips
`null` entries. A ninth key on the assembly is simply never asked about.

The failure is invisible in the direction you would check. `token_counts` is
`.nullish()` and per-key optional by design, precisely so traces written before
L02 stay parseable — so "my section has no token count" is indistinguishable
from "this trace predates the feature". Nothing types it, nothing tests it, and
the trace still renders.

That matters because per-section attribution is the whole point of the field:
its own contract comment says it exists so that "the skills block added N tokens"
is a number rather than a guess. A new slot with no row is a slot whose cost you
cannot argue about — which is exactly when you need the number, since root
`INSIGHTS.md` (2026-08-02) records a prompt addition making a review measurably
*worse*.

Note the two files are in different packages, so neither package's typecheck can
see the coupling.

**Where:** the list is `server/src/modules/reviews/helpers.ts:107-116`
(`promptTokenCounts`), called at `server/src/modules/reviews/run-executor.ts:343`;
the slots it must track are `reviewer-core/src/prompt.ts:104-121` and the
`assembly` object at `:129-138`; the contract is
`server/src/vendor/shared/contracts/trace.ts:39-64` (`token_counts` at `:64`,
nullish for the jsonb reason). Planned use in `specs/l03-intent-layer.md` Step 6.

### 2026-08-08 — Check a body constraint's stated REASON against the frontmatter, not just its conclusion — a right rule with a wrong reason invites you to delete it

**Rule:** when a subagent's body says "you cannot X **because** you have no
`Tool`", verify that clause against the `tools:` / `disallowedTools:` lines
before acting on it. The conclusion and the reason drift independently, and the
dangerous combination is a **true conclusion with a false reason** — because the
obvious fix is to delete the rule.

**Why:** `planner.md` §Discipline read "You cannot write insights. You have no
`Skill` tool." Its frontmatter grants `Skill` — necessarily, since the agent's
whole design is that it opens the same skills `implementer` will (§"Skills — you
load the same set the implementer will"). Spotting the false half makes the
natural move "remove the stale constraint". That would have been a bug: the
conclusion is still correct, for a reason the line never mentions.
`engineering-insights` appends to an `INSIGHTS.md`, and `planner` has neither
`Write` nor `Edit` and runs in `permissionMode: plan`. The skill would load and
fail at the write, spending a turn for nothing.

So the constraint stays; only the reason is corrected. Note the shape: the rule
survived review precisely *because* its conclusion was right, and nothing
mechanical compares a body's factual claims to its own frontmatter.

Same class as the entry below about prose falsified by a new agent — both are
assertions no tooling validates, both read as authority. The cheap check when
touching any agent: `rg -n 'you have no|you cannot|is denied' .claude/agents/*.md`
and read each hit against that file's own `tools:` line.

**Where:** the corrected bullet is `.claude/agents/planner.md` §Discipline (last
item); its frontmatter is `.claude/agents/planner.md:4-5` (`tools:` includes
`Skill`; `disallowedTools:` covers `Write`, `Edit`, `NotebookEdit`) and `:7`
(`permissionMode: plan`). The same false claim in the map was
`.claude/agents/README.md` §"This repo's own record" ("`planner` drops `Skill`
wholesale"), now naming `researcher`, which is the agent that actually does.

### 2026-08-08 — The `pr-self-review` verdict is written by the MODEL, not by the script — so `Write` is the gate, and denying `Skill` protects nothing

**Rule:** when deciding whether an agent can forge the gate that lets a PR
through, look at who writes `.devdigest/pr-self-review.json`. It is the model,
following `pr-self-review/SKILL.md` §3 ("Write `.devdigest/pr-self-review.json`
in the format `report.md` specifies"). `scripts/pr-self-review.sh` never writes
it — its four subcommands are `state`, `files`, `gates`, `gate`, all read-only.

So an agent with `disallowedTools: Write, Edit, NotebookEdit` **cannot** forge a
verdict, whatever else it holds. Removing `Skill` from such an agent buys no
extra safety and costs the entire skill catalogue plus `engineering-insights`.

**Why:** the reflex is the opposite, and it is wrong in a way that looks
rigorous. "There is no per-skill deny, therefore the only way to stop an agent
running `pr-self-review` is to remove `Skill`" (entry below, 2026-08-08) is true
about *invocation* and irrelevant to *effect*. Both new read-only reviewers were
first written with `Skill` denied on exactly that reasoning; the worst outcome
the denial actually prevented was a wasted context window. Meanwhile
`implementer` — which holds **both** `Write` and `Skill`, and is therefore the
strictly more dangerous case — has always been protected by a body contract
alone. Defending the weaker position harder than the stronger one is the tell
that the threat model was never written down.

Two things follow for any future agent. First, ask what the dangerous *effect*
needs, not what the dangerous *name* is: here it needs a file write, so deny the
write. Second, `Bash` re-opens it (`echo … > .devdigest/…`), and that stays a
body contract because `Bash` cannot be scoped by command pattern in frontmatter
— so the honest statement is "blocked by mechanism through the obvious path,
by contract through the shell", not "blocked".

**Where:** the instruction that writes the file is
`.claude/skills/pr-self-review/SKILL.md:120`; the script's subcommand dispatch
is `scripts/pr-self-review.sh:376-379`; the hook that reads the verdict is
`.claude/settings.json` (`PreToolUse` → `Bash`) via `cmd_gate`
(`scripts/pr-self-review.sh:330-344`). The agents that now keep `Skill` with the
prohibition as a contract are `.claude/agents/architecture-reviewer.md` and
`.claude/agents/plan-verifier.md` §Hard constraints; the reasoning is recorded
in `specs/four-subagents.md`.

### 2026-08-08 — Registering a new agent has a FOURTH surface: a prose sentence that the new agent silently falsifies

**Rule:** `.claude/agents/README.md` §"Writing another agent" lists three
registration surfaces — that file, `.claude/skills/README.md` §Agents, and
`AGENTS.md` §Read when. Treat it as three *tables* plus one more job: grep the
same files for **prose claims about the set** and fix those too.

**Why:** `.claude/agents/README.md` carried, immediately under the set table,
"Architecture review and security review are **not** in this set. They are
separate agents and a separate step." Adding `architecture-reviewer` made half
of that sentence false while every table around it was correctly updated — and
a false claim two lines under a correct table is worse than no claim, because a
reader trusts the prose over the row. The same file's §"Why only two skills are
preloaded" was a second one: its title, its opening sentence ("Both agents can
reach all 14 skills") and its whole argument assumed exactly two agents held
`Skill`. `.claude/skills/README.md` had a third — "The pair is a chain, not a
team" — describing three of what are now seven.

None of these is findable by diffing a table. The cheap check before calling the
registration done: `rg -n 'not in this set|both agents|the pair|two agents'` over
`.claude/agents/README.md` and `.claude/skills/README.md`, and read every heading
that contains a number.

This is the same class as the entry below about `routing.md` — a registry the
tooling never validates, where the failure is silent and reads as authority.

**Where:** the falsified sentence was `.claude/agents/README.md` §The set
(now rewritten to say architecture review **is** in the set and security review
still is not); the retitled section is §"What each agent preloads, and why";
the rewritten chain sentence is `.claude/skills/README.md` §Agents. The
five-point contract that needs the fourth point is
`.claude/agents/README.md` §"Writing another agent".

### 2026-08-08 — Package-level `docs/` and `specs/` already exist and are empty — and `e2e/specs/` is not a spec directory

**Rule:** before deciding where a document goes, know that `client/`, `server/`
and `reviewer-core/` each already have **both** `docs/` and `specs/`, and `e2e/`
has `docs/`. All seven hold exactly one file: their own `README.md`. Nothing has
ever been written into any of them. So "there is no package-scoped home for this
document" is false, and creating one is wrong.

The trap on top: **`e2e/specs/` is not a spec directory.** It holds nine
`*.flow.json` deterministic browser flows (`01-app-boot.flow.json`,
`02-repo-pulls-detail.flow.json`, …). A markdown spec written there would sit
next to JSON that a runner globs.

**Why:** a root-scoped look does not show this. `docs/` and `specs/` at the root
have visible content (`docs/l02-experiment.md`, five files in `specs/`), so the
package copies read as "not a thing here" — while every package `AGENTS.md`
§Read when already points at them. The result is a document filed one level too
high, in the shared `docs/`, where it competes with repo-wide decisions.

The routing rule that follows: take the **narrower** home when two fit. A
repo-wide document is what a package document becomes once a second package
needs it — the same promotion logic as `frontend-ui-architecture` §2.

**Where:** `client/docs/README.md`, `client/specs/README.md`,
`server/docs/README.md`, `server/specs/README.md`,
`reviewer-core/docs/README.md`, `reviewer-core/specs/README.md`,
`e2e/docs/README.md`; the flows are `e2e/specs/*.flow.json`. The placement table
that encodes all of this is `.claude/agents/doc-writer.md`
§"Where each kind of document goes".

### 2026-08-08 — Every agent that needs "which skill governs this file" reads `pr-self-review/routing.md` — never its own memory

**Rule:** `.claude/skills/pr-self-review/routing.md` is this repo's single
canonical path→skill table. Any agent, skill or session that has to decide which
skill applies to a changed file derives it from that table and cites the row.
Do not reconstruct the mapping from the skill catalogue, from a skill's
`description`, or from what seems obvious.

**Why:** the table is what keeps two agents with disjoint context windows from
contradicting each other. `planner` names the skills per step by reading it
(§Method 4); `implementer` loads exactly that list and self-routes against the
*same* file when it must touch something the plan did not list (§Method 2). If
each derived its own mapping instead, the plan would be held to one set of rules
and the implementation to another — and the divergence surfaces only at review,
as a finding neither agent could have predicted.

It also encodes decisions that are not inferable from a skill's name: that
`backend-onion-architecture` has nothing to say about a `.tsx` file and must not
be opened for one (context spent, findings invented); that `zod` is what a
`vendor/shared` change pulls in; that `e2e/**` and `.github/workflows/**` are
covered by **no** skill and route to `e2e/AGENTS.md` and `TESTING.md` instead;
and the sentinel paths (`server/src/db/migrations/**`,
`reviewer-core/src/grounding.ts`, `INJECTION_GUARD`) that are a deliberate
decision rather than a drive-by edit.

Consequence when editing: adding a skill to `.claude/skills/` is only half the
job — a skill with no row in `routing.md` is one no agent will ever be told to
open. Add the row in the same change.

**Where:** the table is `.claude/skills/pr-self-review/routing.md`, consumed at
`.claude/skills/pr-self-review/SKILL.md:76` (step 3),
`.claude/agents/planner.md` §Method 4 and `.claude/agents/implementer.md`
§Method 2. The catalogue it must stay in step with is
`.claude/skills/README.md` §Catalog.

### 2026-08-05 — "Created disabled until vetted" is about WHO wrote the body, not about `source !== 'manual'`

**Rule:** a skill built from this repo's own extracted conventions is created
`enabled: true`, even though its `source` is `'extracted'` and the vetting badge
formula is `needsVetting(skill) = source !== "manual" && !enabled`. Do not "fix" it
to `enabled: false` for consistency with the import flow.

**Why:** the disabled-on-import default exists because importing grants a *stranger*
write access to your agent's prompt (entry below, 2026-08-05). The control it buys is
a human reading the body before it takes effect. The conventions extractor already
spent that control, and more of it: the user saw each rule next to the verbatim
snippet that proves it, accepted or rejected it one at a time, could edit the wording,
and then reviewed the merged body in an editable modal before saving. Creating the
result disabled would demand a *second* vetting of text the user just wrote the
verdicts for — and the failure is invisible: the skill sits in `/skills` looking
created while contributing nothing to any review.

The distinction to carry forward: the gate is provenance-of-authorship, not the
`source` enum. `'extracted'` from your own clone is self-authored; the same enum value
for a convention mined out of someone else's repository would not be, and this feature
deliberately does not offer that.

Two consequences worth knowing. `needsVetting` will therefore never fire for these
skills, which is correct rather than a hole. And the residual risk moves to the
evidence snippet: it is model-selected text from repo files that lands **unwrapped**
in every later prompt, so the controls are procedural — proven verbatim against a
file actually read, fenced as a code block, and only the accepted subset promoted. The
data→instruction transition happens exactly at the accept click, which is where a
human is.

**Where:** default set in `server/src/modules/conventions/helpers.ts`
(`buildSkillDraft`, with the reasoning as a comment); asserted by
`server/test/conventions-helpers.test.ts` ("is enabled: the accept/reject loop the
user just completed IS the vetting") and
`server/test/conventions.it.test.ts`; `needsVetting` lives at
`client/src/app/skills/_components/SkillCard/helpers.ts`; reasoning recorded in
`specs/l02-conventions-extractor.md` §Screens and §Trust.

### 2026-08-05 — A skill body must NOT be `wrapUntrusted`-wrapped, however much the UI copy wants it to be

**Rule:** linked skill bodies go into the prompt as plain `## Skills / rules`.
Do not "harden" them by passing them through `wrapUntrusted`, and do not write UI
copy claiming they are delimiter-wrapped. The control on an imported skill is
procedural — preview, explicit confirm, created `enabled: false`, badged until
vetted — never a delimiter.

**Why:** `INJECTION_GUARD` instructs the model that everything inside
`<untrusted>…</untrusted>` is data and that any instruction in it must be ignored.
A skill *is* an instruction. Wrapping one therefore tells the model to ignore the
rule the user just imported and switched on — the feature silently does nothing,
and it fails in the least visible way possible: the block is right there in the
trace, with a token cost, having no effect. `prompt.ts:42` already says as much
("trusted-ish; community skills should be sanitized upstream").

This is worth writing down because the pull toward wrapping is strong and comes
from the product itself: `client/messages/en/skills.json` shipped (before any
skills feature existed) with `file.bodyHint` = "Pasted content is wrapped as
untrusted data — never executed as instructions" and `url.hint` = "stored as
untrusted". Both were false, and both read as a requirement rather than as a
mistake. They are now corrected to state what is true — the body becomes
instructions, which is why import leaves it disabled.

The honest framing for the same reason: importing a skill grants a stranger write
access to your agent's prompt. That is the feature, not a bug to be delimiter-ed
away.

**Where:** guard at `reviewer-core/src/prompt.ts:16` (do not touch — repo rule);
skills rendered unwrapped at `prompt.ts:109`; the disabled-on-import default is
`client/src/app/skills/_components/ImportDrawer/ImportDrawer.tsx` (`enabled: false`);
corrected strings in `client/messages/en/skills.json`; reasoning recorded in
`specs/l02-skills.md` §Trust.

### 2026-08-02 — `CLAUDE.md` is a symlink; the real instruction file is `AGENTS.md`

**Rule:** edit `AGENTS.md`. Each of the five `CLAUDE.md` (root, `server/`,
`client/`, `reviewer-core/`, `e2e/`) is a symlink to the `AGENTS.md` beside it,
and it has to stay one. Never `Write` a fresh `CLAUDE.md` over a link, and never
"resolve the duplication" by deleting one of the two names.

**Why:** Claude Code loads only `CLAUDE.md` — `AGENTS.md` is not read natively,
by design or by setting. So the link is load-bearing, not cosmetic: turn it into
a real file and you get two instruction files that drift silently, with Claude
reading the stale one. Both names must exist, and exactly one of them can hold
content.

**Where:** links at `CLAUDE.md`, `server/CLAUDE.md`, `client/CLAUDE.md`,
`reviewer-core/CLAUDE.md`, `e2e/CLAUDE.md`; rule stated in `AGENTS.md:40`
(Repo rules). Renaming across the repo: a blanket
`sed -i 's/CLAUDE.md/AGENTS.md/g'` must exclude `.claude/skills/zod/` (that
vendored skill ships its own unrelated `AGENTS.md`) and `server/clones/` (a
gitignored stale clone of this repo).

### 2026-08-02 — An `agent_runs` row and its `reviews` row can each outlive the other

**Rule:** when rendering runs and reviews together — they are both on the PR
detail page — never assume one implies the other. A run may have no review, and
a review may have no run row. Code that joins them by `run_id` needs a branch
for "absent", not a `!`.

**Why:** the PR page offers TWO deletes with different blast radii, and neither
touches the other's table. The Timeline's trash calls `DELETE /runs/:id`
(`deleteRun` → run + trace); the run accordion's trash calls
`DELETE /reviews/:id` (`deleteReview` → review + findings, cascade). There is no
FK between them — `RunSummary`'s own comment says "the timeline has no FK to the
review", which is why `findings_count` / `blockers` / `score` are denormalized
onto the run row at completion. So deleting from one place leaves a half-row
visible in the other, and both directions are reachable in a couple of clicks
from the same tab. This is what makes `RunHistory`'s `findingsByRun` prop
optional per row: a run with no review keeps its denormalized `findings_count`
instead of rendering an empty severity breakdown.

**Where:** routes at `server/src/modules/reviews/routes.ts:107` and `:135`;
`deleteReview` deletes only `t.reviews`
(`server/src/modules/reviews/repository/review.repo.ts:83-93`); contract note at
`server/src/vendor/shared/contracts/trace.ts:118-121`; the client's two buttons
are `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:170` (run) and
`.../_components/ReviewRunAccordion/ReviewRunAccordion.tsx` (review); the
fallback is `.../_components/RunHistory/RunHistory.tsx`.

**Superseded by:** 2026-08-03 — the rule is unchanged, but the run-delete button
moved out of the page: it is now the `onDelete` prop passed from
`client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.tsx`
(the page itself is a thin wrapper). The review-delete button did not move.

### 2026-08-02 — A rule added to an agent prompt must state its own severity

**Rule:** every behavioural rule appended to an agent's `system_prompt` has to
say which level to report at — `Report a **WARNING** when …`. Leave it out and
the model defaults to CRITICAL.

**Why:** same agent, same session, two blocks. `## Three-layer modules` spelled
out "Report a **WARNING**" and the finding came back WARNING. `## Outbound I/O`
left severity unstated, and the same class of maintainability issue came back
CRITICAL — which is not cosmetic: the stock `# Verdict` section makes the verdict
a pure function of whether any CRITICAL exists, so the run flipped to
`request_changes` and `score` fell 41 → 30.

**Where:** stock texts are mirrored in `docs/agent-prompts/*.md`; the live copy
is `agents.system_prompt`.

### 2026-08-02 — `## Skills / rules`, `## Relevant memory`, `## Project context` are wired to nothing

**Rule:** until a later lesson wires them, project conventions can reach a review
agent **only** through `agents.system_prompt`. Do not go looking for a
conventions loader — there isn't one.

**Why:** `assemblePrompt` does build those three sections, but only when handed
`skills` / `memory` / `specs`, and the server never hands them over —
`reviewPullRequest()` is called with just `systemPrompt`, `diff`, `callers`,
`repoMap`, `prDescription`, `task`, and the run trace records
`{ skills: null, memory: null, specs: null }` as literals. The `skills`,
`conventions` and `memory` tables are empty by design. The upstream branch
`lesson-2-lab/skills` is presumably what closes this.

**Where:** `reviewer-core/src/prompt.ts:109-114`;
`server/src/modules/reviews/run-executor.ts:192-213` and `:439`.

### 2026-08-02 — A field added to a persisted-jsonb contract must be `.nullish()`

**Rule:** when you add a field to a Zod schema that is stored as a **jsonb
document** rather than as columns, declare it `.nullish()`, never `.nullable()`.
`.nullable()` accepts an explicit `null` but REJECTS a missing key, and every
document already on disk is missing the new key.

**Why:** `RunTrace` is persisted whole into `run_traces.trace`. Declaring
`RunStats.cost_usd` as `.nullable()` would have made every trace written before
L01 unparseable — a silent, total break of run history that no typecheck
catches, because the rows are `jsonb` and only validate at read time. The
sibling field `RunSummary.cost_usd` IS `.nullable()`, and correctly so: it is
rebuilt from columns on every read, so the key is always present.

**Where:** `server/src/vendor/shared/contracts/trace.ts:67` (`RunStats`, nullish)
vs `:112` (`RunSummary`, nullable); persistence at
`server/src/modules/reviews/repository/run.repo.ts:170` (`saveRunTrace`).
Guard test: `server/test/contracts.test.ts:167`.

### 2026-08-02 — Unknown cost is `null`, never `0`

**Rule:** a run that did not bill anything because it never got that far stores
`cost_usd = NULL`. Only a run that genuinely cost nothing stores `0`. The UI
renders `null` as `—` and `0` as `$0.0000`.

**Why:** the failure paths already zero `tokensIn`/`tokensOut`, so the tempting
move is to zero the cost alongside them. That makes a run that died on a missing
API key render as `$0.00` — indistinguishable from a free run, and actively
misleading on a screen whose whole purpose is spend. The distinction is load
bearing across all four render sites, so it is asserted end to end rather than
left as a convention.

**Where:** `server/src/modules/reviews/run-executor.ts:85` (`failAll`) and `:309`
(catch); formatter `client/src/lib/format.ts:17`; asserted in
`server/test/reviews.it.test.ts` ("a failed run records cost_usd = NULL, not 0").

### 2026-08-01 — `costUsd` reaches the server and dies there

**Symptom:** cost is computed in the adapters and accumulated by the engine, but
never surfaces anywhere.

**Cause:** commit `d45ab0d` removed the consumer (per-run cost) and left the
producer in place. This is intentional — the cost badge returns in L01.

**Takeaway:** don't "fix" it as a forgotten wire and don't delete it as dead
code.

**Superseded by:** 2026-08-02 — L01 landed; the consumer is back. `cost_usd` is
persisted on `agent_runs` again (migration `0010_bored_raider.sql`) and rendered
at four sites. The producer side is unchanged: cost still originates in the
adapters and is accumulated by `reviewer-core`, so there is still nothing to
"fix" there.

## Tool & Library Notes

### 2026-08-09 — `pnpm add --lockfile-only` in a scratch copy gives a genuine 400-line lockfile diff in two seconds, with no install

**Quirk:** a demo PR that needs a realistic `pnpm-lock.yaml` diff seems to force
a choice between hand-writing hundreds of lines of fake lock entries and running
a full `pnpm install` in a checkout you do not want. Neither is necessary. pnpm
resolves against the registry and rewrites the lock without touching
`node_modules` when given `--lockfile-only`, and it is happy to do that in a
directory holding nothing but the two files:

```sh
mkdir -p "$SCRATCH/lockgen"
git show origin/main:server/package.json  > "$SCRATCH/lockgen/package.json"
git show origin/main:server/pnpm-lock.yaml > "$SCRATCH/lockgen/pnpm-lock.yaml"
cd "$SCRATCH/lockgen" && pnpm add --lockfile-only exceljs
```

`exceljs` took `server/pnpm-lock.yaml` from 4935 to 5369 lines — 434 added — in
about two seconds, and updated `package.json` in step. Copy both results into
the fixture. Because the resolution is real, the diff is real: no invented
integrity hashes, no lock that contradicts its manifest.

**Workaround:** pick the dependency for its transitive weight when the point is
a big lock diff — a zero-dependency package moves the lock by ~20 lines and will
not make "the lock file is collapsed" legible on a video.

**Where:** `server/package.json` is the manifest to copy; this repo is **not** a
monorepo, so run it against the one package's own lockfile
(`AGENTS.md` §Repo rules). Note `timeout` does not exist on this machine's
zsh — do not wrap the command in it.

### 2026-08-08 — A `.nullish()` z.enum DOES survive `toJsonSchema` — and `Finding.kind` had already proved it in production

**Quirk:** adding an optional enum to the structured-output contract looks risky,
because the only documented precedent (`Finding.skill`) is a nullish **string**,
and the two convert to different JSON Schema shapes:

| Zod | `zodResponseFormat` output |
|---|---|
| `z.string().nullish()` | `{ "type": "string", "nullable": true }` |
| `z.enum([...]).nullish()` | `{ "anyOf": [{ "type": "string", "enum": [...] }, { "type": "null" }] }` |

Both land in `required` — OpenAI's converter puts **every** property there and
expresses optionality through nullability instead, which is why a missing key
still parses on the Zod side while the schema says the field is required.

The part worth knowing before you go looking: **the repo already ships a nullish
enum in that exact schema.** `Finding.kind` is `FindingKind.nullish()`, and
`Finding` is handed straight to `completeStructured` as part of `Review`. So the
`anyOf` shape has been going to real providers since before L03, and
"unverified" was a question that the existing contract had already answered.

**Workaround:** none needed — use `z.enum([...]).nullish()` directly. Verify a
new one the cheap way rather than reasoning about it: `toJsonSchema(Review,
'Review')` and read `properties.findings.items.properties.<field>`. The fallback
that was planned for this (`z.string().nullish()` with the values named in
`.describe()` and normalised server-side) is **not** required and would have cost
a hand-rolled normaliser plus the loss of Zod-side rejection of a bogus value.

Note the general lesson, since the same trap is set for the next optional field:
check whether a sibling field in the same object already has the shape you are
unsure about, before treating the question as open. Also note `nullable: true` is
an OpenAPI-ism rather than standard JSON Schema draft-07 — it is what the bundled
converter emits for a nullish string, and it is not the shape an enum gets.

**Where:** converter at `reviewer-core/src/llm/structured.ts:19`
(`toJsonSchema` → `zodResponseFormat`); the pre-existing nullish enum is
`server/src/vendor/shared/contracts/findings.ts:71` (`kind`), the new one is
`:112` (`scope`); the schema reaches the model at
`reviewer-core/src/review/run.ts:176`. Guard test:
`server/test/prompt-structured.test.ts` ("a NULLISH ENUM survives toJsonSchema").
This **corrects** `specs/l03-intent-layer.md` §Risks 10, which recorded it as
unproven.

### 2026-08-08 — OpenRouter structured-output support is per-ENDPOINT, not per-model — and our request carries no guard, so the symptom is a retry loop, not a routing error

**Quirk:** `response_format: { type: 'json_schema', …, strict: true }` is not a
property of a model on OpenRouter. Its own guide: "Support is determined per
endpoint, not just per model: the same model may be served by multiple providers,
and only some of those providers may support structured outputs." And on strict
mode: "Enforcement varies by provider: some guarantee schema-conforming output,
while others translate your schema into their own structured-output format or
treat it as a strong hint."

Measured on `deepseek/deepseek-v4-flash-0731` via
`/api/v1/models/<slug>/endpoints`: DeepInfra and DigitalOcean advertise
`structured_outputs`; StreamLake, BaseTen, CoreWeave and GMICloud advertise only
`response_format`. So the *same* model id can be served by an endpoint that
honours the schema and by one that treats it as advice, and which you get is a
routing decision you are not making.

What makes it expensive is the failure mode. `OpenRouterProvider.completeStructured`
reprompts on a parse failure up to `maxRetries + 1` times and then throws
`… failed schema validation for <SchemaName>`. That reads as "this model is too
weak for structured output" — so the natural response is to switch to a bigger,
pricier model, which may well work purely because it routed elsewhere. Nothing in
the error mentions the provider.

**Workaround:** send OpenRouter's provider-routing flag —
`provider: { require_parameters: true }`, documented as "the request won't even
be routed to that provider" when it does not support every parameter sent. Today
the request at `openrouter.ts:69-84` has **no** `provider` key at all, and
`StructuredRequest` has no field to carry one, so this needs a field on the
shared contract (both copies) threaded through with the same conditional-spread
shape the file already uses for `session_id` and `usage`.

Make it **opt-in**, not default-on: switching it on globally changes which
providers serve every existing review run, invisibly and possibly at a different
price. A new caller can ask for it; changing the fleet is its own decision.

**Where:** the request is `reviewer-core/src/llm/openrouter.ts:69-84` (the
`response_format` block at `:74-77`, the conditional spreads at `:80` and `:83`);
the contract with no room for it is `server/src/vendor/shared/adapters.ts:55-70`
(`StructuredRequest`), copied at `client/src/vendor/shared/adapters.ts`; the
retry loop that hides the cause is `openrouter.ts:68-115`
(`parseWithRepair` + the final throw). Upstream:
`https://openrouter.ai/docs/guides/features/structured-outputs` and
`https://openrouter.ai/docs/guides/routing/provider-selection`. Verified
2026-08-08; design decision recorded in `specs/l03-intent-layer.md`
§"External findings of record" 2.

### 2026-08-08 — `skills:` and `permissionMode:` exist in subagent frontmatter — and `permissionMode: plan` needs a body rule, because `ExitPlanMode` is stripped

**Quirk:** the entry below lists the frontmatter fields the repo's first subagent
used. It is not wrong, but it is a floor, not the contract. Claude Code 2.1.223
(`claude --version`) supports at least `name`, `description`, `tools`,
`disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`,
`hooks`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt`
— only `name` and `description` are required, and several are gated on
v2.1.212+, so a definition written against them will silently misbehave on an
older CLI. Three that change how you design an agent here:

1. **`skills:` is the only deterministic way to get a skill into a subagent.**
   It injects the skill's **full body** at startup, not its description. Without
   it a subagent still *can* reach every project skill through the `Skill` tool,
   but discovery is description-matching — the same non-deterministic mechanism
   as the main session. So "the agent body mentions the skill by name" is not a
   trigger, and never was.
2. **`permissionMode: plan` on a subagent is a trap on its own.** Plan mode's
   normal exit is `ExitPlanMode`, and that tool is stripped from every subagent
   (see below). An agent that waits for a plan-approval prompt therefore waits
   forever. The mode still buys a real enforced no-edit guarantee, so it is worth
   having — but only with a hard rule in the body.
3. **`disallowedTools` is applied first, then `tools` resolves against what
   remains.** A tool named in both is removed. Listing a constraint twice is
   redundant but harmless, and reads as documentation of intent.

**Workaround:** when using `permissionMode: plan`, state in the body — in the
hard-constraints section, not in passing — that the agent has no `ExitPlanMode`,
must never attempt to call it, and that **its final message *is* the plan**.
`planner.md` does exactly this. For skills, decide per agent: preload the one or
two that apply to almost every task (`implementer` preloads
`backend-onion-architecture` + `frontend-ui-architecture`, and its body says so,
so it does not re-invoke them), and leave the long tail to `Skill` driven by an
explicit list in the plan. Preloading all 13 would cost tens of thousands of
tokens at startup for skills most runs never open. Whether that split actually
routes the right skills is unmeasured — one run proves nothing, and
`docs/l02-experiment.md` is how it would be settled.

**Where:** fields in use at `.claude/agents/planner.md` (frontmatter +
§"Hard constraints", the `ExitPlanMode` rule) and `.claude/agents/implementer.md`
(`skills:` + §"What is already in your context"). Upstream reference:
`https://code.claude.com/docs/en/sub-agents` §"Supported frontmatter fields" and
§"Skills". Version checked: `claude --version` → 2.1.223.

### 2026-08-08 — A subagent has no `AskUserQuestion`, and its tool list resolves differently in background than in foreground

**Quirk:** three things about `.claude/agents/*.md` that the frontmatter does not
hint at, all found while writing the repo's first subagent.

1. **`AskUserQuestion` is stripped from every subagent**, even when named in
   `tools`. So "ask before guessing" cannot be a tool call — a subagent's only
   channel to the user is its final message. Same filter also removes `Agent` at
   the depth limit, `EnterPlanMode`/`ExitPlanMode`, `Workflow`, `TaskOutput`,
   `ScheduleWakeup`, `EndConversation`.
2. **A second filter applies to background subagents, which is the default** (as
   of v2.1.198 Claude Code backgrounds them unless it needs the result now). It
   keeps every MCP tool but only these built-ins: `Read`, `Grep`, `Glob`, `Bash`,
   `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`,
   `TodoWrite`, `Skill`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`,
   `Monitor`, `TaskStop`, `SendMessage`, `Artifact`. Anything else in `tools` is
   dropped **with no error**, so one definition resolves to two different tool
   sets depending on where it runs.
3. **There is no per-skill deny.** `disallowedTools` takes tool names and
   `mcp__server` patterns — not `Skill(deep-research)`. Blocking one skill means
   disallowing the whole `Skill` tool, which also cuts the agent off from
   `engineering-insights`.

**Workaround:** encode the "ask first" requirement as a hard stop in the body —
return *only* a `## Clarification needed` block as the final message, with the
default assumptions it will fall back to — and never rely on a tool for it.
Choose `tools` from the background-safe list above so foreground and background
behave alike. When `Skill` is disallowed, have the agent surface insight-worthy
findings as a line in its report for the caller to capture, since it cannot run
the skill itself. `disallowedTools` is applied first, then `tools` resolves
against what remains, so listing a constraint in both is redundant but harmless —
`researcher.md` does it deliberately, as documentation of intent.

**Superseded by:** 2026-08-08 (entry above) — every claim here still holds, but
the field list it implies is incomplete: `skills:`, `permissionMode:`,
`maxTurns:`, `hooks:`, `memory:`, `effort:` and `isolation:` are supported too.
In particular point 3 ("there is no per-skill deny") is unchanged and still the
reason `planner` denies `Skill` wholesale — but its converse now has an answer:
`skills:` is how you deterministically get a *specific* skill *in*.

**Where:** the definition is `.claude/agents/researcher.md` (frontmatter +
§"Hard constraints" + §"Step 0"); registered in `AGENTS.md` §Read when and
`.claude/skills/README.md` §Agents. Upstream reference:
`https://code.claude.com/docs/en/sub-agents` §"Available tools" and
§"Supported frontmatter fields". Note `.claude/agents/**` is not in
`skills-lock.json`, so unlike most of `.claude/skills/**` it is ours to edit and
will not be overwritten on sync.

### 2026-08-04 — Two shell traps on this machine that both exit 0 with no output

**Quirk:** a string-splitting helper matched nothing, and neither trap announced
itself. Both are macOS defaults, and both were in the same six lines.

1. **BSD `sed` writes a literal `n` for `\n` in a replacement.**
   `sed -E 's/(\&\&|\|\||;|\|)/\n/g'` does not split into lines here — it
   substitutes the character `n`. GNU sed does what you meant, which is why the
   idiom looks correct in every snippet you will find.
2. **`while IFS= read -r x; do … done` never runs the body for a final line with
   no trailing newline.** `printf '%s' "$s"` produces exactly that, so a
   single-part input — the common case — is read into the variable and then
   discarded when `read` returns 1.

Together they produced one unsplit line that was then dropped: the function
returned "no match" for every input, with exit 0 and no diagnostic anywhere.

**Workaround:** split with bash parameter expansion instead of `sed`
(`s="${s//&&/$nl}"`, `||` **before** `|`), feed the loop with `<<< "$s"`, and
write the loop as `while IFS= read -r part || [ -n "$part" ]`. Add this to the
ugrep entry below as the same class of bug: on this machine the standard text
tools are not the GNU ones, and the failure mode is silence rather than an error.

**Where:** `scripts/pr-self-review.sh:260-275` (`pr_verb`).

### 2026-08-04 — `skills-lock.json` covers only 8 of the 13 skills — four vendored-looking ones are ours to edit

**Quirk:** `.claude/skills/` holds 13 skills and the lock holds 8:
`architecture-patterns`, `drizzle-orm-patterns`, `fastify-best-practices`,
`github-workflow-automation`, `next-best-practices`, `postgresql-table-design`,
`typescript-expert`, `zod`. So `react-best-practices`, `react-testing-library`,
`security` and `mermaid-diagram` are **not** locked, despite reading exactly like
vendored upstream files — and two of them (`architecture-patterns`,
`github-workflow-automation`) are locked but not present on disk at all.

**Workaround:** `jq -r '.skills | keys[]' skills-lock.json` is the only reliable
answer to "will my edit be overwritten on sync"; do not infer it from a skill's
tone or from the presence of a `references/` directory. Note this does not soften
the 2026-08-02 entry below — `react-best-practices` is still upstream opinion whose
CRITICAL tags are the vendor's confidence, and editing it in place is still the
wrong fix. It means an edit there would *survive*, not that it is a good idea.

**Where:** `skills-lock.json`; the classifier that acts on it is
`scripts/pr-self-review.sh` (`locked_skills`, `classify` → `skip:vendored-skill`).

### 2026-08-02 — A vendored skill is upstream opinion, not house policy — two of its CRITICAL rules are retracted upstream

**Quirk:** `.claude/skills/react-best-practices/SKILL.md` tags every rule with a
severity, which reads like a house standard. Two of its CRITICAL ones are
positions their own authors have since abandoned:

| Line | Rule as written | Current primary source |
|---|---|---|
| `:24` | "Container components fetch data; presentational components receive props" | Dan Abramov retracted the split in 2019 ("I don't suggest splitting your components like this anymore"); patterns.dev: hooks "achieve the same result without" it |
| `:26` | "Max 200 lines per component — split if larger" | Kent C. Dodds: "I don't mind if the JSX I return in my component function gets really long" — split on a named problem (re-renders, reuse, testing pain), "NOT BEFORE" |

**Workaround:** treat a vendored skill as one opinion to check against
primaries, never as the answer — and remember `skills-lock.json` means any
correction you make in-place is overwritten on the next sync. To supersede one,
write a separate unlocked skill that names the rule it replaces and why. The
severity tag is the trap here: CRITICAL is the vendor's confidence, not
evidence, and nothing in the file dates its claims.

**Where:** `.claude/skills/react-best-practices/SKILL.md:24` and `:26`; the
locked list is `skills-lock.json`. Sourcing and the full conflict set are in
`.claude/skills/frontend-ui-architecture/RESEARCH.md` (§2); the superseding
rules are `.claude/skills/frontend-ui-architecture/SKILL.md` §4.

**Quirk:** git stores a symlink as mode `120000` with no `.gitattributes` and no
config — a fresh checkout materializes a real link. But a Windows checkout
WITHOUT `core.symlinks=true` (or Developer Mode) writes a regular file whose
entire content is the target path. For `CLAUDE.md` that means Claude Code loads a
one-line memory file reading `AGENTS.md` — no error, no warning, the project
instructions are simply gone and the session looks like the repo has no
conventions.

**Workaround:** on Windows clone with `git clone -c core.symlinks=true`. To
verify a checkout anywhere: `git ls-files -s '*CLAUDE.md'` must print `120000`
on every row (`100644` means the link was flattened or a tool dereferenced it),
and `/context` must show a non-trivial token count for the memory file — ~1.8k
for root, not ~10. To test the staged links before committing, use
`git checkout-index -a -f --prefix=/tmp/check/`; a plain `git clone .` only
reflects HEAD and will show the pre-rename layout.

**Where:** `CLAUDE.md` and `<pkg>/CLAUDE.md`; no `.gitattributes` exists in this
repo and none is needed.

### 2026-08-02 — `findings.confidence` is not calibrated — never gate on it

**Quirk:** the model emits `confidence: 1.0` for a hallucination as readily as
for a correct finding. One run returned "Missing `await` on `fetch`" at
confidence 1.0 against a line that reads `await fetch(...)`; the previous run's
correct SQL-in-routes finding also came in at 1.0.

**Workaround:** do not filter, sort, rank or auto-act on `confidence` — treat it
as prose, not a signal. Note that grounding does not cover this either:
`agent_runs.grounding` ("2/2 passed") only proves the cited lines exist in the
diff, never that the claim about them is true.

**Where:** `findings.confidence`; `agent_runs.grounding`.

## Recurring Errors & Fixes

### 2026-08-01 — `@devdigest/shared` drifts silently between server and client

**Symptom:** the client's types don't know about the `openrouter` provider even
though the server fully supports it; `AgentManifest`, `AgentVersionConfig`,
`CommitFilesPayload` and the `sessionId` field are missing too.

**Cause:** the contracts are vendored twice — `server/src/vendor/shared` (canon)
and `client/src/vendor/shared` (copy). There is no sync script, and CI can't
catch the divergence because each package typechecks in isolation and both pass.

**Takeaway:** always edit the canon and port the change in the same commit.
Before touching contracts, check: `diff -r server/src/vendor/shared
client/src/vendor/shared`.

**Superseded by:** 2026-08-08 — the recurring error is real and the takeaway
stands, but two of its specifics are now false, and both mislead in the
expensive direction (they make you plan work that is already done).

1. **`openrouter` is NOT missing from the client's `Provider` union.**
   `client/src/vendor/shared/contracts/knowledge.ts:312` reads
   `z.enum(['openai', 'anthropic', 'openrouter'])`. So setting a client-side
   default to the `openrouter` provider typechecks today, and no porting step is
   needed for it. Re-verified 2026-08-08 while planning L03, which had budgeted
   for exactly that port.
2. **There IS sync tooling now.** `scripts/check-shared-sync.sh` freezes today's
   drift as `scripts/shared-sync.baseline` and fails only on **new** drift, with
   comments and blank lines ignored. It is the check to run, not `diff -r` — the
   2026-08-02 "What Doesn't Work" entry explains why a blanket `diff -r` can
   never be empty here. Use `--update` to re-record the baseline deliberately.

The other four names in the symptom above are unchanged and still absent from the
client copy: `AgentManifest`, `AgentVersionConfig`, `CommitFilesPayload` and
`sessionId` each appear in `server/src/vendor/shared` and in **no** file under
`client/src/vendor/shared`. Closing that gap is still its own task.

## Session Notes

_Empty so far._

## Open Questions

### 2026-08-02 — The `pnpm arch` boundary gate is not wired into CI, so nothing enforces it on a PR

**Question:** should the architecture gate run in `server-unit.yml`, and as what?
`cd server && pnpm arch` (`dependency-cruiser`, 10 ring rules across `server/src`
and `reviewer-core/src`) currently runs **only when someone runs it by hand**. A
PR that puts Drizzle back into a new `routes.ts`, or `node:fs` into
`reviewer-core`, is green in CI today. The skill it enforces reads as house law,
which makes the gap worse than having no gate: the rules look enforced.

**Blocked:** on a decision, not on work — deliberately left out of the change that
introduced the gate. Two things to get right when it lands: the step must be an
inlined `pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs`
rather than `pnpm arch`, because `server-unit.yml` already avoids depending on
`package.json` scripts (its own comment explains why), and it needs
`reviewer-core`'s deps installed first — the same `npm ci` step the typecheck job
already runs, since unresolvable imports there would trip
`core-resolves-everything`. Path filters already cover `server/**` and
`reviewer-core/**`.

**Where:** `.github/workflows/server-unit.yml` (typecheck job, after the
"Install reviewer-core deps" step); gate at `server/.dependency-cruiser.cjs`;
rules documented in `.claude/skills/backend-onion-architecture/SKILL.md` §10.
