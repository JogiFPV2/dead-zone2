import { CHUNK_SIZE } from '@deadzone/content';
import { oRectBounds, inORect, segDist, type ORect, type Pt } from './geom.js';
import { GroundField, type Ground } from './ground.js';
import {
  ROAD_WIDTH,
  type AreaKind,
  type BuildingKind,
  type RoadClass,
  type WorldPlan,
} from './plan.js';
import { valueNoise } from './rng.js';

/** Top-down raster view: world rect from (x0, y0), `mpp` metres per pixel, w × h pixels. */
export interface MapView {
  x0: number;
  y0: number;
  mpp: number;
  w: number;
  h: number;
  /** Chunk grid lines (32 m) when zoomed in. */
  chunkGrid?: boolean;
}

type RGB = readonly [number, number, number];
const hex = (s: string): RGB => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

export const GROUND_COLOR: Record<Ground, RGB> = {
  water: hex('#3f6f8e'),
  urban: hex('#b4ae9f'),
  forest: hex('#2f4f2c'),
  meadow: hex('#8daa58'),
  pasture: hex('#7ea34e'),
  wheat: hex('#d4bf78'),
  rapeseed: hex('#d9cc4a'),
  plowed: hex('#8b6c4c'),
  corn: hex('#a6b45a'),
  fallow: hex('#a2a16a'),
  hedge: hex('#4d6b35'),
};
export const AREA_COLOR: Record<AreaKind, RGB> = {
  yard: hex('#94a865'),
  farmyard: hex('#a59a78'),
  park: hex('#6c9a4c'),
  plaza: hex('#cdc5b3'),
  parking: hex('#8e8d88'),
  base: hex('#9b9670'),
  cemetery: hex('#64824f'),
  glade: hex('#9cba62'),
  orchard: hex('#77a04a'),
  lake: hex('#3f6f8e'),
  sports: hex('#5f9e48'),
  industrial: hex('#9d988c'),
  block: hex('#bdb7a9'),
};
export const BUILDING_COLOR: Record<BuildingKind, RGB> = {
  house: hex('#b4634c'),
  tenement: hex('#9c6b55'),
  apartment: hex('#8f939c'),
  shop: hex('#c6a067'),
  office: hex('#76859a'),
  farmhouse: hex('#ad6650'),
  barn: hex('#7a5a40'),
  shed: hex('#8a7864'),
  gas: hex('#d23c2c'),
  canopy: hex('#e8e4dc'),
  hospital: hex('#f4f4f4'),
  police: hex('#3a5aa8'),
  fire: hex('#c8282a'),
  barracks: hex('#5d6a42'),
  hangar: hex('#6d7358'),
  military: hex('#4b5634'),
  industrial: hex('#85817a'),
  warehouse: hex('#9a948a'),
  church: hex('#e0cfa4'),
  school: hex('#c98f5a'),
  bar: hex('#c27c3a'),
  garage: hex('#9a9a9a'),
  station: hex('#b7a48a'),
  hut: hex('#6e5338'),
};
const ROAD_COLOR: Record<RoadClass, RGB> = {
  highway: hex('#efe6cf'),
  main: hex('#f3e9c6'),
  local: hex('#d8d1bf'),
  street: hex('#cbc6bc'),
  track: hex('#b39a73'),
  path: hex('#a58a63'),
  rail: hex('#4f4545'),
};
const MIN_PX: Record<RoadClass, number> = {
  highway: 3.4,
  main: 2.4,
  local: 1.6,
  street: 1,
  track: 1,
  path: 0.9,
  rail: 1.2,
};
const ROAD_ORDER: RoadClass[] = ['path', 'track', 'local', 'street', 'main', 'highway', 'rail'];

export function renderMap(plan: WorldPlan, v: MapView): Uint8Array {
  const img = new Uint8Array(v.w * v.h * 3);
  const field = new GroundField(plan);
  const set = (px: number, py: number, c: RGB, a = 1) => {
    if (px < 0 || py < 0 || px >= v.w || py >= v.h) return;
    const o = (py * v.w + px) * 3;
    img[o] = (img[o] ?? 0) * (1 - a) + c[0] * a;
    img[o + 1] = (img[o + 1] ?? 0) * (1 - a) + c[1] * a;
    img[o + 2] = (img[o + 2] ?? 0) * (1 - a) + c[2] * a;
  };
  // Ground (+ forest canopy texture).
  for (let py = 0; py < v.h; py++)
    for (let px = 0; px < v.w; px++) {
      const x = v.x0 + (px + 0.5) * v.mpp;
      const y = v.y0 + (py + 0.5) * v.mpp;
      const g = field.at(x, y);
      const c0 = GROUND_COLOR[g];
      const c: RGB =
        g === 'forest' || g === 'water'
          ? c0
          : [c0[0] * 0.78 + 150 * 0.22, c0[1] * 0.78 + 150 * 0.22, c0[2] * 0.78 + 110 * 0.22];
      const n =
        g === 'forest'
          ? 0.8 + valueNoise(plan.seed + 21, x / 6, y / 6) * 0.4
          : 0.95 + valueNoise(plan.seed + 22, x / 30, y / 30) * 0.1;
      set(px, py, [c[0] * n, c[1] * n, c[2] * n]);
    }
  const toPx = (x: number, y: number) => ({ x: (x - v.x0) / v.mpp, y: (y - v.y0) / v.mpp });
  const fillRect = (r: ORect, c: RGB, round = false, a = 1) => {
    const b = oRectBounds(r);
    const p0 = toPx(b.x0, b.y0);
    const p1 = toPx(b.x1, b.y1);
    if (p1.x < 0 || p1.y < 0 || p0.x > v.w || p0.y > v.h) return;
    let any = false;
    for (let py = Math.max(0, Math.floor(p0.y)); py <= Math.min(v.h - 1, Math.floor(p1.y)); py++)
      for (
        let px = Math.max(0, Math.floor(p0.x));
        px <= Math.min(v.w - 1, Math.floor(p1.x));
        px++
      ) {
        const x = v.x0 + (px + 0.5) * v.mpp;
        const y = v.y0 + (py + 0.5) * v.mpp;
        if (round) {
          const dx = x - r.x;
          const dy = y - r.y;
          const u = (dx * Math.cos(r.a) + dy * Math.sin(r.a)) / (r.w / 2);
          const w = (-dx * Math.sin(r.a) + dy * Math.cos(r.a)) / (r.h / 2);
          if (u * u + w * w > 1) continue;
        } else if (!inORect(r, x, y)) continue;
        set(px, py, c, a);
        any = true;
      }
    // Small things still show as one pixel when zoomed out.
    if (!any) {
      const p = toPx(r.x, r.y);
      set(Math.floor(p.x), Math.floor(p.y), c, a);
    }
  };
  for (const ar of plan.areas) {
    // Fence around the military base.
    if (ar.kind === 'base')
      fillRect({ ...ar, w: ar.w + 3 * v.mpp, h: ar.h + 3 * v.mpp }, hex('#3b3b30'));
    fillRect(
      ar,
      AREA_COLOR[ar.kind],
      ar.round === true,
      ar.kind === 'lake' || ar.kind === 'base' ? 1 : 0.85,
    );
  }
  // Orchard trees: dots.
  if (v.mpp <= 2)
    for (const ar of plan.areas) {
      if (ar.kind !== 'orchard' && ar.kind !== 'park' && ar.kind !== 'cemetery') continue;
      const stepM = ar.kind === 'orchard' ? 6 : 9;
      for (let u = -ar.w / 2 + 3; u < ar.w / 2; u += stepM)
        for (let w = -ar.h / 2 + 3; w < ar.h / 2; w += stepM) {
          if (
            ar.kind === 'park' &&
            valueNoise(plan.seed + 31, (ar.x + u) / 10, (ar.y + w) / 10) < 0.5
          )
            continue;
          const x = ar.x + u * Math.cos(ar.a) - w * Math.sin(ar.a);
          const y = ar.y + u * Math.sin(ar.a) + w * Math.cos(ar.a);
          fillRect({ x, y, w: 3, h: 3, a: 0 }, hex('#3f6a32'), true);
        }
    }
  // Roads: casing then fill, minor to major.
  const drawLine = (pts: readonly Pt[], widthM: number, c: RGB, minPx: number, a = 1, dash = 0) => {
    const half = Math.max(minPx, widthM / v.mpp) / 2;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const A = toPx((pts[i - 1] as Pt).x, (pts[i - 1] as Pt).y);
      const B = toPx((pts[i] as Pt).x, (pts[i] as Pt).y);
      const segLen = Math.hypot(B.x - A.x, B.y - A.y);
      const x0 = Math.floor(Math.min(A.x, B.x) - half - 1);
      const x1 = Math.ceil(Math.max(A.x, B.x) + half + 1);
      const y0 = Math.floor(Math.min(A.y, B.y) - half - 1);
      const y1 = Math.ceil(Math.max(A.y, B.y) + half + 1);
      if (x1 < 0 || y1 < 0 || x0 >= v.w || y0 >= v.h) {
        acc += segLen;
        continue;
      }
      for (let py = Math.max(0, y0); py <= Math.min(v.h - 1, y1); py++)
        for (let px = Math.max(0, x0); px <= Math.min(v.w - 1, x1); px++) {
          const h = segDist(px + 0.5, py + 0.5, A.x, A.y, B.x, B.y);
          if (h.d > half) continue;
          if (dash > 0 && Math.floor((acc + h.t * segLen) / dash) % 2 === 1) continue;
          set(px, py, c, a * Math.min(1, half - h.d + 0.5));
        }
      acc += segLen;
    }
  };
  for (const cls of ROAD_ORDER) {
    const w = ROAD_WIDTH[cls];
    for (const r of plan.roads) {
      if (r.cls !== cls) continue;
      if (cls === 'rail') {
        drawLine(r.pts, w, ROAD_COLOR.rail, 1.2);
        if (v.mpp <= 2) drawLine(r.pts, 1.5, hex('#cfc8c0'), 1, 1, 6 / v.mpp);
        continue;
      }
      const minor = cls === 'path' || cls === 'track';
      if (!minor && v.mpp <= 4) drawLine(r.pts, w + 3, hex('#5b5649'), 1.6);
      const far = v.mpp > 4;
      if (far && !minor) drawLine(r.pts, w, hex('#4a463c'), MIN_PX[cls] + 1.2, 0.8);
      drawLine(
        r.pts,
        w,
        ROAD_COLOR[cls],
        MIN_PX[cls],
        far ? (cls === 'path' ? 0.45 : cls === 'track' ? 0.75 : 1) : 1,
      );
      // Centre line on highways and main roads when close.
      if ((cls === 'highway' || cls === 'main') && v.mpp <= 1.5)
        drawLine(r.pts, 0.4, hex('#ffffff'), 0.6, 0.9, 4 / v.mpp);
    }
  }
  // River on top of roads? No: bridges = roads over water (roads drawn after ground water).
  for (const b of plan.buildings) {
    const c = BUILDING_COLOR[b.kind];
    // Darker outline when zoomed in (reads as walls / roof edges).
    if (v.mpp <= 1.5)
      fillRect({ ...b, w: b.w + 1.2 * v.mpp, h: b.h + 1.2 * v.mpp }, [
        c[0] * 0.55,
        c[1] * 0.55,
        c[2] * 0.55,
      ]);
    fillRect(b, v.mpp > 4 ? [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7] : c);
    if (b.kind === 'hospital' && v.mpp <= 2) {
      fillRect({ x: b.x, y: b.y, w: 7, h: 2.2, a: b.a }, hex('#d42a2a'));
      fillRect({ x: b.x, y: b.y, w: 2.2, h: 7, a: b.a }, hex('#d42a2a'));
    }
  }
  // Chunk grid (32 m) and 1 km grid.
  if (v.chunkGrid)
    for (let py = 0; py < v.h; py++)
      for (let px = 0; px < v.w; px++) {
        const x = v.x0 + px * v.mpp;
        const y = v.y0 + py * v.mpp;
        const onChunk =
          Math.floor(x / CHUNK_SIZE) !== Math.floor((x + v.mpp) / CHUNK_SIZE) ||
          Math.floor(y / CHUNK_SIZE) !== Math.floor((y + v.mpp) / CHUNK_SIZE);
        if (onChunk) set(px, py, [255, 255, 255], 0.22);
      }
  for (let py = 0; py < v.h; py++)
    for (let px = 0; px < v.w; px++) {
      const x = v.x0 + px * v.mpp;
      const y = v.y0 + py * v.mpp;
      if (
        Math.floor(x / 1024) !== Math.floor((x + v.mpp) / 1024) ||
        Math.floor(y / 1024) !== Math.floor((y + v.mpp) / 1024)
      )
        set(px, py, [255, 255, 255], 0.22);
    }
  // Scale bar: 1 km (or 100 m when close), bottom-left.
  const barM = v.mpp > 3 ? 1000 : v.mpp > 0.6 ? 200 : 50;
  const barPx = Math.round(barM / v.mpp);
  for (let py = v.h - 22; py < v.h - 14; py++)
    for (let px = 16; px < 16 + barPx; px++)
      set(px, py, Math.floor((px - 16) / (barPx / 4)) % 2 === 0 ? [20, 20, 20] : [245, 245, 245]);
  return img;
}
