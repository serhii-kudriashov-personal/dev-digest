import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  MAX_RATE_GATE_DEFER_MS,
  parseRateLimitReset,
  RateGate,
  type RateLimitHeaders,
} from '../src/platform/resilience.js';

/**
 * `RateGate` — SPEC-06 NFR-10 / NFR-11, and Step A4's `Done when`
 * ("a unit test shows key A paused past its reset while key B proceeds
 * immediately"), which `plan-verifier` found uncovered.
 *
 * Ring 3 platform machinery, tested hermetically: `now` and `sleep` are
 * injectable, so no test here spends wall-clock time.
 *
 * The reset comes from the instance, which means it is THIRD-PARTY INPUT. A
 * hostile or mis-clocked header would otherwise park a request until the
 * process dies, so "clamped, never trusted" is the property, not "usually
 * sensible".
 */

/** Just enough of `Headers` for the gate, so a fixture is a plain object. */
function headers(values: Record<string, string>): RateLimitHeaders {
  const lower = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

/** A gate on a controllable clock whose sleeps are recorded, not slept. */
function fakeClockGate(startMs = 1_700_000_000_000) {
  let clock = startMs;
  const slept: number[] = [];
  const gate = new RateGate({
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
  });
  return { gate, slept, now: () => clock, start: startMs };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the pause is per key — there is no global lock (NFR-10, NFR-11)', () => {
  it('key A defers for its reported reset while key B proceeds immediately', async () => {
    const { gate, slept, now, start } = fakeClockGate();

    gate.noteResponse('A', headers({ 'retry-after': '30' }));

    // B was never rate-limited, so it must not pay for A's pause at all.
    await gate.wait('B');
    expect(slept).toEqual([]);
    expect(now()).toBe(start);
    expect(gate.deferredUntil('B')).toBeNull();

    await gate.wait('A');
    expect(slept).toEqual([30_000]);
    expect(now()).toBe(start + 30_000);
    // The defer was SERVED, so the reset is spent and the next call is free.
    expect(gate.deferredUntil('A')).toBeNull();
    await gate.wait('A');
    expect(slept).toEqual([30_000]);
  });

  it('B resolves before A even while A is still parked — proved on the real timer path', async () => {
    vi.useFakeTimers();
    const gate = new RateGate();
    gate.pauseUntil('A', Date.now() + 30_000);

    const order: string[] = [];
    const a = gate.wait('A').then(() => order.push('A'));
    const b = gate.wait('B').then(() => order.push('B'));

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['B']);

    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all([a, b]);
    expect(order).toEqual(['B', 'A']);
  });

  it('a key with no recorded reset never waits, which is the common path', async () => {
    const { gate, slept } = fakeClockGate();
    for (const key of ['a', 'b', 'c']) await gate.wait(key);
    expect(slept).toEqual([]);
  });

  it('a deleted instance forgets its pause without touching any other key', async () => {
    const { gate, slept } = fakeClockGate();
    gate.noteResponse('A', headers({ 'retry-after': '30' }));
    gate.noteResponse('B', headers({ 'retry-after': '10' }));

    gate.forget('A');
    expect(gate.deferredUntil('A')).toBeNull();
    await gate.wait('A');
    expect(slept).toEqual([]);

    await gate.wait('B');
    expect(slept).toEqual([10_000]);
  });

  it('a longer reset raises the pause; a shorter one does not lower it', () => {
    const { gate, start } = fakeClockGate();
    gate.pauseUntil('A', start + 20_000);
    gate.pauseUntil('A', start + 5_000);
    expect(gate.deferredUntil('A')).toBe(start + 20_000);
    gate.pauseUntil('A', start + 40_000);
    expect(gate.deferredUntil('A')).toBe(start + 40_000);
  });
});

describe('a hostile reset header is clamped, never trusted', () => {
  /**
   * The invariant: whatever the instance sends, the recorded resume time is
   * never further out than `MAX_RATE_GATE_DEFER_MS`, and the resulting sleep is
   * never longer than that either.
   */
  const hostile: [string, Record<string, string>][] = [
    ['Retry-After: an epoch far in the future', { 'retry-after': '99999999' }],
    ['Retry-After: negative', { 'retry-after': '-5' }],
    ['Retry-After: non-numeric', { 'retry-after': 'whenever' }],
    ['Retry-After: Infinity', { 'retry-after': 'Infinity' }],
    ['Retry-After: NaN', { 'retry-after': 'NaN' }],
    ['RateLimit-Reset: an epoch in the year 5138', { 'ratelimit-reset': '99999999999' }],
    ['RateLimit-Reset: negative', { 'ratelimit-reset': '-5' }],
    ['RateLimit-Reset: non-numeric', { 'ratelimit-reset': 'later' }],
    ['RateLimit-Reset: Infinity', { 'ratelimit-reset': 'Infinity' }],
    ['both, both hostile', { 'retry-after': 'Infinity', 'ratelimit-reset': '99999999999' }],
  ];

  for (const [name, values] of hostile) {
    it(`${name} → never defers past MAX_RATE_GATE_DEFER_MS`, async () => {
      const { gate, slept, now, start } = fakeClockGate();
      gate.noteResponse('A', headers(values));

      const until = gate.deferredUntil('A');
      if (until !== null) expect(until).toBeLessThanOrEqual(start + MAX_RATE_GATE_DEFER_MS);

      await gate.wait('A');
      for (const ms of slept) expect(ms).toBeLessThanOrEqual(MAX_RATE_GATE_DEFER_MS);
      expect(now() - start).toBeLessThanOrEqual(MAX_RATE_GATE_DEFER_MS);
    });
  }

  it('an epoch-seconds RateLimit-Reset is absolute; a small value is a delta', () => {
    const start = 1_700_000_000_000;
    // GitLab sends a Unix epoch; the IETF draft sends delta-seconds. The value
    // is disambiguated by magnitude, so both must land in the right place.
    expect(parseRateLimitReset(headers({ 'ratelimit-reset': '1700000030' }), start)).toBe(
      1_700_000_030_000,
    );
    expect(parseRateLimitReset(headers({ 'ratelimit-reset': '30' }), start)).toBe(start + 30_000);
  });

  it('a response with no hint at all records nothing', () => {
    expect(parseRateLimitReset(headers({}), 1_000)).toBeNull();
    expect(parseRateLimitReset(headers({ 'retry-after': '' }), 1_000)).toBeNull();
    const { gate } = fakeClockGate();
    gate.noteResponse('A', headers({ 'x-request-id': 'abc' }));
    expect(gate.deferredUntil('A')).toBeNull();
  });

  it('a reset way past the cap still parks for the cap, not for a second', async () => {
    const { gate, slept } = fakeClockGate();
    gate.noteResponse('A', headers({ 'ratelimit-reset': '99999999999' }));
    await gate.wait('A');
    expect(slept).toEqual([MAX_RATE_GATE_DEFER_MS]);
  });
});

describe('an aborted wait, as built', () => {
  it('returns rather than throwing, keeps the reset, and clears its timer', async () => {
    vi.useFakeTimers();
    const gate = new RateGate();
    const until = Date.now() + 30_000;
    gate.pauseUntil('A', until);

    const controller = new AbortController();
    const pending = gate.wait('A', controller.signal);
    // The defer is real: one timer is holding the event loop open.
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();

    // 1. It RETURNS. The caller's own request then fails on the same
    //    already-aborted signal, which is the outcome it asked for — the gate
    //    does not raise a second, competing error.
    await expect(pending).resolves.toBeUndefined();

    // 2. The recorded reset STAYS. The defer was abandoned, not served, so the
    //    next request for this key must still honour it — dropping it here
    //    would let an aborted request launder away the instance's rate limit.
    expect(gate.deferredUntil('A')).toBe(until);

    // 3. The timer is CLEARED. An abandoned `setTimeout` keeps the event loop
    //    alive for its full duration, which is the whole problem an abortable
    //    defer exists to solve.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a wait on an already-aborted signal never starts a timer at all', async () => {
    vi.useFakeTimers();
    const gate = new RateGate();
    gate.pauseUntil('A', Date.now() + 30_000);

    const controller = new AbortController();
    controller.abort();

    await expect(gate.wait('A', controller.signal)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(gate.deferredUntil('A')).not.toBeNull();
  });

  it('a wait that runs to completion clears both the timer and the reset', async () => {
    vi.useFakeTimers();
    const gate = new RateGate();
    gate.pauseUntil('A', Date.now() + 30_000);

    const controller = new AbortController();
    const pending = gate.wait('A', controller.signal);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await pending;

    expect(vi.getTimerCount()).toBe(0);
    expect(gate.deferredUntil('A')).toBeNull();
  });

  it('an abort on one key leaves another key’s wait running', async () => {
    vi.useFakeTimers();
    const gate = new RateGate();
    gate.pauseUntil('A', Date.now() + 30_000);
    gate.pauseUntil('B', Date.now() + 5_000);

    const controller = new AbortController();
    const a = gate.wait('A', controller.signal);
    const done: string[] = [];
    const b = gate.wait('B').then(() => done.push('B'));

    controller.abort();
    await a;
    expect(done).toEqual([]);

    await vi.advanceTimersByTimeAsync(5_000);
    await b;
    expect(done).toEqual(['B']);
    expect(gate.deferredUntil('B')).toBeNull();
    // A's reset survived its abandoned defer.
    expect(gate.deferredUntil('A')).not.toBeNull();
  });
});
