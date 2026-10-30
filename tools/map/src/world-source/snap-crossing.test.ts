import { expect, it } from 'vitest';
import { crossingShear, crossingSides, snapToRoad } from './rail-crossing.js';
import type { PlanIndex } from './plan-index.js';

const road = {
  kind: 'secondary',
  r: 4,
  rs: 0,
  bridge: false,
  pts: Float64Array.from([0, 0, 40, 0]),
};
const idx = {
  roads: { query: () => [0], items: [road] },
} as unknown as PlanIndex;

it('płyty sąsiednich torów na jednej drodze leżą w jednym pasie (Designer 27.10)', () => {
  const d = { x: 0, y: 1 };
  // Two parallel tracks, OSM nodes 1.5 m and −2 m off the road axis: both snap onto it.
  expect(snapToRoad(idx, { x: 10, y: 1.5 }, d)).toEqual({ x: 10, y: 0 });
  expect(snapToRoad(idx, { x: 14.5, y: -2 }, d)).toEqual({ x: 14.5, y: 0 });
  // Far from the axis: kept.
  expect(snapToRoad(idx, { x: 10, y: 9 }, d)).toEqual({ x: 10, y: 9 });
});

it('płyty na skośnej drodze ścięte wzdłuż drogi', () => {
  // Track along +y (rot 0: model z = world y, x = world x), road along x: right angle, no shear.
  expect(crossingShear(idx, { x: 10, y: 0 }, 0)).toBe(0);
  const diag = {
    roads: {
      query: () => [0],
      items: [{ ...road, pts: Float64Array.from([0, 0, 40, 40]) }],
    },
  } as unknown as PlanIndex;
  // Road at 45°: z grows 1 m per metre of x.
  expect(crossingShear(diag, { x: 10, y: 10 }, 0)).toBe(1);
});

it('jeden zestaw znaków na stronę drogi także na skośnym przejeździe', () => {
  // Track along +y, model +x = world +x; neighbour track 4.5 m to +x, 4.5 m further along the
  // track: on the band of a road with shear 1, so this crossing keeps only its −x furniture.
  const d = { x: 0, y: 1 };
  const side = { x: 1, y: 0 };
  expect(crossingSides({ x: 0, y: 0 }, d, side, [{ x: 4.5, y: 4.5 }], 1, 1)).toBe(1);
  // Without the shear the neighbour still counts (u = 4.5 < 6), as before.
  expect(crossingSides({ x: 0, y: 0 }, d, side, [{ x: 4.5, y: 4.5 }], 1)).toBe(1);
  // Same neighbour, but a road at right angles far off the band: kept both sides.
  expect(crossingSides({ x: 0, y: 0 }, d, side, [{ x: 4.5, y: 9 }], 1, -1)).toBe(3);
});

it('dwie drogi na jednym torze, płyty na siebie zachodzą: jeden przejazd, bez znaków w środku', () => {
  const d = { x: 0, y: 1 };
  const side = { x: 1, y: 0 };
  // Neighbour 9.6 m ahead on the same track (plates 2 × 8.8 m): the −x set (at +z) goes.
  expect(crossingSides({ x: 0, y: 0 }, d, side, [{ x: 0, y: 9.6 }], 1.47)).toBe(2);
  expect(crossingSides({ x: 0, y: 9.6 }, d, side, [{ x: 0, y: 0 }], 1.47)).toBe(1);
  // Far along the track: two crossings, both sets.
  expect(crossingSides({ x: 0, y: 0 }, d, side, [{ x: 0, y: 30 }], 1.47)).toBe(3);
});
