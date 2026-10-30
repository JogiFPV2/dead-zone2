import { expect, it } from 'vitest';
import { crossingBands, joinAlong } from './crossing-band.js';

// Road along world x; three tracks along world y (rot 0: model +x = world +x), 4.5 m and 12 m
// apart, plus one crossing of another road nearby.
const road = { i: 0, d: { x: 1, y: 0 } };
const items = [
  { n: { x: 0, y: 0 }, rot: 0, len: 1, road },
  { n: { x: 4.5, y: 0 }, rot: 0, len: 1.47, road },
  { n: { x: 16.5, y: 0 }, rot: 0, len: 1, road },
  { n: { x: 8, y: 30 }, rot: 0, len: 1, road: { i: 1, d: { x: 1, y: 0 } } },
];

it('przejazd przez kilka torów: jeden ciągły pas płyt (Designer 27.10)', () => {
  const { plates, fills } = crossingBands(items, () => 1.5);
  // One set of signs and barriers per road side; the band shares length and the road's shear.
  expect(plates.slice(0, 3).map((p) => p.furn)).toEqual([1, 0, 2]);
  expect(plates.slice(0, 3).every((p) => p.len === 1.47 && p.shear === 0)).toBe(true);
  // 4.5 m apart: the plates (±3.6 m) overlap; 12 m apart: a 4.8 m gap filled with overlap.
  expect(fills).toEqual([{ x: 10.5, y: 0, rot: 0, len: 1.47, shear: 0, wide: 5 }]);
  // Another road: a crossing of its own, untouched.
  expect(plates[3]).toEqual({ len: 1, shear: 1.5, furn: 3 });
});

it('dwa przejazdy na jednym torze 13 m od siebie: płyty dociągnięte do siebie', () => {
  const its = [
    { n: { x: 0, y: 0 }, rot: 0, len: 1.47 },
    { n: { x: 0, y: 13.3 }, rot: 0, len: 1.47 },
    { n: { x: 0, y: 40 }, rot: 0, len: 1 },
  ];
  const plates = its.map((i) => ({ len: i.len, shear: 0, furn: 3 as const }));
  joinAlong(its, plates);
  // 13.3 / 7.2 + 0.03 → plates meet in the middle; the far one untouched.
  expect(plates.map((p) => p.len)).toEqual([1.88, 1.88, 1]);
});
