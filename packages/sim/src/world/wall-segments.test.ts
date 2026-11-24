import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS } from '../core/constants.js';
import { buildMap, type MapSpec } from '../test/fixtures.js';
import { car, seatedSim } from '../test/vehicle-fixtures.js';
import { eventsOf } from '../test/ai-fixtures.js';
import type { SimEvent } from '@deadzone/protocol';
import { circleOverlaps, moveCircle, slideCircle } from './collision.js';
import { TileGrid } from './grid.js';
import { lineOfSight, walkableLine } from './los.js';
import { OS, OpeningKind, openingKey, setOpening } from '../openings/state.js';

const R = PLAYER_RADIUS;
const grid = (spec: MapSpec): TileGrid => new TileGrid(buildMap(spec));

// A slanted wall from (40, 20) to (60, 40), with a 1.2 m door gap in the middle.
const slanted = { x0: 40, y0: 20, x1: 60, y1: 40 };
const withDoor: MapSpec = {
  wallSegments: [
    { x0: 40, y0: 20, x1: 49.576, y1: 29.576 },
    { x0: 50.424, y0: 30.424, x1: 60, y1: 40 },
  ],
};
/** Signed distance of a point from the slanted line x - y = 20 (positive below/left). */
const side = (x: number, y: number): number => (y - x + 20) / Math.SQRT2;

describe('exact walls (SimChunk.wallSegments)', () => {
  it('without segments the grid falls back to tiles (no wall, nothing stops)', () => {
    const g = grid({});
    expect(g.segmentsSeen).toBe(false);
    const p = moveCircle(g, 0, 45, 30, 10, -10, R);
    expect(p.x).toBeCloseTo(55, 5);
    expect(lineOfSight(g, 0, 45, 30, 55, 20)).toBe(true);
  });

  it('moveCircle stops a circle at a slanted wall, on its side and at radius distance', () => {
    const g = grid({ wallSegments: [slanted] });
    // Start below-left of the line, push straight towards it (+x then -y).
    const p = moveCircle(g, 0, 45, 30, 10, 0, R);
    expect(side(p.x, p.y)).toBeGreaterThanOrEqual(R - 1e-3);
    expect(p.x).toBeLessThan(55);
    expect(circleOverlaps(g, 0, p.x, p.y, R)).toBe(false);
    expect(circleOverlaps(g, 0, 50, 30, R)).toBe(true);
  });

  it('slideCircle slides along a slanted wall instead of sticking', () => {
    const g = grid({ wallSegments: [slanted] });
    let x = 45;
    let y = 30;
    for (let i = 0; i < 40; i++) {
      const p = slideCircle(g, 0, x, y, 0.25, 0, R);
      x = p.x;
      y = p.y;
      expect(side(x, y)).toBeGreaterThan(R - 0.02);
    }
    // Reaches the wall after ~4.4 m of the 10 m push; the rest slides along it at 45°
    // (half the leftover goes into y), not stuck in place.
    expect(y).toBeGreaterThan(32.5);
    expect(x).toBeGreaterThan(52);
  });

  it('a door gap lets a circle through and lets sight through; the wall itself blocks', () => {
    const g = grid(withDoor);
    // Through the gap middle (50, 30), perpendicular to the wall.
    let x = 49;
    let y = 31;
    for (let i = 0; i < 20; i++) {
      const p = slideCircle(g, 0, x, y, 0.1, -0.1, R);
      x = p.x;
      y = p.y;
    }
    expect(side(x, y)).toBeLessThan(-R);
    expect(lineOfSight(g, 0, 49, 31, 51, 29)).toBe(true);
    expect(walkableLine(g, 0, 49, 31, 51, 29)).toBe(true);
    // Through the wall away from the gap.
    expect(lineOfSight(g, 0, 44, 26, 46, 24)).toBe(false);
    expect(walkableLine(g, 0, 44, 26, 46, 24)).toBe(false);
    // A grazing touch at the end point counts as blocked; parallel sight beside it does not.
    expect(lineOfSight(g, 0, 39, 21, 41, 19)).toBe(false);
    expect(lineOfSight(g, 0, 41, 19, 61, 39)).toBe(true);
  });

  it('a gate in the gap follows its raster opening (closed door / window stop, open door lets through)', () => {
    // The gap of `withDoor` closed by a gate whose opening is the north edge of tile (60, 10).
    const gate = { side: 'n' as const, tx: 60, ty: 10 };
    const spec = (kind: 2 | 3): MapSpec => ({
      wallSegments: [
        ...withDoor.wallSegments!,
        { x0: 49.576, y0: 29.576, x1: 50.424, y1: 30.424, gate },
      ],
      wallN: (x, y) => x === 60 && y === 10,
      edgeId: () => kind,
      edgeKinds: [null, 'wall', 'door', 'window'],
    });
    const through = (g: TileGrid): number => {
      let x = 49;
      let y = 31;
      for (let i = 0; i < 20; i++) {
        const p = slideCircle(g, 0, x, y, 0.1, -0.1, R);
        x = p.x;
        y = p.y;
      }
      return side(x, y);
    };
    const key = openingKey(0, 60, 10, 0);
    const door = grid(spec(2));
    setOpening(door.openings, key, OpeningKind.door, OS.closed);
    expect(through(door)).toBeGreaterThan(R - 1e-3);
    expect(lineOfSight(door, 0, 49, 31, 51, 29)).toBe(false);
    expect(walkableLine(door, 0, 49, 31, 51, 29)).toBe(false);
    setOpening(door.openings, key, OpeningKind.door, OS.open);
    expect(through(door)).toBeLessThan(-R);
    expect(lineOfSight(door, 0, 49, 31, 51, 29)).toBe(true);
    // A window: no walking through, but it is seen through.
    const win = grid(spec(3));
    setOpening(win.openings, key, OpeningKind.window, OS.closed);
    expect(through(win)).toBeGreaterThan(R - 1e-3);
    expect(walkableLine(win, 0, 49, 31, 51, 29)).toBe(false);
    expect(lineOfSight(win, 0, 49, 31, 51, 29)).toBe(true);
  });

  it('a segment duplicated in two chunks behaves the same as one', () => {
    // Crosses the chunk border at x = 32 (listed in both chunks by the fixture).
    const g = grid({ wallSegments: [{ x0: 30, y0: 10, x1: 34, y1: 14 }] });
    const p = moveCircle(g, 0, 31, 12, 4, 0, R);
    expect(p.x).toBeLessThan(33);
    expect(lineOfSight(g, 0, 31, 13, 33, 11)).toBe(false);
  });

  it('is deterministic: same inputs give bit-identical results', () => {
    const run = (): number[] => {
      const g = grid(withDoor);
      const out: number[] = [];
      let x = 44;
      let y = 27;
      for (let i = 0; i < 200; i++) {
        const p = slideCircle(g, 0, x, y, 0.13 * ((i % 7) - 2), 0.11 * ((i % 5) - 1), R);
        x = p.x;
        y = p.y;
        out.push(x, y);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('vehicles vs exact walls and blockers', () => {
  const drive = (map: MapSpec) => {
    const { sim, ctl } = seatedSim({ map });
    ctl.drive(1);
    const events: SimEvent[] = [];
    for (let i = 0; i < 400 && car(sim).speed < 8; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    ctl.drive(0);
    for (let i = 0; i < 200; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    return { sim, events };
  };

  it('a car stops at a wall segment and reports a wall impact', () => {
    const { sim, events } = drive({ wallSegments: [{ x0: 60, y0: 40, x1: 60, y1: 90 }] });
    expect(car(sim).x + 2.3).toBeLessThanOrEqual(60.01);
    const hits = eventsOf(events, 'vehicleImpact');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.targetKind).toBe('wall');
    expect(hits[0]!.nx).toBeLessThan(-0.9);
  });

  it('a car stops at a pylon foot (SimChunk.blockers)', () => {
    const c0 = seatedSim({}).sim;
    const y = car(c0).y;
    const { sim, events } = drive({
      blockers: [{ x0: 60, y0: Math.floor(y) - 1, x1: 62, y1: Math.floor(y) + 2 }],
    });
    expect(car(sim).x + 2.3).toBeLessThanOrEqual(60.01);
    expect(eventsOf(events, 'vehicleImpact').map((e) => e.targetKind)).toContain('wall');
  });
});
