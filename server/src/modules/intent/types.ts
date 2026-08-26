import type { PrIntentRecord } from '@devdigest/shared';

/**
 * The intent slice's PUBLIC surface — the ONLY file another slice may import.
 *
 * Everything else here (`service`, `repository`, `routes`, `helpers`,
 * `pipeline`, `constants`) is private by contract. Note that
 * `no-cross-slice-import` only enforces the first four by name: `pipeline.ts`
 * and `constants.ts` would slip past the gate, so they are private by
 * discipline, not by mechanism.
 *
 * Cross-slice access goes through `container.intent`, never through an import.
 */

/**
 * A structural log sink. `RunLogger` satisfies it without knowing about this
 * slice, which is what keeps the dependency pointing one way.
 */
export interface IntentSink {
  info(msg: string): void;
}

export interface DerivedIntent {
  record: PrIntentRecord;
  /**
   * The pre-rendered `## PR intent (derived)` body, already truncated, ready to
   * hand to the engine. `null` when there is nothing worth injecting — in which
   * case the review prompt stays byte-identical to a pre-L03 one.
   */
  promptBlock: string | null;
  /** The pull has moved since this intent was derived. */
  stale: boolean;
}

/**
 * The facade port over the intent subsystem.
 *
 * DEGRADED CONTRACT, stated here because it is the contract: **`ensure` never
 * throws.** A missing API key (`ConfigError`), a provider error, a GitHub
 * failure, a bad model response or a DB hiccup all return `null` and log. A
 * caller must never need a try/catch around it — the moment one does, the
 * degraded path stops being exercised and quietly rots. Same shape as
 * `RepoIntel`, for the same reason.
 *
 * Intent is enrichment. A review must always be able to run without it.
 */
export interface IntentFacade {
  /**
   * The stored intent for a PR, or `null` when none has been derived.
   *
   * NOT covered by the never-throw contract above: this throws `NotFoundError`
   * when the PR does not exist in the workspace, because that is a bad request
   * and the HTTP edge needs the 404. Only `ensure` is safe to call unguarded.
   */
  get(workspaceId: string, prId: string): Promise<DerivedIntent | null>;
  /**
   * The stored intent when it is still current, otherwise derive a new one.
   * `force` re-derives regardless. Returns `null` on any failure.
   */
  ensure(
    workspaceId: string,
    prId: string,
    opts?: { force?: boolean; sink?: IntentSink },
  ): Promise<DerivedIntent | null>;
}
