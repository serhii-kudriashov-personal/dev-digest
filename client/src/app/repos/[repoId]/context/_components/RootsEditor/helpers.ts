import { MAX_ROOTS, MAX_ROOT_LENGTH } from "./constants";

/** One root per line; blank lines and stray whitespace are dropped, not rejected. */
export function parseRoots(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Whether the parsed list is one the server will accept.
 *
 * A positive check, matching the contract's own bounds: at least one root, no
 * more than `MAX_ROOTS`, none longer than `MAX_ROOT_LENGTH`. Anything else is
 * refused here so the user sees the reason instead of a 422.
 */
export function rootsAreValid(roots: string[]): boolean {
  return (
    roots.length > 0 &&
    roots.length <= MAX_ROOTS &&
    roots.every((root) => root.length <= MAX_ROOT_LENGTH)
  );
}
