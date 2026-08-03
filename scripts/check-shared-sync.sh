#!/usr/bin/env bash
# Guard the two copies of @devdigest/shared against NEW drift.
#
#   server/src/vendor/shared   canon
#   client/src/vendor/shared   manual copy
#
# There is no sync tooling, and each package typechecks in isolation, so the two
# trees diverge silently — root INSIGHTS.md has carried that as a recurring error
# since 2026-08-01. This script does not try to close the existing ~120 lines of
# drift (that is its own task, and a blanket `cp -r` would ship unrelated
# contract changes). It freezes today's drift as a baseline and fails only when
# something NEW appears.
#
#   ./scripts/check-shared-sync.sh            check against the baseline
#   ./scripts/check-shared-sync.sh --update   re-record the baseline (deliberate)
#
# Comparison ignores comments and blank lines, because the two trees also carry
# divergent comment wording that is not a contract difference. Output is a
# sorted list of `path: <canon-only` / `path: >copy-only` content lines, so it is
# stable when unrelated code shifts line numbers — a plain `diff -u` would churn
# on every edit above a drifted line.
set -euo pipefail

cd "$(dirname "$0")/.."

CANON="server/src/vendor/shared"
COPY="client/src/vendor/shared"
BASELINE="scripts/shared-sync.baseline"

[ -d "$CANON" ] || { echo "::error::missing $CANON"; exit 1; }
[ -d "$COPY" ]  || { echo "::error::missing $COPY"; exit 1; }

# Drop comment-only lines and blanks. Deliberately the same crude filter the
# repo already documents in INSIGHTS.md — it is not a parser, and it does not
# need to be: a trailing `// note` on a real declaration stays on the line, so
# a genuine contract change is never hidden by it.
strip() { grep -vE '^[[:space:]]*(//|/\*|\*)' "$1" 2>/dev/null | grep -vE '^[[:space:]]*$' || true; }

current="$(mktemp)"
trap 'rm -f "$current"' EXIT

# Union of both file lists, so a file added to one side only is reported too.
{ (cd "$CANON" && find . -name '*.ts' -type f); (cd "$COPY" && find . -name '*.ts' -type f); } \
  | sed 's|^\./||' | sort -u | while read -r rel; do
    a="$CANON/$rel"; b="$COPY/$rel"
    if [ ! -f "$a" ]; then echo "$rel: FILE MISSING FROM CANON"; continue; fi
    if [ ! -f "$b" ]; then echo "$rel: FILE MISSING FROM COPY"; continue; fi
    diff <(strip "$a") <(strip "$b") | grep -E '^[<>]' | sed "s|^|$rel: |" || true
  done | sort > "$current"

if [ "${1:-}" = "--update" ]; then
  cp "$current" "$BASELINE"
  echo "Baseline updated: $(wc -l < "$BASELINE" | tr -d ' ') drifting lines recorded in $BASELINE"
  exit 0
fi

if [ ! -f "$BASELINE" ]; then
  echo "::error::no baseline at $BASELINE — run './scripts/check-shared-sync.sh --update' once and commit it"
  exit 1
fi

if diff -u "$BASELINE" "$current" > /tmp/shared-sync.delta; then
  echo "OK — contract drift unchanged ($(wc -l < "$BASELINE" | tr -d ' ') known differing lines)."
  exit 0
fi

cat <<'MSG'
::error::@devdigest/shared drift changed.

The canon is server/src/vendor/shared; client/src/vendor/shared is a manual copy.
Edit the canon first, then port the same change to the copy in the SAME commit.

Lines prefixed `-` were expected drift that disappeared (fine if you just synced
a contract — re-record the baseline). Lines prefixed `+` are NEW drift and are
almost always the bug: a field added to one copy only.

  re-record:  ./scripts/check-shared-sync.sh --update   (then commit the baseline)
MSG
cat /tmp/shared-sync.delta
exit 1
