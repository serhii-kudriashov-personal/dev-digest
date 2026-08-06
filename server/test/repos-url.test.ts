import { describe, it, expect } from 'vitest';
import { parseRepoUrl } from '../src/modules/repos/helpers.js';

/**
 * `parseRepoUrl` is a security boundary, not just a parser: the string it
 * accepts is the string `runCloneJob` hands to `git clone`. These tests exist
 * because the original implementation matched `github.com/owner/repo` as a
 * SUBSTRING, so a URL on any host that merely contained that path was accepted
 * and cloned from the attacker's server.
 */
describe('parseRepoUrl', () => {
  describe('accepts real GitHub URLs', () => {
    const cases: [string, { owner: string; name: string }][] = [
      ['https://github.com/acme/widgets', { owner: 'acme', name: 'widgets' }],
      ['https://github.com/acme/widgets.git', { owner: 'acme', name: 'widgets' }],
      ['https://github.com/acme/widgets/', { owner: 'acme', name: 'widgets' }],
      ['http://github.com/acme/widgets', { owner: 'acme', name: 'widgets' }],
      ['  https://github.com/acme/widgets  ', { owner: 'acme', name: 'widgets' }],
      ['git@github.com:acme/widgets.git', { owner: 'acme', name: 'widgets' }],
      ['git@github.com:acme/widgets', { owner: 'acme', name: 'widgets' }],
      // A dot inside the repo name is legitimate and used to be rejected.
      ['https://github.com/acme/widgets.js', { owner: 'acme', name: 'widgets.js' }],
    ];
    for (const [url, expected] of cases) {
      it(url.trim(), () => expect(parseRepoUrl(url)).toEqual(expected));
    }
  });

  describe('rejects anything not actually hosted on github.com', () => {
    const hostile = [
      // The regression this test was written for: github.com in the PATH.
      'https://attacker.test/github.com/acme/widgets',
      'https://attacker.test/github.com/acme/widgets.git',
      // github.com as the USERINFO, not the host — the classic URL-parsing trap.
      'https://github.com@attacker.test/acme/widgets',
      // Lookalike hosts.
      'https://github.com.attacker.test/acme/widgets',
      'https://notgithub.com/acme/widgets',
      'https://gitlab.com/acme/widgets',
      // scp-like form on a foreign host.
      'git@attacker.test:acme/widgets.git',
    ];
    for (const url of hostile) {
      it(url, () => expect(() => parseRepoUrl(url)).toThrow(/github\.com|parse/i));
    }
  });

  describe('rejects malformed input', () => {
    for (const url of [
      '',
      'not a url',
      'https://github.com',
      'https://github.com/acme',
      'https://github.com/acme/widgets/extra',
    ]) {
      it(JSON.stringify(url), () => expect(() => parseRepoUrl(url)).toThrow());
    }
  });
});
