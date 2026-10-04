import type { Color } from 'three';
import { BufferAttribute, BufferGeometry } from 'three';
import { CHUNK_SIZE, type ContentId } from '../chunk.js';
import type { TownCells } from './kit.js';
import { hash01 } from './modules.js';
import type { MapTiles } from './tiles.js';

/** Detail channels of the terrain texture: R asphalt, G grass, B paving, A dirt. */
type Mask = readonly [number, number, number, number];
const NONE: Mask = [0, 0, 0, 0];

interface FloorLook {
  cell: string;
  mask: Mask;
  /** Height above the ground plane (indoor floors sit 2 cm up). */
  y?: number;
  /** Per-tile brightness jitter (±). */
  jitter?: number;
}

const OUTDOOR: Record<string, FloorLook> = {
  'base:grass': { cell: 'grass', mask: [0, 1, 0, 0] },
  'base:asphalt': { cell: 'asphalt', mask: [0.8, 0, 0, 0] },
  'base:parking': { cell: 'parking', mask: [0.8, 0, 0, 0] },
  'base:sidewalk': { cell: 'sidewalk', mask: [0, 0, 0.7, 0] },
  'base:concrete': { cell: 'concrete', mask: [0, 0, 0.45, 0] },
  'base:dirt': { cell: 'dirt', mask: [0, 0, 0, 1] },
  // Track ballast (OSM rails); sleepers and rails are drawn on top.
  'base:rail': { cell: 'asphalt', mask: [0.3, 0, 0, 0.7], jitter: 0.16 },
  'base:kitchen-tiles': { cell: 'kitchen-tiles', mask: NONE, y: 0.02, jitter: 0.08 },
};

/** Indoor concrete is skinned by room type (living: wood planks, kitchen: tiles, bedroom: carpet). */
function indoorLook(room: ContentId): FloorLook | undefined {
  if (room === 'base:room-living-room')
    return { cell: 'wood-floor', mask: NONE, y: 0.02, jitter: 0.08 };
  if (room === 'base:room-kitchen' || room === 'base:room-bathroom')
    return { cell: 'kitchen-tiles', mask: NONE, y: 0.02, jitter: 0.08 };
  if (room === 'base:room-bedroom') return { cell: 'carpet', mask: NONE, y: 0.02, jitter: 0.05 };
  return undefined;
}

export function floorLook(floor: ContentId | undefined, room: ContentId | undefined): FloorLook {
  if (room && (floor === 'base:concrete' || floor === undefined)) {
    const l = indoorLook(room);
    if (l) return l;
  }
  return (floor && OUTDOOR[floor]) || { cell: 'concrete', mask: [0, 0, 0.45, 0] };
}

function vnoise(x: number, z: number, s: number): number {
  const fx = Math.floor(x / s);
  const fz = Math.floor(z / s);
  const tx = x / s - fx;
  const tz = z / s - fz;
  const a = hash01(fx, fz);
  const b = hash01(fx + 1, fz);
  const c = hash01(fx, fz + 1);
  const d = hash01(fx + 1, fz + 1);
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const ROAD_MAX_WIDTH = 10;
const CURB = { width: 0.15, height: 0.12 };

/**
 * One merged terrain mesh for a chunk (spec 5–6): per-vertex colour (grass/dirt noise blended at
 * tile corners, per-tile jitter, plank / checker floors), `dmask` (detail texture channel ×
 * strength), curbs on every sidewalk|asphalt border, road paint (centre dashes, crosswalks next to
 * crossings, parking bays) and oil stains — all in the same buffers (1 draw call).
 */
export function buildTerrainGeometry(
  tiles: MapTiles,
  cx: number,
  cy: number,
  cells: TownCells,
  baseY = 0,
): BufferGeometry | undefined {
  const P: number[] = [];
  const C: number[] = [];
  const M: number[] = [];
  type V = [number, number, number];
  const quad = (pts: readonly V[], c: Color | readonly Color[], mask: Mask) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = pts[i] as V;
      const cc = Array.isArray(c) ? (c[i] as Color) : (c as Color);
      P.push(p[0], p[1] + baseY, p[2]);
      C.push(cc.r, cc.g, cc.b);
      M.push(...mask);
    }
  };
  const col = (n: string) => cells.color(n);
  const grass = ['grass-c', 'grass', 'grass-b', 'grass-d'].map(col);
  const grassAt = (x: number, z: number) => {
    const n = vnoise(x, z, 6) * 0.65 + vnoise(x + 91, z - 37, 2.5) * 0.35;
    const f = Math.min(2.999, Math.max(0, ((n - 0.2) / 0.6) * 3));
    const i = Math.floor(f);
    return (grass[i] as Color).clone().lerp(grass[i + 1] as Color, f - i);
  };
  const dirtAt = (x: number, z: number) =>
    col('dirt')
      .clone()
      .lerp(col('grass-d'), Math.max(0, Math.min(1, (vnoise(x + 50, z, 3) - 0.5) * 3)));

  const floorAt = (x: number, z: number) => tiles.floor(x, z);
  const isRoad = (x: number, z: number) => floorAt(x, z) === 'base:asphalt';
  const runs = new Map<string, number>();
  const run = (x: number, z: number, dx: number, dz: number): number => {
    const k = `${x},${z},${dx},${dz}`;
    let n = runs.get(k);
    if (n === undefined) {
      n = 0;
      while (n < 64 && isRoad(x + dx * (n + 1), z + dz * (n + 1))) n++;
      runs.set(k, n);
    }
    return n;
  };
  const x0 = cx * CHUNK_SIZE;
  const z0 = cy * CHUNK_SIZE;
  let any = false;
  for (let z = z0; z < z0 + CHUNK_SIZE; z++) {
    for (let x = x0; x < x0 + CHUNK_SIZE; x++) {
      const floor = floorAt(x, z);
      if (!floor) continue;
      any = true;
      const room = tiles.roomType(x, z);
      const look = floorLook(floor, room);
      const y = look.y ?? 0;
      let c = col(look.cell)
        .clone()
        .multiplyScalar(1 + (hash01(x, z) - 0.5) * (look.jitter ?? 0.06));
      if (look.cell === 'kitchen-tiles' && (x + z) & 1) c = c.multiplyScalar(0.85);
      if (look.cell === 'wood-floor' && x & 1) c = c.multiplyScalar(0.92);
      const corners: V[] = [
        [x, y, z + 1],
        [x + 1, y, z + 1],
        [x + 1, y, z],
        [x, y, z],
      ];
      const cs =
        look.cell === 'grass'
          ? corners.map(([a, , b]) => grassAt(a, b))
          : look.cell === 'dirt'
            ? corners.map(([a, , b]) => dirtAt(a, b))
            : c;
      quad(corners, cs, look.mask);
    }
  }
  if (!any) return undefined;

  // Curbs: a 0.15 × 0.12 strip on the sidewalk side of every sidewalk|asphalt border.
  const curb = col('curb');
  const curbTop = curb.clone().multiplyScalar(1.12);
  const box = (ax: number, az: number, bx: number, bz: number, h: number) => {
    quad(
      [
        [ax, h, bz],
        [bx, h, bz],
        [bx, h, az],
        [ax, h, az],
      ],
      curbTop,
      NONE,
    );
    quad(
      [
        [ax, 0, bz],
        [bx, 0, bz],
        [bx, h, bz],
        [ax, h, bz],
      ],
      curb,
      NONE,
    );
    quad(
      [
        [bx, 0, az],
        [ax, 0, az],
        [ax, h, az],
        [bx, h, az],
      ],
      curb,
      NONE,
    );
    quad(
      [
        [bx, 0, bz],
        [bx, 0, az],
        [bx, h, az],
        [bx, h, bz],
      ],
      curb,
      NONE,
    );
    quad(
      [
        [ax, 0, az],
        [ax, 0, bz],
        [ax, h, bz],
        [ax, h, az],
      ],
      curb,
      NONE,
    );
  };
  const w = CURB.width;
  const paint = col('paint').clone().multiplyScalar(0.9);
  const stain = col('stain');
  const flat = (ax: number, az: number, bx: number, bz: number, c: Color, y = 0.006) =>
    quad(
      [
        [ax, y, bz],
        [bx, y, bz],
        [bx, y, az],
        [ax, y, az],
      ],
      c,
      [0.5, 0, 0, 0],
    );
  const crossing = (x: number, z: number) =>
    isRoad(x, z) &&
    run(x, z, 1, 0) + run(x, z, -1, 0) + 1 > ROAD_MAX_WIDTH &&
    run(x, z, 0, 1) + run(x, z, 0, -1) + 1 > ROAD_MAX_WIDTH;

  // Railway: sleepers every 0.6 m and two rails per track along the ballast band (one track per
  // ~4 m of band width), drawn from the band's first row / column.
  const isRail = (x: number, z: number) => floorAt(x, z) === 'base:rail';
  const railRun = (x: number, z: number, dx: number, dz: number) => {
    let n = 0;
    while (n < 24 && isRail(x + dx * (n + 1), z + dz * (n + 1))) n++;
    return n;
  };
  const sleeper = col('stain').clone().multiplyScalar(0.8);
  const steel = col('paint').clone().multiplyScalar(0.55);
  const RAIL_GAUGE = 1.435;
  for (let z = z0; z < z0 + CHUNK_SIZE; z++) {
    for (let x = x0; x < x0 + CHUNK_SIZE; x++) {
      if (!isRail(x, z)) continue;
      const up = railRun(x, z, 0, -1);
      const down = railRun(x, z, 0, 1);
      const left = railRun(x, z, -1, 0);
      const right = railRun(x, z, 1, 0);
      const wz = up + down + 1;
      const wx = left + right + 1;
      if (wx >= wz && up === 0) {
        const n = Math.max(1, Math.round(wz / 4));
        for (let k = 0; k < n; k++) {
          const c = z + ((k + 0.5) * wz) / n;
          for (let i = 0; i < 2; i++)
            flat(x + i * 0.5 + 0.1, c - 1.25, x + i * 0.5 + 0.32, c + 1.25, sleeper, 0.008);
          for (const s of [-1, 1])
            flat(
              x,
              c + (s * RAIL_GAUGE) / 2 - 0.04,
              x + 1,
              c + (s * RAIL_GAUGE) / 2 + 0.04,
              steel,
              0.03,
            );
        }
      } else if (wz > wx && left === 0) {
        const n = Math.max(1, Math.round(wx / 4));
        for (let k = 0; k < n; k++) {
          const c = x + ((k + 0.5) * wx) / n;
          for (let i = 0; i < 2; i++)
            flat(c - 1.25, z + i * 0.5 + 0.1, c + 1.25, z + i * 0.5 + 0.32, sleeper, 0.008);
          for (const s of [-1, 1])
            flat(
              c + (s * RAIL_GAUGE) / 2 - 0.04,
              z,
              c + (s * RAIL_GAUGE) / 2 + 0.04,
              z + 1,
              steel,
              0.03,
            );
        }
      }
    }
  }

  for (let z = z0; z < z0 + CHUNK_SIZE; z++) {
    for (let x = x0; x < x0 + CHUNK_SIZE; x++) {
      const f = floorAt(x, z);
      if (f === 'base:sidewalk') {
        if (isRoad(x + 1, z)) box(x + 1 - w, z, x + 1, z + 1, CURB.height);
        if (isRoad(x - 1, z)) box(x, z, x + w, z + 1, CURB.height);
        if (isRoad(x, z + 1)) box(x, z + 1 - w, x + 1, z + 1, CURB.height);
        if (isRoad(x, z - 1)) box(x, z, x + 1, z + w, CURB.height);
        continue;
      }
      if (f === 'base:parking') {
        // Bay lines every 3 tiles, 5 m long from the lot's west edge.
        let fromWest = 0;
        while (fromWest < 8 && floorAt(x - fromWest - 1, z) === 'base:parking') fromWest++;
        if (z % 3 === 0 && fromWest < 5) flat(x, z - 0.05, x + 1, z + 0.05, paint);
      }
      if (f !== 'base:asphalt' && f !== 'base:parking') continue;
      if (hash01(x, z, 3) < 0.012) {
        const r = 0.4 + hash01(x, z, 4) * 0.5;
        const sx = x + 0.5;
        const sz = z + 0.5;
        flat(sx - r, sz - r * 0.6, sx + r, sz + r * 0.6, stain, 0.007);
        flat(sx - r * 0.5, sz - r, sx + r * 0.6, sz + r * 0.9, stain, 0.0072);
      }
      if (f !== 'base:asphalt') continue;
      // Road strips: the short asphalt run across the tile gives the road width and centre line.
      const up = run(x, z, 0, -1);
      const down = run(x, z, 0, 1);
      const left = run(x, z, -1, 0);
      const right = run(x, z, 1, 0);
      const widthZ = up + down + 1;
      const widthX = left + right + 1;
      if (widthZ <= ROAD_MAX_WIDTH && widthX > widthZ) {
        // East-west road; this column's first road row draws its paint.
        if (up !== 0) continue;
        const centre = z + widthZ / 2;
        // Zebra band over the two tiles next to the crossing (drawn once, from its west tile).
        if ((crossing(x + 2, z) && !crossing(x + 1, z)) || crossing(x - 1, z)) {
          for (let i = 0; i < widthZ; i++) flat(x + 0.2, z + i + 0.2, x + 1.8, z + i + 0.7, paint);
        } else if (((x % 3) + 3) % 3 === 0 && ![-2, -1, 1, 2, 3].some((d) => crossing(x + d, z))) {
          flat(x, centre - 0.07, x + 1.6, centre + 0.07, paint);
        }
      } else if (widthX <= ROAD_MAX_WIDTH && widthZ > widthX) {
        if (left !== 0) continue;
        const centre = x + widthX / 2;
        if ((crossing(x, z + 2) && !crossing(x, z + 1)) || crossing(x, z - 1)) {
          for (let i = 0; i < widthX; i++) flat(x + i + 0.2, z + 0.2, x + i + 0.7, z + 1.8, paint);
        } else if (((z % 3) + 3) % 3 === 0 && ![-2, -1, 1, 2, 3].some((d) => crossing(x, z + d))) {
          flat(centre - 0.07, z, centre + 0.07, z + 1.6, paint);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(C), 3));
  g.setAttribute('dmask', new BufferAttribute(new Float32Array(M), 4));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
