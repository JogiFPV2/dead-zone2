import { describe, expect, it } from 'vitest';
import { tileIndex } from '../schemas/map/constants.js';
import { paletteId } from '../schemas/map/palette.js';
import { BASE_PACK_DIR, buildContentBundleFromDirs, validatePackDirs } from '../node/index.js';

describe('przykładowa mapa data/base/maps/demo-house', () => {
  it('jeden chunk z domem: kuchnia, ściany, okna, drzwi, lampa', async () => {
    const r = await validatePackDirs([BASE_PACK_DIR]);
    const map = r.maps.find((m) => m.id === 'base:demo-house');
    expect(map?.manifest.chunks).toEqual([{ cx: 0, cy: 0, z: 0 }]);
    const c = map!.chunks[0]!;
    expect(paletteId(c.palette, c.layers.floor[tileIndex(12, 12)]!)).toBe('base:kitchen-tiles');
    expect(paletteId(c.palette, c.layers.floor[tileIndex(0, 0)]!)).toBe('base:grass');
    expect(c.layers.roof?.[tileIndex(0, 0)]).toBe(0);
    expect(c.rooms).toEqual({ '1': { roomType: 'base:room-kitchen', buildingId: 1 } });
    expect(c.layers.room?.[tileIndex(12, 12)]).toBe(1);
    expect(new Set(c.edges.map((e) => e.type))).toEqual(new Set(['wall', 'window', 'door']));

    const bundle = await buildContentBundleFromDirs([BASE_PACK_DIR]);
    const kitchen = Object.values(bundle.lootTables).filter((t) =>
      t.rooms.includes('base:room-kitchen'),
    );
    expect(kitchen.map((t) => t.id)).toEqual(['base:kitchen']);
    const lights = c.objects.filter((o) => {
      const item = bundle.items[o.contentId];
      return item?.kind === 'placeable' && item.placeable.light !== undefined;
    });
    expect(lights.map((o) => o.contentId)).toEqual(['base:ceiling-lamp']);
  });
});
