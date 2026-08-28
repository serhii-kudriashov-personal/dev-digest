import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import {
  type GitLabInstanceClient,
  GitLabInstanceHttpClient,
} from '../adapters/gitlab/index.js';
import { RateGate } from './resilience.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { InstancesRepository } from '../modules/instances/repository.js';
import { SkillsRepository } from '../modules/skills/repository.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import type { IntentFacade } from '../modules/intent/types.js';
import { IntentService } from '../modules/intent/service.js';
import { BlastService } from '../modules/blast/service.js';
import { ReviewService } from '../modules/reviews/service.js';
import type { ProjectContext } from '../modules/context/types.js';
import { ContextService } from '../modules/context/service.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** derived-PR-intent facade (L03) — tests inject a stub IntentFacade. */
  intent?: IntentFacade;
  /** blast-radius service (L06) — tests inject a stub BlastService. */
  blast?: BlastService;
  /** project-context facade (SPEC-01) — tests inject a stub ProjectContext. */
  projectContext?: ProjectContext;
  /** reviews service (SPEC-05) — tests inject a stub to stand in for the executor. */
  reviews?: ReviewService;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
  /** GitLab instance verification (SPEC-06) — tests inject a mock so no test
   *  ever makes an outbound request to an operator-named host. */
  gitlabInstanceClient?: GitLabInstanceClient;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _instancesRepo?: InstancesRepository;
  private _skillsRepo?: SkillsRepository;
  private _reviewRepo?: ReviewRepository;
  private _repoIntel?: RepoIntel;
  private _intent?: IntentFacade;
  private _blast?: BlastService;
  private _projectContext?: ProjectContext;
  private _reviews?: ReviewService;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;
  private _gitlabInstanceClient?: GitLabInstanceClient;
  private _forgeRateGate?: RateGate;

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  /**
   * Registered forge instances (SPEC-06). Constructed here, in the composition
   * root, so a consuming slice reads `container.instancesRepo` instead of
   * importing another slice's `repository.ts` — which `no-cross-slice-import`
   * forbids and this getter is exempt from by construction
   * (`server/INSIGHTS.md` 2026-08-08).
   */
  get instancesRepo(): InstancesRepository {
    return (this._instancesRepo ??= new InstancesRepository(this.db));
  }

  get skillsRepo(): SkillsRepository {
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /**
   * The derived-PR-intent facade (L03). This getter is the SANCTIONED
   * cross-slice channel: `no-cross-slice-import` scopes its `from` selector to
   * `^src/modules/`, so `run-executor.ts` importing `intent/service.js` would
   * fire the rule while this file importing it does not. The container is
   * exempt by construction, not by an allowlist.
   *
   * Tests inject a mock via `ContainerOverrides.intent`.
   */
  get intent(): IntentFacade {
    if (this.overrides.intent) return this.overrides.intent;
    this._intent ??= new IntentService(this);
    return this._intent;
  }

  /**
   * The blast-radius service (L06). Same sanctioned cross-slice channel as
   * `intent` above: `no-cross-slice-import` scopes its `from` to
   * `^src/modules/`, so `brief/service.ts` importing `blast/service.js`
   * directly would fire the rule while this file importing it does not
   * (`server/INSIGHTS.md` 2026-08-08).
   *
   * Tests inject a mock via `ContainerOverrides.blast`.
   */
  get blast(): BlastService {
    if (this.overrides.blast) return this.overrides.blast;
    this._blast ??= new BlastService(this);
    return this._blast;
  }

  /**
   * The project-context facade (SPEC-01) — Markdown discovery, attachment and
   * the run-time read. Same sanctioned cross-slice channel as `intent` above:
   * `no-cross-slice-import` scopes its `from` to `^src/modules/`, so
   * `run-executor.ts` importing `context/service.js` would fire the rule while
   * this file importing it does not.
   *
   * Tests inject a mock via `ContainerOverrides.projectContext`.
   */
  get projectContext(): ProjectContext {
    if (this.overrides.projectContext) return this.overrides.projectContext;
    this._projectContext ??= new ContextService(this);
    return this._projectContext;
  }

  /**
   * The reviews service (SPEC-05) — this is the sanctioned cross-slice
   * channel for the multi-agent slice's `start()` to reach the reviews
   * slice's UNCHANGED `runReview`/executor: `no-cross-slice-import` scopes
   * its `from` to `^src/modules/`, so `modules/multi-agent/service.ts`
   * importing `reviews/service.js` directly would fire the rule while this
   * file importing it does not (`server/INSIGHTS.md` 2026-08-08), same
   * shape as `intent`/`blast`/`projectContext` above.
   *
   * Tests inject a stub via `ContainerOverrides.reviews`.
   */
  get reviews(): ReviewService {
    if (this.overrides.reviews) return this.overrides.reviews;
    this._reviews ??= new ReviewService(this);
    return this._reviews;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /**
   * Per-instance rate gate shared by every outbound forge call (NFR-10,
   * NFR-11). One gate per container, keyed by instance, so a `429` from one
   * registered instance defers only that instance's next request.
   */
  get forgeRateGate(): RateGate {
    return (this._forgeRateGate ??= new RateGate());
  }

  /**
   * GitLab instance verification (SPEC-06). Synchronous because it needs no
   * secret of its own — the access token is a per-call argument, supplied by
   * the operator on registration or read from `SecretsProvider` on a re-test.
   *
   * Tests inject a mock via `ContainerOverrides.gitlabInstanceClient`; that
   * seam is the only reason no test makes a real outbound request, so nothing
   * outside this file may `new` the implementation
   * (`backend-onion-architecture` §4).
   */
  get gitlabInstanceClient(): GitLabInstanceClient {
    if (this.overrides.gitlabInstanceClient) return this.overrides.gitlabInstanceClient;
    this._gitlabInstanceClient ??= new GitLabInstanceHttpClient({ gate: this.forgeRateGate });
    return this._gitlabInstanceClient;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  private async buildLlm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key);
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, {
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
