import { STAIR_STEP } from '@deadzone/content';
import { lockKindOf } from '../building-kind.js';
import { furnishView, type FurnishView, type PlacedObject } from '../furnish.js';
import { buildInterior, type Footprint } from '../osm/interior.js';
import { idHash } from '../osm/classify.js';
import {
  EDGE_PALETTE,
  G_ASPHALT,
  G_PARKING,
  G_RAIL,
  G_SIDEWALK,
  G_WATER,
  GROUND_TILES,
  OUTDOOR_FLOORS,
  PROP_FLOORS,
  TILE_PALETTE,
  edgeId,
  tileId,
} from './palette.js';
import type { IBuilding, PlanIndex } from './plan-index.js';
import { fillRings, rasterGround, type Raster } from './raster.js';

type Side = 'n' | 's' | 'e' | 'w';

/** Room ids of upper floors without their own rooms: ground id + ROOM_Z_STRIDE · z (as `build.ts`). */
const ROOM_Z_STRIDE = 4096;
/** Room id of tiles owned by another building in a building's furnishing view. */
const FOREIGN = 0xffff;
/** Window margin around a building (door scoring looks this far for roads). */
const MARGIN = 20;

/** One storey of a solved building on its grid ((w + 1) × (h + 1): s / e edges of the last row / column). */
export interface BuildingLevel {
  /** Floor tile palette id per tile (0 = no floor: stair opening or outside). */
  floor: Uint16Array;
  /** Building-local room id (0 = outside). */
  room: Uint16Array;
  roof: Uint16Array;
  /** Edge palette ids, canonical: north / west side of each grid tile. */
  edgeN: Uint16Array;
  edgeW: Uint16Array;
}

/** A building with interiors, stairs and furniture: a pure function of the plan and its id. */
export interface SolvedBuilding {
  gid: number;
  osmId: number;
  kind: string;
  type: string;
  /** Grid origin (world tiles) and size (tiles; arrays are (w + 1) × (h + 1)). */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Mask bounding box (world tiles, inclusive). */
  bx0: number;
  by0: number;
  bx1: number;
  by1: number;
  /** Footprint fills its bounding box (pitched roofs are possible). */
  rect: boolean;
  levels: Map<number, BuildingLevel>;
  /** Building-local room id → room type. */
  rooms: Map<number, string>;
  /** Building kind for the sim (`SimChunk.buildingKinds`, `building-kind.ts`); none for a church. */
  lockKind: string | undefined;
  stairs: { x: number; y: number; z: number; dir: 'N' | 'E' | 'S' | 'W'; len: number }[];
  /** Furniture (indoors) and outdoor props (level 0, up to 2 tiles outside), world tiles. */
  objects: PlacedObject[];
  /** Exterior wall / roof content (renderer skin, far LOD). */
  wall: string;
  roofContent: string | undefined;
  floors: number;
  tiles: number;
}

/** Raw OSM fill of a building on a window, minus road / rail / bridge-deck tiles. */
function rawFill(b: IBuilding, r: Raster, out: Uint8Array, value = 1): number {
  let n = 0;
  fillRings(b.rings, r.x0, r.y0, r.w, r.h, (i) => {
    const g = r.g[i]!;
    if (g === G_ASPHALT || g === G_RAIL || g === G_WATER || r.deck[i]) return;
    out[i] = value;
    n++;
  });
  return n;
}

function keepLargest(mask: Uint8Array, w: number, h: number): void {
  const comp = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || comp[i]! >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const q = [i];
    comp[i] = id;
    while (q.length) {
      const j = q.pop()!;
      n++;
      const x = j % w;
      const y = (j - x) / w;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (mask[k] && comp[k]! < 0) {
          comp[k] = id;
          q.push(k);
        }
      }
    }
    sizes.push(n);
  }
  const big = sizes.indexOf(Math.max(...sizes));
  for (let i = 0; i < mask.length; i++) if (mask[i] && comp[i] !== big) mask[i] = 0;
}

export interface SolveOptions {
  /** Playable tile rectangle [x0, x1) × [y0, y1): buildings must lie inside (2-tile margin). */
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
}

/**
 * Footprint → interior (every storey, stairwell, doors, windows) → furniture, for one building.
 * Overlaps: a tile claimed by a lower building id (raw OSM fill) is left to it, so buildings
 * never share a tile. Returns undefined for buildings that are dropped (too small, on a road,
 * outside the playable area).
 */
export function solveBuilding(
  idx: PlanIndex,
  ib: IBuilding,
  opt: SolveOptions,
): SolvedBuilding | undefined {
  const { box } = ib;
  if (box.x0 < opt.tx0 + 2 || box.y0 < opt.ty0 + 2 || box.x1 > opt.tx1 - 2 || box.y1 > opt.ty1 - 2)
    return undefined;
  const fx = Math.floor(box.x0);
  const fy = Math.floor(box.y0);
  const w = Math.ceil(box.x1) - fx + 1;
  const h = Math.ceil(box.y1) - fy + 1;
  const r = rasterGround(idx, fx - MARGIN, fy - MARGIN, w + 2 * MARGIN, h + 2 * MARGIN);
  const n = r.w * r.h;
  const lower = new Uint8Array(n);
  const occupied = new Uint8Array(n);
  for (const i of idx.buildings.query({
    x0: r.x0,
    y0: r.y0,
    x1: r.x0 + r.w,
    y1: r.y0 + r.h,
  })) {
    const o = idx.buildings.items[i]!;
    if (o.gid === ib.gid) continue;
    rawFill(o, r, occupied);
    if (o.gid < ib.gid) rawFill(o, r, lower);
  }
  const own = new Uint8Array(n);
  rawFill(ib, r, own);
  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y + MARGIN) * r.w + (x + MARGIN);
      if (own[i] && !lower[i]) {
        mask[y * w + x] = 1;
        count++;
      }
    }
  if (count < 6) return undefined;
  keepLargest(mask, w, h);
  const mine = (x: number, y: number) =>
    x >= fx && y >= fy && x < fx + w && y < fy + h && mask[(y - fy) * w + (x - fx)] === 1;
  // Distance to the nearest road / sidewalk / parking tile (BFS around other buildings).
  const dist = new Int16Array(n).fill(999);
  const q: number[] = [];
  for (let i = 0; i < n; i++) {
    const g = r.g[i]!;
    const x = r.x0 + (i % r.w);
    const y = r.y0 + Math.floor(i / r.w);
    if (occupied[i] || mine(x, y)) continue;
    if (g === G_ASPHALT || g === G_SIDEWALK || g === G_PARKING) {
      dist[i] = 0;
      q.push(i);
    }
  }
  for (let k = 0; k < q.length; k++) {
    const i = q[k]!;
    const x = i % r.w;
    const y = (i - x) / r.w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
      const j = ny * r.w + nx;
      if (occupied[j] || r.rail[j] || r.g[j] === G_WATER || mine(r.x0 + nx, r.y0 + ny)) continue;
      if (dist[j]! <= dist[i]! + 1) continue;
      dist[j] = dist[i]! + 1;
      q.push(j);
    }
  }
  const fp: Footprint = { x0: fx, y0: fy, w, h, mask };
  const res = buildInterior({
    id: ib.gid,
    kind: ib.b.kind,
    levels: ib.b.levels,
    fp,
    rnd: idHash(ib.b.id, 3),
    nextRoomId: 1,
    doorScore: (x, y, side) => {
      const nx = side === 'e' ? x + 1 : side === 'w' ? x - 1 : x;
      const ny = side === 's' ? y + 1 : side === 'n' ? y - 1 : y;
      const lx = nx - r.x0;
      const ly = ny - r.y0;
      if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) return 0;
      const j = ly * r.w + lx;
      if (occupied[j] || r.rail[j] || r.deck[j] || r.g[j] === G_WATER) return 0;
      return Math.max(1, 100 - dist[j]! * 3);
    },
  });
  const b = res.building;
  const W = w + 1;
  const H = h + 1;
  const levels = new Map<number, BuildingLevel>();
  const rooms = new Map<number, string>();
  const zs = [0, ...(b.floors ?? []).map((f) => f.z)];
  const top = Math.max(...zs);
  const stairs = res.stairs.map((s) => ({
    x: s.at[0],
    y: s.at[1],
    z: s.zFrom ?? 0,
    dir: s.dir,
    len: s.len,
  }));
  const [ox, oy] = b.origin;
  for (const z of zs) {
    const level = z === 0 ? undefined : b.floors?.find((f) => f.z === z);
    const plan = level?.plan ?? b.plan;
    const rmap =
      z === 0
        ? b.rooms
        : (level?.rooms ??
          Object.fromEntries(
            Object.entries(b.rooms).map(([k, v]) => [k, { ...v, id: v.id + ROOM_Z_STRIDE * z }]),
          ));
    const L: BuildingLevel = {
      floor: new Uint16Array(W * H),
      room: new Uint16Array(W * H),
      roof: new Uint16Array(W * H),
      edgeN: new Uint16Array(W * H),
      edgeW: new Uint16Array(W * H),
    };
    const holes = new Set<number>();
    for (const s of stairs) {
      if (s.z !== z - 1) continue;
      const [dx, dy] = STAIR_STEP[s.dir];
      for (let k = 0; k < s.len; k++) holes.add((s.y + dy * k - fy) * W + (s.x + dx * k - fx));
    }
    const roof = b.roof !== undefined && z === top ? tileId(b.roof) : 0;
    const tiles: number[] = [];
    plan.forEach((row, py) => {
      for (let px = 0; px < row.length; px++) {
        const ch = row[px]!;
        if (ch === '.' || ch === ' ') continue;
        const room = rmap[ch];
        if (!room) continue;
        const gx = ox + px - fx;
        const gy = oy + py - fy;
        const i = gy * W + gx;
        L.floor[i] = holes.has(i) ? 0 : tileId(room.floor);
        L.room[i] = room.id;
        rooms.set(room.id, room.type);
        if (roof) L.roof[i] = roof;
        tiles.push(i);
      }
    });
    const wall = edgeId(b.wall);
    const roomAt = (gx: number, gy: number) =>
      gx < 0 || gy < 0 || gx >= W || gy >= H ? 0 : L.room[gy * W + gx]!;
    if (b.walls !== false) {
      for (const i of tiles) {
        const gx = i % W;
        const gy = (i - gx) / W;
        const rm = L.room[i]!;
        if (roomAt(gx, gy - 1) !== rm) L.edgeN[i] = wall;
        if (roomAt(gx - 1, gy) !== rm) L.edgeW[i] = wall;
        if (roomAt(gx, gy + 1) !== rm) L.edgeN[i + W] = wall;
        if (roomAt(gx + 1, gy) !== rm) L.edgeW[i + 1] = wall;
      }
    }
    const canon = (x: number, y: number, side: Side): [Uint16Array, number] => {
      const gx = x - fx;
      const gy = y - fy;
      if (side === 's') return [L.edgeN, (gy + 1) * W + gx];
      if (side === 'e') return [L.edgeW, gy * W + gx + 1];
      return [side === 'n' ? L.edgeN : L.edgeW, gy * W + gx];
    };
    for (const o of level ? (level.openings ?? []) : (b.openings ?? [])) {
      const [arr, i] = canon(ox + o.at[0], oy + o.at[1], o.side);
      if (!arr[i]) continue;
      const id = o.contentId ?? (o.type === 'door' ? b.door : b.window);
      if (id) arr[i] = edgeId(id);
    }
    for (const gp of level ? (level.gaps ?? []) : (b.gaps ?? [])) {
      const [arr, i] = canon(ox + gp.at[0], oy + gp.at[1], gp.side);
      arr[i] = 0;
    }
    levels.set(z, L);
  }
  // --- furniture (same rules as content maps, #131) ---------------------------------------
  const roomInfo = new Map<number, { roomType: string; buildingId: number }>();
  for (const [id, t] of rooms) roomInfo.set(id, { roomType: t, buildingId: ib.gid });
  const inGrid = (x: number, y: number) => x >= fx && y >= fy && x < fx + W && y < fy + H;
  const ri = (x: number, y: number) => {
    const lx = x - r.x0;
    const ly = y - r.y0;
    return lx < 0 || ly < 0 || lx >= r.w || ly >= r.h ? -1 : ly * r.w + lx;
  };
  const kindOf = (v: number) => EDGE_PALETTE[v]?.kind;
  const view: FurnishView = {
    rooms: roomInfo,
    levels: new Set(levels.keys()),
    stairs,
    room(x, y, z) {
      if (inGrid(x, y)) {
        const v = levels.get(z)?.room[(y - fy) * W + (x - fx)] ?? 0;
        if (v) return v;
      }
      if (z !== 0) return 0;
      const i = ri(x, y);
      return i >= 0 && occupied[i] ? FOREIGN : 0;
    },
    floor(x, y, z) {
      if (inGrid(x, y)) {
        const L = levels.get(z);
        const k = (y - fy) * W + (x - fx);
        if (L?.room[k]) return L.floor[k] ? (TILE_PALETTE[L.floor[k]] ?? undefined) : undefined;
      }
      if (z !== 0) return undefined;
      const i = ri(x, y);
      if (i < 0) return undefined;
      return occupied[i] ? 'base:concrete' : GROUND_TILES[r.g[i]!];
    },
    edge(x, y, z, s) {
      let ex = x;
      let ey = y;
      const n = s === 'n' || s === 's';
      if (s === 's') ey = y + 1;
      if (s === 'e') ex = x + 1;
      if (!inGrid(ex, ey)) return undefined;
      const L = levels.get(z);
      if (!L) return undefined;
      const k = (ey - fy) * W + (ex - fx);
      const v = n ? L.edgeN[k]! : L.edgeW[k]!;
      return v ? kindOf(v) : undefined;
    },
    open(x, y, z, s) {
      const e = this.edge(x, y, z, s);
      return e === undefined || e === 'door';
    },
    *tiles(z) {
      const m = z === 0 ? 2 : 0;
      for (let y = fy - m; y < fy + h + m; y++)
        for (let x = fx - m; x < fx + w + m; x++) yield [x, y];
    },
  };
  const objects = furnishView(view, [], {
    seed: (ib.b.id % 1000003) + 1,
    outdoorFloor: (id) => OUTDOOR_FLOORS.has(id),
    propFloor: (id) => PROP_FLOORS.has(id),
    streetFloor: (id) => id === 'base:sidewalk' || id === 'base:asphalt' || id === 'base:parking',
  });
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  let tiles = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        tiles++;
        bx0 = Math.min(bx0, fx + x);
        by0 = Math.min(by0, fy + y);
        bx1 = Math.max(bx1, fx + x);
        by1 = Math.max(by1, fy + y);
      }
  return {
    gid: ib.gid,
    osmId: ib.b.id,
    kind: ib.b.kind,
    type: ib.b.type,
    x0: fx,
    y0: fy,
    w,
    h,
    bx0,
    by0,
    bx1,
    by1,
    rect: tiles === (bx1 - bx0 + 1) * (by1 - by0 + 1),
    levels,
    rooms,
    lockKind: lockKindOf(ib.b.kind, rooms.values()),
    stairs,
    objects,
    wall: b.wall,
    roofContent: b.roof,
    floors: res.levels,
    tiles,
  };
}
