/**
 * Map `town-catalog`: all 12 building types of the catalogue (`deadzone-buildings-spec.md` §1)
 * along two streets, some rotated. Regenerate `blueprints/town-catalog.json` and the map with
 *   pnpm --filter @deadzone/map exec tsx src/town-catalog-map.ts  (then prettier --write the json)
 *   pnpm --filter @deadzone/map map build blueprints/town-catalog.json
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATALOG, placeCatalog } from './catalog.js';
import type { BlueprintInput } from './blueprint.js';

/** [type, x, y, clockwise turns] (NW corner of the rotated footprint). */
const place: [string, number, number, number][] = [
  // North of street 1 (road y 0..5): public buildings, fronts facing south (the street).
  ['hospital', -60, -16, 0],
  ['school', -38, -13, 0],
  ['gym', -14, -12, 0],
  ['police', -2, -13, 0],
  ['grocery', 12, -15, 1],
  ['gas-station', 28, -14, 0],
  // Between the streets (y 8..21): houses, front doors to street 1 (rotated 180°).
  ['pharmacy', -58, 9, 2],
  ['house', -46, 9, 2],
  ['kostka', -33, 9, 2],
  ['house-garage', -21, 9, 2],
  ['shack', -5, 10, 1],
  ['ruin', 4, 9, 0],
  ['kostka', 16, 9, 1],
  ['house', 29, 9, 3],
];

export function townCatalogBlueprint(): BlueprintInput {
  let bid = 1;
  let rid = 1;
  const buildings: NonNullable<BlueprintInput['buildings']> = [];
  const stairs: NonNullable<BlueprintInput['stairs']> = [];
  for (const [type, x, y, rot] of place) {
    const t = CATALOG[type];
    if (!t) throw new Error(`no catalogue type ${type}`);
    const p = placeCatalog(t, [x, y], rot, bid, rid);
    bid = p.nextBuildingId;
    rid = p.nextRoomId;
    buildings.push(...p.buildings);
    stairs.push(...p.stairs);
  }

  const bp: BlueprintInput = {
    id: 'town-catalog',
    floorHeight: 3,
    chunks: { cx0: -2, cy0: -1, cx1: 1, cy1: 0 },
    ground: 'base:grass',
    areas: [
      { x: -64, y: -2, w: 128, h: 10, floor: 'base:sidewalk' },
      { x: -64, y: 0, w: 128, h: 6, floor: 'base:asphalt' },
      { x: -64, y: 22, w: 128, h: 10, floor: 'base:sidewalk' },
      { x: -64, y: 24, w: 128, h: 6, floor: 'base:asphalt' },
      { x: -64, y: -2, w: 2, h: 34, floor: 'base:sidewalk' },
      { x: 26, y: -16, w: 18, h: 14, floor: 'base:parking' },
    ],
    buildings,
    stairs,
    zones: [{ id: 'start', role: 'start', rects: [{ x: -2, y: 2, w: 4, h: 2 }] }],
  };
  return bp;
}

export const TOWN_CATALOG_FILE = new URL('../blueprints/town-catalog.json', import.meta.url);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bp = townCatalogBlueprint();
  writeFileSync(TOWN_CATALOG_FILE, JSON.stringify(bp, null, 2) + '\n');
  console.log(`town-catalog: ${bp.buildings?.length} buildings, ${bp.stairs?.length} flights`);
}
