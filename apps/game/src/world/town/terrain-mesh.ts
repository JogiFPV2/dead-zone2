import type { Color } from 'three';
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three';
import { CHUNK_SIZE, type ContentId } from '../chunk.js';
import type { TownCells } from './kit.js';
import { hash01 } from './modules.js';
import type { MapTiles } from './tiles.js';
import type { VectorRoad } from '../streaming/source.js';
import { zebraSpots } from './zebras.js';

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
  // Rivers and ponds (OSM water): flat dark water, no detail texture; the sim blocks it.
  'base:water': { cell: 'water', mask: NONE, y: -0.04, jitter: 0.05 },
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
/**
 * Smooth vector roads of a generated chunk: road tiles show the ground under them (`underAt`) and
 * the roads are drawn as ribbons with round joins (no stair-stepped edges on diagonals).
 */
export interface TerrainVectorRoads {
  roads: readonly VectorRoad[];
  /** Ground content under a road tile (world tile), undefined = not a road tile. */
  underAt: (x: number, z: number) => ContentId | undefined;
  /**
   * Paved areas (plazas, `area:highway`) touching the chunk: rings in chunk-local tiles (first
   * outer, the rest holes), drawn as smooth polygons instead of stair-stepped sidewalk tiles.
   */
  paved?: readonly (readonly (readonly number[])[])[];
}

/** Indoor floor height (above every road ribbon, see RIBBON_Y). */
export const INDOOR_Y = 0.02;
/** Ribbon heights: dirt < sidewalk < curb < asphalt < paint, all under indoor floors (2 cm). */
const RIBBON_Y = {
  dirt: 0.004,
  paved: 0.005,
  sidewalk: 0.008,
  curb: 0.011,
  asphalt: 0.014,
  paint: 0.017,
};
/** Bridges (decks over rails / water) above every ordinary road layer. */
const BRIDGE_DY = 0.012;
const CURB_BAND = 0.15;
const JOIN_SEGMENTS = 14;
const DASH = { on: 1.6, period: 3.2, width: 0.14 };
const ZEBRA = { stripe: 0.5, gap: 0.5 };

export function buildTerrainGeometry(
  tiles: MapTiles,
  cx: number,
  cy: number,
  cells: TownCells,
  baseY = 0,
  vector?: TerrainVectorRoads,
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
  // Road tiles under a smooth vector road are not tile roads: no stair-stepped tile curbs along
  // them (the ribbon has its own curb), e.g. where a paved area or a plaza meets a diagonal road.
  const isRoad = (x: number, z: number) =>
    floorAt(x, z) === 'base:asphalt' && !vector?.underAt(x, z);
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
      const floor = vector?.underAt(x, z) ?? floorAt(x, z);
      if (!floor) continue;
      any = true;
      const room = tiles.roomType(x, z);
      const look = floorLook(floor, room);
      // Smooth roads run under indoor floors: lift every indoor floor to 2 cm. In every chunk, not
      // only those with a road layer: otherwise a hall across a chunk edge gets a 2 cm step there
      // and the background shows through the crack (a white line along the hall).
      const y = room ? Math.max(look.y ?? 0, INDOOR_Y) : (look.y ?? 0);
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
      // Vector roads draw their own curbs and paint.
      if (vector?.underAt(x, z)) continue;
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
  if (vector?.roads.length) {
    const tri = (a: V, b: V, c: V, cc: Color, mask: Mask) => {
      // Up-facing winding: (b − a) × (c − a) must point to +y.
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      for (const p of ny >= 0 ? [a, b, c] : [a, c, b]) {
        P.push(p[0], p[1] + baseY, p[2]);
        C.push(cc.r, cc.g, cc.b);
        M.push(...mask);
      }
    };
    const inChunk = (x: number, z: number) =>
      x >= x0 && x < x0 + CHUNK_SIZE && z >= z0 && z < z0 + CHUNK_SIZE;
    /** Segment a→b clipped to the chunk square (Liang–Barsky), as [t0, t1] or undefined. */
    const clip = (ax: number, az: number, bx: number, bz: number): [number, number] | undefined => {
      let t0 = 0;
      let t1 = 1;
      const dx = bx - ax;
      const dz = bz - az;
      for (const [p, q] of [
        [-dx, ax - x0],
        [dx, x0 + CHUNK_SIZE - ax],
        [-dz, az - z0],
        [dz, z0 + CHUNK_SIZE - az],
      ] as const) {
        if (p === 0) {
          if (q < 0) return undefined;
          continue;
        }
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
      return t1 > t0 ? [t0, t1] : undefined;
    };
    const band = (pts: readonly number[], R: number, y: number, c: Color, mask: Mask) => {
      const n = pts.length >> 1;
      for (let i = 0; i < n; i++) {
        const ax = x0 + pts[2 * i]!;
        const az = z0 + pts[2 * i + 1]!;
        // Round join / cap at every vertex owned by this chunk.
        if (inChunk(ax, az)) {
          for (let k = 0; k < JOIN_SEGMENTS; k++) {
            const a0 = (k / JOIN_SEGMENTS) * Math.PI * 2;
            const a1 = ((k + 1) / JOIN_SEGMENTS) * Math.PI * 2;
            tri(
              [ax, y, az],
              [ax + Math.cos(a0) * R, y, az + Math.sin(a0) * R],
              [ax + Math.cos(a1) * R, y, az + Math.sin(a1) * R],
              c,
              mask,
            );
          }
        }
        if (i + 1 >= n) break;
        const bx = x0 + pts[2 * i + 2]!;
        const bz = z0 + pts[2 * i + 3]!;
        const t = clip(ax, az, bx, bz);
        if (!t) continue;
        const len = Math.hypot(bx - ax, bz - az);
        if (len === 0) continue;
        const nx = (-(bz - az) / len) * R;
        const nz = ((bx - ax) / len) * R;
        const px = ax + (bx - ax) * t[0];
        const pz = az + (bz - az) * t[0];
        const qx = ax + (bx - ax) * t[1];
        const qz = az + (bz - az) * t[1];
        const a: V = [px + nx, y, pz + nz];
        const b: V = [qx + nx, y, qz + nz];
        const cc: V = [qx - nx, y, qz - nz];
        const d: V = [px - nx, y, pz - nz];
        tri(a, b, cc, c, mask);
        tri(a, cc, d, c, mask);
      }
    };
    const dashes = (pts: readonly number[], d0: number, y: number, c: Color) => {
      let d = d0;
      const n = pts.length >> 1;
      for (let i = 0; i + 1 < n; i++) {
        const ax = x0 + pts[2 * i]!;
        const az = z0 + pts[2 * i + 1]!;
        const bx = x0 + pts[2 * i + 2]!;
        const bz = z0 + pts[2 * i + 3]!;
        const len = Math.hypot(bx - ax, bz - az);
        if (len === 0) continue;
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        const w = DASH.width / 2;
        for (
          let s0 = Math.ceil(d / DASH.period) * DASH.period - DASH.period;
          s0 < d + len;
          s0 += DASH.period
        ) {
          const from = Math.max(s0, d) - d;
          const to = Math.min(s0 + DASH.on, d + len) - d;
          if (to <= from) continue;
          const mx = ax + ux * ((from + to) / 2);
          const mz = az + uz * ((from + to) / 2);
          if (!inChunk(mx, mz)) continue;
          const sx = ax + ux * from;
          const sz = az + uz * from;
          const ex = ax + ux * to;
          const ez = az + uz * to;
          const a: V = [sx - uz * w, y, sz + ux * w];
          const b: V = [ex - uz * w, y, ez + ux * w];
          const cc: V = [ex + uz * w, y, ez - ux * w];
          const dd: V = [sx + uz * w, y, sz - ux * w];
          tri(a, b, cc, c, [0.5, 0, 0, 0]);
          tri(a, cc, dd, c, [0.5, 0, 0, 0]);
        }
        d += len;
      }
    };
    const asphalt = col('asphalt');
    const sidewalk = col('sidewalk');
    const dirt = col('dirt');
    for (const r of vector.roads) {
      const dy = r.bridge ? BRIDGE_DY : 0;
      if (r.rs > 0) {
        band(r.pts, r.rs, RIBBON_Y.sidewalk + dy, sidewalk, [0, 0, 0.7, 0]);
        band(r.pts, r.r + CURB_BAND, RIBBON_Y.curb + dy, curbTop, NONE);
      }
      if (r.surface === 'base:asphalt') {
        band(r.pts, r.r, RIBBON_Y.asphalt + dy, asphalt, [0.8, 0, 0, 0]);
        if (r.r >= 2.5) dashes(r.pts, r.d0, RIBBON_Y.paint + dy, paint);
      } else if (r.surface === 'base:sidewalk') {
        band(r.pts, r.r, RIBBON_Y.sidewalk + dy, sidewalk, [0, 0, 0.7, 0]);
      } else {
        band(r.pts, r.r, RIBBON_Y.dirt + dy, dirt, [0, 0, 0, 1]);
      }
    }
    // Zebra crossings at junctions: stripes along the road, 0.5 m wide with 0.5 m gaps.
    for (const zb of zebraSpots(vector.roads, (x, z) => inChunk(x0 + x, z0 + z))) {
      const y = RIBBON_Y.paint + (zb.bridge ? BRIDGE_DY : 0);
      const cx = x0 + zb.x;
      const cz = z0 + zb.z;
      const { ux, uz } = zb;
      const vx = -uz;
      const vz = ux;
      const n = Math.max(
        1,
        Math.floor((2 * zb.halfWidth + ZEBRA.gap) / (ZEBRA.stripe + ZEBRA.gap)),
      );
      const span = n * ZEBRA.stripe + (n - 1) * ZEBRA.gap;
      for (let k = 0; k < n; k++) {
        const o0 = -span / 2 + k * (ZEBRA.stripe + ZEBRA.gap);
        const o1 = o0 + ZEBRA.stripe;
        const L = zb.halfLength;
        const p = (o: number, l: number): V => [cx + vx * o + ux * l, y, cz + vz * o + uz * l];
        tri(p(o0, -L), p(o0, L), p(o1, L), paint, [0.5, 0, 0, 0]);
        tri(p(o0, -L), p(o1, L), p(o1, -L), paint, [0.5, 0, 0, 0]);
      }
    }
  }
  if (vector?.paved?.length) pavedPolygons(vector, tiles, x0, z0, col('sidewalk'), P, C, M, baseY);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(C), 3));
  g.setAttribute('dmask', new BufferAttribute(new Float32Array(M), 4));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Natural ground a paved polygon may cover past the tile outline of its area (smooth edge). */
const SOFT_GROUND = new Set<ContentId>(['base:grass', 'base:dirt']);

/**
 * Paved areas as smooth polygons (triangulated rings), clipped to the tiles of the chunk where the
 * area really lies: tiles it paved (`underAt` set) and natural ground along its outline. Tiles of
 * buildings or of other areas painted over it keep their own floor.
 */
function pavedPolygons(
  vector: TerrainVectorRoads,
  tiles: MapTiles,
  x0: number,
  z0: number,
  color: Color,
  P: number[],
  C: number[],
  M: number[],
  baseY: number,
): void {
  const y = RIBBON_Y.paved + baseY;
  const ok = new Map<number, boolean>();
  const allowed = (x: number, z: number): boolean => {
    const k = (z - z0) * CHUNK_SIZE + (x - x0);
    let v = ok.get(k);
    if (v === undefined) {
      if (tiles.roomType(x, z)) v = false;
      else if (vector.underAt(x, z)) v = true;
      else {
        const f = tiles.floor(x, z);
        v = f !== undefined && SOFT_GROUND.has(f);
      }
      ok.set(k, v);
    }
    return v;
  };
  const push = (poly: readonly (readonly [number, number])[]) => {
    for (let i = 1; i + 1 < poly.length; i++) {
      const a = poly[0]!;
      const b = poly[i]!;
      const c = poly[i + 1]!;
      // Up-facing winding: (b − a) × (c − a) must point to +y (as the road ribbons).
      const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      for (const [px, pz] of ny >= 0 ? [a, b, c] : [a, c, b]) {
        P.push(px, y, pz);
        C.push(color.r, color.g, color.b);
        M.push(0, 0, 0.7, 0);
      }
    }
  };
  for (const rings of vector.paved ?? []) {
    const toV = (r: readonly number[]) => {
      const out: Vector2[] = [];
      for (let k = 0; k + 1 < r.length; k += 2) out.push(new Vector2(x0 + r[k]!, z0 + r[k + 1]!));
      // Closed OSM rings repeat the first point.
      if (out.length > 1 && out[0]!.equals(out[out.length - 1]!)) out.pop();
      return out;
    };
    const outer = toV(rings[0] ?? []);
    if (outer.length < 3) continue;
    const holes = rings
      .slice(1)
      .map(toV)
      .filter((h) => h.length >= 3);
    const all = [outer, ...holes].flat();
    for (const [a, b, c] of ShapeUtils.triangulateShape(outer, holes)) {
      const tri = [all[a!]!, all[b!]!, all[c!]!];
      const cx0 = Math.max(x0, Math.floor(Math.min(...tri.map((p) => p.x))));
      const cx1 = Math.min(x0 + CHUNK_SIZE - 1, Math.floor(Math.max(...tri.map((p) => p.x))));
      const cz0 = Math.max(z0, Math.floor(Math.min(...tri.map((p) => p.y))));
      const cz1 = Math.min(z0 + CHUNK_SIZE - 1, Math.floor(Math.max(...tri.map((p) => p.y))));
      for (let z = cz0; z <= cz1; z++)
        for (let x = cx0; x <= cx1; x++) {
          if (!allowed(x, z)) continue;
          const poly = clipToCell(
            tri.map((p) => [p.x, p.y] as [number, number]),
            x,
            z,
          );
          if (poly.length >= 3) push(poly);
        }
    }
  }
}

/** Convex polygon clipped to the tile square [x, x + 1] × [z, z + 1] (Sutherland–Hodgman). */
export function clipToCell(
  poly: readonly (readonly [number, number])[],
  x: number,
  z: number,
): [number, number][] {
  let out = poly.map(([a, b]) => [a, b] as [number, number]);
  const edges: [number, number, number][] = [
    [0, 1, x],
    [0, -1, -(x + 1)],
    [1, 1, z],
    [1, -1, -(z + 1)],
  ];
  for (const [axis, sign, lim] of edges) {
    const inp = out;
    out = [];
    const inside = (p: [number, number]) => sign * p[axis]! >= lim;
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i]!;
      const prev = inp[(i + inp.length - 1) % inp.length]!;
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci !== pi) {
        const t = (lim - sign * prev[axis]!) / (sign * (cur[axis]! - prev[axis]!));
        out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
      }
      if (ci) out.push(cur);
    }
    if (!out.length) break;
  }
  return out;
}
