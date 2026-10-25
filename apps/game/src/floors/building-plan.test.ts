import { describe, expect, it } from 'vitest';
import { buildingKind, roomLabel, scanBuilding, stairTiles } from './building-plan.js';
import { testBuildingSource } from './test-building.js';

describe('scanBuilding', () => {
  const plan = scanBuilding(testBuildingSource(), 7, 30, 4, 0)!;

  it('finds every floor and the footprint across the chunk border', () => {
    expect(plan.zMin).toBe(0);
    expect(plan.zMax).toBe(1);
    expect(plan.box).toEqual({ x0: 28, y0: 2, x1: 36, y1: 8 });
    expect([...plan.floors.keys()].sort()).toEqual([0, 1]);
  });

  it('merges room pieces split by a chunk border (same type, touching)', () => {
    const f0 = plan.floors.get(0)!;
    const hall = f0.rooms.find((r) => r.type === 'base:room-hall')!;
    expect(hall.parts).toHaveLength(2);
    expect(hall.area).toBe(16);
    // Kitchen and living room touch across the border too, but differ in type.
    expect(f0.rooms).toHaveLength(3);
    const bed = plan.floors.get(1)!.rooms;
    expect(bed).toHaveLength(1);
    expect(bed[0]!.area).toBe(48);
  });

  it('reads walls, windows and doors with the outline flag', () => {
    const e = plan.floors.get(0)!.edges;
    expect(e.filter((x) => x.kind === 'window')).toHaveLength(1);
    expect(e.filter((x) => x.kind === 'door')).toHaveLength(1);
    const inner = e.filter((x) => !x.outer);
    expect(inner).toHaveLength(4);
    expect(inner.every((x) => x.x0 === 32 && x.x1 === 32)).toBe(true);
  });

  it('draws the flight on its floor and as arriving on the floor above, lettered', () => {
    expect(plan.stairwells).toBe(1);
    expect(plan.floors.get(0)!.stairs).toEqual([
      { x: 30, y: 5, dir: 'N', len: 3, way: 'up', well: 'A' },
    ]);
    expect(plan.floors.get(1)!.stairs[0]).toMatchObject({ way: 'down', well: 'A' });
    expect(stairTiles(plan.floors.get(0)!.stairs[0]!)).toEqual([
      [30, 5],
      [30, 4],
      [30, 3],
    ]);
  });

  it('is undefined where the building has no tile', () => {
    expect(scanBuilding(testBuildingSource(), 8, 30, 4, 0)).toBeUndefined();
  });
});

describe('buildingKind / roomLabel', () => {
  it('flats: house up to P+1, block from P+2', () => {
    const flats = new Map([
      ['base:room-bedroom', 40],
      ['base:room-kitchen', 10],
    ]);
    expect(buildingKind(flats, 1).tag).toBe('DOM');
    expect(buildingKind(flats, 4)).toEqual({ kind: 'BLOK MIESZKALNY', tag: 'BLOK' });
  });
  it('a bigger non-residential use wins', () => {
    expect(
      buildingKind(
        new Map([
          ['base:room-school', 300],
          ['base:room-bathroom', 20],
        ]),
        2,
      ).kind,
    ).toBe('SZKOŁA');
  });
  it('short Polish labels', () => {
    expect(roomLabel('base:room-bathroom')).toBe('łaz.');
    expect(roomLabel('mod:unknown')).toBe('');
  });
});
