import { describe, expect, it } from 'vitest';
import { CHUNK_TILES, tileIndex } from '../schemas/map/constants.js';
import { encodeLayer } from '../schemas/map/layer.js';
import { validatePacks } from '../validate/validate-packs.js';
import { OUTDOOR_OK_TAG } from '../validate/maps/check-map-indoor.js';
import { chunk, mapPack } from './map-fixtures.js';

const errs = (r: ReturnType<typeof validatePacks>) => r.errors.map((e) => [e.code, e.file, e.path]);
const C0 = 'maps/house/chunks/0_0_0.json';

describe('walidator: meble w mapie', () => {
  it('meble tylko w środku: bez tagu outdoor-ok nie stoją poza pokojem ani na podłodze zewnętrznej', () => {
    const room = new Uint16Array(CHUNK_TILES).fill(1);
    room[tileIndex(5, 5)] = 0;
    const r = validatePacks([
      mapPack({
        'tiles/t.json': [
          {
            id: 'base:grass',
            name: 'tile.base.grass.name',
            category: 'floor',
            tags: ['base:outdoor'],
          },
          { id: 'base:planks', name: 'tile.base.planks.name', category: 'floor' },
          { id: 'base:roof', name: 'tile.base.roof.name', category: 'roof' },
          { id: 'base:wall', name: 'tile.base.wall.name', category: 'wall' },
        ],
        'containers/bin.json': {
          id: 'base:bin',
          name: 'container.base.bin.name',
          category: 'other',
          tags: [OUTDOOR_OK_TAG],
          capacityKg: 10,
        },
        [C0]: chunk(undefined, {
          palette: ['base:grass', 'base:roof', 'base:planks'],
          // Wiersz 0 to trawa, reszta deski; pokój wszędzie poza (5, 5).
          layers: {
            floor: {
              rle: [
                [1, 32],
                [3, CHUNK_TILES - 32],
              ],
            },
            room: encodeLayer(room, 'rle'),
          },
          objects: [
            { contentId: 'base:cabinet', x: 3, y: 3 },
            { contentId: 'base:cabinet', x: 5, y: 5 },
            { contentId: 'base:cabinet', x: 2, y: 0 },
            { contentId: 'base:bin', x: 3, y: 0 },
            { contentId: 'base:bin', x: 5, y: 5 },
          ],
        }),
      }),
    ]);
    expect(errs(r)).toEqual([
      ['map', C0, '$.objects[1]'],
      ['map', C0, '$.objects[2]'],
    ]);
    expect(r.errors[0]?.message).toContain('poza pomieszczeniem');
    expect(r.errors[1]?.message).toContain('na podłodze zewnętrznej „base:grass”');
  });
});
