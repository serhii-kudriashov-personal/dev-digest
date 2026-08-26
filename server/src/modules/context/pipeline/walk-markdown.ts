import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { EXCLUDED_DIRS } from '../../repo-intel/constants.js';
import { CONTEXT_DOC_EXT, MAX_LISTED_DOCUMENTS } from '../constants.js';
import { compileRoots, matchesCompiledRoots } from '../helpers.js';

/**
 * Project Context (SPEC-01) — Markdown discovery over a repository's local
 * mirror.
 *
 * Modelled on `repo-intel/pipeline/walk.ts` (recursive `readdir`, never follow
 * a symlink, swallow an unreadable directory and keep going, posix-normalised
 * relative paths, stable alphabetical order) but it cannot REUSE it: that
 * walker's `SUPPORTED_EXT` is JS/TS only and Markdown is never chunked,
 * indexed or embedded anywhere in repo-intel.
 *
 * `EXCLUDED_DIRS` is imported rather than copied — `repo-intel/constants.ts` is
 * outside `SLICE_PRIVATE` (`server/.dependency-cruiser.cjs:65`) and
 * `repos/service.ts:14` already does exactly this, and a copied list drifts.
 * The import is CORRECTNESS, not tidiness: the default root matches at any
 * depth, so `node_modules/<pkg>/docs/readme.md` matches it and would otherwise
 * be listed as this project's documentation — a grounding failure and a
 * prompt-injection surface in one (`server/INSIGHTS.md` 2026-08-16). Note that
 * `.gitignore` is NOT honoured here either, so this list is the whole defence.
 *
 * Ring 2 by the `modules/repo-intel/{types,pipeline}` precedent: it does fs and
 * returns plain data, leaving every decision to its caller.
 */

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);

export interface MarkdownFile {
  /** Repo-relative posix path. */
  path: string;
  /** Directory part of `path`; `''` at the repository root. */
  dir: string;
  /** Label of the first configured root that matched. */
  root: string;
  size: number | null;
  /** ISO timestamp of the file's mtime, or null when `stat()` failed. */
  mtime: string | null;
}

export interface MarkdownWalkResult {
  /** Matched documents, alphabetical, cut at `MAX_LISTED_DOCUMENTS`. */
  files: MarkdownFile[];
  /** Everything that matched, BEFORE the cap. */
  total: number;
  /** `files` was cut (AC-11, NFR-4). */
  truncated: boolean;
}

/** Walk `root`, returning the Markdown documents matching `roots`. */
export async function walkMarkdown(
  root: string,
  roots: readonly string[],
): Promise<MarkdownWalkResult> {
  const compiled = compileRoots(roots);
  const out: MarkdownFile[] = [];
  await walkDir(root, root, compiled, out);

  // Stable alphabetical order so "the first N when truncated" is reproducible
  // across scans, the same contract repo-intel's walker keeps.
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const total = out.length;
  const truncated = total > MAX_LISTED_DOCUMENTS;
  return { files: truncated ? out.slice(0, MAX_LISTED_DOCUMENTS) : out, total, truncated };
}

async function walkDir(
  root: string,
  dir: string,
  compiled: ReturnType<typeof compileRoots>,
  out: MarkdownFile[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink) — skip cleanly so a
    // scan keeps making progress on the parts of the mirror it CAN read.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, escape)
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(name)) continue;
      await walkDir(root, join(dir, name), compiled, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (extname(name).toLowerCase() !== CONTEXT_DOC_EXT) continue;

    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    const label = matchesCompiledRoots(rel, compiled);
    if (label === null) continue;

    // A failed stat is "unknown", never zero — the contract's `size` and
    // `updated_at` are nullish precisely so the UI can say so.
    let size: number | null = null;
    let mtime: string | null = null;
    try {
      const s = await stat(full);
      size = s.size;
      mtime = s.mtime.toISOString();
    } catch {
      /* keep the document, with unknown size and mtime */
    }

    const slash = rel.lastIndexOf('/');
    out.push({
      path: rel,
      dir: slash < 0 ? '' : rel.slice(0, slash),
      root: label,
      size,
      mtime,
    });
  }
}
