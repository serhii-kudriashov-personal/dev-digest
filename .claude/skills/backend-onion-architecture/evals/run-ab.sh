#!/usr/bin/env bash
# A/B this skill's SKILL.md against an earlier revision of itself, on evals.json.
#
#   ./run-ab.sh [BASELINE_REF] [OUT_DIR] [MODEL]
#   ./run-ab.sh HEAD~1 /tmp/onion-ab sonnet
#
# Builds one throwaway workspace per (variant × eval case), each holding only
# that variant's SKILL.md plus the case's fixture tree, runs `claude -p` in it,
# then grades every report against the case's `expectations` with a second
# `claude -p` that sees the report and nothing else.
#
# Both variants get the identical prompt, including the instruction to load the
# skill — this measures the skill's CONTENT, not its triggering. A skill-blind
# baseline is a different experiment: drop `Skill` from --allowedTools.
set -euo pipefail

BASELINE_REF="${1:-HEAD}"
OUT="${2:-${TMPDIR:-/tmp}/onion-ab}"
MODEL="${3:-sonnet}"

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(git -C "$SKILL_DIR" rev-parse --show-toplevel)"
REL="${SKILL_DIR#"$REPO"/}"

rm -rf "$OUT"; mkdir -p "$OUT"
git -C "$REPO" show "$BASELINE_REF:$REL/SKILL.md" > "$OUT/SKILL.old.md"
cp "$SKILL_DIR/SKILL.md" "$OUT/SKILL.new.md"

CASES=$(python3 -c "
import json,sys
print(' '.join(e['name'] for e in json.load(open('$SKILL_DIR/evals/evals.json'))['evals']))")

SUFFIX=$'\n\nBefore you start, load the `backend-onion-architecture` skill with the Skill tool and apply its rules. Write the report to `findings.md` in the current directory.'

for v in old new; do
  for c in $CASES; do
    ws="$OUT/runs/$v/$c"
    mkdir -p "$ws/.claude/skills/backend-onion-architecture"
    cp "$OUT/SKILL.$v.md" "$ws/.claude/skills/backend-onion-architecture/SKILL.md"
    cp -R "$SKILL_DIR/evals/fixtures/$c/." "$ws/"
    python3 -c "
import json
ev = next(e for e in json.load(open('$SKILL_DIR/evals/evals.json'))['evals'] if e['name'] == '$c')
open('$ws/prompt.txt','w').write(ev['prompt'] + '''$SUFFIX''')"
  done
done

run() { # variant case prompt-file out-file  — one headless claude call
  ( cd "$3" && claude -p "$(cat "$4")" --model "$MODEL" \
      --permission-mode bypassPermissions --allowedTools "$5" \
      --setting-sources project --strict-mcp-config \
      --output-format json > "$6" 2>/dev/null ) || echo "FAILED $1/$2" >&2
}

echo "reviewing ($BASELINE_REF vs working tree, model=$MODEL) …"
for v in old new; do for c in $CASES; do
  ws="$OUT/runs/$v/$c"; run "$v" "$c" "$ws" "$ws/prompt.txt" "Read Grep Glob Skill Write" "$ws/run.json" &
done; done; wait

echo "grading …"
python3 "$SKILL_DIR/evals/grade.py" "$SKILL_DIR/evals/evals.json" "$OUT" prompts
for v in old new; do for c in $CASES; do
  ws="$OUT/runs/$v/$c"; run "$v" "$c" "$OUT" "$ws/judge-prompt.txt" "" "$ws/judge.json" &
done; done; wait

python3 "$SKILL_DIR/evals/grade.py" "$SKILL_DIR/evals/evals.json" "$OUT" report
