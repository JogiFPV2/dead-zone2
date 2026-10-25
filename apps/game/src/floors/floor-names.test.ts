import { describe, expect, it } from 'vitest';
import {
  buildingTag,
  floorName,
  floorShort,
  plural,
  stairwellsChip,
  storeysChip,
} from './floor-names.js';

describe('floor names', () => {
  it('spec names', () => {
    expect(floorName(0)).toBe('PARTER');
    expect(floorName(1)).toBe('1 PIĘTRO');
    expect(floorName(4)).toBe('4 PIĘTRO');
    expect(floorName(-1)).toBe('PIWNICA');
    expect(floorName(-1, -2)).toBe('PIWNICA');
    expect(floorName(-2, -2)).toBe('PIWNICA −2');
  });
  it('selector labels', () => {
    expect([4, 1, 0, -1].map(floorShort)).toEqual(['4', '1', 'P', '−1']);
  });
  it('chips with Polish plurals', () => {
    expect(storeysChip(0, 4)).toBe('5 KONDYGNACJI · P + 4 PIĘTRA');
    expect(storeysChip(-1, 4)).toBe('6 KONDYGNACJI · P + 4 PIĘTRA');
    expect(storeysChip(0, 1)).toBe('2 KONDYGNACJE · P + 1 PIĘTRO');
    expect(storeysChip(0, 0)).toBe('1 KONDYGNACJA');
    expect(storeysChip(0, 11)).toBe('12 KONDYGNACJI · P + 11 PIĘTER');
    expect(stairwellsChip(3)).toBe('3 KLATKI');
    expect(stairwellsChip(1)).toBe('1 KLATKA');
    expect(plural(22, 'a', 'b', 'c')).toBe('b');
    expect(plural(12, 'a', 'b', 'c')).toBe('c');
    expect(buildingTag('BLOK', 4)).toBe('BLOK · P+4');
    expect(buildingTag('DOM', 0)).toBe('DOM · P');
  });
});
