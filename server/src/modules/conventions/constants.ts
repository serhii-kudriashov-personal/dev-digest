import { z } from 'zod';
import { ConventionCategory, type Provider } from '@devdigest/shared';

/**
 * Conventions extractor — literals. Schemas and prompts for the single
 * structured call, plus every tunable the pipeline reads.
 *
 * See `specs/l02-conventions-extractor.md`.
 */

// ----- the model's output schema -----

/**
 * One candidate as the MODEL reports it.
 *
 * The `.describe()` calls are not documentation: this schema is handed straight
 * to `completeStructured`, so a description IS the instruction the model reads
 * (root INSIGHTS.md, 2026-08-05). That is why the wording is imperative.
 *
 * Note what is ABSENT — a line number. The server computes the line range from
 * where the snippet is actually found, so asking for it would only create a
 * second unverifiable claim to validate.
 */
export const ExtractionItem = z.object({
  category: ConventionCategory.describe(
    'Which aspect of the codebase this rule is about. Use "tooling" for anything ' +
      'a linter or compiler config already enforces.',
  ),
  rule: z
    .string()
    .describe(
      'One house-rule the codebase consistently follows, phrased as an imperative ' +
        'guideline a reviewer could apply to a diff. One rule per item, no lists.',
    ),
  evidence_path: z
    .string()
    .describe('Repo-relative path of a file below that demonstrates the rule.'),
  evidence_snippet: z
    .string()
    .describe(
      'A short snippet copied VERBATIM from that file. It must appear in the file ' +
        'character for character — do not paraphrase, reformat or elide.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('How consistently the codebase follows this rule, 0..1.'),
});
export type ExtractionItem = z.infer<typeof ExtractionItem>;

export const Extraction = z.object({
  conventions: z.array(ExtractionItem).max(20),
});
export type Extraction = z.infer<typeof Extraction>;

/** Name passed to the structured call — also the mock fixture key in tests. */
export const EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

// ----- sampling -----

/**
 * Files a project states its rules in outright. Matched by exact name against the
 * clone, cheapest-first; a missing one is skipped silently. Read BEFORE the ranked
 * source files so they always survive the byte budget.
 */
export const CONFIG_SAMPLE_PATHS = [
  'eslint.config.mjs',
  'eslint.config.js',
  'eslint.config.ts',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.eslintrc.js',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  'package.json',
] as const;

/** How many ranked source files to ask `repoIntel.getConventionSamples` for. */
export const MAX_RANKED_FILES = 12;

/** Cap on files read when degrading to the grep heuristic. */
export const MAX_GREP_FILES = 12;

/** Max bytes kept per sampled file. */
export const MAX_FILE_BYTES = 10_000;

/** Total byte budget for everything sent to the model (~45K tokens). */
export const SAMPLE_BYTE_BUDGET = 180_000;

/** Grep pattern used to find source files when nothing is indexed. */
export const SAMPLE_GREP_PATTERN = '(function|class|export|def )';

// ----- prompt -----

export const EXTRACTOR_SYSTEM =
  'You are a senior engineer reading a sample of a repository to surface the ' +
  'implicit house-rules it follows — naming, error handling, module structure, ' +
  'testing, API shape, tooling. Report only rules the sample actually ' +
  'demonstrates, each backed by a verbatim snippet from one of the files shown. ' +
  'A rule you cannot point at is not a rule. Prefer a few well-evidenced rules ' +
  'over many weak ones.';

export const EXTRACT_TASK = (owner: string, name: string): string =>
  `Repo ${owner}/${name}. Extract the house-rules this codebase follows from the ` +
  'files below. For each one give the category, the rule as an imperative ' +
  'guideline, the repo-relative path of a file that demonstrates it, a short ' +
  'verbatim snippet copied from that file, and your confidence 0..1.';

// ----- structured-call tuning -----

export const EXTRACTION_TEMPERATURE = 0;
export const EXTRACTION_MAX_RETRIES = 2;

/** Default model per provider when the workspace has picked none. */
export const DEFAULT_MODEL: Record<Provider, string> = {
  openai: 'gpt-5.4',
  anthropic: 'claude-3-5-sonnet',
  openrouter: 'deepseek/deepseek-v4-flash',
};

// ----- skill draft -----

/** Max length of the skill name derived from the repo name. */
export const SKILL_NAME_MAX_LEN = 80;

/** Max length of a generated `##` section slug. */
export const SLUG_MAX_LEN = 60;
