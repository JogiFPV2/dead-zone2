import { describe, expect, it, vi } from 'vitest';
import { MapRevealer, revealFlag } from './reveal-flag.js';

describe('revealFlag', () => {
  it('accepts 1 and all only', () => {
    expect(revealFlag('?reveal=1')).toBe(true);
    expect(revealFlag('?a=b&reveal=all')).toBe(true);
    expect(revealFlag('?reveal=0')).toBe(false);
    expect(revealFlag('')).toBe(false);
  });
});

describe('MapRevealer', () => {
  it('waits for the world and sends once', () => {
    const send = vi.fn();
    const r = new MapRevealer(send, true);
    expect(send).not.toHaveBeenCalled();
    r.worldReady();
    r.worldReady();
    r.setWanted(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('sends when the setting turns on later; never when off', () => {
    const send = vi.fn();
    const r = new MapRevealer(send, false);
    r.worldReady();
    expect(send).not.toHaveBeenCalled();
    r.setWanted(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.done).toBe(true);
  });
});
