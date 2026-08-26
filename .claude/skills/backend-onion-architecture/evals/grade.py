#!/usr/bin/env python3
"""Two halves of `run-ab.sh`'s grading step.

    grade.py evals.json OUT prompts   # write one judge prompt per run
    grade.py evals.json OUT report    # parse the judge verdicts, print the table

Kept separate from run-ab.sh so the grading can be re-run against edited
`expectations` without re-running the reviews — the reports are already on disk,
so a re-grade cannot be tuned toward a variant.
"""
import json, pathlib, re, sys

EVALS, OUT, MODE = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
CASES = [e['name'] for e in json.loads(EVALS.read_text())['evals']]
BY_NAME = {e['name']: e for e in json.loads(EVALS.read_text())['evals']}
VARIANTS = ('old', 'new')

JUDGE = """You are grading one code-review report against a fixed list of assertions.

For each assertion, decide PASS or FAIL:
- PASS = the report clearly makes that point. Wording may differ; the substance must be there.
- FAIL = the report does not make that point, makes only a vaguely related point, or contradicts it.

Be strict. An assertion that names a specific mechanism (a config glob, a rule name, a
consequence) is PASS only if the report actually states that mechanism, not merely the
generic problem it sits on top of. Do not give credit for something the report "implies".

Assertions:
{assertions}

--- BEGIN REPORT ---
{report}
--- END REPORT ---

Reply with ONLY a JSON object, no prose, no code fence:
{{"results": [{{"n": 1, "verdict": "PASS"|"FAIL", "quote": "<short quote, or empty>"}}, ...]}}
"""


def report_text(ws):
    fm = ws / 'findings.md'
    if fm.exists():
        return fm.read_text()
    try:
        return json.loads((ws / 'run.json').read_text()).get('result', '')
    except Exception:
        return ''


def verdicts(ws):
    try:
        raw = json.loads((ws / 'judge.json').read_text()).get('result', '')
    except Exception:
        return []
    m = re.search(r'\{.*\}', raw, re.S)
    if m:
        try:
            return json.loads(m.group(0))['results']
        except json.JSONDecodeError:
            pass  # an unescaped quote inside the judge's `quote` field
    pairs = re.findall(r'"n"\s*:\s*(\d+).*?"verdict"\s*:\s*"(PASS|FAIL)"', raw, re.S)
    return [{'n': int(n), 'verdict': v, 'quote': ''} for n, v in pairs]


if MODE == 'prompts':
    for v in VARIANTS:
        for c in CASES:
            ws = OUT / 'runs' / v / c
            exps = BY_NAME[c]['expectations']
            (ws / 'judge-prompt.txt').write_text(JUDGE.format(
                assertions='\n'.join(f'{i+1}. {e}' for i, e in enumerate(exps)),
                report=report_text(ws) or '(empty report)'))
    sys.exit()

rows, totals = {}, {v: [0, 0] for v in VARIANTS}
print(f"{'case':<22} {'assert':<7} {'old':<6} {'new':<6}")
for c in CASES:
    res = {v: verdicts(OUT / 'runs' / v / c) for v in VARIANTS}
    for i in range(max(len(res['old']), len(res['new']))):
        vd = {v: (res[v][i]['verdict'] if i < len(res[v]) else '?') for v in VARIANTS}
        print(f"{c:<22} {i+1:<7} {vd['old']:<6} {vd['new']:<6}")
        for v in VARIANTS:
            totals[v][1] += 1
            totals[v][0] += vd[v] == 'PASS'
    rows[c] = {v: [sum(x['verdict'] == 'PASS' for x in res[v]), len(res[v])] for v in VARIANTS}
    print(f"{c:<22} {'TOTAL':<7} {rows[c]['old'][0]}/{rows[c]['old'][1]:<4} "
          f"{rows[c]['new'][0]}/{rows[c]['new'][1]}\n")

for v in VARIANTS:
    p, n = totals[v]
    print(f'OVERALL {v}: {p}/{n} ({100*p/max(1,n):.0f}%)')

for v in VARIANTS:
    cost = out = 0
    for c in CASES:
        try:
            rj = json.loads((OUT / 'runs' / v / c / 'run.json').read_text())
            cost += rj.get('total_cost_usd') or 0
            out += (rj.get('usage') or {}).get('output_tokens') or 0
        except Exception:
            pass
    print(f'  {v}: ${cost:.4f}, {out} output tokens')

(OUT / 'benchmark.json').write_text(json.dumps(
    {'per_case': rows, 'totals': totals,
     'raw': {f'{v}/{c}': verdicts(OUT / 'runs' / v / c) for v in VARIANTS for c in CASES}},
    indent=2) + '\n')
