/**
 * gitlab adapter (SPEC-06) — the outbound half of GitLab instance support.
 *
 *   http.ts      one bounded, redirect-refusing, DNS-checked HTTP client per
 *                registered instance
 *   instance.ts  the `GitLabInstanceClient` port + its HTTP implementation:
 *                verify a base URL and an access key, report version/edition,
 *                and probe the approval capability
 *
 * One shallow barrel, re-exporting only. Nothing outside `platform/container.ts`
 * constructs an implementation from here (`backend-onion-architecture` §4);
 * everything else takes the port off the container, which is what keeps
 * `ContainerOverrides` a working test seam.
 */
export * from './http.js';
export * from './instance.js';
