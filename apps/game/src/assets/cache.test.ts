import { describe, expect, it, vi } from 'vitest';
import { RefCache } from './cache.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('RefCache', () => {
  it('shares one load between users and disposes after the last release', async () => {
    const dispose = vi.fn();
    const c = new RefCache<string>(dispose);
    const load = vi.fn(() => Promise.resolve('v'));
    const [a, b] = await Promise.all([c.acquire('u', load), c.acquire('u', load)]);
    expect(a).toBe('v');
    expect(b).toBe('v');
    expect(load).toHaveBeenCalledTimes(1);
    expect(c.refs('u')).toBe(2);
    c.release('u');
    await flush();
    expect(dispose).not.toHaveBeenCalled();
    c.release('u');
    await flush();
    expect(dispose).toHaveBeenCalledWith('v', 'u');
    expect(c.has('u')).toBe(false);
  });

  it('does not cache failures', async () => {
    const c = new RefCache<string>();
    await expect(c.acquire('u', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await flush();
    expect(c.has('u')).toBe(false);
    await expect(c.acquire('u', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('clear disposes everything', async () => {
    const dispose = vi.fn();
    const c = new RefCache<number>(dispose);
    await c.acquire('a', () => Promise.resolve(1));
    await c.acquire('b', () => Promise.resolve(2));
    c.clear();
    await flush();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(c.size).toBe(0);
  });
});
