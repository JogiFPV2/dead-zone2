import {
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE } from '../chunk.js';
import { LEVEL_HEIGHT } from '../instances.js';
import type { DecorInstance } from './source.js';

/** PLACEHOLDER decor shapes until Silnik 2 ships decor models (keyed by content id pattern). */
interface DecorShape {
  geometry: () => BufferGeometry;
  color: string;
  castShadow: boolean;
}
const SHAPES: Record<'tree' | 'bush' | 'rock', DecorShape> = {
  tree: {
    geometry: () =>
      mergeGeometries([
        new CylinderGeometry(0.12, 0.16, 1.2, 6).translate(0, 0.6, 0),
        new ConeGeometry(1.1, 3.2, 7).translate(0, 2.6, 0),
      ]),
    color: '#3d5a3a',
    castShadow: true,
  },
  bush: {
    geometry: () => new IcosahedronGeometry(0.55, 0).translate(0, 0.4, 0),
    color: '#4a6b40',
    castShadow: false,
  },
  rock: {
    geometry: () => new DodecahedronGeometry(0.4, 0).translate(0, 0.2, 0),
    color: '#6d6f70',
    castShadow: false,
  },
};
const shapeOf = (kind: string): keyof typeof SHAPES =>
  /tree|pine|oak/.test(kind) ? 'tree' : /rock|stone/.test(kind) ? 'rock' : 'bush';

/**
 * Near-ring decor (client-only props / plants): one InstancedMesh per kind per chunk, with
 * geometry and material shared across chunks (cached for the session, never per chunk).
 */
export class DecorLayer {
  readonly root = new Group();
  private readonly shared = new Map<
    string,
    { geometry: BufferGeometry; material: MeshStandardMaterial; tris: number }
  >();
  private readonly chunks = new Map<string, InstancedMesh[]>();

  constructor() {
    this.root.name = 'decor';
  }

  get loadedChunks(): number {
    return this.chunks.size;
  }

  /** Returns instance-buffer bytes and triangles of the chunk. */
  load(
    cx: number,
    cy: number,
    decor: readonly DecorInstance[],
  ): { bytes: number; triangles: number } {
    this.unload(cx, cy);
    const byShape = new Map<keyof typeof SHAPES, DecorInstance[]>();
    for (const d of decor) {
      const s = shapeOf(d.kind);
      let list = byShape.get(s);
      if (!list) byShape.set(s, (list = []));
      list.push(d);
    }
    const meshes: InstancedMesh[] = [];
    let bytes = 0;
    let triangles = 0;
    for (const [shape, list] of byShape) {
      const sh = this.sharedFor(shape);
      const mesh = new InstancedMesh(sh.geometry, sh.material, list.length);
      list.forEach((d, i) => {
        pos.set(cx * CHUNK_SIZE + d.x, d.z * LEVEL_HEIGHT, cy * CHUNK_SIZE + d.y);
        quat.setFromAxisAngle(UP, d.rot);
        mesh.setMatrixAt(i, m4.compose(pos, quat, scale.setScalar(d.scale)));
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = SHAPES[shape].castShadow;
      mesh.receiveShadow = true;
      mesh.name = `decor-${shape}@${cx},${cy}`;
      meshes.push(mesh);
      this.root.add(mesh);
      bytes += list.length * 64;
      triangles += list.length * sh.tris;
    }
    this.chunks.set(`${cx},${cy}`, meshes);
    return { bytes, triangles };
  }

  unload(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    for (const m of this.chunks.get(key) ?? []) {
      this.root.remove(m);
      m.dispose();
    }
    this.chunks.delete(key);
  }

  dispose(): void {
    for (const key of [...this.chunks.keys()]) {
      const [cx, cy] = key.split(',').map(Number);
      this.unload(cx!, cy!);
    }
    for (const s of this.shared.values()) {
      s.geometry.dispose();
      s.material.dispose();
    }
    this.shared.clear();
  }

  private sharedFor(shape: keyof typeof SHAPES) {
    let s = this.shared.get(shape);
    if (!s) {
      const geometry = SHAPES[shape].geometry();
      const material = new MeshStandardMaterial({
        color: SHAPES[shape].color,
        roughness: 0.9,
        flatShading: true,
      });
      const tris =
        (geometry.index ? geometry.index.count : geometry.attributes.position!.count) / 3;
      this.shared.set(shape, (s = { geometry, material, tris }));
    }
    return s;
  }
}

const UP = new Vector3(0, 1, 0);
const pos = new Vector3();
const quat = new Quaternion();
const scale = new Vector3();
const m4 = new Matrix4();
