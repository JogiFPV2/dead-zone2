import { BufferAttribute, BufferGeometry } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE, NO_BUILDING, type BuildingId, type ChunkRange } from '../chunk.js';
import type { TownCells } from './kit.js';
import { floorLook } from './terrain-mesh.js';
import type { MapTiles } from './tiles.js';

/**
 * Upper-floor pieces of the town kit: floor slabs of levels z ≥ 1 (top in the room's floor look,
 * 0.2 m thick, holes where the floor is 0 = stair openings) and straight flights of stairs
 * (4 steps per tile; chunk `stairs` on level zFrom, zTo = zFrom + 1, rise = floor height).
 */
export const SLAB = 0.2;
export const STEPS_PER_TILE = 4;

/** Flat-shaded boxes / quads in palette cells (one welded geometry). */
export class Builder {
  readonly P: number[] = [];
  readonly UV: number[] = [];
  constructor(private readonly cells: TownCells) {}
  quad(a: number[], b: number[], c: number[], d: number[], cell: string): void {
    const u = this.cells.uv(cell);
    this.P.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) this.UV.push(...u);
  }
  /** Axis-aligned box, top in `top`, sides in `side`. */
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    top: string,
    side: string,
  ): void {
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], side);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], side);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.P), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.UV), 2));
    const m = mergeVertices(g);
    m.computeVertexNormals();
    m.computeBoundingBox();
    m.computeBoundingSphere();
    return m;
  }
}

export interface LevelPiece {
  building: BuildingId;
  /** Chunk anchor (world x / z of a tile inside it). */
  cx: number;
  cz: number;
  geo: BufferGeometry;
}

/** One slab geometry per (building, chunk) of level `tiles.z` (baseY = z · floor height). */
export function slabGeometry(
  tiles: MapTiles,
  range: ChunkRange,
  baseY: number,
  cells: TownCells,
): LevelPiece[] {
  const out: LevelPiece[] = [];
  for (let cy = range.cy0; cy <= range.cy1; cy++) {
    for (let cx = range.cx0; cx <= range.cx1; cx++) {
      const per = new Map<BuildingId, Builder>();
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const tx = cx * CHUNK_SIZE + x;
          const ty = cy * CHUNK_SIZE + y;
          const b = tiles.building(tx, ty);
          const floor = tiles.floor(tx, ty);
          if (b === NO_BUILDING || floor === undefined) continue;
          let g = per.get(b);
          if (!g) per.set(b, (g = new Builder(cells)));
          const cell = floorLook(floor, tiles.roomType(tx, ty)).cell;
          g.box(tx, baseY - SLAB, ty, tx + 1, baseY + 0.02, ty + 1, cell, 'concrete');
        }
      }
      for (const [building, g] of per) {
        out.push({ building, cx: cx * CHUNK_SIZE + 1, cz: cy * CHUNK_SIZE + 1, geo: g.geometry() });
      }
    }
  }
  return out;
}

const STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const;

/** Stair runs starting on level `tiles.z`: 4 steps per tile, rise = floor height / steps. */
export function stairsGeometry(
  tiles: MapTiles,
  range: ChunkRange,
  baseY: number,
  cells: TownCells,
  floorHeight = 3,
): LevelPiece[] {
  const out: LevelPiece[] = [];
  for (let cy = range.cy0; cy <= range.cy1; cy++) {
    for (let cx = range.cx0; cx <= range.cx1; cx++) {
      const chunk = tiles.source.getChunk(cx, cy, tiles.z);
      for (const st of chunk?.stairs ?? []) {
        const tx = cx * CHUNK_SIZE + st.tx;
        const ty = cy * CHUNK_SIZE + st.ty;
        const [dx, dy] = STEP[st.dir];
        const n = st.len * STEPS_PER_TILE;
        const g = new Builder(cells);
        for (let k = 0; k < n; k++) {
          const a = k / STEPS_PER_TILE;
          const b = (k + 1) / STEPS_PER_TILE;
          const top = baseY + ((k + 1) * floorHeight) / n;
          const [x0, x1, z0, z1] =
            dx !== 0
              ? dx > 0
                ? [tx + a, tx + b, ty + 0.1, ty + 0.9]
                : [tx + 1 - b, tx + 1 - a, ty + 0.1, ty + 0.9]
              : dy > 0
                ? [tx + 0.1, tx + 0.9, ty + a, ty + b]
                : [tx + 0.1, tx + 0.9, ty + 1 - b, ty + 1 - a];
          const riser = top - floorHeight / n;
          g.box(x0, riser - 0.02, z0, x1, top, z1, 'trim-light', 'trim-wood');
          // Stringers under the step, down to this level's floor.
          if (dx !== 0) {
            g.box(x0, baseY, z0, x1, riser, z0 + 0.06, 'trim-wood', 'trim-wood');
            g.box(x0, baseY, z1 - 0.06, x1, riser, z1, 'trim-wood', 'trim-wood');
          } else {
            g.box(x0, baseY, z0, x0 + 0.06, riser, z1, 'trim-wood', 'trim-wood');
            g.box(x1 - 0.06, baseY, z0, x1, riser, z1, 'trim-wood', 'trim-wood');
          }
        }
        out.push({
          building: tiles.building(tx, ty),
          cx: tx + 0.5,
          cz: ty + 0.5,
          geo: g.geometry(),
        });
      }
    }
  }
  return out;
}

/**
 * Shop window module (witryna, spec §2: glass 0.3–2.5 m) for the N axis: the edge runs along x
 * from −0.5 to 0.5, wall thickness `t` around z = 0. Sill and lintel in the wall cell, dark
 * mullions, glass pane (`glass` / `glass-lit`; none when broken).
 */
export function shopWindowGeometry(
  cells: TownCells,
  wall: string,
  look: { lit?: boolean; broken?: boolean },
  t = 0.2,
  height = 2.8,
): BufferGeometry {
  const g = new Builder(cells);
  const h = t / 2;
  g.box(-0.5, 0, -h, 0.5, 0.3, h, wall, wall);
  g.box(-0.5, 2.5, -h, 0.5, height, h, wall, wall);
  g.box(-0.5, 0.3, -h, -0.44, 2.5, h, 'frame-dark', 'frame-dark');
  g.box(0.44, 0.3, -h, 0.5, 2.5, h, 'frame-dark', 'frame-dark');
  g.box(-0.44, 0.3, -h * 0.8, 0.44, 0.36, h * 0.8, 'frame-dark', 'frame-dark');
  if (!look.broken) {
    const c = look.lit ? 'glass-lit' : 'glass';
    g.box(-0.44, 0.36, -0.015, 0.44, 2.5, 0.015, c, c);
  }
  return g.geometry();
}

const RAIL_H = 1.0;

/**
 * Railings around stair openings of level `tiles.z` (spec §2–3: hole with a barrier on every
 * edge to a floor tile, except the exit edge of the flight). One geometry per (building, chunk).
 */
export function railingGeometry(
  tiles: MapTiles,
  range: ChunkRange,
  baseY: number,
  cells: TownCells,
): LevelPiece[] {
  if (tiles.z <= 0) return [];
  // Exit edges: last run tile ↔ exit tile of flights from z − 1.
  const exits = new Set<string>();
  for (let cy = range.cy0; cy <= range.cy1; cy++) {
    for (let cx = range.cx0; cx <= range.cx1; cx++) {
      for (const st of tiles.source.getChunk(cx, cy, tiles.z - 1)?.stairs ?? []) {
        const [dx, dy] = STEP[st.dir];
        const lx = cx * CHUNK_SIZE + st.tx + dx * (st.len - 1);
        const ly = cy * CHUNK_SIZE + st.ty + dy * (st.len - 1);
        exits.add(`${lx},${ly},${lx + dx},${ly + dy}`);
      }
    }
  }
  const out: LevelPiece[] = [];
  const per = new Map<string, { b: BuildingId; g: Builder; cx: number; cz: number }>();
  const NB = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const;
  for (let cy = range.cy0; cy <= range.cy1; cy++) {
    for (let cx = range.cx0; cx <= range.cx1; cx++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const tx = cx * CHUNK_SIZE + x;
          const ty = cy * CHUNK_SIZE + y;
          const b = tiles.building(tx, ty);
          if (b === NO_BUILDING || tiles.floor(tx, ty) !== undefined) continue;
          for (const [dx, dy] of NB) {
            const nx = tx + dx;
            const ny = ty + dy;
            if (tiles.building(nx, ny) === NO_BUILDING || tiles.floor(nx, ny) === undefined)
              continue;
            if (exits.has(`${tx},${ty},${nx},${ny}`)) continue;
            const key = `${b}:${cx},${cy}`;
            let e = per.get(key);
            if (!e) per.set(key, (e = { b, g: new Builder(cells), cx: tx + 0.5, cz: ty + 0.5 }));
            // Barrier on the hole side of the shared edge.
            const r = 0.03;
            const [x0, z0, x1, z1] =
              dx !== 0
                ? [dx > 0 ? tx + 1 - 2 * r : tx, ty, dx > 0 ? tx + 1 : tx + 2 * r, ty + 1]
                : [tx, dy > 0 ? ty + 1 - 2 * r : ty, tx + 1, dy > 0 ? ty + 1 : ty + 2 * r];
            const top = baseY + RAIL_H;
            e.g.box(x0, top - 0.05, z0, x1, top, z1, 'rail', 'rail');
            e.g.box(x0, baseY + 0.45, z0, x1, baseY + 0.49, z1, 'rail', 'rail');
            // Posts at both ends of the edge.
            for (const [px, pz] of dx !== 0
              ? [
                  [x0, z0],
                  [x0, z1 - 2 * r],
                ]
              : [
                  [x0, z0],
                  [x1 - 2 * r, z0],
                ]) {
              e.g.box(px!, baseY, pz!, px! + 2 * r, top, pz! + 2 * r, 'rail', 'rail');
            }
          }
        }
      }
    }
  }
  for (const e of per.values())
    out.push({ building: e.b, cx: e.cx, cz: e.cz, geo: e.g.geometry() });
  return out;
}
