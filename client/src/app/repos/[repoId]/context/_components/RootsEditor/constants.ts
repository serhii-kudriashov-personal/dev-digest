/* The two bounds the server's `ContextRootsUpdate` contract enforces, mirrored
   here so a malformed list is refused before a round trip. They are an external
   contract, not a styling choice: if the contract widens, both ends move. */

/** Most search roots one repository may configure. */
export const MAX_ROOTS = 20;

/** Longest a single root pattern may be. */
export const MAX_ROOT_LENGTH = 300;

/** Rows the editing textarea opens at. */
export const ROOTS_TEXTAREA_ROWS = 4;
