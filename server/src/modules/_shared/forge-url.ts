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
 * `isPrivateAddress` below on each answer.
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
 */
export function normalizeBaseUrl(raw: string): BaseUrlResult {
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
  if (isPrivateAddress(u.hostname) || isLoopbackName(u.hostname)) {
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
 */
export function admitBaseUrl(raw: string): InstanceRejectionCode | null {
  const result = normalizeBaseUrl(raw);
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
