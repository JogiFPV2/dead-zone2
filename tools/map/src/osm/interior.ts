import type { BlueprintInput } from '../blueprint.js';
import { autoDoors } from '../catalog.js';
import type { BuildingKind } from './types.js';

type BuildingInput = NonNullable<BlueprintInput['buildings']>[number];
type StairsInput = NonNullable<BlueprintInput['stairs']>[number];
type Edge = 'n' | 's' | 'e' | 'w';
type Dir = 'N' | 'E' | 'S' | 'W';

/**
 * Interiors for any footprint (OSM polygon rasterised to a tile mask): the same storey outline on
 * every floor, a U stairwell (3 tiles wide, flights alternating between two columns, the third an
 * aisle — like the catalogue's `u` stairs) or a single straight flight in small two-storey houses,
 * a 2-tile corridor along the long axis in wide public buildings and blocks, rooms cut in bands ×
 * segments by kind, one interior door per edge of a spanning tree of the room graph (never beside
 * a flight), an entrance on the ground floor facing the best outside tile, windows on outer walls.
 * Rooms cut off from the tree (touching only flights) are merged into a neighbour, so every tile of
 * every floor reaches the stairwell and the ground-floor exit (checked by `osm-scene.test.ts`).
 */
export interface Footprint {
  /** World tile of mask (0, 0). */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** 1 = inside, row-major w × h. */
  mask: Uint8Array;
}

export interface InteriorInput {
  id: number;
  kind: BuildingKind;
  levels: number;
  fp: Footprint;
  /** Score of an exterior door from building tile (x, y) through `side` (world tiles); ≤ 0 = no. */
  doorScore: (x: number, y: number, side: Edge) => number;
  /** Per-building variety 0..1. */
  rnd: number;
  /** Next free map-global room id (returned updated). */
  nextRoomId: number;
}

export interface InteriorResult {
  building: BuildingInput;
  stairs: StairsInput[];
  nextRoomId: number;
  /** Storeys actually built (lower than asked when no stairwell fits). */
  levels: number;
  /** World tile + side of the ground-floor exterior doors. */
  doors: { x: number; y: number; side: Edge }[];
}

interface Look {
  wall: string;
  window: string;
  door: string;
  roof?: string;
}

const HOUSE_WALLS = [
  'base:siding-green',
  'base:siding-beige',
  'base:siding-blue',
  'base:plaster-wall',
  'base:brick-wall',
  'base:wall-kostka',
];
const HOUSE_ROOFS = ['base:roof-gable', 'base:roof-tile', 'base:roof-shingles', 'base:roof-tile'];

function look(kind: BuildingKind, rnd: number): Look {
  const pick = <T>(a: readonly T[], salt = 0) =>
    a[Math.floor(((rnd * 7919 + salt * 104729) % 1) * a.length)]!;
  switch (kind) {
    case 'house':
      return {
        wall: pick(HOUSE_WALLS),
        window: 'base:wooden-window',
        door: 'base:wooden-door',
        roof: pick(HOUSE_ROOFS, 3),
      };
    case 'kostka':
      return {
        wall: 'base:wall-kostka',
        window: 'base:wooden-window',
        door: 'base:wooden-door',
        roof: 'base:roof-tile',
      };
    case 'block':
      return {
        wall: rnd < 0.5 ? 'base:plaster-wall' : 'base:wall-plain',
        window: 'base:window-plain',
        door: 'base:door-plain',
        roof: 'base:roof-flat',
      };
    case 'shop':
    case 'station':
      return {
        wall: 'base:wall-shop',
        window: 'base:window-shop',
        door: 'base:door-glass',
        roof: 'base:roof-flat',
      };
    case 'pharmacy':
      return {
        wall: 'base:wall-pharmacy',
        window: 'base:window-shop',
        door: 'base:door-glass',
        roof: 'base:roof-flat',
      };
    case 'hospital':
      return {
        wall: 'base:wall-hospital',
        window: 'base:window-plain',
        door: 'base:door-glass',
        roof: 'base:roof-felt',
      };
    case 'school':
      return {
        wall: 'base:wall-school',
        window: 'base:window-plain',
        door: 'base:door-plain',
        roof: 'base:roof-felt',
      };
    case 'office':
      return {
        wall: 'base:wall-plain',
        window: 'base:window-plain',
        door: 'base:door-glass',
        roof: 'base:roof-flat',
      };
    case 'gym':
      return {
        wall: 'base:wall-school',
        window: 'base:window-plain',
        door: 'base:door-plain',
        roof: 'base:roof-corrugated',
      };
    case 'church':
      return {
        wall: 'base:brick-wall',
        window: 'base:wooden-window',
        door: 'base:wooden-door',
        roof: 'base:roof-tile',
      };
    case 'police':
    case 'fire-station':
      return {
        wall: 'base:wall-police',
        window: 'base:window-plain',
        door: 'base:door-plain',
        roof: 'base:roof-flat',
      };
    case 'fuel':
      return {
        wall: 'base:wall-gas',
        window: 'base:window-shop',
        door: 'base:door-glass',
        roof: 'base:roof-flat',
      };
    case 'industrial':
      return {
        wall: rnd < 0.5 ? 'base:wall-plain' : 'base:brick-wall',
        window: 'base:window-plain',
        door: 'base:door-plain',
        roof: 'base:roof-corrugated',
      };
    case 'garage':
      return {
        wall: rnd < 0.5 ? 'base:brick-wall' : 'base:wall-plain',
        window: 'base:window-plain',
        door: 'base:door-plain',
        roof: 'base:roof-felt',
      };
    case 'shed':
      return {
        wall: 'base:wall-plank',
        window: 'base:wooden-window',
        door: 'base:wooden-door',
        roof: 'base:roof-corrugated',
      };
    case 'ruin':
      return { wall: 'base:wall-burnt', window: 'base:wooden-window', door: 'base:wooden-door' };
  }
}

const R = (t: string) => `base:room-${t}`;
const FLAT = ['living-room', 'kitchen', 'bedroom', 'bathroom', 'bedroom'];
const HOUSE_UP = ['bedroom', 'bathroom', 'bedroom', 'living-room'];

/** Room type of cell `i` (of `n`) on floor z. */
function roomType(kind: BuildingKind, z: number, i: number, n: number, levels: number): string {
  switch (kind) {
    case 'house':
    case 'kostka':
      return R(
        z === 0
          ? (['living-room', 'kitchen', 'bedroom', 'bathroom', 'living-room'][i % 5] ??
              'living-room')
          : (HOUSE_UP[i % 4] ?? 'bedroom'),
      );
    case 'block':
      return R(FLAT[i % FLAT.length]!);
    case 'shop':
    case 'station':
      if (z > 0) return R(levels > 2 || kind === 'shop' ? FLAT[i % FLAT.length]! : 'office');
      return R(
        i === n - 1 && n > 1 ? 'warehouse' : kind === 'station' && i % 3 === 1 ? 'office' : 'shop',
      );
    case 'pharmacy':
      if (z > 0) return R(FLAT[i % FLAT.length]!);
      return R(i === n - 1 && n > 1 ? 'bathroom' : 'pharmacy');
    case 'hospital':
      return R(
        i % 7 === 3
          ? 'office'
          : i % 7 === 5
            ? 'bathroom'
            : z === 0 && i === 1
              ? 'pharmacy'
              : 'hospital',
      );
    case 'school':
      return R(i % 6 === 2 ? 'office' : i % 6 === 4 ? 'bathroom' : 'school');
    case 'office':
      return R(i % 5 === 4 ? 'bathroom' : 'office');
    case 'gym':
      return R(i === 0 ? 'gym' : i % 2 ? 'bathroom' : 'gym');
    case 'church':
      return R('hall');
    case 'police':
      return R(i % 4 === 3 ? 'office' : 'police');
    case 'fire-station':
      return R(z === 0 && i % 2 === 0 ? 'garage' : 'office');
    case 'fuel':
      return R('gas-station');
    case 'industrial':
      return R(i % 4 === 3 ? 'office' : 'warehouse');
    case 'garage':
    case 'shed':
      return R('garage');
    case 'ruin':
      return R('ruin');
  }
}

/** Segment length along the long axis and whether wide footprints get a corridor. */
function cut(kind: BuildingKind): { seg: number; corridor: boolean; maxSingle: number } {
  switch (kind) {
    case 'house':
    case 'kostka':
      return { seg: 4, corridor: false, maxSingle: 20 };
    case 'block':
      return { seg: 5, corridor: true, maxSingle: 24 };
    case 'hospital':
      return { seg: 6, corridor: true, maxSingle: 30 };
    case 'school':
      return { seg: 8, corridor: true, maxSingle: 40 };
    case 'office':
    case 'police':
    case 'fire-station':
      return { seg: 5, corridor: true, maxSingle: 25 };
    case 'station':
      return { seg: 7, corridor: false, maxSingle: 40 };
    case 'shop':
    case 'pharmacy':
      return { seg: 12, corridor: false, maxSingle: 60 };
    case 'industrial':
      return { seg: 20, corridor: false, maxSingle: 150 };
    case 'gym':
      return { seg: 30, corridor: false, maxSingle: 2000 };
    case 'church':
    case 'fuel':
      return { seg: 1000, corridor: false, maxSingle: 100000 };
    default:
      return { seg: 8, corridor: false, maxSingle: 60 };
  }
}

const CHARS = (() => {
  const out: string[] = [];
  for (let c = 0x41; c <= 0x5a; c++) if (c !== 0x55 && c !== 0x43) out.push(String.fromCharCode(c));
  for (let c = 0x61; c <= 0x7a; c++) out.push(String.fromCharCode(c));
  for (let c = 0x30; c <= 0x39; c++) out.push(String.fromCharCode(c));
  for (let c = 0x100; c < 0x100 + 2000; c++) out.push(String.fromCharCode(c));
  return out;
})();
const STAIR = 'U';
const HALL = 'C';

interface StairPlan {
  kind: 'u' | 'straight';
  /** Mask-local tiles of the stair room (U) / the flight with its two landings (straight). */
  tiles: [number, number][];
  /** Flights in mask-local coords. */
  flights: { at: [number, number]; dir: Dir; len: number; zFrom: number }[];
}

const STEP: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/** U stairwell 3 × (len + 2) at (c, r), vertical (flights N/S) or horizontal (E/W). */
function uStair(c: number, r: number, len: number, vertical: boolean, levels: number): StairPlan {
  const tiles: [number, number][] = [];
  const W = vertical ? 3 : len + 2;
  const H = vertical ? len + 2 : 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tiles.push([c + x, r + y]);
  const flights: StairPlan['flights'] = [];
  for (let z = 0; z < levels - 1; z++) {
    if (vertical) {
      flights.push(
        z % 2 === 0
          ? { at: [c, r + len], dir: 'N', len, zFrom: z }
          : { at: [c + 1, r + 1], dir: 'S', len, zFrom: z },
      );
    } else {
      flights.push(
        z % 2 === 0
          ? { at: [c + len, r], dir: 'W', len, zFrom: z }
          : { at: [c + 1, r + 1], dir: 'E', len, zFrom: z },
      );
    }
  }
  return { kind: 'u', tiles, flights };
}

/** Straight flight (two storeys only): bottom landing, `len` steps, top landing in a line. */
function straightStair(c: number, r: number, len: number, vertical: boolean): StairPlan {
  const tiles: [number, number][] = [];
  for (let k = 0; k < len + 2; k++) tiles.push(vertical ? [c, r + k] : [c + k, r]);
  const flights: StairPlan['flights'] = [
    vertical
      ? { at: [c, r + len], dir: 'N', len, zFrom: 0 }
      : { at: [c + len, r], dir: 'W', len, zFrom: 0 },
  ];
  return { kind: 'straight', tiles, flights };
}

function flightTiles(f: StairPlan['flights'][number]): [number, number][] {
  const [dx, dy] = STEP[f.dir];
  return Array.from(
    { length: f.len },
    (_, k) => [f.at[0] + dx * k, f.at[1] + dy * k] as [number, number],
  );
}

export function buildInterior(inp: InteriorInput): InteriorResult {
  const { fp, kind } = inp;
  const { w, h } = fp;
  const inM = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && fp.mask[y * w + x] === 1;
  const area = fp.mask.reduce((a, v) => a + v, 0);
  const vertical = h > w; // long axis along y
  const L = vertical ? h : w;
  const S = vertical ? w : h;
  // (x, y) → (a, b) = (along the long axis, across)
  const ab = (x: number, y: number): [number, number] => (vertical ? [y, x] : [x, y]);
  const cfg = cut(kind);
  const corridor = cfg.corridor && S >= 9 && area > 120;
  const cb0 = Math.floor(S / 2) - 1; // corridor rows (across) cb0, cb0 + 1

  // --- stairs -----------------------------------------------------------------------------
  let levels = Math.max(1, inp.levels);
  let stair: StairPlan | undefined;
  if (levels > 1) {
    const small = kind === 'house' || kind === 'kostka' || kind === 'garage' || kind === 'shed';
    const len = small ? 3 : 4;
    const cands: { s: StairPlan; score: number }[] = [];
    const [ca, cbm] = [L / 2, S / 2];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (const vert of [true, false]) {
          const variants = [uStair(x, y, len, vert, levels)];
          if (levels === 2 && small) variants.push(straightStair(x, y, len, vert));
          for (const s of variants) {
            if (!s.tiles.every(([tx, ty]) => inM(tx, ty))) continue;
            const [a, b] = ab(x, y);
            let score = -Math.hypot(a - ca, b - cbm) * 0.2 + (s.kind === 'u' ? 2 : 0);
            if (corridor) {
              // Touching the corridor along a whole side, not crossing it.
              const across = s.tiles.map(([tx, ty]) => ab(tx, ty)[1]);
              const lo = Math.min(...across);
              const hi = Math.max(...across);
              if (hi >= cb0 && lo <= cb0 + 1) continue;
              if (hi === cb0 - 1 || lo === cb0 + 2) score += 50;
            } else {
              // Small buildings: stairs against an outer wall.
              if (
                s.tiles.some(
                  ([tx, ty]) =>
                    !inM(tx - 1, ty) || !inM(tx + 1, ty) || !inM(tx, ty - 1) || !inM(tx, ty + 1),
                )
              )
                score += 5;
            }
            cands.push({ s, score });
          }
        }
      }
    }
    cands.sort((p, q) => q.score - p.score);
    stair = cands[0]?.s;
    if (!stair) levels = 1;
  }
  const stairSet = new Set((stair?.kind === 'u' ? stair.tiles : []).map(([x, y]) => `${x},${y}`));

  // --- cells ------------------------------------------------------------------------------
  const single = area <= cfg.maxSingle;
  const cellKey = (x: number, y: number): string => {
    const [a, b] = ab(x, y);
    if (stairSet.has(`${x},${y}`)) return STAIR;
    if (corridor && (b === cb0 || b === cb0 + 1)) return HALL;
    if (single) return '0';
    const band = corridor
      ? b < cb0
        ? 0
        : 1
      : S >= 9 && cfg.seg < 12
        ? b < Math.floor(S / 2)
          ? 0
          : 1
        : 0;
    const segs = Math.max(1, Math.round(L / cfg.seg));
    const seg = Math.min(segs - 1, Math.floor((a * segs) / L));
    return `${band}:${seg}`;
  };
  // Connected components per cell key → rooms.
  const room = new Int32Array(w * h).fill(-1);
  const roomKey: string[] = [];
  const roomTiles: number[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inM(x, y) || room[y * w + x]! >= 0) continue;
      const k = cellKey(x, y);
      const id = roomKey.length;
      roomKey.push(k);
      const tiles: number[] = [];
      const q = [y * w + x];
      room[y * w + x] = id;
      while (q.length) {
        const i = q.pop()!;
        tiles.push(i);
        const cx = i % w;
        const cy = (i - cx) / w;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!inM(nx, ny) || room[ny * w + nx]! >= 0 || cellKey(nx, ny) !== k) continue;
          room[ny * w + nx] = id;
          q.push(ny * w + nx);
        }
      }
      roomTiles.push(tiles);
    }
  }
  const merge = (from: number, into: number) => {
    for (const i of roomTiles[from]!) room[i] = into;
    roomTiles[into]!.push(...roomTiles[from]!);
    roomTiles[from] = [];
  };
  const neighbours = (r: number): Map<number, number> => {
    const m = new Map<number, number>();
    for (const i of roomTiles[r]!) {
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!inM(x + dx, y + dy)) continue;
        const o = room[(y + dy) * w + x + dx]!;
        if (o !== r) m.set(o, (m.get(o) ?? 0) + 1);
      }
    }
    return m;
  };
  // Slivers (< 4 tiles, or 1 tile wide) join the neighbour they share most border with.
  const sliver = (r: number) => {
    const t = roomTiles[r]!;
    if (t.length === 0 || roomKey[r] === STAIR) return false;
    if (t.length < 4) return true;
    const xs = new Set(t.map((i) => i % w));
    const ys = new Set(t.map((i) => Math.floor(i / w)));
    return (xs.size === 1 || ys.size === 1) && roomKey[r] !== HALL;
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let r = 0; r < roomTiles.length; r++) {
      if (!sliver(r)) continue;
      const nb = [...neighbours(r)]
        .filter(([o]) => roomKey[o] !== STAIR)
        .sort((p, q) => q[1] - p[1]);
      if (nb[0]) merge(r, nb[0][0]);
    }
  }

  // --- per floor: plan, doors, rooms ------------------------------------------------------
  const lk = look(kind, inp.rnd);
  let nextRoomId = inp.nextRoomId;
  const floorsOut: {
    plan: string[];
    rooms: BuildingInput['rooms'];
    openings: NonNullable<BuildingInput['openings']>;
    gaps: NonNullable<BuildingInput['gaps']>;
  }[] = [];
  const flights = stair?.flights.filter((f) => f.zFrom < levels - 1) ?? [];
  const doors: InteriorResult['doors'] = [];
  let retries = 0;
  for (let z = 0; z < levels; z++) {
    // Flights on z and stair openings from z − 1: no door beside them.
    const avoid = new Set<string>();
    for (const f of flights)
      if (f.zFrom === z || f.zFrom === z - 1)
        for (const [x, y] of flightTiles(f)) avoid.add(`${x},${y}`);
    const alive = roomTiles.map((t, i) => (t.length ? i : -1)).filter((i) => i >= 0);
    const charOf = new Map<number, string>();
    let ci = 0;
    let hallUsed = false;
    for (const r of alive) {
      // Every component gets its own char (two corridor pieces are two rooms for the door tree).
      if (roomKey[r] === STAIR) charOf.set(r, STAIR);
      else if (roomKey[r] === HALL && !hallUsed) {
        charOf.set(r, HALL);
        hallUsed = true;
      } else charOf.set(r, CHARS[ci++]!);
    }
    const plan = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => (inM(x, y) ? charOf.get(room[y * w + x]!)! : '.')).join(
        '',
      ),
    );
    // Start of the door tree: the stairwell, else the corridor, else the biggest room.
    const biggest = alive.reduce(
      (a, b) => (roomTiles[b]!.length > roomTiles[a]!.length ? b : a),
      alive[0]!,
    );
    const startRoom =
      alive.find((r) => roomKey[r] === STAIR) ?? alive.find((r) => roomKey[r] === HALL) ?? biggest;
    const start = charOf.get(startRoom)!;
    const inner = autoDoors(plan, start, avoid);
    // Rooms the tree did not reach (only touching flights / hole tiles): merged, then retried.
    const reached = new Set<string>([start]);
    for (const [x, y, e] of inner) {
      reached.add(plan[y]![x]!);
      const [dx, dy] = e === 'n' ? [0, -1] : e === 's' ? [0, 1] : e === 'e' ? [1, 0] : [-1, 0];
      reached.add(plan[y + dy]![x + dx]!);
    }
    const lost = retries < 40 ? alive.filter((r) => !reached.has(charOf.get(r)!)) : [];
    if (lost.length) retries++;
    if (lost.length && z === 0 && floorsOut.length === 0) {
      for (const r of lost) {
        const nb = [...neighbours(r)]
          .filter(([o]) => roomKey[o] !== STAIR && roomTiles[o]!.length)
          .sort((p, q) => q[1] - p[1]);
        if (nb[0]) merge(r, nb[0][0]);
      }
      z = -1; // redo from the ground floor with merged rooms
      continue;
    }
    if (lost.length) {
      // Upper floor only (different avoid set): merge for all floors and restart.
      for (const r of lost) {
        const nb = [...neighbours(r)]
          .filter(([o]) => roomKey[o] !== STAIR && roomTiles[o]!.length)
          .sort((p, q) => q[1] - p[1]);
        if (nb[0]) merge(r, nb[0][0]);
      }
      floorsOut.length = 0;
      doors.length = 0;
      nextRoomId = inp.nextRoomId;
      z = -1;
      continue;
    }
    const rooms: BuildingInput['rooms'] = {};
    const ordinary = alive.filter((r) => roomKey[r] !== STAIR && roomKey[r] !== HALL);
    // Bigger rooms first get the main use (shop floor, living room).
    ordinary.sort((a, b) => roomTiles[b]!.length - roomTiles[a]!.length || a - b);
    const typeOf = new Map<number, string>();
    ordinary.forEach((r, i) => typeOf.set(r, roomType(kind, z, i, ordinary.length, levels)));
    for (const r of alive) {
      const ch = charOf.get(r)!;
      const type = roomKey[r] === STAIR || roomKey[r] === HALL ? R('hall') : typeOf.get(r)!;
      const tile =
        type === R('kitchen') || type === R('bathroom') ? 'base:kitchen-tiles' : 'base:concrete';
      rooms[ch] = { id: nextRoomId++, type, floor: tile };
    }
    const openings: NonNullable<BuildingInput['openings']> = inner.map(([x, y, side]) => ({
      at: [x, y] as [number, number],
      side,
      type: 'door' as const,
    }));
    const gaps: NonNullable<BuildingInput['gaps']> = [];
    // Exterior edges.
    const ext: { x: number; y: number; side: Edge; along: number }[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!inM(x, y)) continue;
        for (const [dx, dy, side] of [
          [0, -1, 'n'],
          [0, 1, 's'],
          [-1, 0, 'w'],
          [1, 0, 'e'],
        ] as const) {
          if (inM(x + dx, y + dy)) continue;
          ext.push({ x, y, side, along: side === 'n' || side === 's' ? x : y });
        }
      }
    }
    const used = new Set<string>();
    if (z === 0) {
      // Entrance(s): best-scoring outer edge, preferring the stairwell aisle / corridor / main room.
      const prefer = (x: number, y: number) => {
        const c = plan[y]![x]!;
        if (avoid.has(`${x},${y}`)) return -1e9;
        if (stair?.kind === 'u' && c === STAIR) {
          // Only off the stair room's aisle / landings (never beside a flight).
          return flights.some((f) => flightTiles(f).some(([fx, fy]) => fx === x && fy === y))
            ? -1e9
            : 30;
        }
        return c === HALL ? 25 : 0;
      };
      const scored = ext
        .map((e) => ({ e, s: inp.doorScore(fp.x0 + e.x, fp.y0 + e.y, e.side) }))
        .filter((o) => o.s > 0)
        .map((o) => ({ ...o, s: o.s + prefer(o.e.x, o.e.y) }))
        .filter((o) => o.s > 0)
        .sort((p, q) => q.s - p.s);
      const want = area > 600 ? 3 : area > 250 ? 2 : 1;
      for (const o of scored) {
        if (doors.length >= want) break;
        if (doors.some((d) => Math.hypot(d.x - fp.x0 - o.e.x, d.y - fp.y0 - o.e.y) < 12)) continue;
        openings.push({
          at: [o.e.x, o.e.y],
          side: o.e.side,
          type: 'door',
          ...(kind === 'garage' || kind === 'industrial' ? {} : {}),
        });
        used.add(`${o.e.x},${o.e.y},${o.e.side}`);
        doors.push({ x: fp.x0 + o.e.x, y: fp.y0 + o.e.y, side: o.e.side });
      }
    }
    for (const e of ext) {
      if (used.has(`${e.x},${e.y},${e.side}`)) continue;
      if (kind === 'ruin' && (e.x * 7 + e.y * 13 + z) % 5 === 0) {
        gaps.push({ at: [e.x, e.y], side: e.side });
        continue;
      }
      const every =
        kind === 'shed' || kind === 'garage' || kind === 'industrial'
          ? 6
          : kind === 'shop' && z === 0
            ? 2
            : 3;
      if (e.along % every !== 1) continue;
      const shopWin =
        (kind === 'shop' || kind === 'pharmacy' || kind === 'station' || kind === 'fuel') &&
        z === 0;
      openings.push({
        at: [e.x, e.y],
        side: e.side,
        type: 'window',
        ...(shopWin ? {} : z === 0 ? {} : {}),
        ...(!shopWin && lk.window === 'base:window-shop' ? { contentId: 'base:window-plain' } : {}),
      });
    }
    floorsOut.push({ plan, rooms, openings, gaps });
  }

  const ground = floorsOut[0]!;
  const building: BuildingInput = {
    id: inp.id,
    origin: [fp.x0, fp.y0],
    plan: ground.plan,
    rooms: ground.rooms,
    wall: lk.wall,
    window: lk.window,
    door: lk.door,
    ...(lk.roof ? { roof: lk.roof } : {}),
    openings: ground.openings,
    gaps: ground.gaps,
    floors: floorsOut.slice(1).map((f, i) => ({
      z: i + 1,
      plan: f.plan,
      rooms: f.rooms,
      openings: f.openings,
      gaps: f.gaps,
    })),
  };
  const stairs: StairsInput[] = flights.map((f) => ({
    at: [fp.x0 + f.at[0], fp.y0 + f.at[1]],
    dir: f.dir,
    len: f.len,
    zFrom: f.zFrom,
  }));
  return { building, stairs, nextRoomId, levels, doors };
}
