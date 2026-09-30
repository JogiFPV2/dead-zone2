import { describe, expect, it } from 'vitest';
import { daysWord, deathTimeLabel, updateRecord, RECORD_KEY } from './death-model.js';

describe('death model', () => {
  it('formats time and days', () => {
    expect(deathTimeLabel(12, 21 * 60 + 47.6)).toBe('Dzień 12, 21:47');
    expect(daysWord(1)).toBe('dzień');
    expect(daysWord(5)).toBe('dni');
  });
  it('keeps the best record', () => {
    const m = new Map<string, string>();
    const store = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    expect(updateRecord(store, 3)).toBeUndefined();
    expect(updateRecord(store, 2)).toBe(3);
    expect(m.get(RECORD_KEY)).toBe('3');
    expect(updateRecord(store, 7)).toBe(3);
    expect(m.get(RECORD_KEY)).toBe('7');
  });
});
