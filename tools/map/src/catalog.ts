import type { BlueprintInput } from './blueprint.js';

/**
 * Building catalogue (`deadzone-buildings-spec.md` §1–2, Designer sheet `town-building-sheet.png`):
 * 12 types with footprint W×D in tiles (1 tile = 1 m), floors (3 m each), floor plans with room
 * types, facades and stairs. A type may have several parts (house + garage, shop + canopy).
 *
 * Facades: one string per side and floor (1 char = 1 m, repeated when shorter; the last string
 * repeats for higher floors):
 *   `w` / `.` wall · `o` / `x` / `k` window · `s` shop window · `d` / `g` door · `S` glass door ·
 *   `R` gap (ruin, no wall at all).
 * Doors above the ground floor become windows. Interior doors are added automatically: one door
 * per edge of a spanning tree of the room graph (from the room under the first exterior door),
 * plus explicit `innerDoors`.
 *
 * Stairs (contract with Physics / Simulation: z = floor index, a flight goes zFrom → zFrom + 1):
 * - `straight`: one flight of `len` tiles from `at` in `dir`, on every floor from zFrom.
 * - `u`: switchback in a 3-tile-wide stair room — flights alternate between two columns and
 *   directions per floor, the third column is the landing / aisle (spec §2 „schody U”).
 *
 * `placeCatalog` rotates a type by 90° steps and returns blueprint buildings + world stairs.
 */
export type Side = 'N' | 'S' | 'W' | 'E';
type Dir = 'N' | 'E' | 'S' | 'W';
type Edge = 'n' | 's' | 'e' | 'w';
type BuildingInput = NonNullable<BlueprintInput['buildings']>[number];
type StairsInput = NonNullable<BlueprintInput['stairs']>[number];
type OpeningInput = NonNullable<BuildingInput['openings']>[number];
type GapInput = NonNullable<BuildingInput['gaps']>[number];

export interface CatalogRoom {
  type: string;
  floor: string;
}

export interface CatalogStairs {
  kind: 'straight' | 'u';
  /** Bottom tile of the first flight (part-local). */
  at: [number, number];
  dir: Dir;
  len: number;
  /** First level (default 0) and number of flights (default: up to the top floor). */
  zFrom?: number;
  flights?: number;
}

export interface CatalogPart {
  /** Part-local offset inside the type (tiles). */
  at: [number, number];
  w: number;
  d: number;
  floors: number;
  wall: string;
  roof?: string;
  /** No generated walls (canopy). */
  walls?: boolean;
  fac: Partial<Record<Side, string[]>>;
  /** Ground-floor plan (rows of room keys); default one room `A`. */
  plan?: string[];
  /** Plans of floors z = 1, 2, … (last one repeats); default = ground plan. */
  upper?: string[][];
  rooms?: Record<string, CatalogRoom>;
  innerDoors?: [number, number, Edge, number?][];
  stairs?: CatalogStairs;
}

export interface CatalogType {
  id: string;
  label: string;
  /** Overall footprint (all parts). */
  w: number;
  d: number;
  floors: number;
  parts: CatalogPart[];
}

export const pat = (n: number, base: string, ov: Record<number, string> = {}): string => {
  let s = '';
  for (let i = 0; i < n; i++) s += ov[i] ?? base[i % base.length];
  return s;
};
const rows = (n: number, s: string): string[] => Array.from({ length: n }, () => s);
const R = (type: string, floor = 'base:concrete'): CatalogRoom => ({ type: `base:${type}`, floor });

const WOOD = 'base:concrete';
const TILES = 'base:kitchen-tiles';

export const CATALOG: Record<string, CatalogType> = {
  hospital: {
    id: 'hospital',
    label: 'Szpital powiatowy',
    w: 18,
    d: 13,
    floors: 4,
    parts: [
      {
        at: [0, 0],
        w: 18,
        d: 13,
        floors: 4,
        wall: 'base:wall-hospital',
        roof: 'base:roof-felt',
        fac: {
          S: [pat(18, 'oow', { 8: 'S', 9: 'S' }), pat(18, 'oow')],
          E: [pat(13, 'ow', { 6: 'g' }), pat(13, 'ow')],
          N: ['woo'],
          W: ['wo'],
        },
        // Z0: ER, pharmacy, reception | corridor | U stairs, waiting room, toilets.
        plan: [
          ...rows(5, 'EEEEEEEPPPPRRRRRRR'),
          ...rows(2, 'CCCCCCCCCCCCCCCCCC'),
          ...rows(6, 'UUUWWWWWWWWWWWBBBB'),
        ],
        // Z1–Z3: wards and offices on both sides of the middle corridor, drug store.
        upper: [
          [
            ...rows(5, 'FFFFFGGGGGHHHHHMMM'),
            ...rows(2, 'CCCCCCCCCCCCCCCCCC'),
            ...rows(6, 'UUUIIIIIJJJJJOOOOO'),
          ],
        ],
        rooms: {
          E: R('room-hospital'),
          P: R('room-pharmacy'),
          R: R('room-office'),
          C: R('room-hospital'),
          U: R('room-hospital'),
          W: R('room-hospital'),
          B: R('room-bathroom', TILES),
          F: R('room-hospital'),
          G: R('room-hospital'),
          H: R('room-hospital'),
          M: R('room-pharmacy'),
          I: R('room-hospital'),
          J: R('room-hospital'),
          O: R('room-office'),
        },
        stairs: { kind: 'u', at: [0, 11], dir: 'N', len: 4 },
      },
    ],
  },
  school: {
    id: 'school',
    label: 'Szkoła podstawowa',
    w: 22,
    d: 10,
    floors: 3,
    parts: [
      {
        at: [0, 0],
        w: 22,
        d: 10,
        floors: 3,
        wall: 'base:wall-school',
        roof: 'base:roof-tile',
        fac: {
          S: [pat(22, 'oow', { 10: 'd', 11: 'd' }), pat(22, 'oow')],
          E: [pat(10, 'ow')],
          N: ['oow'],
          W: ['ow'],
        },
        // Z0: kitchen, canteen, teachers, office | corridor | cloakroom, hall | U stairs.
        plan: [
          ...rows(4, 'KKKKKJJJJJJJJTTTTSSSSS'),
          ...rows(2, 'CCCCCCCCCCCCCCCCCCCUUU'),
          ...rows(4, 'LLLLLLLLLAAAAAAAAAAUUU'),
        ],
        // Z1–Z2: classrooms on both sides, staff room, WC.
        upper: [
          [
            ...rows(4, 'DDDDDDDEEEEEEENNNNWWWW'),
            ...rows(2, 'CCCCCCCCCCCCCCCCCCCUUU'),
            ...rows(4, 'FFFFFFFGGGGGGGHHHHHUUU'),
          ],
        ],
        rooms: {
          K: R('room-kitchen', TILES),
          J: R('room-school'),
          T: R('room-office'),
          S: R('room-office'),
          C: R('room-school'),
          U: R('room-school'),
          L: R('room-school'),
          A: R('room-school'),
          D: R('room-school'),
          E: R('room-school'),
          N: R('room-office'),
          W: R('room-bathroom', TILES),
          F: R('room-school'),
          G: R('room-school'),
          H: R('room-school'),
        },
        stairs: { kind: 'u', at: [19, 8], dir: 'N', len: 4 },
      },
    ],
  },
  gym: {
    id: 'gym',
    label: 'Sala gimnastyczna',
    w: 9,
    d: 9,
    floors: 1,
    parts: [
      {
        at: [0, 0],
        w: 9,
        d: 9,
        floors: 1,
        wall: 'base:brick-wall',
        roof: 'base:roof-felt',
        fac: {
          E: [pat(9, 'wo', { 2: 'd' })],
          S: ['wwo'],
          N: ['ow'],
          W: ['ow'],
        },
        plan: [...rows(6, 'HHHHHHHHH'), ...rows(3, 'SSSSMMMMM')],
        rooms: { H: R('room-gym', WOOD), S: R('room-bathroom', TILES), M: R('room-gym') },
      },
    ],
  },
  'gas-station': {
    id: 'gas-station',
    label: 'Stacja paliw + sklep 24h',
    w: 13,
    d: 11,
    floors: 1,
    parts: [
      {
        at: [6, 0],
        w: 7,
        d: 5,
        floors: 1,
        wall: 'base:wall-gas',
        roof: 'base:roof-felt',
        fac: { S: ['ssSssww'], W: ['ws'], N: ['w'], E: ['wwdww'] },
        plan: [...rows(3, 'SSSSSZZ'), ...rows(2, 'SSSSSWW')],
        rooms: {
          S: R('room-gas-station'),
          Z: R('room-warehouse'),
          W: R('room-bathroom', TILES),
        },
      },
      {
        // Fuel canopy: roof on stilts (no walls).
        at: [0, 5],
        w: 13,
        d: 6,
        floors: 1,
        walls: false,
        wall: 'base:wall-gas',
        roof: 'base:roof-flat',
        fac: {},
        rooms: { A: R('room-gas-station', 'base:parking') },
      },
    ],
  },
  police: {
    id: 'police',
    label: 'Komisariat policji',
    w: 10,
    d: 10,
    floors: 2,
    parts: [
      {
        at: [0, 0],
        w: 10,
        d: 10,
        floors: 2,
        wall: 'base:wall-police',
        roof: 'base:roof-felt',
        fac: {
          E: [pat(10, 'ow', { 4: 'g', 5: 'g' }), pat(10, 'o')],
          S: [pat(10, 'wo', { 7: 'S' }), pat(10, 'o')],
          N: ['wo'],
          W: ['wo'],
        },
        // Z0: interrogation, 2 cells | corridor with the stairs | duty desk, waiting room.
        plan: [...rows(3, 'QQQQXXXYYY'), ...rows(3, 'CCCCCCCCCC'), ...rows(4, 'DDDDDPPPPP')],
        // Z1: offices | corridor | armoury, lockers.
        upper: [[...rows(3, 'AAAAABBBBB'), ...rows(3, 'CCCCCCCCCC'), ...rows(4, 'GGGGGLLLLL')]],
        rooms: {
          Q: R('room-police'),
          X: R('room-police'),
          Y: R('room-police'),
          C: R('room-police'),
          D: R('room-police'),
          P: R('room-office'),
          A: R('room-office'),
          B: R('room-office'),
          G: R('room-police'),
          L: R('room-police'),
        },
        stairs: { kind: 'straight', at: [8, 4], dir: 'W', len: 4 },
      },
    ],
  },
  grocery: {
    id: 'grocery',
    label: 'Sklep spożywczy',
    w: 12,
    d: 12,
    floors: 1,
    parts: [
      {
        at: [0, 0],
        w: 12,
        d: 12,
        floors: 1,
        wall: 'base:wall-shop',
        roof: 'base:roof-felt',
        fac: {
          E: [pat(12, 's', { 0: 'w', 4: 'S', 5: 'S', 9: 'w', 10: 'w', 11: 'w' })],
          S: [pat(12, 'w', { 2: 'o', 9: 'd' })],
          N: ['w'],
          W: ['w'],
        },
        plan: [...rows(9, 'SSSSSSSSSSSS'), ...rows(3, 'MMMMMMMMOOOO')],
        rooms: { S: R('room-shop'), M: R('room-warehouse'), O: R('room-office') },
      },
    ],
  },
  pharmacy: {
    id: 'pharmacy',
    label: 'Apteka (kamienica)',
    w: 8,
    d: 8,
    floors: 2,
    parts: [
      {
        at: [0, 0],
        w: 8,
        d: 8,
        floors: 2,
        wall: 'base:wall-pharmacy',
        roof: 'base:roof-tile',
        fac: {
          S: ['ssSsssod', 'owowowow'],
          E: ['owwowwow', 'owowowow'],
          N: ['wowowowo'],
          W: ['wowowowo'],
        },
        // Z0: pharmacy + back room, stair hall to the flat. Z1: flat.
        plan: [...rows(2, 'ZZZZZZHH'), ...rows(6, 'AAAAAAHH')],
        upper: [[...rows(4, 'LLLLLLHH'), ...rows(4, 'KKKKBBHH')]],
        rooms: {
          Z: R('room-warehouse'),
          A: R('room-pharmacy'),
          H: R('room-living-room'),
          L: R('room-living-room'),
          K: R('room-kitchen', TILES),
          B: R('room-bathroom', TILES),
        },
        stairs: { kind: 'straight', at: [7, 6], dir: 'N', len: 3 },
      },
    ],
  },
  house: {
    id: 'house',
    label: 'Dom parterowy',
    w: 9,
    d: 8,
    floors: 1,
    parts: [
      {
        at: [0, 0],
        w: 9,
        d: 8,
        floors: 1,
        wall: 'base:siding-green',
        roof: 'base:roof-gable',
        fac: { S: [pat(9, 'wo', { 6: 'd' })], E: [pat(8, 'wo')], N: ['wo'], W: ['wo'] },
        plan: [...rows(4, 'LLLLLKKKK'), ...rows(4, 'BBBBBHHWW')],
        rooms: {
          L: R('room-living-room'),
          K: R('room-kitchen', TILES),
          B: R('room-bedroom'),
          H: R('room-living-room'),
          W: R('room-bathroom', TILES),
        },
      },
    ],
  },
  kostka: {
    id: 'kostka',
    label: 'Dom piętrowy (kostka)',
    w: 8,
    d: 8,
    floors: 2,
    parts: [
      {
        at: [0, 0],
        w: 8,
        d: 8,
        floors: 2,
        wall: 'base:wall-kostka',
        roof: 'base:roof-tile',
        fac: {
          S: ['owdoowow', 'owowowow'],
          E: ['wowwwowo'],
          N: ['wowowowo'],
          W: ['wowowowo'],
        },
        // Z0: kitchen, living room, hall with the stairs; Z1: 2 bedrooms, bathroom, landing.
        plan: [...rows(3, 'KKKKLLLL'), ...rows(5, 'HHHHHHHH')],
        upper: [[...rows(3, 'BBBBCCCC'), ...rows(5, 'DDDDHHHH')]],
        rooms: {
          K: R('room-kitchen', TILES),
          L: R('room-living-room'),
          H: R('room-living-room'),
          B: R('room-bedroom'),
          C: R('room-bedroom'),
          D: R('room-bathroom', TILES),
        },
        stairs: { kind: 'straight', at: [7, 6], dir: 'N', len: 3 },
      },
    ],
  },
  'house-garage': {
    id: 'house-garage',
    label: 'Dom z garażem',
    w: 12,
    d: 8,
    floors: 1,
    parts: [
      {
        at: [0, 0],
        w: 7,
        d: 8,
        floors: 1,
        wall: 'base:siding-blue',
        roof: 'base:roof-gable',
        fac: { S: [pat(7, 'wo', { 5: 'd' })], W: ['wo'], N: ['wo'], E: ['ow'] },
        plan: [...rows(4, 'LLLLKKK'), ...rows(4, 'BBBWWHH')],
        rooms: {
          L: R('room-living-room'),
          K: R('room-kitchen', TILES),
          B: R('room-bedroom'),
          W: R('room-bathroom', TILES),
          H: R('room-living-room'),
        },
      },
      {
        at: [7, 0],
        w: 5,
        d: 4,
        floors: 1,
        wall: 'base:siding-blue',
        roof: 'base:roof-shingles',
        fac: { S: ['wgggw'], E: ['wow'], N: ['w'], W: ['w'] },
        rooms: { A: R('room-garage') },
        // Door into the kitchen (shared wall).
        innerDoors: [[0, 2, 'w']],
      },
    ],
  },
  shack: {
    id: 'shack',
    label: 'Rudera',
    w: 5,
    d: 4,
    floors: 1,
    parts: [
      {
        at: [0, 0],
        w: 5,
        d: 4,
        floors: 1,
        wall: 'base:wall-plank',
        roof: 'base:roof-corrugated',
        fac: { E: ['wdxw'], S: ['xwwkx'], N: ['wxw'], W: ['w'] },
        rooms: { A: R('room-garage') },
      },
    ],
  },
  ruin: {
    id: 'ruin',
    label: 'Ruina (spalony dom)',
    w: 8,
    d: 7,
    floors: 1,
    parts: [
      {
        at: [0, 0],
        w: 8,
        d: 7,
        floors: 1,
        wall: 'base:wall-burnt',
        fac: { N: ['wRRwwRww'], S: ['wwRRRwkw'], E: ['wRwwRRw'], W: ['wwRwwkw'] },
        plan: [...rows(4, 'AAAAAAAA'), ...rows(3, 'AAAABBBB')],
        rooms: { A: R('room-ruin'), B: R('room-ruin') },
        innerDoors: [[5, 4, 'n']],
      },
    ],
  },
};

/** Building types of the catalogue (order of the Designer sheet). */
export const CATALOG_IDS = Object.keys(CATALOG);

/** Edge of the facade char `i` on `side` (part-local tile + side). */
function sideTile(p: CatalogPart, side: Side, i: number): [number, number, Edge] {
  switch (side) {
    case 'N':
      return [i, 0, 'n'];
    case 'S':
      return [i, p.d - 1, 's'];
    case 'W':
      return [0, i, 'w'];
    default:
      return [p.w - 1, i, 'e'];
  }
}

const OPENING: Record<string, { type: 'window' | 'door'; contentId?: string } | undefined> = {
  o: { type: 'window' },
  x: { type: 'window' },
  k: { type: 'window' },
  s: { type: 'window', contentId: 'base:window-shop' },
  d: { type: 'door' },
  g: { type: 'door' },
  S: { type: 'door', contentId: 'base:door-glass' },
};

const planOf = (p: CatalogPart, z: number): string[] => {
  const ground = p.plan ?? rows(p.d, 'A'.repeat(p.w));
  if (z === 0 || !p.upper?.length) return ground;
  return p.upper[Math.min(z - 1, p.upper.length - 1)] ?? ground;
};

/** Facade openings and gaps of floor `z`. */
export function facadeOpenings(
  p: CatalogPart,
  z: number,
): { openings: OpeningInput[]; gaps: GapInput[] } {
  const openings: OpeningInput[] = [];
  const gaps: GapInput[] = [];
  if (p.walls === false) return { openings, gaps };
  for (const side of ['N', 'S', 'W', 'E'] as const) {
    const strings = p.fac[side] ?? ['wo'];
    const s = strings[Math.min(z, strings.length - 1)] ?? 'w';
    const n = side === 'N' || side === 'S' ? p.w : p.d;
    for (let i = 0; i < n; i++) {
      const ch = s[i % s.length] ?? 'w';
      const [x, y, sd] = sideTile(p, side, i);
      if (ch === 'R') {
        gaps.push({ at: [x, y], side: sd });
        continue;
      }
      const o = OPENING[ch];
      if (!o) continue;
      // Doors above the ground floor open onto nothing: windows there.
      if (o.type === 'door' && z > 0) {
        openings.push({ at: [x, y], side: sd, type: 'window' });
        continue;
      }
      openings.push({
        at: [x, y],
        side: sd,
        type: o.type,
        ...(o.contentId ? { contentId: o.contentId } : {}),
      });
    }
  }
  return { openings, gaps };
}

const NB: [number, number, Edge][] = [
  [0, -1, 'n'],
  [0, 1, 's'],
  [-1, 0, 'w'],
  [1, 0, 'e'],
];

/**
 * Interior doors of a plan: BFS over the room adjacency graph from `start`, one door per new room
 * in the middle of the shared border (tiles in `avoid` are never used, e.g. stair runs).
 */
export function autoDoors(
  plan: readonly string[],
  start: string,
  avoid: ReadonlySet<string> = new Set(),
): [number, number, Edge][] {
  const at = (x: number, y: number) => {
    const ch = plan[y]?.[x];
    return ch === undefined || ch === '.' || ch === ' ' ? undefined : ch;
  };
  const shared = new Map<string, [number, number, Edge][]>();
  plan.forEach((row, y) => {
    [...row].forEach((a, x) => {
      if (!at(x, y)) return;
      for (const [dx, dy, e] of NB.slice(1, 2).concat(NB.slice(3))) {
        const b = at(x + dx, y + dy);
        if (!b || b === a) continue;
        if (avoid.has(`${x},${y}`) || avoid.has(`${x + dx},${y + dy}`)) continue;
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        let list = shared.get(k);
        if (!list) shared.set(k, (list = []));
        list.push([x, y, e]);
      }
    });
  });
  const keys = [...new Set(plan.join('').replace(/[. ]/g, ''))].sort();
  const seen = new Set([start]);
  const queue = [start];
  const out: [number, number, Edge][] = [];
  while (queue.length > 0) {
    const a = queue.shift()!;
    for (const b of keys) {
      if (seen.has(b)) continue;
      const list = shared.get(a < b ? `${a}|${b}` : `${b}|${a}`);
      if (!list?.length) continue;
      seen.add(b);
      queue.push(b);
      out.push(list[Math.floor(list.length / 2)]!);
    }
  }
  return out;
}

const STEP: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPP: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Part-local flights {at, dir, len, zFrom} of a part's stairs. */
export function partFlights(
  p: CatalogPart,
): { at: [number, number]; dir: Dir; len: number; zFrom: number }[] {
  const st = p.stairs;
  if (!st) return [];
  const z0 = st.zFrom ?? 0;
  const n = st.flights ?? p.floors - 1 - z0;
  const out: { at: [number, number]; dir: Dir; len: number; zFrom: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (st.kind === 'straight' || i % 2 === 0) {
      out.push({ at: st.at, dir: st.dir, len: st.len, zFrom: z0 + i });
      continue;
    }
    // U: the return flight starts next to the top of the first one, one column over.
    const [dx, dy] = STEP[st.dir];
    const top: [number, number] = [st.at[0] + dx * (st.len - 1), st.at[1] + dy * (st.len - 1)];
    const side: [number, number] = dx === 0 ? [1, 0] : [0, 1];
    out.push({
      at: [top[0] + side[0], top[1] + side[1]],
      dir: OPP[st.dir],
      len: st.len,
      zFrom: z0 + i,
    });
  }
  return out;
}

/** Tiles of every flight of a part on level z (stairs on z, holes from z − 1). */
function stairTiles(p: CatalogPart, z: number): Set<string> {
  const out = new Set<string>();
  for (const f of partFlights(p)) {
    if (f.zFrom !== z && f.zFrom !== z - 1) continue;
    const [dx, dy] = STEP[f.dir];
    for (let k = 0; k < f.len; k++) out.add(`${f.at[0] + dx * k},${f.at[1] + dy * k}`);
  }
  return out;
}

// --- rotation (90° clockwise steps, +x east / +y south) -----------------------------------

const ROT_EDGE: Record<Edge, Edge> = { n: 'e', e: 's', s: 'w', w: 'n' };
const ROT_DIR: Record<Dir, Dir> = { N: 'E', E: 'S', S: 'W', W: 'N' };

/** One clockwise turn of a W×D local frame: (x, y) → (D − 1 − y, x). */
const rotXy = (x: number, y: number, d: number): [number, number] => [d - 1 - y, x];
const rotPlan = (plan: readonly string[]): string[] => {
  const d = plan.length;
  const w = Math.max(...plan.map((r) => r.length));
  return Array.from({ length: w }, (_, x) =>
    Array.from({ length: d }, (_, ny) => plan[d - 1 - ny]?.[x] ?? '.').join(''),
  );
};

interface Local {
  w: number;
  d: number;
  plan: string[];
  floors: { plan: string[]; openings: OpeningInput[]; gaps: GapInput[] }[];
  stairs: { at: [number, number]; dir: Dir; len: number; zFrom: number }[];
}

function rotateLocal(l: Local): Local {
  const r = (a: [number, number]) => rotXy(a[0], a[1], l.d);
  return {
    w: l.d,
    d: l.w,
    plan: rotPlan(l.plan),
    floors: l.floors.map((f) => ({
      plan: rotPlan(f.plan),
      openings: f.openings.map((o) => ({ ...o, at: r(o.at), side: ROT_EDGE[o.side] })),
      gaps: f.gaps.map((g) => ({ at: r(g.at), side: ROT_EDGE[g.side] })),
    })),
    stairs: l.stairs.map((s) => ({ ...s, at: r(s.at), dir: ROT_DIR[s.dir] })),
  };
}

export interface CatalogPlaced {
  buildings: BuildingInput[];
  stairs: StairsInput[];
  /** World footprint of the whole type (after rotation). */
  rect: { x: number; y: number; w: number; h: number };
  nextBuildingId: number;
  nextRoomId: number;
}

/** First room key behind an exterior door of the ground floor (BFS start for interior doors). */
function entryRoom(plan: readonly string[], openings: readonly OpeningInput[]): string {
  for (const o of openings) {
    if (o.type !== 'door') continue;
    const ch = plan[o.at[1]]?.[o.at[0]];
    if (ch && ch !== '.') return ch;
  }
  return plan.join('').replace(/[. ]/g, '')[0] ?? 'A';
}

/**
 * Places catalogue type `t` with its NW corner at world tile `origin`, rotated `rot` × 90°
 * clockwise. Building ids from `buildingId0`, room ids from `roomId0` (each floor its own rooms).
 */
export function placeCatalog(
  t: CatalogType,
  origin: [number, number],
  rot: number,
  buildingId0: number,
  roomId0: number,
): CatalogPlaced {
  const turns = ((rot % 4) + 4) % 4;
  let bid = buildingId0;
  let next = roomId0;
  const buildings: BuildingInput[] = [];
  const stairs: StairsInput[] = [];
  // Rotate part offsets inside the type frame.
  for (const p of t.parts) {
    const floors = Array.from({ length: p.floors }, (_, z) => {
      const plan = planOf(p, z);
      const fac = facadeOpenings(p, z);
      const stairsHere = stairTiles(p, z);
      const start = z === 0 ? entryRoom(plan, fac.openings) : (plan[0]?.[0] ?? 'A');
      const doors = p.walls === false ? [] : autoDoors(plan, start, stairsHere);
      const explicit = (p.innerDoors ?? []).filter(([, , , dz]) => dz === undefined || dz === z);
      const inner: OpeningInput[] = [...doors, ...explicit].map(([x, y, side]) => ({
        at: [x, y],
        side,
        type: 'door',
      }));
      // Upper floors start from the stair room (the BFS root must be reachable).
      if (z > 0 && p.stairs) {
        const s = partFlights(p).find((f) => f.zFrom === z - 1);
        const ch = s ? plan[s.at[1]]?.[s.at[0]] : undefined;
        if (ch) {
          inner.length = 0;
          for (const [x, y, side] of [...autoDoors(plan, ch, stairsHere), ...explicit]) {
            inner.push({ at: [x, y], side, type: 'door' });
          }
        }
      }
      return { plan, openings: [...fac.openings, ...inner], gaps: fac.gaps };
    });
    let l: Local = {
      w: p.w,
      d: p.d,
      plan: floors[0]!.plan,
      floors,
      stairs: partFlights(p),
    };
    // Part offset in the rotated type frame.
    let off: [number, number] = p.at;
    let tw = t.w;
    let td = t.d;
    for (let i = 0; i < turns; i++) {
      l = rotateLocal(l);
      // NW corner of the part after the turn: the old SW corner (x0, y0 + d − 1) maps there.
      const [nx, ny] = rotXy(off[0], off[1] + (i === 0 ? p.d : rotDepth(p, i)) - 1, td);
      off = [nx, ny];
      [tw, td] = [td, tw];
    }
    const o: [number, number] = [origin[0] + off[0], origin[1] + off[1]];
    const roomsOf = (plan: readonly string[]) =>
      Object.fromEntries(
        [...new Set(plan.join('').replace(/[. ]/g, ''))].map((k) => {
          const r = p.rooms?.[k] ?? R('room-warehouse');
          return [k, { id: next++, type: r.type, floor: r.floor }];
        }),
      );
    const ground = l.floors[0]!;
    buildings.push({
      id: bid++,
      origin: o,
      plan: ground.plan,
      rooms: roomsOf(ground.plan),
      wall: p.wall,
      window: 'base:window-plain',
      door: 'base:door-plain',
      ...(p.roof ? { roof: p.roof } : {}),
      ...(p.walls === false ? { walls: false } : {}),
      openings: ground.openings,
      gaps: ground.gaps,
      floors: l.floors.slice(1).map((f, i) => ({
        z: i + 1,
        plan: f.plan,
        rooms: roomsOf(f.plan),
        openings: f.openings,
        gaps: f.gaps,
      })),
    });
    for (const s of l.stairs) {
      stairs.push({ at: [o[0] + s.at[0], o[1] + s.at[1]], dir: s.dir, len: s.len, zFrom: s.zFrom });
    }
  }
  const odd = turns % 2 === 1;
  return {
    buildings,
    stairs,
    rect: { x: origin[0], y: origin[1], w: odd ? t.d : t.w, h: odd ? t.w : t.d },
    nextBuildingId: bid,
    nextRoomId: next,
  };
}

/** Depth (y extent) of a part after `i` clockwise turns. */
const rotDepth = (p: CatalogPart, i: number): number => (i % 2 === 0 ? p.d : p.w);
