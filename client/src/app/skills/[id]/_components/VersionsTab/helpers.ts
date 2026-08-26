export type DiffOp = "same" | "add" | "del";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * Line diff between two skill bodies, for the Versions tab's Diff view.
 *
 * Hand-rolled rather than pulled from a dependency: `DiffViewer` cannot be reused
 * (it takes `PrFile[]`, a PR-specific shape) and this needs two plain strings.
 * Classic LCS — O(n·m) in lines, which is fine for a skill body of a few dozen
 * lines and would not be for a source tree.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: "del", text: a[i]! });
      i++;
    } else {
      out.push({ op: "add", text: b[j]! });
      j++;
    }
  }
  while (i < a.length) out.push({ op: "del", text: a[i++]! });
  while (j < b.length) out.push({ op: "add", text: b[j++]! });
  return out;
}

/** Counts for the diff header, e.g. "+4 −2". */
export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.op === "add").length,
    removed: lines.filter((l) => l.op === "del").length,
  };
}
