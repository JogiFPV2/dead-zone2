import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { NearbyContainerView } from '@deadzone/protocol';
import { simToWorld } from '../sim/coords.js';
import type { ChunkRange, ChunkSource } from './chunk.js';
import { CHUNK_SIZE } from './chunk.js';
import { MARKER_GEOMETRY, MARKER_MATERIAL, animateMarker } from './ground-piles.js';

/** Box size [w, h, d] per content id (PLACEHOLDER shapes until models). */
const SIZES: Record<string, [number, number, number]> = {
  'base:fridge': [0.75, 1.8, 0.7],
  'base:freezer': [0.9, 0.9, 0.7],
  'base:kitchen-cabinet': [0.9, 0.9, 0.6],
  'base:kitchen-counter': [0.95, 0.9, 0.6],
  'base:wardrobe': [0.95, 1.9, 0.6],
  'base:dresser': [0.9, 1.0, 0.5],
  'base:bookshelf': [0.95, 1.9, 0.35],
  'base:wooden-chest': [0.9, 0.55, 0.55],
  'base:crate': [0.85, 0.7, 0.85],
  'base:metal-shelf': [0.95, 1.8, 0.45],
  'base:tool-chest': [0.7, 0.8, 0.45],
  'base:locker': [0.5, 1.8, 0.5],
  'base:gun-locker': [0.8, 1.8, 0.5],
};
const DEFAULT_SIZE: [number, number, number] = [0.8, 0.8, 0.8];

interface Obj {
  contentId: string;
  height: number;
  tx: number;
  ty: number;
  z: number;
  mesh: Mesh;
  material: MeshStandardMaterial;
  marker: Mesh;
  markerY: number;
}

/**
 * PLACEHOLDER map objects (chunk `objects`: storage and furniture) as grey boxes. Storage in
 * reach that this player has not searched yet gets a floating marker; searched storage is darker.
 */
export class MapObjects {
  readonly root = new Group();
  private readonly objects: Obj[] = [];
  private lastNearby: readonly NearbyContainerView[] | undefined;
  private readonly searched = new Set<string>();

  constructor(source: ChunkSource, range: ChunkRange) {
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        {
          const z = range.z;
          const chunk = source.getChunk(cx, cy, z);
          for (const o of chunk?.objects ?? []) {
            const [w, h, d] = SIZES[o.contentId] ?? DEFAULT_SIZE;
            const material = new MeshStandardMaterial({ color: 0x8c9196, roughness: 0.8 });
            const mesh = new Mesh(new BoxGeometry(w, h, d), material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const tx = cx * CHUNK_SIZE + o.x;
            const ty = cy * CHUNK_SIZE + o.y;
            const p = simToWorld(tx + 0.5, ty + 0.5, z);
            mesh.position.set(p.x, p.y + h / 2, p.z);
            mesh.rotation.y = (-o.rot * Math.PI) / 2;
            const marker = new Mesh(MARKER_GEOMETRY, MARKER_MATERIAL);
            const markerY = p.y + h + 0.45;
            marker.position.set(p.x, markerY, p.z);
            marker.visible = false;
            this.root.add(mesh, marker);
            this.objects.push({
              contentId: o.contentId,
              height: h,
              tx,
              ty,
              z,
              mesh,
              material,
              marker,
              markerY,
            });
          }
        }
      }
    }
  }

  /** Swaps the grey boxes for models where `model(contentId, height)` has one. */
  applyModels(model: (contentId: string, height: number) => Object3D | undefined): void {
    for (const o of this.objects) {
      const m = model(o.contentId, o.height);
      if (!m) continue;
      m.position.set(o.mesh.position.x, o.mesh.position.y - o.height / 2, o.mesh.position.z);
      m.rotation.y = o.mesh.rotation.y;
      o.mesh.visible = false;
      this.root.add(m);
    }
  }

  get count(): number {
    return this.objects.length;
  }

  update(nearby: readonly NearbyContainerView[], nowMs: number): void {
    if (nearby !== this.lastNearby) {
      this.lastNearby = nearby;
      const unsearched = new Set<string>();
      for (const n of nearby) {
        if (n.kind !== 'world') continue;
        const key = `${n.x},${n.y},${n.z}`;
        if (n.searched) this.searched.add(key);
        else unsearched.add(key);
      }
      for (const o of this.objects) {
        const key = `${o.tx},${o.ty},${o.z}`;
        o.marker.visible = unsearched.has(key);
        o.material.color.setHex(this.searched.has(key) ? 0x5d6266 : 0x8c9196);
      }
    }
    for (const o of this.objects) {
      if (o.marker.visible) animateMarker(o.marker, o.markerY, true, nowMs);
    }
  }
}
