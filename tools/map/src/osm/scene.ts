import { CHUNK_SIZE } from '@deadzone/content';
import { parseBlueprint, type Blueprint, type BlueprintInput } from '../blueprint.js';
import { furnish } from '../furnish.js';
import { LOCK_KIND_OF } from '../building-kind.js';
import { baseFurnishOptions } from '../furnish-base.js';
import { idHash } from './classify.js';
import { unflat } from './convert.js';
import { buildInterior, type Footprint } from './interior.js';
import type { AreaKind, OsmBuilding, OsmMap, RoadKind } from './types.js';

type P = readonly [number, number];

/**
 * A square cut of the OSM map as a content-map blueprint (`maps/<id>/`, `?map=<id>`): ground from
 * landuse, roads (+ sidewalks), rails, bridges with railings, buildings typed from OSM with
 * generated interiors on every storey, furniture by room type; plus the scene file for the game
 * (player, cars, framed zombies, trees from OSM, focus, attribution).
 *
 * The cut may be rotated (`rotDeg`) so the main streets run along the tile grid: tiles are 1 m,
 * scene (u, v) = R(−rot) · (p − centre) + size / 2.
 */
export interface SceneCut {
  id: string;
  /** Centre in OSM local metres. */
  cx: number;
  cy: number;
  /** Side in tiles (multiple of 32). */
  size: number;
  rotDeg: number;
  seed?: number;
}

export interface SceneVehicle {
  x: number;
  y: number;
  heading: number;
  type: string;
}

export interface SceneFile {
  map: string;
  attribution: string;
  source: string;
  /** Centre (UTM 34N), rotation and size of the cut. */
  cut: { E: number; N: number; rotDeg: number; size: number };
  focus: { x: number; y: number };
  player: { x: number; y: number; heading: number };
  zombies: { x: number; y: number; heading: number }[];
  vehicles: SceneVehicle[];
  /** Trees from OSM (single trees, rows, woods, parks): sim tiles. */
  trees: [number, number][];
  /** Viaduct deck tiles' bounding box (sim tiles). */
  landmarks: { name: string; x: number; y: number }[];
  stats: SceneStats;
}

export interface SceneStats {
  buildings: number;
  byType: Record<string, number>;
  byKind: Record<string, number>;
  typeFrom: Record<string, number>;
  levels: Record<string, number>;
  levelsFrom: Record<string, number>;
  levelsReduced: number;
  rooms: number;
  objects: number;
}

const GROUND: Partial<Record<AreaKind, string>> = {
  farmland: 'base:dirt',
  sand: 'base:dirt',
  construction: 'base:dirt',
  industrial: 'base:concrete',
  commercial: 'base:concrete',
  fuel: 'base:concrete',
  paved: 'base:sidewalk',
  parking: 'base:parking',
  railway: 'base:dirt',
  military: 'base:dirt',
};
/** Paint order (later wins). */
const AREA_ORDER: AreaKind[] = [
  'farmland',
  'meadow',
  'residential',
  'commercial',
  'industrial',
  'military',
  'railway',
  'construction',
  'orchard',
  'allotments',
  'cemetery',
  'grass',
  'park',
  'scrub',
  'forest',
  'wetland',
  'sand',
  'pitch',
  'paved',
  'fuel',
  'parking',
  'water',
];
const ROAD_ORDER: RoadKind[] = [
  'track',
  'path',
  'footway',
  'cycleway',
  'steps',
  'service',
  'residential',
  'tertiary',
  'secondary',
  'primary',
  'trunk',
  'motorway',
];
const ROAD_FLOOR = (k: RoadKind) =>
  k === 'path' || k === 'track'
    ? 'base:dirt'
    : k === 'footway' || k === 'cycleway' || k === 'steps'
      ? 'base:sidewalk'
      : 'base:asphalt';

export function buildScene(osm: OsmMap, cut: SceneCut): { blueprint: Blueprint; scene: SceneFile } {
  const S = cut.size;
  const th = (cut.rotDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const to = ([x, y]: P): [number, number] => {
    const dx = x - cut.cx;
    const dy = y - cut.cy;
    return [dx * c + dy * s + S / 2, -dx * s + dy * c + S / 2];
  };
  const toScene = (f: readonly number[]) => unflat(f).map(to);
  const near = (pts: readonly P[], m: number) =>
    pts.some(([u, v]) => u > -m && v > -m && u < S + m && v < S + m);
  const tiles: string[] = ['base:grass'];
  const tid = (t: string) => {
    const i = tiles.indexOf(t);
    return i >= 0 ? i : tiles.push(t) - 1;
  };
  const g = new Uint8Array(S * S); // ground tile index
  const inS = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S;

  const fillRings = (rings: readonly (readonly P[])[], set: (x: number, y: number) => void) => {
    let y0 = Infinity,
      y1 = -Infinity;
    for (const r of rings)
      for (const [, v] of r) {
        y0 = Math.min(y0, v);
        y1 = Math.max(y1, v);
      }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(S - 1, Math.ceil(y1)); y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (const r of rings)
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i]!;
          const [xj, yj] = r[j]!;
          if (yi > yc !== yj > yc) xs.push(xi + ((yc - yi) * (xj - xi)) / (yj - yi));
        }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (
          let x = Math.max(0, Math.ceil(xs[k]! - 0.5));
          x <= Math.min(S - 1, Math.floor(xs[k + 1]! - 0.5));
          x++
        )
          set(x, y);
      }
    }
  };
  const stroke = (pts: readonly P[], r: number, set: (x: number, y: number) => void) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!;
      const [bx, by] = pts[i]!;
      const dx = bx - ax,
        dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      for (
        let y = Math.max(0, Math.floor(Math.min(ay, by) - r));
        y <= Math.min(S - 1, Math.ceil(Math.max(ay, by) + r));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(Math.min(ax, bx) - r));
          x <= Math.min(S - 1, Math.ceil(Math.max(ax, bx) + r));
          x++
        ) {
          const px = x + 0.5,
            py = y + 0.5;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
          if (Math.hypot(px - ax - dx * t, py - ay - dy * t) <= r) set(x, y);
        }
    }
  };

  // --- ground: areas, waterways, rails, roads ---------------------------------------------
  const forestMask = new Uint8Array(S * S); // 1 forest, 2 park/cemetery/orchard
  for (const kind of AREA_ORDER) {
    for (const a of osm.areas) {
      if (a.kind !== kind) continue;
      const rings = a.rings.map(toScene);
      if (!near(rings[0]!, 0)) continue;
      const t = tid(GROUND[kind] ?? 'base:grass');
      const tree =
        kind === 'forest' || kind === 'scrub'
          ? 1
          : kind === 'park' || kind === 'cemetery' || kind === 'orchard'
            ? 2
            : 0;
      fillRings(rings, (x, y) => {
        g[y * S + x] = t;
        forestMask[y * S + x] = tree;
      });
    }
  }
  const rail = tid('base:rail');
  const railMask = new Uint8Array(S * S);
  for (const r of osm.rails) {
    if (r.bridge) continue;
    const pts = toScene(r.pts);
    if (!near(pts, 5)) continue;
    stroke(pts, 1.9, (x, y) => {
      g[y * S + x] = rail;
      railMask[y * S + x] = 1;
    });
  }
  const paintRoads = (bridge: boolean, mark?: Uint8Array) => {
    for (const kind of ROAD_ORDER) {
      for (const r of osm.roads) {
        if (r.kind !== kind || !!r.bridge !== bridge || r.tunnel) continue;
        const pts = toScene(r.pts);
        if (!near(pts, 20)) continue;
        if (r.sidewalk > 0) {
          const sw = tid('base:sidewalk');
          stroke(pts, r.width / 2 + r.sidewalk, (x, y) => {
            const cur = tiles[g[y * S + x]!];
            if (cur !== 'base:asphalt' && cur !== 'base:rail') g[y * S + x] = sw;
            if (mark) mark[y * S + x] = 1;
          });
        }
        const t = tid(ROAD_FLOOR(kind));
        stroke(pts, Math.max(0.75, r.width / 2), (x, y) => {
          // Footpaths do not cut the carriageway (crossings stay asphalt).
          if (t !== tid('base:asphalt') && tiles[g[y * S + x]!] === 'base:asphalt') return;
          g[y * S + x] = t;
          forestMask[y * S + x] = 0;
          if (mark) mark[y * S + x] = 1;
        });
      }
    }
  };
  paintRoads(false);
  const deck = new Uint8Array(S * S);
  paintRoads(true, deck);
  for (const r of osm.rails) {
    if (!r.bridge) continue;
    const pts = toScene(r.pts);
    if (near(pts, 5))
      stroke(pts, 1.9, (x, y) => {
        g[y * S + x] = rail;
        deck[y * S + x] = 1;
      });
  }

  // --- buildings ----------------------------------------------------------------------------
  const owner = new Int32Array(S * S).fill(-1);
  const cand: { b: OsmBuilding; fp: Footprint; tiles: number }[] = [];
  const sorted = [...osm.buildings].sort((a, b) => a.id - b.id);
  for (const b of sorted) {
    const rings = b.rings.map(toScene);
    if (!near(rings[0]!, 0)) continue;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [u, v] of rings[0]!) {
      x0 = Math.min(x0, u);
      y0 = Math.min(y0, v);
      x1 = Math.max(x1, u);
      y1 = Math.max(y1, v);
    }
    // Fully inside, one tile of margin (walls on the map edge are cut).
    if (x0 < 2 || y0 < 2 || x1 > S - 2 || y1 > S - 2) continue;
    const fx = Math.floor(x0),
      fy = Math.floor(y0);
    const w = Math.ceil(x1) - fx + 1,
      h = Math.ceil(y1) - fy + 1;
    const mask = new Uint8Array(w * h);
    let n = 0;
    fillRings(rings, (x, y) => {
      const t = tiles[g[y * S + x]!];
      if (owner[y * S + x]! >= 0 || t === 'base:asphalt' || t === 'base:rail' || deck[y * S + x])
        return;
      mask[(y - fy) * w + (x - fx)] = 1;
      n++;
    });
    if (n < 6) continue;
    keepLargest(mask, w, h);
    const fp: Footprint = { x0: fx, y0: fy, w, h, mask };
    let k = 0;
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) {
        owner[(fy + Math.floor(i / w)) * S + fx + (i % w)] = cand.length;
        k++;
      }
    cand.push({ b, fp, tiles: k });
  }
  // Distance (tiles) to the nearest road / sidewalk, for entrances.
  const distRoad = new Int16Array(S * S).fill(999);
  const q: number[] = [];
  for (let i = 0; i < S * S; i++) {
    const t = tiles[g[i]!];
    if (owner[i]! < 0 && (t === 'base:asphalt' || t === 'base:sidewalk' || t === 'base:parking')) {
      distRoad[i] = 0;
      q.push(i);
    }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    const x = i % S,
      y = (i - x) / S;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx,
        ny = y + dy;
      if (!inS(nx, ny)) continue;
      const j = ny * S + nx;
      if (owner[j]! >= 0 || railMask[j] || distRoad[j]! <= distRoad[i]! + 1) continue;
      distRoad[j] = distRoad[i]! + 1;
      q.push(j);
    }
  }
  const buildings: NonNullable<BlueprintInput['buildings']> = [];
  const stairs: NonNullable<BlueprintInput['stairs']> = [];
  let nextRoomId = 1;
  const st: SceneStats = {
    buildings: 0,
    byType: {},
    byKind: {},
    typeFrom: {},
    levels: {},
    levelsFrom: {},
    levelsReduced: 0,
    rooms: 0,
    objects: 0,
  };
  const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
  cand.forEach(({ b, fp }, bi) => {
    const res = buildInterior({
      id: bi + 1,
      kind: b.kind,
      levels: b.levels,
      fp,
      rnd: idHash(b.id, 3),
      nextRoomId,
      doorScore: (x, y, side) => {
        const [nx, ny] =
          side === 'n'
            ? [x, y - 1]
            : side === 's'
              ? [x, y + 1]
              : side === 'e'
                ? [x + 1, y]
                : [x - 1, y];
        if (!inS(nx, ny)) return 0;
        const j = ny * S + nx;
        if (owner[j]! >= 0 || railMask[j] || deck[j]) return 0;
        return Math.max(1, 100 - distRoad[j]! * 3);
      },
    });
    if (res.nextRoomId > 0xffff) return;
    nextRoomId = res.nextRoomId;
    const lockKind = LOCK_KIND_OF[b.kind];
    buildings.push(lockKind ? { ...res.building, kind: lockKind } : res.building);
    stairs.push(...res.stairs);
    st.buildings++;
    inc(st.byType, b.type);
    inc(st.byKind, b.kind);
    inc(st.typeFrom, b.typeFrom);
    inc(st.levels, String(res.levels));
    inc(st.levelsFrom, b.levelsFrom);
    if (res.levels < b.levels) st.levelsReduced++;
  });
  st.rooms = nextRoomId - 1;

  // --- railings on bridge decks over rails / water ----------------------------------------
  const fences: NonNullable<BlueprintInput['fences']> = [];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (!deck[y * S + x]) continue;
      for (const [dx, dy, side] of [
        [0, -1, 'n'],
        [-1, 0, 'w'],
        [0, 1, 's'],
        [1, 0, 'e'],
      ] as const) {
        const nx = x + dx,
          ny = y + dy;
        if (!inS(nx, ny) || deck[ny * S + nx] || !railMask[ny * S + nx]) continue;
        if (side === 'n' || side === 'w')
          fences.push({ x, y, side, len: 1, contentId: 'base:railing' });
        else
          fences.push({
            x: nx,
            y: ny,
            side: side === 's' ? 'n' : 'w',
            len: 1,
            contentId: 'base:railing',
          });
      }
    }

  // Ground as horizontal runs (blueprint `areas`).
  const areas: NonNullable<BlueprintInput['areas']> = [];
  for (let y = 0; y < S; y++) {
    let x = 0;
    while (x < S) {
      const t = g[y * S + x]!;
      let e = x + 1;
      while (e < S && g[y * S + e] === t) e++;
      if (t !== 0) areas.push({ x, y, w: e - x, h: 1, floor: tiles[t]! });
      x = e;
    }
  }

  // --- scene: focus, player, cars, zombies, trees -----------------------------------------
  let fxs = 0,
    fys = 0,
    fn = 0;
  for (let i = 0; i < S * S; i++)
    if (deck[i] && railMask[i]) {
      fxs += i % S;
      fys += Math.floor(i / S);
      fn++;
    }
  for (let i = 0; i < S * S && fn === 0; i++) void i;
  const focus = fn ? { x: Math.round(fxs / fn), y: Math.round(fys / fn) } : { x: S / 2, y: S / 2 };
  const ground = (x: number, y: number) => (inS(x, y) ? tiles[g[y * S + x]!] : undefined);
  const free = (x: number, y: number) => inS(x, y) && owner[y * S + x]! < 0;
  const rand = mulberry(cut.seed ?? 1);
  // Player: sidewalk tile closest to the focus, off the deck.
  let player = { x: focus.x + 0.5, y: focus.y + 0.5, heading: 0 };
  let best = Infinity;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (ground(x, y) !== 'base:sidewalk' || !free(x, y) || deck[y * S + x]) continue;
      const d = Math.hypot(x - focus.x, y - focus.y - 14);
      if (d < best) {
        best = d;
        player = { x: x + 0.5, y: y + 0.5, heading: -Math.PI / 2 };
      }
    }
  // Cars: parking lots (bays every 3 tiles), kerbside on streets near the focus.
  const vehicles: SceneVehicle[] = [];
  const blocked = new Uint8Array(S * S);
  const fits = (x: number, y: number, along: 'x' | 'y', ok: (t: string | undefined) => boolean) => {
    for (let a = -2; a <= 2; a++)
      for (let b = -1; b <= 1; b++) {
        const [tx, ty] = along === 'x' ? [x + a, y + b] : [x + b, y + a];
        if (
          !inS(tx, ty) ||
          !free(tx, ty) ||
          blocked[ty * S + tx] ||
          !ok(ground(tx, ty)) ||
          deck[ty * S + tx]
        )
          return false;
      }
    return true;
  };
  const park = (x: number, y: number, along: 'x' | 'y', heading: number) => {
    for (let a = -3; a <= 3; a++)
      for (let b = -2; b <= 2; b++) {
        const [tx, ty] = along === 'x' ? [x + a, y + b] : [x + b, y + a];
        if (inS(tx, ty)) blocked[ty * S + tx] = 1;
      }
    vehicles.push({ x: x + 0.5, y: y + 0.5, heading, type: 'base:sedan' });
  };
  for (let y = 2; y < S - 2; y += 3)
    for (let x = 3; x < S - 3; x += 5)
      if (fits(x, y, 'y', (t) => t === 'base:parking') && rand() < 0.55)
        park(x, y, 'y', rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
  // Kerbside: asphalt next to a sidewalk, along the road.
  for (let y = 1; y < S - 1; y++)
    for (let x = 3; x < S - 3; x++) {
      if (ground(x, y) !== 'base:asphalt') continue;
      const ew = ground(x, y - 1) === 'base:sidewalk' || ground(x, y + 1) === 'base:sidewalk';
      const ns = ground(x - 1, y) === 'base:sidewalk' || ground(x + 1, y) === 'base:sidewalk';
      const d = Math.hypot(x - focus.x, y - focus.y);
      // Denser near the focus (a few cars in the menu frame), sparse further out.
      if (d > 90 || rand() > (d < 40 ? 0.3 : 0.04)) continue;
      if (
        ew &&
        fits(
          x,
          y + (ground(x, y - 1) === 'base:sidewalk' ? 1 : -1),
          'x',
          (t) => t === 'base:asphalt',
        )
      )
        park(
          x,
          y + (ground(x, y - 1) === 'base:sidewalk' ? 1 : -1),
          'x',
          rand() < 0.5 ? 0 : Math.PI,
        );
      else if (
        ns &&
        fits(
          x + (ground(x - 1, y) === 'base:sidewalk' ? 1 : -1),
          y,
          'y',
          (t) => t === 'base:asphalt',
        )
      )
        park(
          x + (ground(x - 1, y) === 'base:sidewalk' ? 1 : -1),
          y,
          'y',
          rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2,
        );
    }
  // Max 64 cars per chunk (`SimChunk.vehicles`).
  const perChunk = new Map<string, number>();
  const cars = vehicles.filter((v) => {
    const k = `${Math.floor(v.x / CHUNK_SIZE)},${Math.floor(v.y / CHUNK_SIZE)}`;
    const n = (perChunk.get(k) ?? 0) + 1;
    perChunk.set(k, n);
    return n <= 64;
  });
  // Framed zombies: on open ground 11..24 tiles from the player, towards the focus.
  const zombies: SceneFile['zombies'] = [];
  for (let tries = 0; tries < 4000 && zombies.length < 8; tries++) {
    const a = rand() * Math.PI * 2;
    const r = 11 + rand() * 13;
    const x = Math.floor(player.x + Math.cos(a) * r);
    const y = Math.floor(player.y + Math.sin(a) * r);
    const t = ground(x, y);
    if (
      !free(x, y) ||
      blocked[y * S + x] ||
      deck[y * S + x] ||
      !(t === 'base:asphalt' || t === 'base:sidewalk' || t === 'base:grass')
    )
      continue;
    if (zombies.some((z) => Math.hypot(z.x - x, z.y - y) < 3)) continue;
    zombies.push({ x: x + 0.5, y: y + 0.5, heading: Math.atan2(player.y - y, player.x - x) });
  }
  // Trees: OSM single trees and rows, then woods (5 m jitter grid) and parks (9 m).
  const trees: [number, number][] = [];
  const treeOk = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = ground(x + dx, y + dy);
        if (!free(x + dx, y + dy) || (t !== 'base:grass' && t !== 'base:dirt')) return false;
      }
    return true;
  };
  const addTree = (u: number, v: number) => {
    const x = Math.floor(u),
      y = Math.floor(v);
    if (
      inS(x, y) &&
      treeOk(x, y) &&
      !trees.some(([a, b]) => Math.abs(a - u) < 2 && Math.abs(b - v) < 2)
    )
      trees.push([Math.round(u * 10) / 10, Math.round(v * 10) / 10]);
  };
  for (let i = 0; i + 1 < osm.trees.length; i += 2) {
    const [u, v] = to([osm.trees[i]! / 10, osm.trees[i + 1]! / 10]);
    addTree(u, v);
  }
  for (const row of osm.treeRows) {
    const pts = toScene(row);
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1]!;
      const [bx, by] = pts[k]!;
      const l = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d < l; d += 7) addTree(ax + ((bx - ax) * d) / l, ay + ((by - ay) * d) / l);
    }
  }
  for (const [step, kind] of [
    [5, 1],
    [9, 2],
  ] as const)
    for (let y = 0; y < S; y += step)
      for (let x = 0; x < S; x += step) {
        const u = x + rand() * step,
          v = y + rand() * step;
        if (forestMask[Math.floor(v) * S + Math.floor(u)] === kind) addTree(u, v);
      }

  const bpIn: BlueprintInput = {
    id: cut.id,
    chunks: { cx0: 0, cy0: 0, cx1: S / CHUNK_SIZE - 1, cy1: S / CHUNK_SIZE - 1 },
    ground: 'base:grass',
    areas,
    buildings,
    fences,
    stairs,
    zones: [
      {
        id: 'start',
        role: 'start',
        rects: [{ x: Math.floor(player.x) - 1, y: Math.floor(player.y) - 1, w: 3, h: 3 }],
      },
    ],
  };
  const bp = parseBlueprint(bpIn);
  const objs = furnish(bp, baseFurnishOptions(cut.seed ?? 1));
  bp.objects.push(...objs.map((o) => ({ ...o })));
  st.objects = objs.length;
  const N1 = osm.N1;
  const E = osm.E0 + cut.cx;
  const N = N1 - cut.cy;
  const scene: SceneFile = {
    map: cut.id,
    attribution: osm.attribution,
    source: osm.source,
    cut: { E: Math.round(E), N: Math.round(N), rotDeg: cut.rotDeg, size: S },
    focus,
    player: { x: player.x, y: player.y, heading: player.heading },
    zombies,
    vehicles: cars,
    trees,
    landmarks: [{ name: 'Wiadukt KEN', x: focus.x, y: focus.y }],
    stats: st,
  };
  return { blueprint: bp, scene };
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
      const x = j % w,
        y = (j - x) / w;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx,
          ny = y + dy;
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

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
