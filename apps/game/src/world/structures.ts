import { BoxGeometry, Group, InstancedMesh, type MeshStandardMaterial } from 'three';
import { placeholderMaterial } from '../lighting/materials.js';
import { BuildingLookup } from './building-lookup.js';
import type { ChunkRange, ChunkSource, EdgeKind } from './chunk.js';
import { NO_CUTAWAY, cutawayKey, isEdgeLowered, isRoofHidden, type Cutaway } from './cutaway.js';
import { LEVEL_HEIGHT } from './instances.js';
import {
  collectEdges,
  collectRoofs,
  edgeHeight,
  writeEdgeMatrix,
  writeRoofMatrix,
  type EdgeGroup,
  type RoofGroup,
} from './structure-instances.js';

/** Neutral grey placeholders (grey-box stage). */
export const STRUCTURE_GREYS: Readonly<Record<EdgeKind | 'roof', string>> = {
  wall: '#6b7178',
  window: '#8a9097',
  door: '#6b7178',
  fence: '#7a6146',
  roof: '#50565e',
};

interface Part {
  /** Chunk key `cx,cy,z` (streaming unload). */
  chunk: string;
  mesh: InstancedMesh;
  baseY: number;
  edges?: EdgeGroup;
  roof?: RoofGroup;
}

/** Walls (one InstancedMesh per edge type per chunk) and roofs (per roof type per chunk). */
export class Structures {
  readonly root = new Group();
  readonly lookup: BuildingLookup;
  private readonly geometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly parts: Part[] = [];
  private key = '';
  private cutaway: Cutaway = NO_CUTAWAY;

  /** `cacheLookup: false` for streamed sources (see BuildingLookup). */
  constructor(
    private readonly source: ChunkSource,
    cacheLookup = true,
  ) {
    this.root.name = 'structures';
    this.lookup = new BuildingLookup(source, cacheLookup);
  }

  loadRange(range: ChunkRange): void {
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) this.loadChunk(cx, cy, range.z);
    }
    this.key = '';
    this.setCutaway(NO_CUTAWAY);
  }

  loadChunk(cx: number, cy: number, z: number): void {
    const chunk = this.source.getChunk(cx, cy, z);
    if (!chunk) return;
    this.unloadChunk(cx, cy, z);
    const key = `${cx},${cy},${z}`;
    const baseY = z * LEVEL_HEIGHT;
    const kindOf = (id: number) => this.source.edgePalette?.[id]?.kind;
    for (const edges of collectEdges(chunk, kindOf, this.lookup)) {
      const name = this.source.edgePalette?.[edges.edgeId]?.id ?? `edge:${edges.edgeId}`;
      this.add(
        { chunk: key, baseY, edges },
        edges.edges.length,
        edges.kind,
        `${name}@${cx},${cy},${z}`,
      );
    }
    for (const roof of collectRoofs(chunk, this.lookup)) {
      const name = this.source.tilePalette[roof.roofId] ?? `roof:${roof.roofId}`;
      this.add({ chunk: key, baseY, roof }, roof.tiles.length, 'roof', `${name}@${cx},${cy},${z}`);
    }
  }

  /** Instance buffers of a loaded chunk's walls and roofs (the box geometry is shared). */
  statsOf(cx: number, cy: number, z: number): { bytes: number; triangles: number } {
    const key = `${cx},${cy},${z}`;
    let n = 0;
    for (const p of this.parts) if (p.chunk === key) n += p.mesh.count;
    return { bytes: n * 64, triangles: n * 12 };
  }

  /** Removes a chunk's walls and roofs and frees their instance buffers. */
  unloadChunk(cx: number, cy: number, z: number): void {
    const key = `${cx},${cy},${z}`;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]!;
      if (p.chunk !== key) continue;
      this.root.remove(p.mesh);
      p.mesh.dispose();
      this.parts.splice(i, 1);
    }
  }

  get partCount(): number {
    return this.parts.length;
  }

  /** Rewrites instance matrices only when the cutaway (building, tile, camera side) changes. */
  setCutaway(c: Cutaway): void {
    const key = cutawayKey(c);
    if (key === this.key) return;
    this.key = key;
    this.cutaway = c;
    for (const p of this.parts) this.write(p, c);
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.root.clear();
    this.parts.length = 0;
  }

  private add(p: Omit<Part, 'mesh'>, count: number, kind: EdgeKind | 'roof', name: string): void {
    const mesh = new InstancedMesh(this.geometry, this.material(kind), count);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const part = { ...p, mesh };
    // Bounds from the full (uncut) layout; chunks streamed in later then get the current cutaway.
    this.write(part, NO_CUTAWAY);
    mesh.computeBoundingSphere();
    if (this.cutaway !== NO_CUTAWAY) this.write(part, this.cutaway);
    this.parts.push(part);
    this.root.add(mesh);
  }

  private write({ mesh, baseY, edges, roof }: Part, c: Cutaway): void {
    const m = mesh.instanceMatrix.array as Float32Array;
    edges?.edges.forEach((e, i) => {
      const lowered = isEdgeLowered(c, e.building, e.axis, e.tx, e.ty);
      writeEdgeMatrix(m, i * 16, e, baseY, edgeHeight(edges.kind, lowered));
    });
    roof?.tiles.forEach((t, i) =>
      writeRoofMatrix(m, i * 16, t, baseY, isRoofHidden(c, t.building)),
    );
    mesh.instanceMatrix.needsUpdate = true;
  }

  private material(kind: EdgeKind | 'roof'): MeshStandardMaterial {
    let m = this.materials.get(kind);
    if (!m) {
      m = placeholderMaterial(STRUCTURE_GREYS[kind]);
      this.materials.set(kind, m);
    }
    return m;
  }
}
