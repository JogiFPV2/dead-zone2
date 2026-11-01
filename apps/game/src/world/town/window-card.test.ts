import { describe, expect, it } from 'vitest';
import { CARD_GRID, cardCategory, cardCell, cardSeed } from './window-card.js';

describe('window interior card', () => {
  it('maps room types to the spec categories', () => {
    expect(cardCategory('base:room-kitchen')).toBe('kuchnia');
    expect(cardCategory('base:room-living-room')).toBe('salon');
    expect(cardCategory('base:room-bathroom')).toBe('lazienka');
    expect(cardCategory('base:room-shop')).toBe('sklep');
    expect(cardCategory('base:room-warehouse')).toBe('magazyn');
    expect(cardCategory('base:room-hall')).toBe('klatka');
    expect(cardCategory(undefined)).toBe('pusty');
    expect(cardCategory('base:room-unknown')).toBe('pusty');
  });

  it('picks a deterministic atlas cell within the grid', () => {
    const a = cardSeed(12, 100, 200, 'N');
    expect(cardSeed(12, 100, 200, 'N')).toBe(a);
    expect(cardSeed(12, 100, 200, 'W')).not.toBe(a);
    const cells = new Set<number>();
    for (let tx = 0; tx < 50; tx++) cells.add(cardCell('sypialnia', cardSeed(3, tx, 7, 'N')));
    expect([...cells].sort()).toEqual([4, 5]);
    expect(cardCell('pusty', 1)).toBeLessThan(16);
    expect(cardCell('pusty', 1)).toBeLessThan(CARD_GRID * CARD_GRID);
  });
});
