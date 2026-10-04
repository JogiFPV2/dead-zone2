import { describe, expect, it } from 'vitest';
import type { CloudCharacter } from '../account/account-api.js';
import { demoCharacters } from '../account/mock-api.js';
import {
  cloudCardView,
  initials,
  mbLabel,
  newCharacterState,
  placesLabel,
  sortCloud,
  usageColor,
  usageLabel,
} from './cloud-characters-model.js';

const MiB = 1024 * 1024;
const now = new Date(2026, 9, 4, 20, 0).getTime();

describe('online Postacie texts', () => {
  it('MB: one decimal below 10 MB, whole numbers above; `12 / 50 MB`', () => {
    expect(mbLabel(1.8 * MiB)).toBe('1,8 MB');
    expect(mbLabel(0.2 * MiB)).toBe('0,2 MB');
    expect(mbLabel(12.4 * MiB)).toBe('12 MB');
    expect(usageLabel({ usedBytes: 12 * MiB, limitBytes: 50 * MiB })).toBe('12 / 50 MB');
  });

  it('bar colour from 80 % and 95 %', () => {
    expect(usageColor(0.5)).toBe('#E0A23A');
    expect(usageColor(0.8)).toBe('#E8CD7A');
    expect(usageColor(0.96)).toBe('#E8766C');
  });

  it('cards: location or „—”, NOWA on day 0, tombstone rows, sync badge', () => {
    const [marta, jan, ola, piotr] = demoCharacters(now) as [
      CloudCharacter,
      CloudCharacter,
      CloudCharacter,
      CloudCharacter,
    ];
    const m = cloudCardView(marta, now, false);
    expect(m).toMatchObject({
      sub: 'ŻYWA',
      daysLabel: 'PRZEŻYŁA',
      days: '12 DNI',
      location: 'Wolnogród · dzień 12',
      played: 'dzisiaj, 19:52',
      save: '1,8 MB',
      badge: 'cloud',
    });
    expect(cloudCardView(jan, now, true)).toMatchObject({ sub: 'ŻYWY', badge: 'sync', busy: true });
    expect(cloudCardView(ola, now, false)).toMatchObject({
      sub: 'ŻYWA · NOWA',
      location: undefined,
    });
    // Serwer #157 sends `place: null` for now: position in km and the day.
    const noPlace = { ...ola, lastLocation: { place: null, x: 4210, y: 6630, z: 1, day: 3 } };
    expect(cloudCardView(noPlace, now, false).location).toBe('4,2 · 6,6 km · dzień 3');
    expect(cloudCardView(piotr, now, false)).toMatchObject({
      sub: 'MARTWY · NAGROBEK',
      died: '2 paź 2026',
      save: 'usunięty',
      badge: undefined,
      actions: ['delete'],
    });
  });

  it('sorts living by last played, then tombstones by death', () => {
    const names = sortCloud(demoCharacters(now)).map((c) => c.name);
    expect(names).toEqual(['Marta Nowak', 'Ola Zielińska', 'Jan Kowalski', 'Piotr Wrona']);
  });

  it('Nowa postać: places left, alive limit, full storage', () => {
    const u = { usedBytes: 12 * MiB, limitBytes: 50 * MiB, alive: 3, aliveLimit: 20 };
    expect(newCharacterState(u)).toEqual({ disabled: false, note: '· zostało 17 miejsc' });
    expect(newCharacterState({ ...u, alive: 17 }).note).toBe('· zostały 3 miejsca');
    expect(newCharacterState({ ...u, alive: 19 }).note).toBe('· zostało 1 miejsce');
    expect(newCharacterState({ ...u, alive: 20 })).toEqual({
      disabled: true,
      note: '· limit 20 żywych postaci',
    });
    expect(newCharacterState({ ...u, usedBytes: 50 * MiB })).toEqual({
      disabled: true,
      note: '· brak miejsca na koncie',
    });
    expect(placesLabel(12)).toBe('12 miejsc');
    expect(placesLabel(22)).toBe('22 miejsca');
  });

  it('avatar initials from the e-mail', () => {
    expect(initials('pawel.rosol@gmail.com')).toBe('PR');
    expect(initials('jan@x.pl')).toBe('JA');
  });
});
