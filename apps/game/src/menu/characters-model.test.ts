import { describe, expect, it } from 'vitest';
import type { CharacterRecord } from '../characters/schema.js';
import {
  NEW_FOCUS,
  cardView,
  feminine,
  mapLabel,
  moveFocus,
  playedLabel,
} from './characters-model.js';

const base: CharacterRecord = {
  id: 'a',
  name: 'Marta Nowak',
  appearance: { portrait: { skin: '#1', hair: '#2', shirt: '#3' } },
  worldSeed: 7,
  worldSettings: { map: 'test-town', mode: 'survive' },
  generatorVersion: 1,
  status: 'alive',
  daysSurvived: 12,
  deathCause: null,
  createdAt: 0,
  lastPlayedAt: new Date(2026, 9, 1, 19, 52).getTime(),
  diedAt: null,
};
const now = new Date(2026, 9, 1, 21, 0).getTime();

describe('characters model', () => {
  it('formats last played like the mockup', () => {
    expect(playedLabel(base.lastPlayedAt, now)).toBe('dzisiaj, 19:52');
    expect(playedLabel(new Date(2026, 8, 30, 22, 10).getTime(), now)).toBe('wczoraj, 22:10');
    expect(playedLabel(new Date(2026, 8, 28, 8, 14).getTime(), now)).toBe('28 wrz, 08:14');
  });

  it('uses Polish forms from the first name', () => {
    expect(feminine('Marta Nowak')).toBe(true);
    expect(feminine('Jan Kowalski')).toBe(false);
    expect(feminine('Kuba Wrona')).toBe(false);
    expect(mapLabel('test-town')).toBe('Test Town');
  });

  it('builds alive and dead cards', () => {
    expect(cardView(base, now, true)).toMatchObject({
      sub: 'TEST TOWN · AKTYWNA',
      days: { label: 'PRZEŻYŁA', value: '12 DNI' },
      second: { label: 'OSTATNIO GRANA', value: 'dzisiaj, 19:52' },
      actions: ['play', 'delete'],
    });
    const dead = cardView(
      { ...base, name: 'Piotr Wrona', status: 'dead', daysSurvived: 1, deathCause: 'bleeding' },
      now,
      false,
    );
    expect(dead).toMatchObject({
      dead: true,
      sub: 'TEST TOWN · ZMARŁY',
      days: { label: 'PRZEŻYŁ', value: '1 DZIEŃ' },
      second: { label: 'PRZYCZYNA', value: 'Wykrwawienie', danger: true },
      actions: ['delete'],
    });
  });

  it('marks a character saved on an older map („stara mapa”), not the newest or test map', () => {
    expect(
      cardView({ ...base, worldSettings: { map: 'demo-house', mode: 'survive' } }, now, true).sub,
    ).toBe('DEMO HOUSE · AKTYWNA · STARA MAPA');
    expect(
      cardView({ ...base, worldSettings: { map: 'test', mode: 'survive' } }, now, true).sub,
    ).toBe('MAPA TESTOWA · AKTYWNA');
  });

  it('moves focus between cards, actions and Nowa postać', () => {
    const cards = [{ actions: ['play', 'delete'] as const }, { actions: ['delete'] as const }];
    const f0 = { card: 0, action: 1 };
    expect(moveFocus(f0, 'ArrowRight', cards, true)).toEqual({ card: 1, action: 0 });
    expect(moveFocus({ card: 1, action: 0 }, 'KeyD', cards, true)).toEqual({ card: 0, action: 0 });
    expect(moveFocus({ card: 0, action: 0 }, 'ArrowDown', cards, true)).toEqual(f0);
    expect(moveFocus(f0, 'ArrowDown', cards, true)).toEqual(NEW_FOCUS);
    expect(moveFocus(f0, 'ArrowDown', cards, false)).toEqual(f0);
    expect(moveFocus(NEW_FOCUS, 'ArrowUp', cards, true)).toEqual({ card: 0, action: 0 });
    expect(moveFocus(f0, 'Enter', cards, true)).toBeUndefined();
  });
});
