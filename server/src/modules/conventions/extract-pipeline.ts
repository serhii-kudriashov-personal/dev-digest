import type { Container } from '../../platform/container.js';
import type { Provider, RepoRef } from '@devdigest/shared';
import { assemblePrompt, wrapUntrusted } from '../../platform/prompt.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { getFeatureModelOverride } from '../settings/feature-models.js';
import type { ConventionsRepository, InsertConvention } from './repository.js';
import { groundEvidence, ruleKey, type GroundedItem } from './helpers.js';
import {
  Extraction,
  EXTRACTION_SCHEMA_NAME,
  EXTRACTION_MAX_RETRIES,
  EXTRACTION_TEMPERATURE,
  EXTRACTOR_SYSTEM,
  EXTRACT_TASK,
  CONFIG_SAMPLE_PATHS,
  MAX_RANKED_FILES,
  MAX_GREP_FILES,
  MAX_FILE_BYTES,
  SAMPLE_BYTE_BUDGET,
  SAMPLE_GREP_PATTERN,
  DEFAULT_MODEL,
} from './constants.js';

/**
 * The extraction pipeline: sample in code, ask once, verify everything.
 *
 * Sampling makes ZERO model calls. The reference build spent a first call letting
 * the model pick its own files out of a repo map; this does not. Code-side
 * selection is one call cheaper, is deterministic — so the integration test mocks
 * one schema instead of a two-turn conversation — and it is what
 * `repoIntel.getConventionSamples` was written for (ONBOARDING.md marks it L02).
 *
 * Repository content is UNTRUSTED here and always `wrapUntrusted`-wrapped. It only
 * becomes an instruction later, at the moment a human accepts a rule.
 */

export interface SampledFile {
  path: string;
  content: string;
}

export interface ExtractionResult {
  files: SampledFile[];
  grounded: GroundedItem[];
  dropped: number;
  provider: Provider;
  model: string;
}

export interface ExtractOpts {
  provider?: Provider;
  model?: string;
}

/**
 * Run one extraction. Returns what survived plus the audit numbers; persistence is
 * the service's job.
 */
export async function runExtraction(
  container: Container,
  repo: ConventionsRepository,
  workspaceId: string,
  repoId: string,
  opts: ExtractOpts = {},
): Promise<ExtractionResult> {
  const repoRow = await repo.findRepo(workspaceId, repoId);
  if (!repoRow) throw new NotFoundError('Repo not found');
  if (!repoRow.clonePath) {
    throw new AppError('repo_not_cloned', 'Repo is not cloned yet — clone it first', 409);
  }
  const ref: RepoRef = { owner: repoRow.owner, name: repoRow.name };

  const files = await sampleFiles(container, ref, repoId);

  // Explicit opts win; else the workspace's configured conventions model
  // (Settings -> Feature Models); else the provider's dynamic default.
  const override = await getFeatureModelOverride(container, workspaceId, 'conventions');
  const provider: Provider = opts.provider ?? override?.provider ?? 'openai';
  const llm = await container.llm(provider);
  const model = opts.model ?? override?.model ?? (await defaultModel(container, provider));

  if (files.length === 0) {
    return { files, grounded: [], dropped: 0, provider, model };
  }

  const blob = files.map((f) => `FILE: ${f.path}\n${f.content}`).join('\n\n---\n\n');
  const { messages } = assemblePrompt({
    system: EXTRACTOR_SYSTEM,
    task: EXTRACT_TASK(repoRow.owner, repoRow.name),
    // The bodies go in the `diff` slot. It is the wrong NAME for a file sample —
    // the section renders as "## Diff to review" — but it is the only mandatory
    // slot, so routing the sample through `repoMap` instead would additionally
    // emit an empty Diff section, which misleads more than the header does. What
    // matters is the property: this slot is `wrapUntrusted`-wrapped, and each body
    // is prefixed `FILE: <path>` so the model can tell them apart.
    diff: blob,
  });

  const result = await llm.completeStructured<Extraction>({
    model,
    schema: Extraction,
    schemaName: EXTRACTION_SCHEMA_NAME,
    messages,
    temperature: EXTRACTION_TEMPERATURE,
    maxRetries: EXTRACTION_MAX_RETRIES,
  });

  const byPath = new Map(files.map((f) => [f.path, f.content] as const));
  const grounded: GroundedItem[] = [];
  for (const item of result.data.conventions) {
    const ok = groundEvidence(item, byPath);
    if (ok) grounded.push(ok);
  }

  return {
    files,
    grounded,
    dropped: result.data.conventions.length - grounded.length,
    provider,
    model,
  };
}

/**
 * Turn what survived into insertable rows, dropping anything whose rule was
 * already accepted or rejected for this repo. Without that, an accepted rule
 * returns as a duplicate pending card on every scan and a rejected one comes back
 * forever.
 */
export function toInsertRows(
  workspaceId: string,
  repoId: string,
  grounded: GroundedItem[],
  judgedRules: string[],
): InsertConvention[] {
  const seen = new Set(judgedRules.map(ruleKey));
  const rows: InsertConvention[] = [];
  for (const g of grounded) {
    const key = ruleKey(g.rule);
    if (seen.has(key)) continue;
    seen.add(key); // also dedups within one response
    rows.push({ workspaceId, repoId, ...g });
  }
  return rows;
}

/**
 * Sample the repo entirely in code:
 *   1. the config files a project states its rules in outright;
 *   2. the top-ranked source files via `repoIntel.getConventionSamples`;
 *   3. only if that yields nothing (unindexed repo, or the facade degraded to
 *      `[]` by design) fall back to a grep for source-looking files.
 *
 * Configs go first so they always survive the byte budget.
 */
async function sampleFiles(
  container: Container,
  ref: RepoRef,
  repoId: string,
): Promise<SampledFile[]> {
  const paths: string[] = [];

  for (const p of CONFIG_SAMPLE_PATHS) paths.push(p);

  let ranked: string[] = [];
  try {
    ranked = await container.repoIntel.getConventionSamples(repoId, MAX_RANKED_FILES);
  } catch {
    /* the facade is best-effort enrichment, never a hard dependency */
  }
  if (ranked.length === 0) ranked = await grepSamples(container, ref);
  for (const p of ranked) if (!paths.includes(p)) paths.push(p);

  return readWithinBudget(container, ref, paths);
}

async function grepSamples(container: Container, ref: RepoRef): Promise<string[]> {
  try {
    const matches = await container.codeIndex.grep(ref, SAMPLE_GREP_PATTERN);
    const out: string[] = [];
    for (const m of matches) {
      if (!out.includes(m.path)) out.push(m.path);
      if (out.length >= MAX_GREP_FILES) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Read each path, skipping what is missing or empty, until the budget is spent. */
async function readWithinBudget(
  container: Container,
  ref: RepoRef,
  paths: string[],
): Promise<SampledFile[]> {
  const out: SampledFile[] = [];
  let total = 0;
  for (const path of paths) {
    if (total >= SAMPLE_BYTE_BUDGET) break;
    const raw = await container.git.readFile(ref, path).catch(() => '');
    if (!raw.trim()) continue;
    const content = raw.slice(0, Math.min(MAX_FILE_BYTES, SAMPLE_BYTE_BUDGET - total));
    out.push({ path, content });
    total += content.length;
  }
  return out;
}

/** Our pinned default if the provider grants it, else whatever it lists first. */
async function defaultModel(container: Container, provider: Provider): Promise<string> {
  const preferred = DEFAULT_MODEL[provider];
  try {
    const llm = await container.llm(provider);
    const models = await llm.listModels();
    if (models.some((m) => m.id === preferred)) return preferred;
    return models[0]?.id ?? preferred;
  } catch {
    return preferred;
  }
}
