/** Constants for the skills module. */

/** Initial body version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Default skill description when none is supplied on insert. */
export const DEFAULT_SKILL_DESCRIPTION = '';

/** Type assigned to an imported skill when the file does not imply a better one. */
export const DEFAULT_SKILL_TYPE = 'custom' as const;

/**
 * Ceiling on the DECODED upload, checked before anything is parsed.
 *
 * Deliberately below the route's own `bodyLimit` (see routes.ts): a payload the
 * route accepts but this rejects produces a clear `ValidationError` naming the
 * size, whereas one that trips `bodyLimit` produces Fastify's opaque 413.
 */
export const MAX_IMPORT_BYTES = 512 * 1024;

/**
 * Ceiling on the TOTAL decompressed size of an archive. A small zip can expand
 * without bound (a "zip bomb"), so the guard has to be on the output, not just
 * on the uploaded file — this is checked entry by entry as the archive is read.
 */
export const MAX_UNPACKED_BYTES = 2 * 1024 * 1024;

/**
 * Per-route body limit for `POST /skills/import`, above `MAX_IMPORT_BYTES` with
 * room for base64's ~33% inflation plus the JSON envelope. The app-wide default
 * is 1 MiB (`app.ts`), which a base64-encoded 512 KiB file would otherwise
 * exceed on its own.
 */
export const IMPORT_BODY_LIMIT_BYTES = 1_500_000;
