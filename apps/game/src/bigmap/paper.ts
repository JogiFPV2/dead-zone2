import { CHUNK_SIZE, tileIndex, type ChunkRange, type ChunkSource } from '../world/chunk.js';
import type { Bounds } from './bigmap-model.js';

/** Paper map colours (mockup bigmap.png). */
export const PAPER = {
  base: [230, 216, 180],
  field: [221, 212, 166],
  dirt: [214, 196, 154],
  path: [207, 194, 160],
  parking: [200, 190, 166],
  road: [200, 116, 60],
  roadEdge: [142, 74, 37],
  building: [94, 85, 75],
  floor: [120, 110, 98],
  water: [146, 172, 176],
  rail: [70, 64, 58],
} as const;

export type PaperKind = keyof typeof PAPER;
type Kind = PaperKind;

/** Floor tile id → paper class (unknown / indoor tiles read as building floor). */
export function paperKind(id: string | null | undefined): Kind | undefined {
  if (!id) return undefined;
  if (/water/.test(id)) return 'water';
  if (/rail/.test(id)) return 'rail';
  if (/asphalt|road/.test(id)) return 'road';
  if (/parking/.test(id)) return 'parking';
  if (/sidewalk|path/.test(id)) return 'path';
  if (/dirt|soil|sand/.test(id)) return 'dirt';
  if (/grass/.test(id)) return 'field';
  return 'floor';
}

export interface PaperMap {
  canvas: HTMLCanvasElement;
  /** World rectangle the canvas covers (metres). */
  bounds: Bounds;
  /** Canvas px per metre. */
  scale: number;
}

/** Deterministic hash noise 0..1. */
const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/**
 * Ground floor of the loaded map drawn as a paper map: fields, paths, roads with darker edges,
 * building blocks, paper grain. At most 4096 px on a side (large worlds sample tiles).
 */
export function renderPaper(
  source: ChunkSource,
  range: ChunkRange,
  isBuilding: (x: number, y: number) => boolean,
): PaperMap {
  const bounds = {
    x0: range.cx0 * CHUNK_SIZE,
    y0: range.cy0 * CHUNK_SIZE,
    x1: (range.cx1 + 1) * CHUNK_SIZE,
    y1: (range.cy1 + 1) * CHUNK_SIZE,
  };
  const wm = bounds.x1 - bounds.x0;
  const hm = bounds.y1 - bounds.y0;
  const scale = Math.min(1, 4096 / Math.max(wm, hm));
  const w = Math.max(1, Math.round(wm * scale));
  const h = Math.max(1, Math.round(hm * scale));
  const kinds = new Uint8Array(w * h);
  const order = Object.keys(PAPER) as Kind[];
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = Math.floor(bounds.x0 + (px + 0.5) / scale);
      const y = Math.floor(bounds.y0 + (py + 0.5) / scale);
      const c = source.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), range.z);
      let k: Kind = 'base';
      if (c) {
        const id =
          source.tilePalette[
            c.floor[tileIndex(x - c.coord.cx * CHUNK_SIZE, y - c.coord.cy * CHUNK_SIZE)] ?? 0
          ];
        k = isBuilding(x, y) ? 'building' : (paperKind(id) ?? 'base');
      }
      kinds[py * w + px] = order.indexOf(k);
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, bounds, scale };
  const img = ctx.createImageData(w, h);
  const road = order.indexOf('road');
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      let k = order[kinds[i]!]!;
      if (k === 'road') {
        const edge =
          (px > 0 && kinds[i - 1] !== road) ||
          (px < w - 1 && kinds[i + 1] !== road) ||
          (py > 0 && kinds[i - w] !== road) ||
          (py < h - 1 && kinds[i + w] !== road);
        if (edge) k = 'roadEdge';
      }
      const col = PAPER[k];
      const n = (hash(px, py) - 0.5) * 14 + (hash(px >> 3, py >> 3) - 0.5) * 10;
      img.data[i * 4] = col[0] + n;
      img.data[i * 4 + 1] = col[1] + n;
      img.data[i * 4 + 2] = col[2] + n * 0.8;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, bounds, scale };
}
