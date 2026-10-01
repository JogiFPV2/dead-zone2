import { CHUNK_TILES, tileIndex } from '../schemas/map/constants.js';
import { encodeLayer } from '../schemas/map/layer.js';
import { miniBase } from './helpers.js';

export const manifest = (chunks = [{ cx: 0, cy: 0, z: 0 }]) => ({
  formatVersion: 1,
  chunkSize: 32,
  floorHeight: 3,
  chunks,
});

/** Chunk: trawa (1) wszędzie, kafel (0,0) w pokoju 1 (kuchnia) z dachem (2). */
export function chunk(address = { cx: 0, cy: 0, z: 0 }, extra: Record<string, unknown> = {}) {
  const roof = new Uint16Array(CHUNK_TILES);
  const room = new Uint16Array(CHUNK_TILES);
  roof[tileIndex(0, 0)] = 2;
  room[tileIndex(0, 0)] = 1;
  return {
    address,
    palette: ['base:grass', 'base:roof'],
    layers: {
      floor: { rle: [[1, CHUNK_TILES]] },
      roof: encodeLayer(roof, 'base64'),
      room: encodeLayer(room, 'rle'),
    },
    edges: [{ x: 0, y: 0, side: 'n', type: 'wall', contentId: 'base:wall' }],
    objects: [{ contentId: 'base:cabinet', x: 0, y: 0, rot: 1 }],
    rooms: { '1': { roomType: 'base:room-kitchen', buildingId: 1 } },
    ...extra,
  };
}

const tile = (id: string, category: string) => ({
  id,
  name: `tile.${id.replace(':', '.')}.name`,
  category,
});

/** Content potrzebny mapie testowej: kafle, schowek, loot table kuchni. */
export const mapContent = {
  'tiles/t.json': [
    tile('base:grass', 'floor'),
    tile('base:roof', 'roof'),
    tile('base:wall', 'wall'),
    tile('base:door', 'door'),
    tile('base:fence', 'fence'),
  ],
  'containers/c.json': {
    id: 'base:cabinet',
    name: 'container.base.cabinet.name',
    category: 'cabinet',
    capacityKg: 10,
  },
  'loot-tables/l.json': {
    id: 'base:kitchen',
    rooms: ['base:room-kitchen'],
    rolls: { min: 1, max: 1 },
    entries: [{ item: 'base:knife', weight: 1 }],
  },
};

/** Paczka bazowa z mapą `base:house`; `files` dopisuje/zastępuje pliki. */
export const mapPack = (files: Record<string, unknown> = {}) =>
  miniBase({
    ...mapContent,
    'maps/house/manifest.json': manifest(),
    'maps/house/chunks/0_0_0.json': chunk(),
    ...files,
  });
