import type { Container } from '../../platform/container.js';
import type { Provider, RepoRef } from '@devdigest/shared';
import { assemblePrompt } from '@devdigest/reviewer-core';
import {
  IntentClassification,
  INTENT_MAX_RETRIES,
  INTENT_SCHEMA_NAME,
  INTENT_SYSTEM,
  INTENT_TASK,
  INTENT_TEMPERATURE,
  MAX_BODY_CHARS,
  MAX_COMMITS,
  MAX_ISSUE_CHARS,
  MAX_SPEC_BYTES,
  type SourceLabel,
} from './constants.js';
import {
  commitSubject,
  hunkHeaders,
  linkedIssueNumbers,
  linkedSpecPaths,
} from './helpers.js';
import type { IntentPrFileRow, IntentPullRow, IntentRepoRow } from './repository.js';

/**
 * Source collection + the single classification call.
 *
 * NO Drizzle and no `src/db` here — every row arrives as a parameter. That is a
 * discipline rather than a gate: `no-sql-in-service` matches by filename and
 * would not catch a query in this file (the honesty problem
 * `conventions/extract-pipeline.ts` already carries).
 *
 * What is NEVER collected: diff bodies. Only `@@` hunk headers, via
 * `hunkHeaders`, which is the enforcement point.
 */

export interface SourceBlock {
  label: SourceLabel;
  text: string;
}

export interface CollectedSources {
  blocks: SourceBlock[];
  labels: SourceLabel[];
}

export interface ClassificationOutcome {
  data: IntentClassification;
  provider: Provider;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** NULL when the price book cannot attribute it — never 0. */
  costUsd: number | null;
}

/**
 * Gather the material, in priority order:
 *   PR title+body → linked issue → linked plan/spec → hunk headers → commits.
 *
 * Every step is best-effort: a GitHub failure, a `ConfigError` from a missing
 * key, or a missing file degrades to simply not emitting that label. A label is
 * emitted only when the source produced actual text, so `sources` records what
 * was really used rather than what was attempted.
 */
export async function collectSources(
  container: Container,
  repo: IntentRepoRow,
  pull: IntentPullRow,
  files: IntentPrFileRow[],
  commits: { message: string }[],
  specChunks: { path: string; content: string }[] = [],
): Promise<CollectedSources> {
  const blocks: SourceBlock[] = [];
  const ref: RepoRef = { owner: repo.owner, name: repo.name, instanceKey: repo.instanceKey };

  // 1. PR title + body — always present in some form.
  const body = (pull.body ?? '').trim().slice(0, MAX_BODY_CHARS);
  blocks.push({
    label: 'pr_title_body',
    text: body ? `TITLE: ${pull.title}\n\n${body}` : `TITLE: ${pull.title}`,
  });

  // 2. Linked issues — only those closed by one of GitHub's nine keyword stems.
  const issueNumbers = linkedIssueNumbers(pull.body);
  if (issueNumbers.length > 0) {
    const texts: string[] = [];
    try {
      // The repository's OWN forge (SPEC-06 AC-20) — GitHub behaviour is
      // unchanged; a GitLab repository now reaches its instance instead of
      // silently degrading to "no linked issue".
      const gh = await container.forge(repo);
      for (const n of issueNumbers) {
        try {
          const issue = await gh.getIssue(ref, n);
          const issueBody = (issue.body ?? '').trim().slice(0, MAX_ISSUE_CHARS);
          texts.push(`ISSUE #${issue.number}: ${issue.title}\n${issueBody}`);
        } catch {
          /* one unreachable issue must not lose the others */
        }
      }
    } catch {
      /* no access token for this repository's forge (ConfigError) — degraded */
    }
    if (texts.length > 0) blocks.push({ label: 'linked_issue', text: texts.join('\n\n') });
  }

  // 3. Linked plan/spec — the paths are attacker-controlled, so they have
  //    already passed the allowlist in `linkedSpecPaths`.
  const specPaths = linkedSpecPaths(pull.body);
  if (specPaths.length > 0) {
    const texts: string[] = [];
    let budget = MAX_SPEC_BYTES;
    const indexed = new Map(specChunks.map((c) => [c.path, c.content] as const));
    for (const path of specPaths) {
      if (budget <= 0) break;
      let content = '';
      try {
        content = await container.git.readFile(ref, path);
      } catch {
        // Secondary route: a chunk already indexed as `source = 'spec'`. May
        // well be permanently empty — nothing here guarantees a writer exists.
        content = indexed.get(path) ?? '';
      }
      const trimmed = content.trim();
      if (!trimmed) continue;
      const slice = trimmed.slice(0, budget);
      budget -= slice.length;
      texts.push(`SPEC ${path}:\n${slice}`);
    }
    if (texts.length > 0) blocks.push({ label: 'linked_spec', text: texts.join('\n\n') });
  }

  // 4. Hunk headers — the SHAPE of the change, never its content.
  const headers: string[] = [];
  for (const f of files) {
    const hs = hunkHeaders(f.patch);
    for (const h of hs) headers.push(`${f.path}: ${h}`);
  }
  if (headers.length > 0) blocks.push({ label: 'hunk_headers', text: headers.join('\n') });

  // 5. Commit subjects.
  const subjects = commits
    .slice(0, MAX_COMMITS)
    .map((c) => commitSubject(c.message))
    .filter((s) => s.length > 0);
  if (subjects.length > 0) {
    blocks.push({ label: 'commit_messages', text: subjects.map((s) => `- ${s}`).join('\n') });
  }

  return { blocks, labels: blocks.map((b) => b.label) };
}

/**
 * One `assemblePrompt` + one `completeStructured`. Mirrors
 * `conventions/extract-pipeline.ts`.
 *
 * The blocks go in the `diff` slot: it is the only UNCONDITIONAL slot, and it
 * is `wrapUntrusted`-wrapped, which is the property that matters — every source
 * is author-controlled text that must arrive as data. Routing it through
 * `repoMap` for a nicer heading would additionally emit an empty Diff section.
 * Each block is prefixed `SOURCE: <label>` so the model can tell them apart.
 */
export async function classifyIntent(
  container: Container,
  repo: IntentRepoRow,
  pull: IntentPullRow,
  sources: CollectedSources,
  choice: { provider: Provider; model: string },
): Promise<ClassificationOutcome> {
  const blob = sources.blocks.map((b) => `SOURCE: ${b.label}\n${b.text}`).join('\n\n---\n\n');

  const { messages } = assemblePrompt({
    system: INTENT_SYSTEM,
    task: INTENT_TASK(`${repo.owner}/${repo.name}`, pull.number, pull.title),
    diff: blob,
  });

  const llm = await container.llm(choice.provider);
  const res = await llm.completeStructured<IntentClassification>({
    model: choice.model,
    schema: IntentClassification,
    schemaName: INTENT_SCHEMA_NAME,
    messages,
    temperature: INTENT_TEMPERATURE,
    maxRetries: INTENT_MAX_RETRIES,
    // Structured-output support on OpenRouter is per ENDPOINT, not per model.
    // Opt in HERE, for this call only — review runs keep their routing.
    providerRouting: { requireParameters: true },
  });

  return {
    data: res.data,
    provider: choice.provider,
    model: choice.model,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
