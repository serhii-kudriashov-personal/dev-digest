import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  extractHeading,
  parseSkillUpload,
  pickSkillEntry,
  splitFrontmatter,
  stemFromFilename,
} from '../src/modules/skills/helpers.js';
import { MAX_IMPORT_BYTES, MAX_UNPACKED_BYTES } from '../src/modules/skills/constants.js';

/**
 * Import parsing is pure (fflate decompresses in memory, nothing touches the
 * filesystem), so the whole path is covered without Postgres.
 *
 * The invariant these guard: exactly ONE markdown entry is read out of an
 * archive, and every other entry is REPORTED rather than executed.
 */

const zip = (files: Record<string, string>): Buffer =>
  Buffer.from(
    zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))),
  );

describe('splitFrontmatter', () => {
  it('reads flat key: value pairs and strips the block from the body', () => {
    const { attrs, body } = splitFrontmatter(
      '---\nname: security\ndescription: "Use when reviewing auth."\n---\n# Security\nBody.',
    );
    expect(attrs.name).toBe('security');
    expect(attrs.description).toBe('Use when reviewing auth.');
    expect(body).toBe('# Security\nBody.');
  });

  it('leaves a document without frontmatter untouched', () => {
    const { attrs, body } = splitFrontmatter('# Just a heading\nText.');
    expect(attrs).toEqual({});
    expect(body).toBe('# Just a heading\nText.');
  });

  it('does not treat a mid-document --- rule as frontmatter', () => {
    const text = '# Title\n\n---\n\nnot: frontmatter\n';
    expect(splitFrontmatter(text).attrs).toEqual({});
  });

  it('ignores blank values so they do not shadow the heading fallback', () => {
    const { attrs } = splitFrontmatter('---\nname:\ndescription: real\n---\nbody');
    expect(attrs.name).toBeUndefined();
    expect(attrs.description).toBe('real');
  });
});

describe('extractHeading / stemFromFilename', () => {
  it('takes the first # heading', () => {
    expect(extractHeading('intro\n# The Rule\n## Sub')).toBe('The Rule');
  });

  it('returns undefined when there is no h1', () => {
    expect(extractHeading('## only an h2')).toBeUndefined();
  });

  it('strips directory and extension', () => {
    expect(stemFromFilename('bundle/security/SKILL.md')).toBe('SKILL');
    expect(stemFromFilename('no-extension')).toBe('no-extension');
  });
});

describe('pickSkillEntry', () => {
  it('prefers SKILL.md at any depth, case-insensitively', () => {
    expect(pickSkillEntry(['bundle/README.md', 'bundle/skill.md'])).toBe('bundle/skill.md');
  });

  it('falls back to the shallowest markdown file', () => {
    expect(pickSkillEntry(['deep/a/b/first.md', 'top.md'])).toBe('top.md');
  });

  it('returns undefined when the archive holds no markdown', () => {
    expect(pickSkillEntry(['run.sh', 'logo.png'])).toBeUndefined();
  });
});

describe('parseSkillUpload — markdown', () => {
  it('fills name and description from frontmatter', () => {
    const md = '---\nname: test-rubric\ndescription: Use when reviewing tests.\n---\n# Rubric\nRule.';
    const out = parseSkillUpload('whatever.md', Buffer.from(md));
    expect(out.name).toBe('test-rubric');
    expect(out.description).toBe('Use when reviewing tests.');
    expect(out.body).toBe('# Rubric\nRule.');
    expect(out.ignored_files).toEqual([]);
  });

  it('falls back to the heading, then to the filename stem', () => {
    expect(parseSkillUpload('a.md', Buffer.from('# From Heading\nx')).name).toBe('From Heading');
    expect(parseSkillUpload('my-skill.md', Buffer.from('no heading here')).name).toBe('my-skill');
  });

  it('marks an upload as imported, never as manual authorship', () => {
    // `source` drives the "needs vetting" badge and the disabled-on-import
    // default, so it must never come back as 'manual'.
    expect(parseSkillUpload('a.md', Buffer.from('# x')).source).toBe('imported_url');
  });
});

describe('parseSkillUpload — zip', () => {
  it('reads SKILL.md and reports every other entry as ignored', () => {
    const out = parseSkillUpload(
      'security.zip',
      zip({
        'security/SKILL.md': '---\nname: security\n---\n# Security\nRule.',
        'security/scripts/install.sh': 'rm -rf /',
        'security/references.md': '# refs',
      }),
    );
    expect(out.name).toBe('security');
    expect(out.body).toBe('# Security\nRule.');
    // The shell script is surfaced, not run.
    expect(out.ignored_files).toEqual(['security/references.md', 'security/scripts/install.sh']);
  });

  it('rejects an archive with no markdown', () => {
    expect(() => parseSkillUpload('x.zip', zip({ 'run.sh': 'echo hi' }))).toThrow(/no \.md file/i);
  });

  it('rejects a file that is not markdown or zip', () => {
    expect(() => parseSkillUpload('payload.tar.gz', Buffer.from('x'))).toThrow(
      /unsupported file type/i,
    );
  });

  it('rejects an empty upload', () => {
    expect(() => parseSkillUpload('a.md', Buffer.alloc(0))).toThrow(/empty/i);
  });

  it('rejects an upload over the decoded size ceiling', () => {
    const big = Buffer.alloc(MAX_IMPORT_BYTES + 1, 0x61);
    expect(() => parseSkillUpload('big.md', big)).toThrow(/too large/i);
  });

  it('rejects an archive that expands past the unpacked ceiling', () => {
    // Highly compressible: small on the wire, huge once expanded. The guard has
    // to be on the OUTPUT size, or this is a zip bomb.
    const bomb = zip({ 'a.md': '#' + 'a'.repeat(MAX_UNPACKED_BYTES + 1) });
    expect(bomb.byteLength).toBeLessThan(MAX_IMPORT_BYTES);
    expect(() => parseSkillUpload('bomb.zip', bomb)).toThrow(/expands to/i);
  });
});
