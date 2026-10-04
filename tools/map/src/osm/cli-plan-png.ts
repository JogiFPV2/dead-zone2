/**
 * `tsx src/osm/cli-plan-png.ts <map id> <out.png> [z] [scale]`: top-down plan of a built content
 * map (floors by tile, rooms tinted, walls / windows / doors / fences, stairs) — dev preview.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CHUNK_SIZE, decodeLayer, type MapChunkJson } from '@deadzone/content';
import { BASE_PACK_DIR } from '@deadzone/content/node';
import { encodePng } from '../world/png.js';

const [id, out, zs = '0', ss = '3'] = process.argv.slice(2);
if (!id || !out) throw new Error('usage: cli-plan-png <map id> <out.png> [z] [scale]');
const Z = Number(zs);
const K = Number(ss);
const dir = join(BASE_PACK_DIR, 'maps', id, 'chunks');
const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
const chunks = await Promise.all(
  files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8')) as MapChunkJson),
);
const ground = chunks.filter((c) => c.address.z === 0);
const cx0 = Math.min(...ground.map((c) => c.address.cx));
const cy0 = Math.min(...ground.map((c) => c.address.cy));
const cx1 = Math.max(...ground.map((c) => c.address.cx));
const cy1 = Math.max(...ground.map((c) => c.address.cy));
const W = (cx1 - cx0 + 1) * CHUNK_SIZE;
const H = (cy1 - cy0 + 1) * CHUNK_SIZE;
const rgb = new Uint8Array(W * K * H * K * 3);
const COL: Record<string, [number, number, number]> = {
  'base:grass': [96, 132, 70],
  'base:asphalt': [70, 70, 74],
  'base:sidewalk': [160, 156, 148],
  'base:parking': [96, 96, 100],
  'base:dirt': [132, 108, 76],
  'base:concrete': [190, 186, 176],
  'base:kitchen-tiles': [210, 214, 220],
  'base:rail': [92, 80, 70],
};
const ROOM: Record<string, [number, number, number]> = {
  'base:room-hall': [200, 200, 200],
  'base:room-living-room': [222, 196, 150],
  'base:room-kitchen': [235, 225, 170],
  'base:room-bedroom': [200, 170, 200],
  'base:room-bathroom': [170, 210, 230],
  'base:room-shop': [240, 170, 120],
  'base:room-warehouse': [180, 160, 130],
  'base:room-office': [170, 190, 230],
  'base:room-school': [230, 200, 120],
  'base:room-pharmacy': [140, 220, 160],
  'base:room-garage': [160, 160, 150],
  'base:room-hospital': [240, 240, 250],
};
const px = (x: number, y: number, c: readonly number[]) => {
  if (x < 0 || y < 0 || x >= W * K || y >= H * K) return;
  const i = (y * W * K + x) * 3;
  rgb[i] = c[0]!;
  rgb[i + 1] = c[1]!;
  rgb[i + 2] = c[2]!;
};
const show = Z === 0 ? [0] : [0, Z];
for (const z of show) {
  for (const c of chunks.filter((ch) => ch.address.z === z)) {
    const floor = decodeLayer(c.layers.floor);
    const room = c.layers.room ? decodeLayer(c.layers.room) : undefined;
    const ox = (c.address.cx - cx0) * CHUNK_SIZE;
    const oy = (c.address.cy - cy0) * CHUNK_SIZE;
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
      const lx = i % CHUNK_SIZE,
        ly = Math.floor(i / CHUNK_SIZE);
      const f = floor[i] ? c.palette[floor[i]! - 1] : undefined;
      const r = room?.[i] ? c.rooms?.[String(room[i])]?.roomType : undefined;
      let col: readonly number[] | undefined = r
        ? (ROOM[r] ?? [230, 120, 230])
        : f
          ? (COL[f] ?? [255, 0, 255])
          : z > 0 && room?.[i]
            ? [40, 40, 40]
            : undefined;
      if (z > 0 && !col) continue;
      if (z > 0 && room?.[i] && !floor[i]) col = [30, 30, 30];
      col ??= [0, 0, 0];
      const dim = z === 0 && Z > 0 ? 0.45 : 1;
      for (let a = 0; a < K; a++)
        for (let b = 0; b < K; b++)
          px(
            (ox + lx) * K + a,
            (oy + ly) * K + b,
            col.map((v) => v * dim),
          );
    }
    for (const e of c.edges ?? []) {
      const col =
        e.type === 'wall'
          ? [30, 24, 20]
          : e.type === 'window'
            ? [80, 160, 255]
            : e.type === 'door'
              ? [255, 60, 40]
              : [250, 250, 250];
      const x = (ox + e.x) * K,
        y = (oy + e.y) * K;
      for (let k = 0; k < K; k++) {
        if (e.side === 'n') px(x + k, y, col);
        else px(x, y + k, col);
      }
    }
    for (const s of c.stairs ?? []) {
      const d = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[s.dir];
      for (let k = 0; k < s.len; k++) {
        const x = (ox + s.tx + d[0]! * k) * K,
          y = (oy + s.ty + d[1]! * k) * K;
        for (let a = 1; a < K - 1; a++)
          for (let b = 1; b < K - 1; b++) px(x + a, y + b, k === 0 ? [0, 200, 0] : [0, 120, 0]);
      }
    }
  }
}
await writeFile(out, encodePng(W * K, H * K, rgb));
console.log(out, W * K, H * K);
