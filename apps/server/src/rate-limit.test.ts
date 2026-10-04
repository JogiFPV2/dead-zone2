import { describe, expect, it } from 'vitest';
import { MemoryRateLimitStore, RateLimitedError, enforce } from './rate-limit.js';

describe('MemoryRateLimitStore', () => {
  it('counts per key within a fixed window and resets after it', async () => {
    let t = 0;
    const s = new MemoryRateLimitStore(() => t);
    expect(await s.hit('a', 1, 2, 1000)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect((await s.hit('a', 1, 2, 1000)).allowed).toBe(true);
    t = 400;
    expect(await s.hit('a', 1, 2, 1000)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect((await s.hit('b', 1, 2, 1000)).allowed).toBe(true);
    t = 1000;
    expect((await s.hit('a', 1, 2, 1000)).allowed).toBe(true);
  });

  it('supports costs (bytes) and rejected hits consume nothing', async () => {
    const s = new MemoryRateLimitStore(() => 0);
    expect((await s.hit('u', 70, 100, 10_000)).allowed).toBe(true);
    expect(await s.hit('u', 40, 100, 10_000)).toEqual({ allowed: false, retryAfterSeconds: 10 });
    expect((await s.hit('u', 30, 100, 10_000)).allowed).toBe(true);
  });

  it('sweeps expired windows', async () => {
    let t = 0;
    const s = new MemoryRateLimitStore(() => t, 3);
    await s.hit('a', 1, 5, 10);
    await s.hit('b', 1, 5, 10);
    t = 100;
    await s.hit('c', 1, 5, 10);
    expect(s.size).toBe(1);
  });

  it('enforce throws a 429 with Retry-After seconds', async () => {
    const s = new MemoryRateLimitStore(() => 0);
    await enforce(s, 'k', 1, 1, 60_000);
    const err = await enforce(s, 'k', 1, 1, 60_000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err).toMatchObject({ statusCode: 429, code: 'rate_limited', retryAfterSeconds: 60 });
  });
});
