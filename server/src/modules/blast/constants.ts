/**
 * Blast Radius slice — literals only. Every cap the feature has lives here;
 * `helpers.ts`, `service.ts` and `routes.ts` carry no number.
 *
 * The caps exist to bound the response, not to hide data: the state/reason pair
 * on `BlastRadiusResponse` is what reports an incomplete answer, and a cap is
 * never allowed to look like "nothing found" (see `foldBlastResult`).
 */

/**
 * Caller fan-out kept per changed symbol. Deliberately the same value as
 * `repo-intel`'s `MAX_CALLERS_PER_SYMBOL`: the facade already clamps per symbol
 * as of L06 Step 2, and this is the fold's own belt-and-braces bound so the
 * response stays bounded even if the facade's semantics change again.
 */
export const MAX_CALLERS_PER_SYMBOL = 20;

/**
 * Changed symbols reported. This is what bounds the whole response: the fold's
 * worst case is `MAX_CHANGED_SYMBOLS × MAX_CALLERS_PER_SYMBOL` = 1000 caller
 * rows, which is also the bound on what the facade can hand back.
 */
export const MAX_CHANGED_SYMBOLS = 50;

/** Endpoints attributed to one changed symbol. */
export const MAX_ENDPOINTS_PER_SYMBOL = 20;

/** Crons (raw expression or `job:<kind>`) attributed to one changed symbol. */
export const MAX_CRONS_PER_SYMBOL = 20;
