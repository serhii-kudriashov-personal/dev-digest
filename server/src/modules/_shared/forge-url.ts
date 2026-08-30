import type { InstanceRejectionCode } from '@devdigest/shared';

/**
 * Forge URL admission and parsing (SPEC-06 — AC-2, AC-4, AC-5, AC-13, AC-14,
 * NFR-4). PURE: no I/O, no DNS, no DB, no container.
 *
 * WHY IT LIVES IN `_shared/` AND NOT IN A SLICE. Two slices need the same
 * functions — `instances` to admit a base URL at registration, `repos` to match
 * an imported repository URL against an already-registered one. A slice's
 * `helpers.ts` is `SLICE_PRIVATE` and `no-cross-slice-import` blocks it, while
 * an off-manifest filename under `modules/_shared/` is importable by every
 * slice (`server/INSIGHTS.md` 2026-08-17).
 *
 * WHAT THIS FILE IS FOR, IN ONE LINE. The operator's base URL decides where the
 * server will later open a connection and where an access key will later be
 * sent, so it is the SSRF control surface. Everything here is therefore
 * fail-closed: an input this file cannot classify is refused, never admitted.
 *
 * THE HALF THIS FILE CANNOT DO. A hostname that is not an IP literal can still
 * resolve to a private address. That is the runtime half of AC-4 and it lives
 * in `adapters/gitlab/http.ts`, which re-resolves the host and calls
 * `isRefusedAddress` below on each answer.
 *
 * THE ONE WAY THE REFUSAL CAN BE WIDENED. A self-managed forge on a corporate
 * network is SPEC-06's primary use case and it resolves to an RFC 1918 address,
 * so a blanket refusal blocks the feature it protects. The operator therefore
 * names the hosts they accept, one at a time, in
 * `DEVDIGEST_ALLOW_PRIVATE_FORGE_HOSTS` — and that list arrives here as a
 * PARAMETER, because this file stays pure and never reads config (see the top
 * of this docblock, `pnpm arch`, and `backend-onion-architecture` §1).
 *
 * Three properties make that opt-in safe, and all three are load-bearing:
 *
 *  1. **Exact hostname match, never a suffix.** `evil-git.devart.com` does not
 *     match an entry of `git.devart.com`, and `*.internal` matches nothing at
 *     all because no real hostname contains a `*`.
 *  2. **The comparison runs on the PARSED, lower-cased `URL.hostname`**, never
 *     on the operator's raw string (root `INSIGHTS.md` 2026-08-28).
 *  3. **It widens RFC 1918 and IPv6 unique-local ONLY.** Loopback stays refused
 *     because that is this machine; link-local stays refused because that is
 *     the cloud metadata service; `0/8`, CGNAT, `192.0.0/24`, benchmarking,
 *     multicast and reserved stay refused because none of them is a forge.
 *     Allowlisting a corporate GitLab must not incidentally open
 *     `169.254.169.254`.
 *
 * One thing the WHATWG parser does for free, and it is worth knowing rather
 * than re-implementing: `new URL()` canonicalises obfuscated IPv4 literals
 * (`https://0177.0.0.1` and `https://2130706433` both come back as
 * `127.0.0.1`), fully expands and normalises IPv6, and resolves `.`/`..` and
 * their percent-encoded forms out of the path. So every check below runs on the
 * canonical form, not on the string the operator typed.
 */

/** A base URL that passed admission, split into the parts callers need. */
export interface NormalizedBaseUrl {
  /** `https://host[:port]` — no trailing slash. */
  origin: string;
  /** `''`, or `/prefix` for an instance mounted under a path. No trailing slash. */
  pathPrefix: string;
  /** `origin + pathPrefix` — what is persisted as `git_instances.base_url`. */
  baseUrl: string;
  /** Filesystem-safe slug identifying this instance (see `instanceKeyFor`). */
  instanceKey: string;
}

export type BaseUrlResult =
  | { ok: true; value: NormalizedBaseUrl }
  | { ok: false; code: InstanceRejectionCode };

/** The minimum an instance-shaped record must expose to be matched against. */
export interface OriginCandidate {
  baseUrl: string;
}

/**
 * The environment variable that widens the private-address refusal, for the
 * hosts it names and no others.
 *
 * Declared here rather than in `platform/config.ts` because both halves of the
 * gate have to NAME it in a refusal — a refusal the operator cannot act on is
 * what made this a support question — and because `platform/config.ts` indexes
 * its parsed environment with this constant, so a typo there is a typecheck
 * error rather than a silently ignored variable.
 */
export const ALLOW_PRIVATE_FORGE_HOSTS_ENV = 'DEVDIGEST_ALLOW_PRIVATE_FORGE_HOSTS';

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP_RE = /^[0-9a-f]{1,4}$/;

function ipv4Octets(host: string): [number, number, number, number] | null {
  const m = IPV4_RE.exec(host);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts as [number, number, number, number];
}

function isPrivateIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 192 && b === 0 && c === 0) return true; // RFC 6890 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // RFC 2544 benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC 6598 carrier-grade NAT
  if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 multicast
  if (a >= 240) return true; // 240.0.0.0/4 reserved, incl. 255.255.255.255 broadcast
  return false;
}

/**
 * The three RFC 1918 blocks, and NOTHING else — this is the exact cut an
 * explicit per-host allowlist is permitted to widen (see the docblock at the
 * top). It is deliberately a separate predicate from `isPrivateIpv4` rather
 * than a subset expressed by exclusion: written as "private but not loopback,
 * not link-local, not …" it would silently widen every range added to
 * `isPrivateIpv4` afterwards.
 */
function isRfc1918Ipv4([a, b]: [number, number, number, number]): boolean {
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/** The IPv4 address carried in the last two groups of an IPv6 literal. */
function embeddedIpv4(g: number[]): [number, number, number, number] {
  const hi = g[6] ?? 0;
  const lo = g[7] ?? 0;
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
}

/** Expand an IPv6 literal (bracketed or bare) into its eight 16-bit groups. */
function parseIpv6(raw: string): number[] | null {
  let s = raw;
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (!s.includes(':')) return null;
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);

  // A trailing dotted-quad is how Node's resolver spells an IPv4-mapped address
  // — `dns.lookup(…, { family: 6, v4mapped: true })` returns
  // `::ffff:192.0.0.170`, never the hex form. `new URL()` canonicalises URL-form
  // input to hex, so a hex-only parser tests green on every admission case and
  // still answers `false` on resolver output, leaving the RUNTIME half of the
  // gate open. Fold the quad into the last two 16-bit groups.
  const dotted = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (dotted) {
    const quad = ipv4Octets(dotted[1] ?? '');
    if (!quad) return null;
    const hi = ((quad[0] << 8) | quad[1]).toString(16);
    const lo = ((quad[2] << 8) | quad[3]).toString(16);
    s = `${s.slice(0, dotted.index)}:${hi}:${lo}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!IPV6_GROUP_RE.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };

  const head = toGroups(halves[0] ?? '');
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1] ?? '');
  if (!tail) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function isPrivateIpv6(g: number[]): boolean {
  if (g.every((x) => x === 0)) return true; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback
  const first = g[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  // IPv4-mapped (::ffff:a.b.c.d) — classify the embedded v4 address.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isPrivateIpv4(embeddedIpv4(g));
  }
  // IPv4-compatible (::a.b.c.d, deprecated by RFC 4291 but still routable by
  // some stacks). The `::1` test above only matches loopback EXACTLY, so
  // without this branch `https://[::127.0.0.1]` — which `new URL()`
  // canonicalises to `[::7f00:1]` — classifies as public.
  if (g.slice(0, 6).every((x) => x === 0)) {
    return isPrivateIpv4(embeddedIpv4(g));
  }
  // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052). On a network with a NAT64
  // gateway these are translated to the embedded v4 address, so
  // `[64:ff9b::a9fe:a9fe]` reaches 169.254.169.254 — the cloud metadata
  // service. Classify what it translates to, not the prefix.
  if (first === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIpv4(embeddedIpv4(g));
  }
  return false;
}

/**
 * The IPv6 half of the allowlistable cut: unique-local `fc00::/7` only, plus
 * the three forms that TUNNEL an IPv4 address, each classified by what it
 * translates to. Mirrors `isPrivateIpv6`'s branch order on purpose, so the two
 * predicates cannot disagree about which form an address is.
 *
 * `::1` and `::` both fall through the IPv4-compatible branch with an embedded
 * `0.0.0.1` / `0.0.0.0`, neither of which is RFC 1918 — so loopback and the
 * unspecified address answer `false` here without a special case. The explicit
 * loopback branch is kept anyway: a reader must not have to derive "loopback is
 * never widened" from arithmetic two branches away.
 */
function isAllowlistablePrivateIpv6(g: number[]): boolean {
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1 loopback
  const first = g[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local — metadata
  // IPv4-mapped (::ffff:a.b.c.d).
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isRfc1918Ipv4(embeddedIpv4(g));
  }
  // IPv4-compatible (::a.b.c.d).
  if (g.slice(0, 6).every((x) => x === 0)) {
    return isRfc1918Ipv4(embeddedIpv4(g));
  }
  // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052).
  if (first === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isRfc1918Ipv4(embeddedIpv4(g));
  }
  return false;
}

/**
 * Is `address` in the narrow set an operator MAY open with an explicit per-host
 * allowlist — RFC 1918 (`10/8`, `172.16/12`, `192.168/16`) or IPv6 unique-local
 * (`fc00::/7`), including those addresses tunnelled inside an IPv4-mapped,
 * IPv4-compatible or NAT64 IPv6 literal?
 *
 * Answering `true` never admits anything on its own: it only says the allowlist
 * is ALLOWED to speak about this address. `isRefusedAddress` is the decision.
 *
 * The invariant that makes the pair safe to reason about: every address this
 * returns `true` for, `isPrivateAddress` also returns `true` for. It is a
 * strict subset, so the allowlist can only ever narrow a refusal, never create
 * one.
 */
export function isAllowlistablePrivateAddress(address: string): boolean {
  const host = address.trim().toLowerCase();
  const v4 = ipv4Octets(host);
  if (v4) return isRfc1918Ipv4(v4);
  const v6 = parseIpv6(host);
  if (v6) return isAllowlistablePrivateIpv6(v6);
  return false;
}

/**
 * Is `address` an IP literal DevDigest must not connect to (AC-4)? Accepts both
 * the URL form (`[::1]`) and the bare form a resolver returns (`::1`,
 * `10.1.2.3`).
 *
 * "Must not" is wider than "private": loopback, link-local, unique-local and the
 * RFC 1918 / 6598 ranges, plus multicast, the 240/4 reserved block, the RFC 2544
 * benchmarking block and 192.0.0.0/24 — none of which is a forge, and each of
 * which reaches something on the local network rather than the internet. The
 * two IPv6 forms that TUNNEL a v4 address (`::a.b.c.d` and the NAT64 prefix
 * `64:ff9b::/96`) are classified by what they translate to, not by their
 * prefix.
 *
 * Returns FALSE for anything that is not an IP literal — a DNS name is not
 * classifiable here, which is exactly why the adapter re-resolves it and calls
 * this again on each answer.
 */
export function isPrivateAddress(address: string): boolean {
  const host = address.trim().toLowerCase();
  const v4 = ipv4Octets(host);
  if (v4) return isPrivateIpv4(v4);
  const v6 = parseIpv6(host);
  if (v6) return isPrivateIpv6(v6);
  return false;
}

/**
 * Names RFC 6761 reserves for the loopback interface. Cheap to check and always
 * correct, so the syntactic pass rejects them without waiting for DNS.
 */
export function isLoopbackName(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost');
}

// ---------------------------------------------------------------------------
// The per-host opt-in
// ---------------------------------------------------------------------------

/**
 * One spelling for one host, so both sides of an allowlist comparison are
 * reduced the same way: trimmed, lower-cased, the root label's trailing dot
 * dropped (`git.devart.com.` and `git.devart.com` are the same host), and an
 * IPv6 literal's brackets removed (`url.hostname` keeps them, a resolver does
 * not — `server/INSIGHTS.md` 2026-08-28).
 *
 * Normalisation only. It never removes a label, so it cannot turn one host into
 * another.
 */
function canonicalHost(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

/**
 * Read `DEVDIGEST_ALLOW_PRIVATE_FORGE_HOSTS` into the list the two halves of
 * the gate compare against. Pure — the environment is read by
 * `platform/config.ts`, which passes the raw value here.
 *
 * Entries are canonicalised and de-duplicated; blanks are dropped. Nothing else
 * is interpreted, and that is the point: an entry that is not a bare hostname
 * (`*.internal`, `https://git.devart.com`, `10.0.0.0/8`) simply matches no host
 * ever, because `URL.hostname` cannot produce those strings. A malformed entry
 * is therefore inert rather than dangerous.
 */
export function parseAllowedPrivateHosts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const hosts = new Set<string>();
  for (const entry of raw.split(',')) {
    const host = canonicalHost(entry);
    if (host !== '') hosts.add(host);
  }
  return [...hosts];
}

/**
 * Did the operator name THIS host? Exact match on the canonical form — never a
 * suffix, never a wildcard, never a substring. A suffix rule would make
 * `evil-git.devart.com` match an entry of `git.devart.com`, which is the hole
 * this whole feature has to not have.
 *
 * `hostname` must be a PARSED `URL.hostname` (or a resolver's host), never the
 * raw string an operator typed: the WHATWG parser is what collapses the
 * obfuscated spellings, and only its output is safe to compare (root
 * `INSIGHTS.md` 2026-08-28).
 */
export function isAllowlistedForgeHost(
  hostname: string,
  allowedPrivateHosts: readonly string[],
): boolean {
  if (allowedPrivateHosts.length === 0) return false;
  const host = canonicalHost(hostname);
  if (host === '') return false;
  return allowedPrivateHosts.some((entry) => canonicalHost(entry) === host);
}

/**
 * THE decision both halves of the gate share: must DevDigest refuse to connect
 * to `address` when reaching `hostname`?
 *
 * Three questions, in this order, and the order is the security property:
 *
 *  1. Not a private address at all → not refused. Nothing changes for the
 *     public internet.
 *  2. Private, and the operator did not name this host → refused. The default
 *     is untouched, and an empty allowlist is the default.
 *  3. Private, host named → refused UNLESS the address is in the narrow
 *     RFC 1918 / unique-local cut. So allowlisting a corporate GitLab admits
 *     `10.10.128.52` and still refuses `127.0.0.1`, `169.254.169.254` and
 *     `::1` for that very same host.
 *
 * The syntactic half passes the host as BOTH arguments, because there an IP
 * literal is the host; the runtime half passes each resolved address against
 * the host that produced it.
 */
export function isRefusedAddress(
  address: string,
  hostname: string,
  allowedPrivateHosts: readonly string[] = [],
): boolean {
  if (!isPrivateAddress(address)) return false;
  if (!isAllowlistedForgeHost(hostname, allowedPrivateHosts)) return true;
  return !isAllowlistablePrivateAddress(address);
}

/**
 * The one sentence that tells an operator how to widen the gate for a host they
 * own. Both halves of the gate use it, so the instruction cannot drift between
 * the message shown at registration and the one shown on a later request.
 *
 * Names the HOSTNAME only, never the base URL: the submitted URL may carry a
 * username and password (AC-5, AC-10).
 *
 * Only append it when the refusal would actually be lifted by doing so — see
 * `isAllowlistablePrivateAddress`. Telling an operator to allowlist a host that
 * resolves to `169.254.169.254` would be advice that cannot work.
 */
export function allowlistHint(hostname: string): string {
  return (
    `If this is a forge on your own private network, add '${hostname}' to ` +
    `${ALLOW_PRIVATE_FORGE_HOSTS_ENV} (a comma-separated list of exact hostnames) ` +
    `and restart the server.`
  );
}

// ---------------------------------------------------------------------------
// Base URL admission
// ---------------------------------------------------------------------------

/** Path segments that must never survive into a key or a clone path. */
function segmentsOf(pathname: string): string[] | null {
  const trimmed = pathname.replace(/^\/+|\/+$/g, '');
  if (trimmed === '') return [];
  const segments = trimmed.split('/');
  for (const raw of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null; // a malformed escape is not a segment we will reason about
    }
    // `new URL()` already resolves these away; the check is defence in depth,
    // because the value ends up in a filesystem path (`security` §Framework
    // Security Quirks — "path.join() with user input allows traversal").
    if (decoded === '' || decoded === '.' || decoded === '..') return null;
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) return null;
  }
  return segments;
}

/**
 * Normalize and admit an operator-supplied base URL.
 *
 * Check order is deliberate and each check has its own code, so a consumer can
 * branch on the reason instead of matching prose (AC-2, AC-4, AC-5).
 *
 * `allowedPrivateHosts` is the operator's opt-in list (see the docblock at the
 * top). It DEFAULTS TO EMPTY, which is the strictest behaviour — a caller that
 * forgets it refuses more, never less.
 */
export function normalizeBaseUrl(
  raw: string,
  allowedPrivateHosts: readonly string[] = [],
): BaseUrlResult {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    // Nothing in the closed rejection set means "malformed", and inventing a
    // code is a contract change. Fail closed onto the catch-all rather than
    // admitting something we could not parse.
    return { ok: false, code: 'unreachable' };
  }

  if (u.protocol !== 'https:') return { ok: false, code: 'not_https' };
  if (u.username !== '' || u.password !== '') return { ok: false, code: 'credentials_in_url' };
  // `localhost` and `*.localhost` are THIS machine, so no allowlist entry can
  // reach them — the check stays unconditional and comes first.
  if (isLoopbackName(u.hostname)) return { ok: false, code: 'private_address' };
  // When the host is an IP literal it is also the address, so it is passed as
  // both arguments; a DNS name is not classifiable here and falls through to
  // the runtime half in `adapters/gitlab/http.ts`.
  if (isRefusedAddress(u.hostname, u.hostname, allowedPrivateHosts)) {
    return { ok: false, code: 'private_address' };
  }

  const segments = segmentsOf(u.pathname);
  if (segments === null) return { ok: false, code: 'unreachable' };

  const origin = u.origin;
  const pathPrefix = segments.length === 0 ? '' : `/${segments.join('/')}`;
  const key = keyFromParts(u.hostname, u.port, segments);
  if (key === null) return { ok: false, code: 'unreachable' };

  return {
    ok: true,
    value: { origin, pathPrefix, baseUrl: `${origin}${pathPrefix}`, instanceKey: key },
  };
}

/**
 * `null` when the base URL is acceptable, otherwise why it was refused (AC-2,
 * AC-4 syntactic half, AC-5). Thin projection of `normalizeBaseUrl` so a caller
 * that only wants the verdict does not have to unwrap a union.
 *
 * Same `allowedPrivateHosts` contract: omitted means the strictest answer.
 */
export function admitBaseUrl(
  raw: string,
  allowedPrivateHosts: readonly string[] = [],
): InstanceRejectionCode | null {
  const result = normalizeBaseUrl(raw, allowedPrivateHosts);
  return result.ok ? null : result.code;
}

function keyFromParts(hostname: string, port: string, segments: string[]): string | null {
  // Brackets would be illegal in a path segment; an IPv6 host is rejected long
  // before this in practice, but the key must never contain one either way.
  const host = hostname.replace(/^\[|\]$/g, '');
  const parts = [host, ...(port === '' ? [] : [port]), ...segments].map((p) =>
    encodeURIComponent(p),
  );
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return parts.join('_');
}

/**
 * Filesystem-safe slug for one instance: host, then the port when it is not the
 * https default, then each path segment — percent-encoded and `_`-joined.
 *
 *   https://gitlab.example.com          → gitlab.example.com
 *   https://git.acme.io:8443/gitlab     → git.acme.io_8443_gitlab
 *   https://github.com                  → github.com   (the legacy clone path)
 *
 * `null` when the URL cannot produce one. This value becomes a directory name
 * under the clone root, so a `.`, `..` or separator in it would be a traversal.
 */
export function instanceKeyFor(baseUrl: string): string | null {
  const result = normalizeBaseUrl(baseUrl);
  return result.ok ? result.value.instanceKey : null;
}

// ---------------------------------------------------------------------------
// Matching a repository URL against registered instances
// ---------------------------------------------------------------------------

/**
 * NOTE ON THE ALLOWLIST, for everything below this line. `prefixOf` re-admits
 * an ALREADY-REGISTERED base URL at the strictest setting (no allowlist), which
 * is deliberate defence in depth and is free for the case this feature exists
 * for: a host like `git.devart.com` is a DNS name, so the syntactic half admits
 * it either way and only the runtime DNS half ever refuses it.
 *
 * The one shape it does cost: an instance registered by private IP LITERAL
 * (`https://10.10.128.52/`) is admitted by `normalizeBaseUrl` when allowlisted,
 * but `matchOrigin` will not match a repository URL to it, because it does not
 * take the allowlist. Threading it here would change `resolveRepoUrl`'s
 * signature and its callers in the `repos` slice — out of scope here, and
 * recorded rather than silently half-done.
 */
function prefixOf(candidate: OriginCandidate): { origin: string; pathPrefix: string } | null {
  const result = normalizeBaseUrl(candidate.baseUrl);
  return result.ok ? { origin: result.value.origin, pathPrefix: result.value.pathPrefix } : null;
}

function remainderFor(repoUrl: string, candidate: OriginCandidate): string[] | null {
  let u: URL;
  try {
    u = new URL(repoUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const base = prefixOf(candidate);
  if (!base) return null;
  if (u.origin !== base.origin) return null;

  const path = u.pathname;
  if (base.pathPrefix !== '' && !path.startsWith(`${base.pathPrefix}/`)) return null;
  const rest = path.slice(base.pathPrefix.length);
  const segments = segmentsOf(rest);
  if (segments === null || segments.length === 0) return null;
  return segments;
}

/**
 * The registered instance a repository URL belongs to, or `null` when none does
 * (AC-13, AC-14).
 *
 * The URL can only ever SELECT an already-registered destination; it can never
 * introduce one. When two registered instances share an origin and differ only
 * by path prefix, the longest matching prefix wins, so
 * `https://x/gitlab/g/p` resolves to `https://x/gitlab` rather than to
 * `https://x`.
 */
export function matchOrigin<T extends OriginCandidate>(
  repoUrl: string,
  instances: readonly T[],
): T | null {
  let best: T | null = null;
  let bestLength = -1;
  for (const candidate of instances) {
    if (remainderFor(repoUrl, candidate) === null) continue;
    const base = prefixOf(candidate);
    if (!base) continue;
    if (base.pathPrefix.length > bestLength) {
      best = candidate;
      bestLength = base.pathPrefix.length;
    }
  }
  return best;
}

/**
 * The repository's path within its instance, at ANY depth — `group/project`,
 * `group/subgroup/team/project`, and so on (AC-13, NFR-4). Trailing `.git` is
 * stripped; a `.` or `..` segment refuses the whole URL.
 *
 * `null` when the URL does not belong to this instance or has fewer than two
 * segments — a project always sits inside at least one namespace.
 */
export function namespacePathFrom(repoUrl: string, instance: OriginCandidate): string | null {
  const segments = remainderFor(repoUrl, instance);
  if (segments === null) return null;

  const last = segments[segments.length - 1];
  if (last === undefined) return null;
  const project = last.replace(/\.git$/, '');
  if (project === '') return null;
  const full = [...segments.slice(0, -1), project];
  if (full.length < 2) return null;
  return full.join('/');
}
