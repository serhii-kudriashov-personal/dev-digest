import { describe, it, expect } from 'vitest';
import { SmartDiff, type SmartDiffRole } from '@devdigest/shared';
import {
  buildSmartDiff,
  classifyFile,
  findingLinesFor,
  normalizePath,
  suggestSplit,
  type SmartDiffFileInput,
} from '../src/modules/smart-diff/helpers.js';
import { GROUP_ORDER, SPLIT_MAX_PROPOSALS } from '../src/modules/smart-diff/constants.js';

/**
 * Smart Diff helpers — hermetic (ring 2, pure functions, no container, no DB).
 *
 * The load-bearing property is determinism: the same PR must always produce the
 * same grouping and the same order, with no appeal to `findings.confidence`
 * (uncalibrated — root `INSIGHTS.md` 2026-08-02) and no model call anywhere.
 */

const file = (path: string, additions = 1, deletions = 0): SmartDiffFileInput => ({
  path,
  additions,
  deletions,
});

describe('classifyFile — first match wins, boilerplate → wiring → core', () => {
  const cases: [string, SmartDiffRole][] = [
    // Lock files can never be anything else — the acceptance criterion.
    ['pnpm-lock.yaml', 'boilerplate'],
    ['package-lock.json', 'boilerplate'],
    ['client/pnpm-lock.yaml', 'boilerplate'],
    ['yarn.lock', 'boilerplate'],
    ['go.sum', 'boilerplate'],
    // Manifests are grouped with their lock files.
    ['package.json', 'boilerplate'],
    ['server/package.json', 'boilerplate'],
    // Generated, vendored and binary.
    ['dist/index.js', 'boilerplate'],
    ['__snapshots__/x.snap', 'boilerplate'],
    ['client/src/vendor/ui/Badge.tsx', 'boilerplate'],
    ['logo.svg', 'boilerplate'],
    ['app/bundle.min.js', 'boilerplate'],
    // Wiring: barrels, config, CI, migrations, tests, docs.
    ['server/src/modules/x/index.ts', 'wiring'],
    ['vitest.config.ts', 'wiring'],
    ['server/test/x.test.ts', 'wiring'],
    ['client/src/components/y/Y.spec.tsx', 'wiring'],
    ['server/src/db/migrations/0016_x.sql', 'wiring'],
    ['.github/workflows/client.yml', 'wiring'],
    ['Dockerfile', 'wiring'],
    ['types/global.d.ts', 'wiring'],
    ['README.md', 'wiring'],
    // Everything else is the substance of the change.
    ['server/src/modules/x/service.ts', 'core'],
    ['client/src/lib/api.ts', 'core'],
    ['server/src/modules/x/routes.ts', 'core'],
  ];

  for (const [path, role] of cases) {
    it(`${path} → ${role}`, () => {
      expect(classifyFile(path)).toBe(role);
    });
  }

  it('boilerplate beats wiring even when both patterns match', () => {
    // `dist/index.js` is a barrel by name and build output by location. The
    // order of the two lists is the only thing that decides it.
    expect(classifyFile('dist/index.js')).toBe('boilerplate');
    expect(classifyFile('src/index.js')).toBe('wiring');
  });

  it('classifies a diff-prefixed path the same as a plain one', () => {
    expect(normalizePath('b/pnpm-lock.yaml')).toBe('pnpm-lock.yaml');
    expect(classifyFile('b/pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyFile('./server/src/modules/x/service.ts')).toBe('core');
  });
});

describe('findingLinesFor', () => {
  it('deduplicates and sorts ascending when two agents flag the same line', () => {
    const findings = [
      { file: 'src/a.ts', start_line: 40 },
      { file: 'src/a.ts', start_line: 12 },
      { file: 'src/a.ts', start_line: 40 },
      { file: 'src/b.ts', start_line: 7 },
    ];
    expect(findingLinesFor('src/a.ts', findings)).toEqual([12, 40]);
  });

  it('matches on the normalized path, and matches exactly — no basename fallback', () => {
    const findings = [
      { file: 'b/src/a.ts', start_line: 3 },
      // Same basename, different directory: must NOT be attributed here.
      { file: 'other/a.ts', start_line: 99 },
    ];
    expect(findingLinesFor('src/a.ts', findings)).toEqual([3]);
  });
});

describe('buildSmartDiff', () => {
  it('emits all three groups in GROUP_ORDER even when a group is empty', () => {
    const diff = buildSmartDiff([file('src/only.ts')], []);
    expect(diff.groups.map((g) => g.role)).toEqual([...GROUP_ORDER]);
    expect(diff.groups[1]!.files).toEqual([]);
    expect(diff.groups[2]!.files).toEqual([]);
    // Parsing with the contract itself is the point: the route returns this.
    expect(() => SmartDiff.parse(diff)).not.toThrow();
  });

  it('orders within a group by findings, then changed lines, then path', () => {
    const files = [
      file('src/zero-b.ts', 5, 0),
      file('src/zero-a.ts', 5, 0),
      file('src/big.ts', 90, 10),
      file('src/flagged.ts', 1, 0),
    ];
    const diff = buildSmartDiff(files, [{ file: 'src/flagged.ts', start_line: 4 }]);
    const core = diff.groups.find((g) => g.role === 'core')!;
    expect(core.files.map((f) => f.path)).toEqual([
      'src/flagged.ts', // one finding beats every line count
      'src/big.ts', // then the most changed lines
      'src/zero-a.ts', // then path, so the tie is never insertion order
      'src/zero-b.ts',
    ]);
  });

  it('keeps a lock file out of every group but boilerplate, even when flagged', () => {
    const diff = buildSmartDiff([file('pnpm-lock.yaml', 400, 380), file('src/a.ts')], [
      { file: 'pnpm-lock.yaml', start_line: 1 },
    ]);
    const paths = (role: SmartDiffRole) =>
      diff.groups.find((g) => g.role === role)!.files.map((f) => f.path);
    expect(paths('boilerplate')).toEqual(['pnpm-lock.yaml']);
    expect(paths('core')).toEqual(['src/a.ts']);
    expect(paths('wiring')).toEqual([]);
  });

  it('carries the split suggestion, so the endpoint cannot ship without it', () => {
    // `split_suggestion` is computed and returned but rendered nowhere yet, so
    // nothing on screen would notice it going missing. The contract would.
    const files = [file('server/a.ts', 300, 0), file('server/b.ts', 200, 0)];
    const diff = buildSmartDiff(files, []);
    expect(diff.split_suggestion).toEqual(suggestSplit(files));
    expect(diff.split_suggestion.too_big).toBe(true);
    expect(() => SmartDiff.parse(diff)).not.toThrow();
  });

  it('never fills pseudocode_summary — that would need a model call', () => {
    const diff = buildSmartDiff([file('src/a.ts')], []);
    expect(diff.groups[0]!.files[0]!.pseudocode_summary).toBeNull();
  });
});

describe('suggestSplit', () => {
  it('is not too_big below the thresholds, and proposes nothing', () => {
    const split = suggestSplit([file('src/a.ts', 10, 5), file('src/b.ts', 3, 2)]);
    expect(split).toEqual({ too_big: false, total_lines: 20, proposed_splits: [] });
  });

  it('counts every file in total_lines, boilerplate included', () => {
    // 500 changed lines of lock file alone trips the line threshold.
    const split = suggestSplit([file('pnpm-lock.yaml', 300, 200)]);
    expect(split.total_lines).toBe(500);
    expect(split.too_big).toBe(true);
    // …but a lock file is never something to split a PR by.
    expect(split.proposed_splits).toEqual([]);
  });

  it('groups core files by top-level directory, deterministically, when too big', () => {
    const files = [
      file('server/a.ts', 200, 0),
      file('server/b.ts', 100, 0),
      file('server/c.ts', 50, 0),
      file('client/y.ts', 50, 0),
      file('client/x.ts', 50, 0),
      file('docs/only.ts', 10, 0), // one file — below SPLIT_MIN_FILES_PER_PROPOSAL
    ];
    const split = suggestSplit(files);
    expect(split.too_big).toBe(true);
    expect(split.proposed_splits).toEqual([
      { name: 'server', files: ['server/a.ts', 'server/b.ts', 'server/c.ts'] },
      { name: 'client', files: ['client/x.ts', 'client/y.ts'] },
    ]);
  });

  it('caps the proposals and breaks a count tie by name, ascending', () => {
    // Six directories of two core files each: past SPLIT_TOO_BIG_CORE_FILES, and
    // every bucket the same size, so the cap and the tie-break are the only two
    // rules deciding what comes back.
    // Not named `a`/`b`: those are diff prefixes and `normalizePath` strips
    // them, which is deliberate (see the case below) but not what is under test
    // here.
    const files = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].flatMap((dir) => [
      file(`${dir}/one.ts`, 1, 0),
      file(`${dir}/two.ts`, 1, 0),
    ]);
    const split = suggestSplit([...files].reverse());
    expect(split.too_big).toBe(true);
    expect(split.proposed_splits).toHaveLength(SPLIT_MAX_PROPOSALS);
    expect(split.proposed_splits.map((p) => p.name)).toEqual(['m1', 'm2', 'm3', 'm4']);
    // Files inside a proposal are sorted too, so nothing depends on input order.
    expect(split.proposed_splits[0]!.files).toEqual(['m1/one.ts', 'm1/two.ts']);
  });

  it('names a repo-root proposal ".", and treats a top-level a/ or b/ as a diff prefix', () => {
    // The cost of stripping diff prefixes, stated rather than discovered: a
    // real top-level directory called `a` or `b` is indistinguishable from the
    // prefix a unified diff adds, so its files land in the root bucket. `a/x`
    // in a diff is genuinely ambiguous; normalization picks one reading.
    const files = [
      file('a/one.ts', 200, 0),
      file('b/two.ts', 200, 0),
      file('root.ts', 100, 0),
    ];
    const split = suggestSplit(files);
    expect(split.too_big).toBe(true);
    expect(split.proposed_splits).toEqual([
      { name: '.', files: ['a/one.ts', 'b/two.ts', 'root.ts'] },
    ]);
  });

  it('is the same answer whatever order the files arrive in', () => {
    const files = [
      file('server/a.ts', 200, 0),
      file('client/x.ts', 50, 0),
      file('server/b.ts', 100, 0),
      file('client/y.ts', 50, 0),
    ];
    expect(suggestSplit([...files].reverse())).toEqual(suggestSplit(files));
  });

  it('trips on the core-file count alone, with no line threshold in sight', () => {
    const files = Array.from({ length: 11 }, (_, i) => file(`src/f${i}.ts`, 1, 0));
    const split = suggestSplit(files);
    expect(split.total_lines).toBe(11);
    expect(split.too_big).toBe(true);
  });
});
