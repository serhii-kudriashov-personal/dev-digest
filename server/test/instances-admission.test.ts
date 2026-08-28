import { describe, it, expect } from 'vitest';
import {
  admitBaseUrl,
  instanceKeyFor,
  isLoopbackName,
  isPrivateAddress,
  matchOrigin,
  namespacePathFrom,
  normalizeBaseUrl,
} from '../src/modules/_shared/forge-url.js';

/**
 * `modules/_shared/forge-url.ts` is the SSRF control surface for SPEC-06
 * (`specs/2026-08-28-gitlab-repositories.md` — AC-2, AC-4, AC-5, AC-13, AC-14,
 * NFR-4). The operator's base URL decides where this process opens a connection
 * and where an access token is sent, so a gap in the classifier is not a wrong
 * answer, it is a reachable internal service.
 *
 * Ring 2, pure: no DNS, no DB, no container, no container overrides needed
 * (`backend-onion-architecture` §9 — "helpers directly").
 *
 * Two things drive the shape of this file:
 *
 *  1. Every range the classifier's own docblock claims gets a case, because a
 *     claimed-but-unimplemented range fails silently and looks exactly like a
 *     working one.
 *  2. Every address is asserted in BOTH spellings. `new URL('https://[::1]/')`
 *     yields the hostname `'[::1]'` with brackets and in hex, while
 *     `dns.lookup(h, { all: true })` yields `'::1'` bare and spells an
 *     IPv4-mapped address as `::ffff:192.0.0.170`. `isPrivateAddress` is called
 *     from both sites — `admitBaseUrl` here and `adapters/gitlab/http.ts`'s
 *     `assertHostIsPublic` — so a predicate that only understands the URL
 *     spelling tests green on every admission case while leaving the RUNTIME
 *     half of AC-4 wide open (root/`server` `INSIGHTS.md` 2026-08-28).
 */

const INSTANCE = { baseUrl: 'https://gitlab.example.com' };

describe('admitBaseUrl — one distinct code per syntactically reachable rejection (AC-2, AC-4, AC-5)', () => {
  it('admits a plain https base URL', () => {
    expect(admitBaseUrl('https://gitlab.example.com/')).toBeNull();
  });

  it('not_https — a non-TLS scheme (AC-2)', () => {
    expect(admitBaseUrl('http://x/')).toBe('not_https');
  });

  it('credentials_in_url — userinfo in the base URL (AC-5)', () => {
    expect(admitBaseUrl('https://u:p@x/')).toBe('credentials_in_url');
    expect(admitBaseUrl('https://u@x/')).toBe('credentials_in_url');
  });

  it('private_address — an IP literal in a reserved range (AC-4, syntactic half)', () => {
    expect(admitBaseUrl('https://127.0.0.1/')).toBe('private_address');
    expect(admitBaseUrl('https://10.1.2.3/')).toBe('private_address');
    expect(admitBaseUrl('https://[::1]/')).toBe('private_address');
  });

  it('scheme is judged before userinfo, so the codes never blur into each other', () => {
    // Both faults present: the caller must still be able to branch on one code.
    expect(admitBaseUrl('http://u:p@10.0.0.1/')).toBe('not_https');
  });

  it('the four adapter-decided codes are never invented by the pure pass', () => {
    // tls_untrusted / cross_origin_redirect / credential_rejected /
    // capability_missing are decided by an answered request, so nothing here may
    // produce them — a consumer branching on them would be branching on a guess.
    const corpus = [
      'https://gitlab.example.com/',
      'http://x/',
      'https://u:p@x/',
      'https://127.0.0.1/',
      'https://[fe80::1]/',
      'not a url',
      '',
      'https://x/a%2Fb',
      'https://x/%zz',
      'ftp://x/',
    ];
    const seen = new Set(corpus.map((u) => admitBaseUrl(u)));
    expect([...seen].sort()).toEqual(
      ['credentials_in_url', 'not_https', 'private_address', 'unreachable', null].sort(),
    );
  });
});

describe('isPrivateAddress — every range the classifier claims (AC-4)', () => {
  /**
   * A gap in any row here is a live SSRF hole, not a cosmetic miss: each of
   * these reaches something on the local network or the host itself rather than
   * a forge.
   */
  const privateIpv4: [string, string][] = [
    ['10.1.2.3', 'RFC 1918 10/8'],
    ['172.20.0.5', 'RFC 1918 172.16/12'],
    ['192.168.1.1', 'RFC 1918 192.168/16'],
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', '"this network" 0/8'],
    ['169.254.169.254', 'link-local — the cloud metadata service'],
    ['100.100.0.1', 'RFC 6598 carrier-grade NAT'],
    ['192.0.0.8', 'RFC 6890 IETF protocol assignments'],
    ['198.18.0.1', 'RFC 2544 benchmarking, low end'],
    ['198.19.255.255', 'RFC 2544 benchmarking, high end'],
    ['224.0.0.1', 'multicast, low end'],
    ['239.255.255.250', 'multicast — SSDP'],
    ['240.0.0.1', 'reserved 240/4'],
    ['255.255.255.255', 'broadcast'],
  ];
  for (const [address, why] of privateIpv4) {
    it(`${address} — ${why}`, () => {
      expect(isPrivateAddress(address)).toBe(true);
      // …and the same address reached through the URL form the operator types.
      expect(admitBaseUrl(`https://${address}/`)).toBe('private_address');
    });
  }

  const privateIpv6: [string, string][] = [
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fd00::1', 'fc00::/7 unique-local'],
    ['fe80::1', 'fe80::/10 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::127.0.0.1', 'IPv4-compatible loopback'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 well-known prefix carrying 169.254.169.254'],
  ];
  for (const [address, why] of privateIpv6) {
    it(`${address} — ${why}`, () => {
      // Bare, as `dns.lookup` returns it…
      expect(isPrivateAddress(address)).toBe(true);
      // …and bracketed, as `url.hostname` returns it. One input cannot detect
      // the bracket bug; both can (`server/INSIGHTS.md` 2026-08-28).
      expect(isPrivateAddress(`[${address}]`)).toBe(true);
      expect(admitBaseUrl(`https://[${address}]/`)).toBe('private_address');
    });
  }

  it('a routable address is not classified as private', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '198.20.0.1', '223.255.255.255']) {
      expect(isPrivateAddress(address)).toBe(false);
    }
    expect(admitBaseUrl('https://8.8.8.8/')).toBeNull();
  });

  it('a hostname is not classifiable here — that is why the adapter re-resolves', () => {
    // FALSE, not "safe": the runtime half of AC-4 lives in
    // `adapters/gitlab/http.ts#assertHostIsPublic`, which calls this predicate
    // again on each resolved answer.
    expect(isPrivateAddress('gitlab.example.com')).toBe(false);
    expect(isPrivateAddress('metadata.google.internal')).toBe(false);
  });
});

describe('isPrivateAddress — obfuscated IPv4 literals, via `new URL()` canonicalisation', () => {
  /**
   * These are not parsed by `forge-url.ts` at all: the WHATWG parser rewrites
   * them to dotted-quad before the predicate sees them. The test guards the
   * DEPENDENCY — a future refactor that classifies `raw` instead of
   * `u.hostname` re-opens the whole evasion set (root `INSIGHTS.md` 2026-08-28).
   */
  const obfuscated = ['0177.0.0.1', '2130706433', '0x7f.1', '127.1', '127.0.0.1.'];
  for (const host of obfuscated) {
    it(`https://${host}/ is 127.0.0.1 and is refused`, () => {
      expect(new URL(`https://${host}/`).hostname).toBe('127.0.0.1');
      expect(admitBaseUrl(`https://${host}/`)).toBe('private_address');
    });
  }
});

describe('isPrivateAddress — the RESOLVER spelling (AC-4, runtime half)', () => {
  /**
   * `dns.lookup` is the only producer of these strings; `new URL()` never emits
   * an IPv4-mapped address in dotted form, it rewrites it to hex. So a
   * hex-only parser passes every admission case above and still answers `false`
   * here — which is the bug this block exists to keep dead.
   */
  const resolverPrivate = [
    '::ffff:192.0.0.170',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::169.254.169.254',
  ];
  for (const address of resolverPrivate) {
    it(`${address} → true`, () => expect(isPrivateAddress(address)).toBe(true));
  }

  const resolverPublic = ['::ffff:8.8.8.8', '64:ff9b::8.8.8.8', '8.8.8.8', '2606:4700::6810:85e5'];
  for (const address of resolverPublic) {
    it(`${address} → false`, () => expect(isPrivateAddress(address)).toBe(false));
  }
});

describe('isLoopbackName — RFC 6761 names, rejected without waiting for DNS', () => {
  for (const name of ['localhost', 'LOCALHOST', 'foo.localhost', 'localhost.', 'foo.localhost.']) {
    it(`${name} → true`, () => expect(isLoopbackName(name)).toBe(true));
  }
  for (const name of ['localhost.example.com', 'notlocalhost', 'gitlab.example.com']) {
    it(`${name} → false`, () => expect(isLoopbackName(name)).toBe(false));
  }
  it('a loopback name is refused as private_address at admission', () => {
    expect(admitBaseUrl('https://localhost/')).toBe('private_address');
    expect(admitBaseUrl('https://gitlab.localhost/')).toBe('private_address');
    expect(admitBaseUrl('https://localhost./')).toBe('private_address');
  });
});

describe('normalizeBaseUrl — what a caller persists (AC-6)', () => {
  it('splits origin and path prefix, and drops the trailing slash', () => {
    const result = normalizeBaseUrl('https://git.acme.io:8443/gitlab/');
    expect(result).toEqual({
      ok: true,
      value: {
        origin: 'https://git.acme.io:8443',
        pathPrefix: '/gitlab',
        baseUrl: 'https://git.acme.io:8443/gitlab',
        instanceKey: 'git.acme.io_8443_gitlab',
      },
    });
  });

  it('the default https port is not part of the origin or the key', () => {
    const result = normalizeBaseUrl('https://gitlab.example.com:443/');
    expect(result.ok && result.value.baseUrl).toBe('https://gitlab.example.com');
    expect(result.ok && result.value.instanceKey).toBe('gitlab.example.com');
  });
});

describe('path segments — a segment that could become a traversal is refused', () => {
  /**
   * `segmentsOf` is private, so its contract is asserted where it is observable:
   * a refused segment refuses the whole base URL, and a repository URL carrying
   * one produces no namespace path. The value ends up in a filesystem path
   * (`security` §Framework Security Quirks), so "refused" is the only safe answer.
   */
  it('a percent-encoded separator is refused rather than decoded into the path', () => {
    // `new URL()` keeps `%2F` in the pathname — it is NOT normalised away, so
    // this is the one evasion the parser leaves for us to catch.
    expect(new URL('https://x/a%2Fb').pathname).toBe('/a%2Fb');
    expect(admitBaseUrl('https://gitlab.example.com/a%2Fb')).toBe('unreachable');
    expect(instanceKeyFor('https://gitlab.example.com/a%2Fb')).toBeNull();
    expect(namespacePathFrom('https://gitlab.example.com/g%2Fp/proj', INSTANCE)).toBeNull();
  });

  it('a backslash or a NUL inside a segment is refused', () => {
    expect(admitBaseUrl('https://gitlab.example.com/a%5Cb')).toBe('unreachable');
    expect(admitBaseUrl('https://gitlab.example.com/a%00b')).toBe('unreachable');
  });

  it('a malformed escape is refused, not guessed at', () => {
    expect(admitBaseUrl('https://gitlab.example.com/%zz')).toBe('unreachable');
  });

  it('`.` and `..` never survive into a namespace path', () => {
    const hostile = [
      'https://gitlab.example.com/group/../../../etc/passwd',
      'https://gitlab.example.com/g/%2e%2e/%2e%2e/etc/passwd',
      'https://gitlab.example.com/g/./p',
      'https://gitlab.example.com/g/%2e/p',
    ];
    for (const url of hostile) {
      const path = namespacePathFrom(url, INSTANCE);
      if (path === null) continue;
      expect(path.split('/')).not.toContain('.');
      expect(path.split('/')).not.toContain('..');
      expect(path.startsWith('/')).toBe(false);
    }
  });

  it('a malformed base URL is refused rather than admitted', () => {
    for (const raw of ['', 'not a url', 'ftp://x/', '//gitlab.example.com/']) {
      expect(admitBaseUrl(raw)).not.toBeNull();
    }
  });
});

describe('instanceKeyFor — a filesystem-safe slug (AC-17 depends on it)', () => {
  const cases: [string, string][] = [
    ['https://gitlab.example.com', 'gitlab.example.com'],
    ['https://gitlab.example.com/', 'gitlab.example.com'],
    ['https://git.acme.io:8443/gitlab', 'git.acme.io_8443_gitlab'],
    ['https://git.acme.io/team/gitlab', 'git.acme.io_team_gitlab'],
  ];
  for (const [baseUrl, key] of cases) {
    it(`${baseUrl} → ${key}`, () => expect(instanceKeyFor(baseUrl)).toBe(key));
  }

  it('the key is a single path segment — never a separator, a dot-segment or an IPv6 bracket', () => {
    for (const [baseUrl] of cases) {
      const key = instanceKeyFor(baseUrl);
      expect(key).not.toBeNull();
      expect(key!).not.toMatch(/[/\\[\]\0]/);
      expect(key!.split('_')).not.toContain('..');
      expect(key!.split('_')).not.toContain('.');
    }
  });

  it('two instances that differ only by port or prefix get different keys', () => {
    expect(instanceKeyFor('https://git.acme.io/gitlab')).not.toBe(
      instanceKeyFor('https://git.acme.io:8443/gitlab'),
    );
    expect(instanceKeyFor('https://git.acme.io/a')).not.toBe(instanceKeyFor('https://git.acme.io/b'));
  });

  it('an inadmissible base URL has no key', () => {
    expect(instanceKeyFor('http://x/')).toBeNull();
    expect(instanceKeyFor('https://127.0.0.1/')).toBeNull();
  });
});

describe('matchOrigin — a repository URL SELECTS a registered instance, never introduces one (AC-13, AC-14)', () => {
  const plain = { baseUrl: 'https://gitlab.example.com' };
  const prefixed = { baseUrl: 'https://git.acme.io:8443/gitlab' };
  const registered = [plain, prefixed];

  it('matches on origin', () => {
    expect(matchOrigin('https://gitlab.example.com/group/project', registered)).toBe(plain);
  });

  it('matches on origin AND path prefix', () => {
    expect(matchOrigin('https://git.acme.io:8443/gitlab/group/project', registered)).toBe(prefixed);
  });

  it('null for an origin nobody registered', () => {
    expect(matchOrigin('https://attacker.test/group/project', registered)).toBeNull();
    // Lookalike host, and the userinfo trap: the host is `attacker.test`.
    expect(matchOrigin('https://gitlab.example.com.attacker.test/g/p', registered)).toBeNull();
    expect(matchOrigin('https://gitlab.example.com@attacker.test/g/p', registered)).toBeNull();
  });

  it('null when the origin matches but the path prefix does not', () => {
    expect(matchOrigin('https://git.acme.io:8443/other/group/project', registered)).toBeNull();
    // The prefix must be a whole segment — `/gitlabX` is not inside `/gitlab`.
    expect(matchOrigin('https://git.acme.io:8443/gitlabX/group/project', registered)).toBeNull();
  });

  it('null on a port or scheme mismatch — an origin is host+port+scheme', () => {
    expect(matchOrigin('https://git.acme.io/gitlab/group/project', registered)).toBeNull();
    expect(matchOrigin('http://gitlab.example.com/group/project', registered)).toBeNull();
  });

  it('null against an empty registry, so a workspace with no instances imports nothing', () => {
    expect(matchOrigin('https://gitlab.example.com/g/p', [])).toBeNull();
  });

  it('the longest matching prefix wins when two instances share an origin', () => {
    const root = { baseUrl: 'https://x.example.com' };
    const nested = { baseUrl: 'https://x.example.com/gitlab' };
    expect(matchOrigin('https://x.example.com/gitlab/g/p', [root, nested])).toBe(nested);
    expect(matchOrigin('https://x.example.com/g/p', [root, nested])).toBe(root);
  });
});

describe('namespacePathFrom — any depth, `.git` stripped (AC-13, NFR-4)', () => {
  it('accepts a four-segment path', () => {
    expect(namespacePathFrom('https://gitlab.example.com/group/subgroup/team/project', INSTANCE)).toBe(
      'group/subgroup/team/project',
    );
  });

  it('strips a trailing `.git` from the project segment only', () => {
    expect(
      namespacePathFrom('https://gitlab.example.com/group/subgroup/team/project.git', INSTANCE),
    ).toBe('group/subgroup/team/project');
    // A dot inside the name is legitimate and must survive.
    expect(namespacePathFrom('https://gitlab.example.com/group/widgets.js', INSTANCE)).toBe(
      'group/widgets.js',
    );
  });

  it('imposes no depth limit of its own (NFR-4)', () => {
    const deep = Array.from({ length: 12 }, (_, i) => `s${i}`).join('/');
    expect(namespacePathFrom(`https://gitlab.example.com/${deep}`, INSTANCE)).toBe(deep);
  });

  it('resolves the path relative to the instance prefix, which is not part of the namespace', () => {
    const prefixed = { baseUrl: 'https://git.acme.io:8443/gitlab' };
    expect(namespacePathFrom('https://git.acme.io:8443/gitlab/group/project', prefixed)).toBe(
      'group/project',
    );
  });

  it('null when the project sits in no namespace, or the URL belongs elsewhere', () => {
    expect(namespacePathFrom('https://gitlab.example.com/project', INSTANCE)).toBeNull();
    expect(namespacePathFrom('https://gitlab.example.com/', INSTANCE)).toBeNull();
    expect(namespacePathFrom('https://attacker.test/group/project', INSTANCE)).toBeNull();
    expect(namespacePathFrom('https://gitlab.example.com/group/.git', INSTANCE)).toBeNull();
  });
});
