import { describe, expect, it } from 'vitest';
import { footprintForId, occupiedTiles, onSurfaceForId } from '../footprint/index.js';
import { CHUNK_SIZE } from '../schemas/map/constants.js';
import { BASE_PACK_DIR, buildContentBundleFromDirs, validatePackDirs } from '../node/index.js';

/**
 * Furniture on the base maps never overlaps (#249, Silnik 2): every `occupiedTiles` tile of a
 * piece of furniture (content footprint, rotation, NW anchor, across chunk borders) belongs to
 * one piece only. "Furniture" as in the sim (`world/furniture.ts`): container types, and
 * placeables with a storage, a sleep surface, a station or an explicit footprint. Objects with
 * `placeable.onSurface` (TV, VCR, radio, desk lamp) stand on other furniture and are skipped;
 * other small placeables (light switch, ceiling lamp) do not block either.
 */
describe('meble na mapach paczki bazowej się nie nakładają', () => {
  it('każdy kafel footprintu należy do jednego mebla (wszystkie mapy, piętra, obroty)', async () => {
    const [r, b] = await Promise.all([
      validatePackDirs([BASE_PACK_DIR]),
      buildContentBundleFromDirs([BASE_PACK_DIR]),
    ]);
    const isFurniture = (id: string): boolean => {
      if (onSurfaceForId(b, id)) return false;
      if (b.containers[id]) return true;
      const it = b.items[id];
      if (it?.kind !== 'placeable') return false;
      const p = it.placeable;
      return !!(p.containerType || p.sleepSurface || p.station || p.footprint);
    };
    expect(r.maps.length).toBeGreaterThan(3);
    const problems: string[] = [];
    let pieces = 0;
    for (const map of r.maps) {
      const owner = new Map<string, string>();
      for (const c of map.chunks) {
        const { cx, cy, z } = c.address;
        for (const o of c.objects) {
          if (!isFurniture(o.contentId)) continue;
          pieces++;
          const tx = cx * CHUNK_SIZE + o.x;
          const ty = cy * CHUNK_SIZE + o.y;
          const me = `${o.contentId}@${tx},${ty} rot ${o.rot}`;
          for (const t of occupiedTiles(tx, ty, o.rot, footprintForId(b, o.contentId))) {
            const key = `${t.x},${t.y},${z}`;
            const other = owner.get(key);
            if (other) problems.push(`${map.id} (${key}): ${other} × ${me}`);
            else owner.set(key, me);
          }
        }
      }
    }
    expect(pieces).toBeGreaterThan(100);
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('onSurface: tylko małe placeable bez footprintu, schowka, łóżka i stacji', async () => {
    const b = await buildContentBundleFromDirs([BASE_PACK_DIR]);
    const on = Object.values(b.items).filter((i) => onSurfaceForId(b, i.id));
    expect(on.map((i) => i.id).sort()).toEqual([
      'base:desk-lamp',
      'base:radio-set',
      'base:tv',
      'base:vcr',
    ]);
    for (const i of on) {
      if (i.kind !== 'placeable') throw new Error(i.id);
      const p = i.placeable;
      expect(!!(p.containerType || p.sleepSurface || p.station || p.footprint), i.id).toBe(false);
    }
  });
});
