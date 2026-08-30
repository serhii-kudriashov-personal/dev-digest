import 'dotenv/config';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import {
  ALLOW_PRIVATE_FORGE_HOSTS_ENV,
  parseAllowedPrivateHosts,
} from '../modules/_shared/forge-url.js';

/**
 * Central, zod-validated environment config. Loaded once at startup.
 *
 * NOTE: secret keys (OPENAI/ANTHROPIC/OPENROUTER/GITHUB_TOKEN) are deliberately
 * NOT in this schema. Feature code must access secrets through SecretsProvider,
 * never via process.env or AppConfig — the SecretsProvider is the one chokepoint
 * that reads process.env directly (see adapters/secrets/local.ts). Listing them
 * here would be dead config that never reaches AppConfig.
 */
const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgres://devdigest:devdigest@localhost:5432/devdigest'),
  // Memory/RAG embeddings run on OpenAI (text-embedding-3-small, 1536-dim — the
  // pgvector columns are locked to that). Default OFF so the app makes ZERO
  // OpenAI requests; set EMBEDDINGS_ENABLED=true to turn memory retrieval on.
  EMBEDDINGS_ENABLED: z.string().optional(),
  // repo-intel facade (Tier 1). Default ON — reviews get repo skeleton +
  // callers context. Set REPO_INTEL_ENABLED=false to opt out, in which case
  // every consumer degrades to ripgrep-identical behavior (acceptance #10).
  // Note: even when on, sections only populate once the repo is indexed; an
  // unindexed repo degrades gracefully. Per-agent override: agents.repo_intel.
  REPO_INTEL_ENABLED: z.string().optional(),
  // SSRF opt-in for a self-managed forge on a private network (SPEC-06 AC-4).
  // Comma-separated EXACT hostnames — `git.devart.com,gitlab.internal`. Empty
  // by default, which is the shipped refusal; naming a host widens it to
  // RFC 1918 and IPv6 unique-local for THAT host only, never to loopback and
  // never to link-local. The rules and the reasons are in
  // `modules/_shared/forge-url.ts`; this is only where the value is read.
  DEVDIGEST_ALLOW_PRIVATE_FORGE_HOSTS: z.string().optional(),
  API_PORT: z.coerce.number().int().default(3001),
  WEB_PORT: z.coerce.number().int().default(3000),
  DEVDIGEST_CLONE_DIR: z.string().optional(),
  // Built by `cd agent-runner && pnpm install && pnpm build`. Not committed —
  // `agent-runner/.gitignore` ignores `dist/` — so a fresh clone has none until
  // it is built. Override the location with RUNNER_BUNDLE_PATH.
  RUNNER_BUNDLE_PATH: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // `.env` (and .env.example) ship `LOG_LEVEL=` empty; an empty string is not a
  // valid enum member, so coerce '' → undefined to fall through to the default.
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  webPort: number;
  /** Absolute path where repos are cloned (~/.devdigest/workspace by default). */
  cloneDir: string;
  /**
   * Absolute path to the built agent-runner bundle
   * (`agent-runner/dist/index.js` by default). SPEC-05's "Export to CI" reads
   * this file's bytes into the generated bundle; it throws `ConfigError` when
   * absent (see `server/AGENTS.md` §Read when).
   */
  runnerBundlePath: string;
  /** Absolute path to the writable secrets store (BYO keys from the UI). */
  secretsPath: string;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for the Next.js dev server. */
  webOrigin: string;
  /** Whether memory/RAG embeddings (OpenAI) are enabled. Default false. */
  embeddingsEnabled: boolean;
  /**
   * Whether the repo-intel facade (Tier 1: phantom-gate, callers-in-prompt) is
   * active. Default ON — set REPO_INTEL_ENABLED=false to opt out, in which case
   * every facade method returns its degraded result (`[]`) so consumers behave
   * EXACTLY like the ripgrep-only baseline.
   */
  repoIntelEnabled: boolean;
  /**
   * Hosts the operator has explicitly opted into reaching on a private network
   * (`DEVDIGEST_ALLOW_PRIVATE_FORGE_HOSTS`). Empty by default. Canonicalised
   * and de-duplicated; matched EXACTLY, and only ever able to widen the refusal
   * to RFC 1918 / IPv6 unique-local — see `modules/_shared/forge-url.ts`.
   *
   * Not a secret: it is a list of hostnames the operator typed, so `AppConfig`
   * is the right home for it (unlike an access token, which is
   * `SecretsProvider`'s — see the note at the top of this file).
   */
  allowPrivateForgeHosts: readonly string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const cloneDirRaw =
    parsed.DEVDIGEST_CLONE_DIR ?? join(homedir(), '.devdigest', 'workspace');
  const cloneDir = isAbsolute(cloneDirRaw) ? cloneDirRaw : resolve(process.cwd(), cloneDirRaw);
  const runnerBundlePathRaw =
    parsed.RUNNER_BUNDLE_PATH ?? resolve(process.cwd(), '..', 'agent-runner', 'dist', 'index.js');
  const runnerBundlePath = isAbsolute(runnerBundlePathRaw)
    ? runnerBundlePathRaw
    : resolve(process.cwd(), runnerBundlePathRaw);
  return {
    databaseUrl: parsed.DATABASE_URL,
    apiPort: parsed.API_PORT,
    webPort: parsed.WEB_PORT,
    cloneDir,
    runnerBundlePath,
    secretsPath: join(homedir(), '.devdigest', 'secrets.json'),
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    webOrigin: `http://localhost:${parsed.WEB_PORT}`,
    embeddingsEnabled: parsed.EMBEDDINGS_ENABLED === 'true',
    repoIntelEnabled: parsed.REPO_INTEL_ENABLED !== 'false',
    // Indexed by the constant rather than written as `parsed.DEVDIGEST_…`, so
    // the schema key and the name the refusal messages print cannot drift: a
    // mismatch is a typecheck error here, not a variable nobody notices is
    // being ignored.
    allowPrivateForgeHosts: parseAllowedPrivateHosts(parsed[ALLOW_PRIVATE_FORGE_HOSTS_ENV]),
  };
}
