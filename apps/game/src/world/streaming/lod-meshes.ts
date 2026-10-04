import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { CHUNK_SIZE, EMPTY_TILE, type ChunkData, type EdgeDef, type TileId } from '../chunk.js';
import { LEVEL_HEIGHT } from '../instances.js';
import {
  ROOF_THICKNESS,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WINDOW_HEIGHT,
} from '../structure-instances.js';
import { STRUCTURE_GREYS } from '../structures.js';
import { tileGrey } from '../terrain.js';
import { SUMMARY_CELLS, type ChunkSummary, type WorldChunk } from './source.js';

/** Fences in the mid LOD: a low slab (near draws them as openings with state). */
const FENCE_LOD_HEIGHT = 1;

/** Growable position / colour buffers of a merged, non-indexed, flat-shaded mesh. */
class MeshWriter {
  pos: number[] = [];
  col: number[] = [];
  private readonly color = new Color();
  private r = 1;
  private g = 1;
  private b = 1;

  setColor(css: string): void {
    // Linear working space (vertex colours are not colour-managed).
    this.color.set(css);
    this.r = this.color.r;
    this.g = this.color.g;
    this.b = this.color.b;
  }

  private v(x: number, y: number, z: number): void {
    this.pos.push(x, y, z);
    this.col.push(this.r, this.g, this.b);
  }

  /** Quad a-b-c-d (counter-clockwise seen from the front). */
  quad(a: V, b: V, c: V, d: V): void {
    this.v(...a);
    this.v(...b);
    this.v(...c);
    this.v(...a);
    this.v(...c);
    this.v(...d);
  }

  /** Horizontal quad facing up over [x0, x1] × [z0, z1] at height y. */
  floor(x0: number, z0: number, x1: number, z1: number, y: number): void {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]);
  }

  /** Axis-aligned box without its bottom face. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.floor(x0, z0, x1, z1, y1);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +Z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]); // -Z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); // +X
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // -X
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
type V = [number, number, number];

/** Same-id runs along each row of a CHUNK_SIZE² layer (merges floor / roof quads). */
function rowRuns(
  layer: Uint16Array,
  each: (id: TileId, x0: number, x1: number, y: number) => void,
): void {
  for (let y = 0; y < CHUNK_SIZE; y++) {
    let start = 0;
    for (let x = 1; x <= CHUNK_SIZE; x++) {
      const prev = layer[y * CHUNK_SIZE + start] ?? EMPTY_TILE;
      const cur = x < CHUNK_SIZE ? (layer[y * CHUNK_SIZE + x] ?? EMPTY_TILE) : -1;
      if (cur === prev) continue;
      if (prev !== EMPTY_TILE) each(prev, start, x, y);
      start = x;
    }
  }
}

export interface LodGeometry {
  geometry: BufferGeometry;
  triangles: number;
  bytes: number;
}

const finish = (w: MeshWriter): LodGeometry | undefined => {
  if (w.triangles === 0) return undefined;
  const geometry = w.geometry();
  // position + normal + colour, 3 floats each per vertex.
  return { geometry, triangles: w.triangles, bytes: w.pos.length * 4 * 3 };
};

/**
 * Mid LOD (vertices relative to the chunk origin `cx · 32, cy · 32`): one merged mesh per chunk (all levels) — floor runs, walls / windows at full height
 * (no cutaway, no doors), roof runs; no map objects or decor. Same placeholder colours as near.
 */
export function buildMidGeometry(
  chunk: WorldChunk,
  edgePalette: readonly (EdgeDef | null)[] | undefined,
): LodGeometry | undefined {
  const w = new MeshWriter();
  // Vertices relative to the chunk origin (the mesh sits at it: floating origin, float32 buffers).
  const ox = 0;
  const oz = 0;
  for (const [z, data] of chunk.levels) {
    const y = z * LEVEL_HEIGHT;
    rowRuns(data.floor, (id, x0, x1, row) => {
      w.setColor(tileGrey(id));
      w.floor(ox + x0, oz + row, ox + x1, oz + row + 1, y);
    });
    writeEdges(w, data, edgePalette, ox, oz, y);
    if (data.roof) {
      w.setColor(STRUCTURE_GREYS.roof);
      const top = y + WALL_HEIGHT;
      rowRuns(data.roof, (_id, x0, x1, row) =>
        w.box(ox + x0, top, oz + row, ox + x1, top + ROOF_THICKNESS, oz + row + 1),
      );
    }
  }
  return finish(w);
}

function writeEdges(
  w: MeshWriter,
  data: ChunkData,
  palette: readonly (EdgeDef | null)[] | undefined,
  ox: number,
  oz: number,
  y: number,
): void {
  const t = WALL_THICKNESS / 2;
  const layers: [Uint16Array | undefined, boolean][] = [
    [data.edgeN, true],
    [data.edgeW, false],
  ];
  for (const [layer, north] of layers) {
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const kind = palette?.[layer[i] ?? 0]?.kind;
      if (!kind || kind === 'door') continue;
      w.setColor(STRUCTURE_GREYS[kind]);
      const h =
        kind === 'window' ? WINDOW_HEIGHT : kind === 'fence' ? FENCE_LOD_HEIGHT : WALL_HEIGHT;
      const tx = ox + (i % CHUNK_SIZE);
      const tz = oz + Math.floor(i / CHUNK_SIZE);
      if (north) w.box(tx - t, y, tz - t, tx + 1 + t, y + h, tz + t);
      else w.box(tx - t, y, tz - t, tx + t, y + h, tz + 1 + t);
    }
  }
}

/** Coarse summary of a full chunk (dominant floor and building height per cell). */
export function summarize(chunk: WorldChunk): ChunkSummary {
  const n = SUMMARY_CELLS;
  const cell = CHUNK_SIZE / n;
  const ground = new Uint16Array(n * n);
  const height = new Uint8Array(n * n);
  const counts = new Map<TileId, number>();
  const base = chunk.levels.get(0) ?? chunk.levels.values().next().value;
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      counts.clear();
      let h = 0;
      for (const [z, lv] of chunk.levels) {
        let roofs = 0;
        for (let y = cy * cell; y < (cy + 1) * cell; y++) {
          for (let x = cx * cell; x < (cx + 1) * cell; x++) {
            const i = y * CHUNK_SIZE + x;
            if (lv === base) {
              const id = lv.floor[i] ?? EMPTY_TILE;
              if (id !== EMPTY_TILE) counts.set(id, (counts.get(id) ?? 0) + 1);
            }
            if ((lv.roof?.[i] ?? 0) !== 0) roofs++;
          }
        }
        // Built-up when at least a third of the cell is under a roof on that level.
        if (roofs * 3 >= cell * cell) h = Math.max(h, z + 1);
      }
      let best: TileId = EMPTY_TILE;
      let bestN = 0;
      for (const [id, c] of counts) {
        if (c > bestN || (c === bestN && id < best)) {
          best = id;
          bestN = c;
        }
      }
      ground[cy * n + cx] = best;
      height[cy * n + cx] = h;
    }
  }
  return { cx: chunk.cx, cy: chunk.cy, ground, height };
}

/** Far LOD (chunk-relative like mid): coarse ground runs plus one block per built-up cell; a few hundred triangles. */
export function buildFarGeometry(s: ChunkSummary): LodGeometry | undefined {
  const w = new MeshWriter();
  const n = SUMMARY_CELLS;
  const cell = CHUNK_SIZE / n;
  const ox = 0;
  const oz = 0;
  for (let y = 0; y < n; y++) {
    let start = 0;
    for (let x = 1; x <= n; x++) {
      const prev = s.ground[y * n + start] ?? EMPTY_TILE;
      const cur = x < n ? (s.ground[y * n + x] ?? EMPTY_TILE) : -1;
      if (cur === prev) continue;
      if (prev !== EMPTY_TILE) {
        w.setColor(tileGrey(prev));
        w.floor(ox + start * cell, oz + y * cell, ox + x * cell, oz + (y + 1) * cell, 0);
      }
      start = x;
    }
  }
  w.setColor(STRUCTURE_GREYS.roof);
  for (let i = 0; i < n * n; i++) {
    const h = s.height[i] ?? 0;
    if (h === 0) continue;
    const x0 = ox + (i % n) * cell;
    const z0 = oz + Math.floor(i / n) * cell;
    const top = (h - 1) * LEVEL_HEIGHT + WALL_HEIGHT + ROOF_THICKNESS;
    w.box(x0 + 0.25, 0, z0 + 0.25, x0 + cell - 0.25, top, z0 + cell - 0.25);
  }
  return finish(w);
}
