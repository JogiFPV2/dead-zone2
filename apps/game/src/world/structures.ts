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
const GREYS: Record<EdgeKind | 'roof', string> = {
  wall: '#6b7178',
  window: '#8a9097',
  door: '#6b7178',
  roof: '#50565e',
};

interface Part {
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

  constructor(private readonly source: ChunkSource) {
    this.root.name = 'structures';
    this.lookup = new BuildingLookup(source);
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
    const baseY = z * LEVEL_HEIGHT;
    const kindOf = (id: number) => this.source.edgePalette?.[id]?.kind;
    for (const edges of collectEdges(chunk, kindOf, this.lookup)) {
      const name = this.source.edgePalette?.[edges.edgeId]?.id ?? `edge:${edges.edgeId}`;
      this.add({ baseY, edges }, edges.edges.length, edges.kind, `${name}@${cx},${cy},${z}`);
    }
    for (const roof of collectRoofs(chunk, this.lookup)) {
      const name = this.source.tilePalette[roof.roofId] ?? `roof:${roof.roofId}`;
      this.add({ baseY, roof }, roof.tiles.length, 'roof', `${name}@${cx},${cy},${z}`);
    }
  }

  /** Rewrites instance matrices only when the cutaway (building, tile, camera side) changes. */
  setCutaway(c: Cutaway): void {
    const key = cutawayKey(c);
    if (key === this.key) return;
    this.key = key;
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
    this.write(part, NO_CUTAWAY);
    mesh.computeBoundingSphere();
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
      m = placeholderMaterial(GREYS[kind]);
      this.materials.set(kind, m);
    }
    return m;
  }
}
