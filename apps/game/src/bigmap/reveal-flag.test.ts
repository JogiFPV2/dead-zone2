import { describe, expect, it, vi } from 'vitest';
import { MapRevealer, bigMapOverview, revealFlag } from './reveal-flag.js';

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

describe('bigMapOverview', () => {
  it('is on with ?bigmap16=1, the reveal flag or the reveal setting', () => {
    expect(bigMapOverview(undefined, '', false)).toBe(false);
    expect(bigMapOverview(true, '', false)).toBe(true);
    expect(bigMapOverview(undefined, '?reveal=all', false)).toBe(true);
    expect(bigMapOverview(undefined, '?reveal=1', false)).toBe(true);
    expect(bigMapOverview(undefined, '?reveal=0', false)).toBe(false);
    expect(bigMapOverview(undefined, '', true)).toBe(true);
  });
});
