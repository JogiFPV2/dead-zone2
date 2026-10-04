import {
  CHUNK_SIZE,
  MapChunkSchema,
  STAIR_STEP,
  tileIndex,
  type EdgeType,
  type MapChunk,
  type StairDir,
} from '@deadzone/content';
import type { BuiltMap } from './build.js';

/** World-tile rectangle `[x, x + w) × [y, y + h)`. */
export interface PreviewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Edge glyphs: [horizontal (n), vertical (w)]. */
const EDGE_GLYPH: Record<EdgeType, readonly [string, string]> = {
  wall: ['-', '|'],
  window: ['=', '"'],
  door: ['d', 'd'],
  fence: ['~', '!'],
  gate: ['g', 'g'],
};
const STAIR_GLYPH: Record<StairDir, string> = { N: '^', E: '>', S: 'v', W: '<' };

export const PREVIEW_LEGEND = [
  'legenda: . podłoga, , pokój, (spacja) brak podłogi, * obiekt',
  '  krawędzie: - | ściana, = " okno, d drzwi, ~ ! płot, g brama; schody: ^ > v < (kierunek wchodzenia), S = najniższy kafel',
].join('\n');

/**
 * Editor map view: ASCII top view of level `z` of a built map, at double resolution (tile cells
 * on odd rows/columns, tile borders between them). Shows floor, rooms, objects, walls, windows,
 * doors, fences and every tile of each flight of stairs.
 */
export function renderPreview(map: BuiltMap, z = 0, rect?: PreviewRect): string {
  const chunks = map.chunks
    .map((c) => MapChunkSchema.parse(c.json))
    .filter((c) => c.address.z === z);
  if (chunks.length === 0) return `(brak chunków na piętrze ${z})`;
  const r = rect ?? bounds(chunks);
  const W = 2 * r.w + 1;
  const grid = Array.from({ length: 2 * r.h + 1 }, () => Array<string>(W).fill(' '));
  const put = (gx: number, gy: number, ch: string) => {
    if (gx >= 0 && gy >= 0 && gx < W && gy < grid.length) grid[gy]![gx] = ch;
  };
  const cell = (x: number, y: number) => [2 * (x - r.x) + 1, 2 * (y - r.y) + 1] as const;

  for (const c of chunks) {
    const ox = c.address.cx * CHUNK_SIZE;
    const oy = c.address.cy * CHUNK_SIZE;
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = tileIndex(x, y);
        if ((c.layers.floor[i] ?? 0) === 0) continue;
        const [gx, gy] = cell(ox + x, oy + y);
        put(gx, gy, (c.layers.room?.[i] ?? 0) !== 0 ? ',' : '.');
      }
    }
    for (const o of c.objects) put(...cell(ox + o.x, oy + o.y), '*');
    for (const e of c.edges) {
      const [gx, gy] = cell(ox + e.x, oy + e.y);
      const [h, v] = EDGE_GLYPH[e.type];
      if (e.side === 'n') put(gx, gy - 1, h);
      else put(gx - 1, gy, v);
    }
  }
  // Stairs last, so a flight is visible over objects; flights may run into other chunks.
  for (const c of chunks) {
    const ox = c.address.cx * CHUNK_SIZE;
    const oy = c.address.cy * CHUNK_SIZE;
    for (const s of c.stairs ?? []) {
      const [dx, dy] = STAIR_STEP[s.dir];
      for (let k = 0; k < s.len; k++) {
        put(...cell(ox + s.tx + dx * k, oy + s.ty + dy * k), k === 0 ? 'S' : STAIR_GLYPH[s.dir]);
      }
    }
  }
  return grid.map((row) => row.join('').trimEnd()).join('\n');
}

function bounds(chunks: readonly MapChunk[]): PreviewRect {
  const cx = chunks.map((c) => c.address.cx);
  const cy = chunks.map((c) => c.address.cy);
  const x = Math.min(...cx) * CHUNK_SIZE;
  const y = Math.min(...cy) * CHUNK_SIZE;
  return {
    x,
    y,
    w: (Math.max(...cx) + 1) * CHUNK_SIZE - x,
    h: (Math.max(...cy) + 1) * CHUNK_SIZE - y,
  };
}
