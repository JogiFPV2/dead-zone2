import { MapChunkSchema } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import { parseBlueprint, type BlueprintInput } from './blueprint.js';
import { ROOM_Z_STRIDE, buildMap } from './build.js';

const house: BlueprintInput['buildings'] = [
  {
    id: 3,
    origin: [4, 4],
    plan: ['AAAA', 'AAAA', 'AAAA', 'AAAA'],
    rooms: { A: { id: 5, type: 'base:room-living-room', floor: 'base:concrete' } },
    wall: 'base:brick-wall',
    roof: 'base:roof-shingles',
    door: 'base:wooden-door',
    window: 'base:wooden-window',
    openings: [{ at: [1, 3], side: 's', type: 'door' }],
    floors: [{ z: 1, openings: [{ at: [1, 0], side: 'n', type: 'window' }] }],
  },
];
const bp = (over: Partial<BlueprintInput> = {}) =>
  parseBlueprint({
    id: 'unit',
    chunks: { cx0: 0, cy0: 0, cx1: 1, cy1: 0 },
    ground: 'base:grass',
    buildings: house,
    stairs: [{ at: [6, 7], dir: 'N', len: 3 }],
    ...over,
  });
const at = (m: ReturnType<typeof buildMap>, cx: number, z: number) => {
  const c = m.chunks.find((k) => k.json.address.cx === cx && k.json.address.z === z);
  return c ? MapChunkSchema.parse(c.json) : undefined;
};

describe('piętra budynków (building.floors[])', () => {
  it('emits used upper chunks only, with shifted room ids of the same building', () => {
    const m = buildMap(bp());
    expect(m.manifest.chunks).toEqual([
      { cx: 0, cy: 0, z: 0 },
      { cx: 1, cy: 0, z: 0 },
      { cx: 0, cy: 0, z: 1 },
    ]);
    const up = at(m, 0, 1)!;
    expect(up.rooms).toEqual({
      [String(5 + ROOM_Z_STRIDE)]: { roomType: 'base:room-living-room', buildingId: 3 },
    });
    expect(up.edges.some((e) => e.type === 'window' && e.side === 'n')).toBe(true);
    expect(up.edges.some((e) => e.type === 'door')).toBe(false);
  });

  it('roof only on the top floor; stair tiles have no floor on zFrom + 1', () => {
    const m = buildMap(bp());
    const g = at(m, 0, 0)!;
    const up = at(m, 0, 1)!;
    expect(g.layers.roof).toBeUndefined();
    expect(up.layers.roof).toBeDefined();
    const floor = up.layers.floor;
    const tile = (x: number, y: number) => floor[y * 32 + x];
    expect([tile(6, 7), tile(6, 6), tile(6, 5)]).toEqual([0, 0, 0]);
    expect(tile(6, 4)).not.toBe(0);
    expect(g.stairs).toEqual([{ tx: 6, ty: 7, dir: 'N', len: 3 }]);
    expect(up.stairs).toBeUndefined();
  });

  it('stairs from an upper floor go into that level; a missing level is an error', () => {
    const two = house.map((b) => ({ ...b, floors: [...(b.floors ?? []), { z: 2 }] }));
    const m = buildMap(
      bp({
        buildings: two,
        stairs: [
          { at: [6, 7], dir: 'N', len: 3 },
          { at: [5, 7], dir: 'N', len: 3, zFrom: 1 },
        ],
      }),
    );
    expect(at(m, 0, 1)!.stairs).toEqual([{ tx: 5, ty: 7, dir: 'N', len: 3 }]);
    expect(at(m, 0, 2)).toBeDefined();
    expect(() => buildMap(bp({ stairs: [{ at: [6, 7], dir: 'N', len: 3, zFrom: 3 }] }))).toThrow(
      /brak piętra/,
    );
  });
});
