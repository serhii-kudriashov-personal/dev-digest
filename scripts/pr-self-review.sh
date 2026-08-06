#!/usr/bin/env bash
# PR Self Review — the deterministic half of the `pr-self-review` skill.
#
# The skill (.claude/skills/pr-self-review/SKILL.md) does the judgement: it routes
# the diff to the skills that can speak about it, reads them, and writes findings.
# Everything mechanical lives here, so the two halves can never disagree about
# what "the open changes" are or whether a verdict is still fresh.
#
#   ./scripts/pr-self-review.sh state    base/head/tree identity, as JSON
#   ./scripts/pr-self-review.sh files    changed files, TSV: <status>\t<path>
#   ./scripts/pr-self-review.sh gates    deterministic gates, TSV: <status>\t<name>\t<detail>
#   ./scripts/pr-self-review.sh gate     PreToolUse hook mode — reads hook JSON on stdin
#
# `state` exists so the verdict file records the SAME tree_hash the hook later
# recomputes. Two implementations of that hash would make every verdict read as
# stale, and a gate that always denies gets switched off within a day.
#
# The file list is built with quoted per-line reads, never a
# `grep -lZ | while read -d ''` pipeline: root INSIGHTS.md (2026-08-03) records
# that `grep` here is ugrep, where -Z means fuzzy matching, so that shape exits 0
# with no output — indistinguishable from "nothing to review".
set -uo pipefail

cd "$(dirname "$0")/.."

VERDICT_FILE=".devdigest/pr-self-review.json"
LOG_DIR=".devdigest/pr-self-review-logs"
# This skill's own artifacts never count as reviewable changes. See tree_hash().
EXCL=':(exclude).devdigest'

# ---------------------------------------------------------------- identity ----

default_branch() {
  local ref
  ref=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null) || ref=""
  if [ -n "$ref" ]; then
    printf '%s\n' "${ref#refs/remotes/origin/}"
  else
    printf 'main\n'
  fi
}

base_sha() {
  local db="$1"
  git merge-base HEAD "origin/$db" 2>/dev/null || git rev-parse HEAD
}

# Hash of every open change: the porcelain status, the full tracked diff against
# HEAD (staged and unstaged in one), and a content hash per untracked file.
# Untracked contents are hashed individually because `git status` reports only
# their names — editing a brand-new file after a passing review must invalidate it.
#
# .devdigest/ is excluded by pathspec, not only by .gitignore. Writing the verdict
# file is itself a change to the tree, so without this the hash recorded in the
# verdict can never match the hash the hook recomputes: every `pass` reads as
# stale the instant it is written.
tree_hash() {
  {
    git status --porcelain -- . "$EXCL"
    git diff HEAD -- . "$EXCL"
    while IFS= read -r f; do
      printf '%s ' "$f"
      git hash-object -- "$f" 2>/dev/null || printf 'unhashable\n'
    done < <(git ls-files --others --exclude-standard -- . "$EXCL")
  } | git hash-object --stdin
}

cmd_state() {
  local db base head tree branch
  db=$(default_branch)
  base=$(base_sha "$db")
  head=$(git rev-parse HEAD)
  tree=$(tree_hash)
  branch=$(git rev-parse --abbrev-ref HEAD)
  jq -n \
    --arg base "$base" --arg head "$head" --arg tree "$tree" \
    --arg branch "$branch" --arg db "$db" \
    '{base_sha:$base, head_sha:$head, tree_hash:$tree, branch:$branch, default_branch:$db}'
}

# ------------------------------------------------------------------- files ----

locked_skills() {
  [ -f skills-lock.json ] || return 0
  jq -r '.skills | keys[]' skills-lock.json 2>/dev/null || true
}

LOCKED=""

is_locked_skill() {
  local name="$1" s
  for s in $LOCKED; do
    [ "$s" = "$name" ] && return 0
  done
  return 1
}

# review           — send it to the routing table
# sentinel:<what>  — a "do not touch" path; reviewed AND always a finding
# skip:<why>       — not reviewed, but reported, so silence never reads as clean
classify() {
  local p="$1" name
  case "$p" in
    node_modules/*|*/node_modules/*)              printf 'skip:deps\n'; return ;;
    *pnpm-lock.yaml|*package-lock.json)           printf 'skip:lockfile\n'; return ;;
    server/src/db/migrations/*)                   printf 'sentinel:migrations\n'; return ;;
    reviewer-core/src/grounding.ts)               printf 'sentinel:grounding\n'; return ;;
    reviewer-core/src/prompt.ts)                  printf 'sentinel:injection-guard\n'; return ;;
    # vendor/shared is the contract canon and carries its own sync rule — it is
    # reviewed. Every other vendored tree is not ours to refactor.
    */src/vendor/shared/*)                        printf 'review\n'; return ;;
    */src/vendor/*)                               printf 'skip:vendored\n'; return ;;
  esac
  case "$p" in
    .claude/skills/*)
      name="${p#.claude/skills/}"
      name="${name%%/*}"
      if is_locked_skill "$name"; then printf 'skip:vendored-skill\n'; return; fi ;;
  esac
  printf 'review\n'
}

# Committed on the branch + staged + unstaged + untracked, deduplicated.
# Uncommitted work counts: "before opening a PR" means the tree as it will be
# pushed, and BASE..HEAD alone misses what is about to be committed.
collect_files() {
  local db base
  db=$(default_branch)
  base=$(base_sha "$db")
  {
    git diff --name-only "$base" HEAD -- . "$EXCL"
    git diff --name-only HEAD -- . "$EXCL"
    git ls-files --others --exclude-standard -- . "$EXCL"
  } 2>/dev/null | sed '/^$/d' | sort -u
}

cmd_files() {
  LOCKED=$(locked_skills)
  local f
  while IFS= read -r f; do
    printf '%s\t%s\n' "$(classify "$f")" "$f"
  done < <(collect_files)
}

# ------------------------------------------------------------------- gates ----

FAILED=0

emit() { printf '%s\t%s\t%s\n' "$1" "$2" "$3"; }

run_gate() {
  local name="$1" dir="$2"
  shift 2
  local log="$LOG_DIR/${name//:/-}.log"
  if ( cd "$dir" && "$@" ) >"$log" 2>&1; then
    emit pass "$name" '-'
  else
    emit fail "$name" "$log"
    FAILED=1
  fi
}

# A DB-backed test must be named *.it.test.ts or the CI split breaks silently:
# the unit lane excludes that glob, the integration lane selects only it, so a
# misnamed DB test is collected by the lane that has no Postgres. TESTING.md
# states the trigger precisely — the file imports test/helpers/pg.ts.
gate_test_naming() {
  local list="$1" f bad=""
  while IFS= read -r f; do
    case "$f" in
      *.it.test.ts) continue ;;
      *.test.ts|*.test.tsx) ;;
      *) continue ;;
    esac
    [ -f "$f" ] || continue
    if grep -q "helpers/pg" "$f" 2>/dev/null; then
      bad="$bad $f"
    fi
  done < "$list"
  if [ -n "$bad" ]; then
    emit fail 'test-naming' "DB-backed but not *.it.test.ts:$bad"
    FAILED=1
  else
    emit pass 'test-naming' '-'
  fi
}

# Every CLAUDE.md is a symlink to the AGENTS.md beside it. Flattened to a regular
# file it becomes a one-line memory reading "AGENTS.md" — no error, no warning,
# the project instructions are simply gone.
gate_symlinks() {
  local bad
  bad=$(git ls-files -s '*CLAUDE.md' | awk '$1 != "120000" { print $4 }')
  if [ -n "$bad" ]; then
    emit fail 'symlinks' "not mode 120000: $(printf '%s' "$bad" | tr '\n' ' ')"
    FAILED=1
  else
    emit pass 'symlinks' '-'
  fi
}

cmd_gates() {
  mkdir -p "$LOG_DIR"
  local list
  list=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$list'" EXIT

  LOCKED=$(locked_skills)
  local f status
  while IFS= read -r f; do
    status=$(classify "$f")
    case "$status" in skip:*) continue ;; esac
    printf '%s\n' "$f" >> "$list"
  done < <(collect_files)

  local server=0 client=0 core=0 shared=0 instructions=0
  while IFS= read -r f; do
    case "$f" in
      server/*)                    server=1 ;;
      client/*)                    client=1 ;;
      reviewer-core/*)             core=1 ;;
    esac
    case "$f" in
      */src/vendor/shared/*)       shared=1 ;;
      *CLAUDE.md|*AGENTS.md)       instructions=1 ;;
    esac
  done < "$list"

  # The server typechecks reviewer-core's sources too, so a core change is gated
  # by both. `pnpm arch` is the dependency-cruiser ring gate — root INSIGHTS.md
  # records it as NOT wired into CI, which makes this its only run on a change.
  if [ "$server" = 1 ] || [ "$core" = 1 ]; then
    run_gate 'server:typecheck' server pnpm typecheck
    run_gate 'server:arch'      server pnpm arch
  fi
  [ "$core" = 1 ]   && run_gate 'core:typecheck'   reviewer-core pnpm typecheck
  if [ "$client" = 1 ]; then
    run_gate 'client:typecheck' client pnpm typecheck
    run_gate 'client:lint'      client pnpm lint
  fi
  # Not `diff -r`: the two vendor/shared copies carry ~120 lines of documented
  # pre-existing drift, so a blanket diff can never be empty (INSIGHTS 2026-08-02).
  [ "$shared" = 1 ] && run_gate 'shared:sync' . ./scripts/check-shared-sync.sh

  gate_test_naming "$list"
  [ "$instructions" = 1 ] && gate_symlinks

  return "$FAILED"
}

# -------------------------------------------------------------------- hook ----

# Prints `create` or `merge` when the command actually RUNS one of them; exits 1
# otherwise. Matching the bare string anywhere in the command is wrong: it denies
# `echo "gh pr create"` and every grep for it, which is how a gate earns a
# reputation for getting in the way. So the command is split on shell operators
# and each part is tested for *starting* with `gh` — an argument that merely
# mentions it belongs to some other program.
pr_verb() {
  local s="$1" part rest nl=$'\n'
  # Split on shell operators with parameter expansion, not `sed`: BSD sed on
  # macOS writes a literal `n` for `\n` in a replacement, so the sed version
  # silently produced one unsplit line and matched nothing. `||` before `|`.
  s="${s//&&/$nl}"
  s="${s//||/$nl}"
  s="${s//|/$nl}"
  s="${s//;/$nl}"
  # `|| [ -n "$part" ]` is required: the last line carries no trailing newline,
  # and a bare `while read` never runs the body for it.
  while IFS= read -r part || [ -n "$part" ]; do
    part="${part#"${part%%[![:space:]]*}"}"          # ltrim
    case "$part" in
      gh|gh[[:space:]]*) rest="${part#gh}" ;;
      *) continue ;;
    esac
    if printf '%s' "$rest" | grep -Eq '(^|[[:space:]])pr[[:space:]]+merge([[:space:]]|$)'; then
      printf 'merge\n'; return 0
    fi
    if printf '%s' "$rest" | grep -Eq '(^|[[:space:]])pr[[:space:]]+create([[:space:]]|$)'; then
      printf 'create\n'; return 0
    fi
  done <<< "$s"
  return 1
}

deny() {
  jq -n --arg reason "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}

note() {
  jq -n --arg msg "$1" '{systemMessage:$msg, suppressOutput:true}'
  exit 0
}

# PreToolUse on Bash. Denies `gh pr create` / `gh pr merge` unless a verdict file
# says `pass` for exactly this tree. Fails CLOSED — an internal error denies with
# a named cause rather than waving the call through, because a gate that opens on
# its own breakage is not a gate.
cmd_gate() {
  set +e
  local payload cmd
  payload=$(cat)

  # Cheap pre-filter on the raw payload. This hook is matched on every Bash call,
  # so the overwhelmingly common case must cost one grep and no jq. The precise
  # check below still runs on whatever survives.
  printf '%s' "$payload" | grep -Eq 'gh.{0,40}pr[^a-z]{1,4}(create|merge)' || exit 0

  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)

  # Not a PR-opening command — stay silent and out of the way.
  local verb
  verb=$(pr_verb "$cmd") || exit 0

  local db branch
  db=$(default_branch)
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || branch=''
  [ -n "$branch" ] || deny "pr-self-review: cannot read the current branch — is this a git repository?"

  # The gate guards the branch you are on. On the default branch there are no
  # local open changes to self-review, so gating `gh pr merge 123` from main
  # would be pure noise.
  if [ "$branch" = "$db" ] && [ "$verb" = 'merge' ]; then
    note "pr-self-review: on $db, no local changes to review — merge not gated."
  fi

  [ -f "$VERDICT_FILE" ] && [ -r "$VERDICT_FILE" ] || deny \
"pr-self-review: no verdict for this branch. Run /pr-self-review before \`gh pr $verb\`."

  local v_head v_tree v_verdict v_override
  v_head=$(jq -r '.head_sha // ""'  "$VERDICT_FILE" 2>/dev/null)
  v_tree=$(jq -r '.tree_hash // ""' "$VERDICT_FILE" 2>/dev/null)
  v_verdict=$(jq -r '.verdict // ""' "$VERDICT_FILE" 2>/dev/null)
  v_override=$(jq -r '.overridden_by_user // false' "$VERDICT_FILE" 2>/dev/null)

  [ -n "$v_verdict" ] || deny \
"pr-self-review: $VERDICT_FILE is unreadable or has no verdict. Re-run /pr-self-review."

  local head tree
  head=$(git rev-parse HEAD 2>/dev/null)
  tree=$(tree_hash)

  if [ "$v_head" != "$head" ]; then
    deny "pr-self-review: the verdict is for commit ${v_head:0:8}, HEAD is now ${head:0:8}. Re-run /pr-self-review."
  fi
  if [ "$v_tree" != "$tree" ]; then
    deny "pr-self-review: the working tree changed since the review. Re-run /pr-self-review."
  fi

  if [ "$v_verdict" = 'block' ] && [ "$v_override" != 'true' ]; then
    local criticals
    criticals=$(jq -r '
      [.findings[]? | select(.severity == "CRITICAL")]
      | if length == 0 then "(none listed)"
        else map("  - \(.file):\(.line // "?") — \(.rule) [\(.source)]") | join("\n") end
    ' "$VERDICT_FILE" 2>/dev/null)
    deny "pr-self-review: BLOCKED — CRITICAL findings stand:
$criticals

Fix them and re-run /pr-self-review, or state the override explicitly so it is recorded in $VERDICT_FILE."
  fi

  if [ "$v_verdict" = 'block' ]; then
    note "pr-self-review: proceeding on a recorded user override — CRITICAL findings were waived."
  fi

  note "pr-self-review: pass @ ${head:0:8}."
}

# -------------------------------------------------------------------- main ----

case "${1:-}" in
  state) cmd_state ;;
  files) cmd_files ;;
  gates) cmd_gates ;;
  gate)  cmd_gate  ;;
  *)
    printf 'usage: %s {state|files|gates|gate}\n' "$0" >&2
    exit 64 ;;
esac
