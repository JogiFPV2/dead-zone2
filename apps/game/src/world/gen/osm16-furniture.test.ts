import { CENTRUM_SPOT } from './osm16-fixtures.js';
// #131 on the whole 16 km osm-stw generator: furniture only in rooms, rooms closed to the outside.
import { BASE_PACK_DIR, buildContentBundleFromDirs } from '@deadzone/content/node';
import { footprintForId, onSurfaceForId, surfaceHeightForId } from '@deadzone/content/footprint';
import {
  OUTDOOR_FLOORS,
  TILE_PALETTE,
  columnFootprintIssues,
  surfaceIssues,
  type GenColumn,
} from '@deadzone/map/world-source';
import { CHUNK_SIZE } from '@deadzone/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadWorld } from './load-plan.js';
import { GENERATED_MAPS } from './maps.js';
import { publicFetch } from './osm16-fixtures.js';
import { levelToSimChunk } from './convert.js';

/** The only objects allowed outside a room (yard props, pumps). */
const OUTDOOR_OBJECTS = new Set([
  'base:trash-bin',
  'base:firewood-pile',
  'base:bench',
  'base:dumpster',
  'base:fuel-pump',
]);
/** Areas of the PR screenshots (centrum, bloki, hala, wieś, start): every chunk ±5 around. */
const AREAS = [
  [Math.floor(CENTRUM_SPOT.x), Math.floor(CENTRUM_SPOT.y)],
  [8640, 11072],
  [8256, 12480],
  [7463, 3919],
  [9419, 10712],
] as const;
/** Plus every STRIDE-th chunk of the square in zones with buildings. */
const STRIDE = 8;
const EMPTY_ZONES = new Set(['las', 'pola', 'woda']);

let g: NonNullable<Awaited<ReturnType<typeof loadWorld>>['tiles']>['generator'];

beforeAll(async () => {
  const w = await loadWorld(GENERATED_MAPS['osm-stw']!, publicFetch([]));
  await w.tiles!.ensureAll();
  g = w.tiles!.generator;
}, 120_000);

function chunks(): [number, number][] {
  const out = new Map<string, [number, number]>();
  for (const [x, y] of AREAS) {
    const cx0 = Math.floor(x / CHUNK_SIZE);
    const cy0 = Math.floor(y / CHUNK_SIZE);
    for (let cy = cy0 - 5; cy <= cy0 + 5; cy++)
      for (let cx = cx0 - 5; cx <= cx0 + 5; cx++) out.set(`${cx},${cy}`, [cx, cy]);
  }
  for (let cy = 0; cy < 704; cy += STRIDE)
    for (let cx = 0; cx < 704; cx += STRIDE)
      if (!EMPTY_ZONES.has(g.chunkKind(cx, cy) ?? 'las')) out.set(`${cx},${cy}`, [cx, cy]);
  return [...out.values()];
}

describe('osm-stw furniture (#131) over the whole generator', () => {
  it('stands only in rooms; outside only yard props, never on the road', () => {
    const C = CHUNK_SIZE;
    let furniture = 0;
    let columns = 0;
    const bad: string[] = [];
    const open: string[] = [];
    for (const [cx, cy] of chunks()) {
      const c = g.column(cx, cy);
      if (!c) continue;
      columns++;
      for (const l of c.levels) {
        for (const o of l.objects) {
          const i = o.y * C + o.x;
          const floor = TILE_PALETTE[l.floor[i]!] ?? '';
          const indoor = (l.room?.[i] ?? 0) !== 0 && !OUTDOOR_FLOORS.has(floor);
          if (indoor) furniture++;
          else if (!OUTDOOR_OBJECTS.has(o.contentId) || floor === 'base:asphalt')
            bad.push(`${o.contentId} @ ${cx * C + o.x},${cy * C + o.y} z${l.z} on ${floor}`);
        }
        // A room tile next to a non-room tile has a wall / door / window there (ruins are open).
        const R = l.room;
        if (!R) continue;
        const ruin = new Set(l.rooms.filter((r) => r[1] === 'base:room-ruin').map((r) => r[0]));
        for (let y = 1; y < C - 1; y++)
          for (let x = 1; x < C - 1; x++) {
            const i = y * C + x;
            if (!R[i] || ruin.has(R[i])) continue;
            if (
              (!R[i - C] && !l.edgeN[i]) ||
              (!R[i + C] && !l.edgeN[i + C]) ||
              (!R[i - 1] && !l.edgeW[i]) ||
              (!R[i + 1] && !l.edgeW[i + 1])
            )
              open.push(`${cx * C + x},${cy * C + y} z${l.z}`);
          }
      }
    }
    expect(columns).toBeGreaterThan(1000);
    expect(furniture).toBeGreaterThan(10_000);
    expect(bad.slice(0, 20)).toEqual([]);
    expect(open.slice(0, 20)).toEqual([]);
  }, 900_000);

  it('places furniture by footprint (#218/#249) and gives every building a kind', async () => {
    const content = await buildContentBundleFromDirs([BASE_PACK_DIR]);
    const cols: GenColumn[] = [];
    for (const [cx, cy] of chunks()) {
      const c = g.column(cx, cy);
      if (c) cols.push(c);
    }
    const fp = (id: string) => footprintForId(content, id);
    const issues = columnFootprintIssues(cols, fp);
    expect(issues.map((i) => `${i.kind}: ${i.at}`).slice(0, 20)).toEqual([]);
    // #267: TV, VCR, radio and desk lamp stand on a worktop (their anchor tile, same column).
    const surf: string[] = [];
    let tops = 0;
    for (const c of cols)
      for (const l of c.levels) {
        const objs = l.objects.map((o) => ({
          ...o,
          x: c.cx * CHUNK_SIZE + o.x,
          y: c.cy * CHUNK_SIZE + o.y,
          z: l.z,
        }));
        tops += objs.filter((o) => onSurfaceForId(content, o.contentId)).length;
        surf.push(
          ...surfaceIssues(
            objs,
            fp,
            (id) => surfaceHeightForId(content, id),
            (id) => onSurfaceForId(content, id),
          ),
        );
      }
    expect(surf.slice(0, 20)).toEqual([]);
    expect(tops).toBeGreaterThan(500);
    const big = cols.flatMap((c) =>
      c.levels.flatMap((l) => l.objects.filter((o) => fp(o.contentId).w * fp(o.contentId).h > 1)),
    );
    expect(big.length).toBeGreaterThan(500);
    // buildingKinds from the OSM building kinds (church = none).
    let kinds = 0;
    const missing: string[] = [];
    for (const c of cols)
      for (const l of c.levels) {
        const sc = levelToSimChunk(l, 0);
        for (const [id, , gid] of l.rooms) {
          if (sc.roomBuildings?.[String(id)] !== gid) missing.push(`room ${id}: building`);
          const kind = c.buildings.find((b) => b.id === gid)?.kind;
          if (kind === 'church') continue;
          if (!/^[a-z]+$/.test(sc.buildingKinds?.[String(gid)] ?? ''))
            missing.push(`building ${gid} (${kind})`);
          else kinds++;
        }
      }
    expect(missing.slice(0, 20)).toEqual([]);
    expect(kinds).toBeGreaterThan(1000);
  }, 600_000);
});
