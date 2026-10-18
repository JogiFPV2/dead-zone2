import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, type SimChunk } from '@deadzone/protocol';
import { buildMap } from '../test/fixtures.js';
import {
  createOpeningsWorld,
  DEFAULT_OPENINGS_CONFIG,
  lockedAtStart,
  openingKey,
  type OpeningsConfig,
} from './state.js';

/**
 * Shop (building 7: shop + flat upstairs-like living room) with a door at (2, 5), house
 * (building 8: kitchen) with a door at (20, 5), a gate in a fence at (40, 5), a lone room with
 * no building id (pharmacy) with a door at (50, 5). Rows of extra house doors at y = 40.. for
 * the determinism check (building 8).
 */
const spec = {
  width: CHUNK_SIZE * 2,
  height: CHUNK_SIZE * 2,
  room: (x: number, y: number) =>
    x >= 2 && x < 6 && y >= 2 && y < 10
      ? 1
      : x >= 6 && x < 10 && y >= 2 && y < 10
        ? 3
        : x >= 20 && x < 28 && y >= 2 && y < 10
          ? 2
          : x >= 50 && x < 56 && y >= 2 && y < 10
            ? 4
            : x >= 20 && x < 28 && y >= 40 && y < 60
              ? 2
              : 0,
  rooms: {
    '1': 'base:room-shop',
    '2': 'base:room-kitchen',
    '3': 'base:room-living-room',
    '4': 'base:room-pharmacy',
  },
  roomBuildings: { '1': 7, '2': 8, '3': 7 },
  wallW: (x: number, y: number) =>
    ((x === 2 || x === 20 || x === 50) && y >= 2 && y < 10) ||
    (x === 40 && y < 20) ||
    (x === 20 && y >= 40 && y < 60),
  edgeId: (x: number, y: number) =>
    x === 40 ? (y === 5 ? 4 : 3) : y === 5 || (x === 20 && y >= 40) ? 2 : 1,
  edgeKinds: [null, 'wall', 'door', 'fence', 'gate'] as const,
};

const SHOP = openingKey(1, 2, 5, 0);
const HOUSE = openingKey(1, 20, 5, 0);
const GATE = openingKey(1, 40, 5, 0);
const LONE = openingKey(1, 50, 5, 0);

function world(
  locks: Partial<NonNullable<OpeningsConfig['locks']>>,
  seed = 1,
  map = buildMap(spec),
) {
  const cfg: OpeningsConfig = {
    ...DEFAULT_OPENINGS_CONFIG,
    locks: { ...DEFAULT_OPENINGS_CONFIG.locks, ...locks },
  };
  return createOpeningsWorld(map, cfg, seed);
}

describe('locks at start by building kind (exteriorLockedChanceFor)', () => {
  it('shop / house / gate / room without a building: chance by kind', () => {
    const o = world({
      exteriorLockedChance: 0,
      exteriorLockedChanceByBuilding: { shop: 1, house: 0, gate: 1, pharmacy: 1 },
    });
    expect(lockedAtStart(o, SHOP)).toBe(true);
    expect(lockedAtStart(o, HOUSE)).toBe(false);
    expect(lockedAtStart(o, GATE)).toBe(true);
    expect(lockedAtStart(o, LONE)).toBe(true);
    // Walls and fences never lock.
    expect(lockedAtStart(o, openingKey(1, 40, 6, 0))).toBe(false);
    expect(o.buildingRooms?.get(7)).toEqual(new Set(['base:room-shop', 'base:room-living-room']));
  });

  it('the shop room decides even from the living-room side (building, not room)', () => {
    const o = world({
      exteriorLockedChance: 0,
      exteriorLockedChanceByBuilding: { shop: 1, house: 0 },
    });
    // Door into the living room of building 7: an exterior door on the north wall, (7, 2).
    const map = buildMap({
      ...spec,
      wallN: (x: number, y: number) => y === 2 && x === 7,
      edgeId: (x: number, y: number) => (y === 2 && x === 7 ? 2 : spec.edgeId(x, y)),
    });
    const p = world(
      { exteriorLockedChance: 0, exteriorLockedChanceByBuilding: { shop: 1, house: 0 } },
      1,
      map,
    );
    expect(lockedAtStart(p, openingKey(0, 7, 2, 0))).toBe(true);
    expect(lockedAtStart(o, HOUSE)).toBe(false);
  });

  it('kinds outside the map and the gate fall back to exteriorLockedChance', () => {
    const o = world({ exteriorLockedChance: 1, exteriorLockedChanceByBuilding: { shop: 0 } });
    expect(lockedAtStart(o, SHOP)).toBe(false);
    expect(lockedAtStart(o, HOUSE)).toBe(true);
    expect(lockedAtStart(o, GATE)).toBe(true);
  });

  it('SimChunk.lockedDoors wins over the roll', () => {
    const map = buildMap(spec);
    (map.getChunk(0, 0, 0) as unknown as { lockedDoors?: number[] }).lockedDoors = [];
    const o = world(
      { exteriorLockedChance: 1, exteriorLockedChanceByBuilding: { shop: 1 } },
      1,
      map,
    );
    expect(lockedAtStart(o, SHOP)).toBe(false);
    expect(lockedAtStart(o, HOUSE)).toBe(false);
    const c = map.getChunk(1, 0, 0) as SimChunk;
    expect(c.lockedDoors).toBeUndefined();
    expect(lockedAtStart(o, LONE)).toBe(true);
  });

  it('deterministic: the same seed gives the same locks, another seed differs', () => {
    const doors = Array.from({ length: 20 }, (_, i) => openingKey(1, 20, 40 + i, 0));
    const roll = (seed: number) => {
      const o = world(
        { exteriorLockedChance: 0, exteriorLockedChanceByBuilding: { house: 0.5 } },
        seed,
      );
      return doors.map((k) => lockedAtStart(o, k));
    };
    const a = roll(42);
    expect(roll(42)).toEqual(a);
    expect(a.some(Boolean)).toBe(true);
    expect(a.every(Boolean)).toBe(false);
    expect(roll(43)).not.toEqual(a);
  });
});
