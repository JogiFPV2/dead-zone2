import { describe, expect, it } from 'vitest';
import { scanBuilding } from './building-plan.js';
import { writeEntities } from '../sim/snapshot.js';
import { DemoFloorIntel, SimFloorIntel } from './floor-intel.js';
import { agoText, floorStats, planScale, zombiesOnFloor } from './floor-stats.js';
import { testBuildingSource } from './test-building.js';

const plan = scanBuilding(testBuildingSource(), 7, 30, 4, 0)!;
const f0 = plan.floors.get(0)!;
const hall = f0.rooms.find((r) => r.type === 'base:room-hall')!;
const kitchen = f0.rooms.find((r) => r.type === 'base:room-kitchen')!;

describe('SimFloorIntel (protocol 22)', () => {
  const kPart = kitchen.parts[0]!;
  const hallParts = hall.parts;

  it('rooms: full list replaces, roomsAdd adds and upgrades; a room is known under any chunk piece', () => {
    const intel = new SimFloorIntel();
    expect(intel.room(hall, 0)).toBe('unknown');
    const p0 = hallParts[0]!;
    intel.applyView({ worldMap: { rooms: [{ ...p0, z: 0, state: 'seen' }] } });
    expect(intel.room(hall, 0)).toBe('seen');
    expect(intel.room(hall, 1)).toBe('unknown'); // other level, same chunk ids
    intel.applyView({ worldMap: { roomsAdd: [{ ...kPart, z: 0, state: 'searched' }] } });
    expect(intel.room(kitchen, 0)).toBe('searched');
    expect(floorStats(f0, intel)).toMatchObject({
      searched: 1,
      seen: 1,
      unknown: 1,
      visited: true,
    });
    // Full list after a load: only what it says.
    intel.applyView({ worldMap: { rooms: [] } });
    expect(intel.room(kitchen, 0)).toBe('unknown');
    expect(intel.room(hall, 0)).toBe('unknown');
  });

  it('a room over two chunks is searched only when no piece is merely seen', () => {
    expect(hallParts.length).toBeGreaterThan(1); // the fixture hall crosses x = 32
    const intel = new SimFloorIntel();
    const [a, b] = hallParts as [(typeof hallParts)[0], (typeof hallParts)[0]];
    intel.applyView({
      worldMap: {
        rooms: [
          { ...a, z: 0, state: 'searched' },
          { ...b, z: 0, state: 'seen' },
        ],
      },
    });
    expect(intel.room(hall, 0)).toBe('seen');
    intel.applyView({ worldMap: { roomsAdd: [{ ...b, z: 0, state: 'searched' }] } });
    expect(intel.room(hall, 0)).toBe('searched');
  });

  it('sensed zombies: stableIds from the view, positions and level from the snapshot', () => {
    const intel = new SimFloorIntel();
    const buf = writeEntities([
      { id: 0, x: 1, y: 1, z: 0, facing: 0 }, // player
      { id: 41, x: 10, y: 4, z: 1, facing: 0 },
      { id: 42, x: 12, y: 5, z: -0.0001, facing: 0 },
      { id: 43, x: 50, y: 50, z: 0, facing: 0 }, // not sensed
    ]);
    intel.applySnapshot(buf, 5);
    expect(intel.sensedZombies()).toEqual([]);
    intel.applyView({ sensedZombies: [41, 42] });
    intel.applySnapshot(buf, 6);
    expect(intel.sensedZombies()).toEqual([
      { x: 10, y: 4, z: 1, tick: 6 },
      { x: 12, y: 5, z: 0, tick: 6 },
    ]);
    const v = intel.version;
    intel.applyView({ sensedZombies: [] });
    expect(intel.sensedZombies()).toEqual([]);
    expect(intel.version).toBeGreaterThan(v);
  });

  it('last sightings from worldMap.zombieSightings, marker floors from the markers', () => {
    const intel = new SimFloorIntel((id) => (id === 3 ? 2 : undefined));
    intel.applyView({ worldMap: { zombieSightings: [{ x: 33, y: 4, z: 1, tick: 90 }] } });
    expect(intel.lastSeenZombies()).toEqual([{ x: 33, y: 4, z: 1, tick: 90 }]);
    expect(zombiesOnFloor(plan, 1, intel.lastSeenZombies())).toHaveLength(1);
    expect(intel.markerZ(3)).toBe(2);
    expect(intel.markerZ(4)).toBeUndefined();
  });
});

describe('DemoFloorIntel (?floorsDemo=1)', () => {
  it('rooms near the player searched, zombies on the floor and ±1', () => {
    const demo = new DemoFloorIntel();
    demo.setup(plan, { x: 30, y: 4, z: 0 }, 100_000);
    expect(demo.room(kitchen)).toBe('searched');
    const zs = demo.sensedZombies();
    expect(zs.some((z) => z.z === 0)).toBe(true);
    expect(zs.some((z) => z.z === 1)).toBe(true);
    expect(zombiesOnFloor(plan, 0, zs).length).toBeGreaterThan(0);
  });
});

describe('floor stats helpers', () => {
  it('ago text', () => {
    expect(agoText(1000, 1000)).toBe('widziane teraz');
    expect(agoText(20 * 60 * 5, 0)).toBe('widziane 5 min temu');
    expect(agoText(20 * 3600 * 3, 0)).toBe('widziane 3 h temu');
  });
  it('plan scale fits the column, 2..14 px/m', () => {
    expect(planScale(12, 44, 232, 430)).toBeCloseTo(430 / 44);
    expect(planScale(6, 6, 232, 430)).toBe(14);
    expect(planScale(400, 10, 232, 430)).toBe(2);
  });
});
