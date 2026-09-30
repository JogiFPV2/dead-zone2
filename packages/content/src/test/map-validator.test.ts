import { describe, expect, it } from 'vitest';
import { validatePacks } from '../validate/validate-packs.js';
import { chunk, manifest, mapPack } from './map-fixtures.js';

const errs = (r: ReturnType<typeof validatePacks>) => r.errors.map((e) => [e.code, e.file, e.path]);
const C0 = 'maps/house/chunks/0_0_0.json';
const M = 'maps/house/manifest.json';

describe('walidator: mapy w paczce', () => {
  it('poprawna mapa przechodzi i trafia do wyniku z id namespace:folder', () => {
    const r = validatePacks([mapPack()]);
    expect(errs(r)).toEqual([]);
    expect(r.maps.map((m) => [m.id, m.chunks.length, m.chunkFiles])).toEqual([
      ['base:house', 1, [C0]],
    ]);
    expect(r.maps[0]?.chunks[0]?.layers.floor).toBeInstanceOf(Uint16Array);
  });

  it('manifest musi wymieniać dokładnie obecne pliki chunków', () => {
    const r = validatePacks([
      mapPack({
        [M]: manifest([
          { cx: 0, cy: 0, z: 0 },
          { cx: 1, cy: 0, z: 0 },
        ]),
        'maps/house/chunks/0_1_0.json': chunk({ cx: 0, cy: 1, z: 0 }),
      }),
    ]);
    expect(errs(r)).toEqual([
      ['map', M, '$.chunks[1]'],
      ['map', 'maps/house/chunks/0_1_0.json', '$'],
    ]);
  });

  it('adres chunka musi zgadzać się z nazwą pliku; brak manifestu to błąd', () => {
    const r = validatePacks([mapPack({ [C0]: chunk({ cx: 5, cy: 0, z: 0 }) })]);
    expect(errs(r)).toEqual([['map', C0, '$.address']]);
    const noManifest = validatePacks([mapPack({ [M]: undefined })]);
    expect(errs(noManifest)).toEqual([['map', M, '$']]);
    expect(noManifest.maps).toEqual([]);
  });

  it('pliki poza maps/<mapId>/{manifest.json,chunks/*.json} są odrzucane', () => {
    const r = validatePacks([
      mapPack({ 'maps/house/notes.json': {}, 'maps/House/manifest.json': manifest() }),
    ]);
    expect(errs(r)).toEqual([
      ['unknown_folder', 'maps/House/manifest.json', '$'],
      ['unknown_folder', 'maps/house/notes.json', '$'],
    ]);
  });

  it('błąd schematu chunka ma ścieżkę JSON w pliku', () => {
    const r = validatePacks([
      mapPack({ [C0]: chunk(undefined, { layers: { floor: { rle: [[1, 3]] } } }) }),
    ]);
    expect(errs(r)).toEqual([['schema', C0, '$.layers.floor']]);
  });

  it('paleta, krawędzie i obiekty muszą wskazywać istniejący content właściwego rodzaju', () => {
    const r = validatePacks([
      mapPack({
        [C0]: chunk(undefined, {
          palette: ['base:roof', 'base:grass', 'base:nope'],
          edges: [
            { x: 0, y: 0, side: 'n', type: 'door', contentId: 'base:wall' },
            { x: 1, y: 0, side: 'n', type: 'wall', contentId: 'base:ghost' },
          ],
          objects: [
            { contentId: 'base:knife', x: 1, y: 1 },
            { contentId: 'base:sofa', x: 2, y: 1 },
          ],
        }),
      }),
    ]);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual([
      ['wrong_kind', '$.palette[0]'],
      ['wrong_kind', '$.palette[1]'],
      ['missing_ref', '$.palette[2]'],
      ['wrong_kind', '$.edges[0].contentId'],
      ['missing_ref', '$.edges[1].contentId'],
      ['wrong_kind', '$.objects[0].contentId'],
      ['missing_ref', '$.objects[1].contentId'],
    ]);
  });

  it('roomType musi mieć loot table; ten sam roomId w chunkach ma ten sam typ i budynek', () => {
    const other = { rooms: { '1': { roomType: 'base:room-garage', buildingId: 2 } } };
    const r = validatePacks([
      mapPack({
        [M]: manifest([
          { cx: 0, cy: 0, z: 0 },
          { cx: 0, cy: 0, z: 1 },
        ]),
        'maps/house/chunks/0_0_1.json': chunk({ cx: 0, cy: 0, z: 1 }, other),
      }),
    ]);
    expect(errs(r)).toEqual([
      ['map', 'maps/house/chunks/0_0_1.json', '$.rooms["1"]'],
      ['missing_ref', 'maps/house/chunks/0_0_1.json', '$.rooms["1"].roomType'],
    ]);
  });
});
