import { describe, expect, it } from 'vitest';
import {
  FURNITURE_ACTIONS_PL,
  FURNITURE_REASON_DETAILS_PL,
  FURNITURE_REASONS_PL,
  furnitureActionPl,
  furnitureReasonPl,
  furnitureTypePl,
} from './furniture-labels.js';

describe('furniture menu labels (pl)', () => {
  it('reason texts (sim checks the full protocol list against this map)', () => {
    expect(Object.keys(FURNITURE_REASONS_PL)).toContain('threat');
    expect(furnitureReasonPl('no-water')).toBe('Brak wody w sieci');
  });

  it('prefixed ids take the prefix label; unknown ids fall back', () => {
    expect(furnitureActionPl('lockpick:42')).toBe('Użyj wytrycha');
    expect(furnitureActionPl('open')).toBe('Otwórz');
    expect(furnitureActionPl('mystery')).toBe('mystery');
    expect(furnitureTypePl('door')).toBe('Drzwi');
  });

  it('sen, odpoczynek, kaseta VHS; łóżko i kanapa (też łóżko podwójne: typeId bed)', () => {
    expect(furnitureActionPl('insert-tape:7')).toBe('Włóż kasetę');
    expect(furnitureActionPl('sleep')).toBe('Śpij');
    expect(furnitureActionPl('sleep-until:morning')).toBe('Śpij do rana');
    expect(furnitureActionPl('sleep-until:4')).toBe('Śpij 4 godz.');
    expect(furnitureActionPl('rest')).toBe('Odpocznij');
    expect(furnitureTypePl('bed')).toBe('Łóżko');
    expect(furnitureTypePl('sofa')).toBe('Kanapa');
    expect(furnitureTypePl('seat')).toBe('Siedzisko');
    expect(furnitureReasonPl('missing-item')).toBe('Brak w ekwipunku');
    expect(furnitureReasonPl('not-tired')).toBe('Nie jesteś zmęczony');
  });

  it('every menu action id of protocol 26–28 has a Polish label', () => {
    // Ids from `FurnitureActionView.id` (protocol views.ts) and the sleep / rest menu (#220).
    const ids = [
      'open',
      'close',
      'lock',
      'unlock',
      'unlock-key',
      'lock-key',
      'lockpick',
      'force-pry',
      'force-kick',
      'knock',
      'barricade',
      'unbarricade',
      'smash',
      'clear-glass',
      'climb-through',
      'open-storage',
      'watch',
      'insert-tape',
      'sleep',
      'sleep-until:morning',
      'rest',
    ];
    for (const id of ids) expect(FURNITURE_ACTIONS_PL, id).toHaveProperty(id);
  });

  it('window detail texts for a greyed „Wejdź przez okno” (#226)', () => {
    expect(FURNITURE_REASON_DETAILS_PL['window-closed']).toBe('Okno zamknięte');
    expect(FURNITURE_REASON_DETAILS_PL['window-boarded']).toBe('Okno zabite deskami');
  });
});
