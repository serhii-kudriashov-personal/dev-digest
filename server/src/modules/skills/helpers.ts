import { unzipSync, strFromU8 } from 'fflate';
import type { Skill, SkillImportPreview, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import { ValidationError } from '../../platform/errors.js';
import {
  DEFAULT_SKILL_TYPE,
  MAX_IMPORT_BYTES,
  MAX_UNPACKED_BYTES,
} from './constants.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping and import parsing.
 *
 * The parsing lives here rather than in the service because it is a pure
 * bytes → preview transform: `fflate` decompresses in memory and touches no
 * filesystem, so the whole import path is unit-testable without Postgres.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as Skill['type'],
    source: row.source as Skill['source'],
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Map a persisted `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    message: row.message ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Parse an uploaded `.md` or `.zip` into the skill it WOULD become.
 *
 * Nothing is persisted and nothing is written to disk — archive entries are
 * decompressed in memory, exactly one markdown entry is read, and every other
 * entry is reported in `ignored_files` so the user can see that the executable
 * parts of someone else's skill bundle were skipped rather than silently run.
 */
export function parseSkillUpload(filename: string, buf: Buffer): SkillImportPreview {
  if (buf.byteLength === 0) throw new ValidationError('The uploaded file is empty.');
  if (buf.byteLength > MAX_IMPORT_BYTES) {
    throw new ValidationError(
      `File too large: ${buf.byteLength} bytes (max ${MAX_IMPORT_BYTES}).`,
    );
  }

  const lower = filename.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return previewFromMarkdown(buf.toString('utf-8'), filename, []);
  }
  if (lower.endsWith('.zip')) return previewFromZip(buf, filename);

  throw new ValidationError(
    `Unsupported file type: "${filename}". Only .md and .zip are supported.`,
  );
}

function previewFromZip(buf: Buffer, filename: string): SkillImportPreview {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buf));
  } catch {
    throw new ValidationError(`Could not read "${filename}" as a zip archive.`);
  }

  // Directory records carry no content; they are not "ignored files" either.
  const paths = Object.keys(entries).filter((p) => !p.endsWith('/'));

  // A zip bomb is small on the wire and huge once expanded, so the guard has to
  // be on the decompressed total rather than on the upload size alone.
  const unpacked = paths.reduce((n, p) => n + (entries[p]?.byteLength ?? 0), 0);
  if (unpacked > MAX_UNPACKED_BYTES) {
    throw new ValidationError(
      `Archive expands to ${unpacked} bytes (max ${MAX_UNPACKED_BYTES}).`,
    );
  }

  const bodyPath = pickSkillEntry(paths);
  if (!bodyPath) throw new ValidationError('No .md file found in the zip archive.');

  const bytes = entries[bodyPath];
  if (!bytes) throw new ValidationError(`Could not read ${bodyPath} from the archive.`);

  const ignored = paths.filter((p) => p !== bodyPath).sort();
  return previewFromMarkdown(strFromU8(bytes), bodyPath, ignored);
}

/**
 * Choose the ONE entry to read: `SKILL.md` (at any depth — bundles are usually
 * zipped with their folder as the root), else the shallowest markdown file.
 */
export function pickSkillEntry(paths: string[]): string | undefined {
  const md = paths.filter((p) => /\.(md|markdown)$/i.test(p));
  if (md.length === 0) return undefined;
  const byDepth = (p: string) => p.split('/').length;
  const named = md.filter((p) => /(^|\/)skill\.md$/i.test(p));
  const pool = named.length > 0 ? named : md;
  return [...pool].sort((a, b) => byDepth(a) - byDepth(b) || a.localeCompare(b))[0];
}

function previewFromMarkdown(
  text: string,
  path: string,
  ignoredFiles: string[],
): SkillImportPreview {
  const { attrs, body } = splitFrontmatter(text);
  return {
    // Frontmatter first: every `.claude/skills/*/SKILL.md` carries `name` and
    // `description`, so an imported skill arrives with its interface already
    // filled in rather than blank.
    name: attrs.name ?? extractHeading(body) ?? stemFromFilename(path),
    description: attrs.description ?? '',
    type: DEFAULT_SKILL_TYPE,
    // A file someone handed us is not "manual" authorship — the distinction is
    // what drives the "needs vetting" badge and the disabled-on-import default.
    source: 'imported_url',
    body,
    ignored_files: ignoredFiles,
  };
}

/**
 * Split leading YAML frontmatter from a markdown document.
 *
 * Deliberately NOT a YAML parser — only the flat `key: value` pairs a skill
 * header uses, with surrounding quotes stripped. Anything structured is left in
 * place and ignored; the body is returned without the frontmatter block.
 */
export function splitFrontmatter(text: string): {
  attrs: Record<string, string>;
  body: string;
} {
  const match = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { attrs: {}, body: text.replace(/^﻿/, '') };

  const attrs: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!pair) continue;
    const value = (pair[2] ?? '').trim().replace(/^["'](.*)["']$/s, '$1').trim();
    if (value) attrs[pair[1]!] = value;
  }
  return { attrs, body: text.slice(match[0].length) };
}

/** The first `# heading` of a markdown document, if it has one. */
export function extractHeading(text: string): string | undefined {
  return /^#[ \t]+(.+)$/m.exec(text)?.[1]?.trim() || undefined;
}

/** Filename stem — no directory, no extension. */
export function stemFromFilename(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
