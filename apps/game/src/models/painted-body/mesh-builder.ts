import type { Color } from 'three';
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';

/** Bone weights of a vertex: [bone index, weight] (normalized when written, at most 4). */
export type Weights = readonly (readonly [number, number])[];

/** One cross-section of a loft: centre, width / depth axes and half sizes there. */
export interface Ring {
  c: Vector3;
  /** Width axis (unit) and half width along it. */
  u: Vector3;
  a: number;
  /** Depth axis (unit) and half depth along it. */
  v: Vector3;
  b: number;
  w: Weights;
  /** Per-vertex weights instead of `w` (a coat skirt split between the legs). */
  wAt?: (at: Vector3) => Weights;
  color: Color;
  /** Superellipse exponent (2 = ellipse, higher = boxier). */
  n?: number;
  /** Offset of the centre along v at the front (+) half only (a belly, a toe cap). */
  front?: number;
}

const p = new Vector3();

/**
 * Accumulates skinned, vertex-coloured geometry from lofts (rings joined into tubes) and boxes,
 * in bind space. Normals are computed at the end (smooth inside each part, parts separate).
 */
export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly si: number[] = [];
  private readonly sw: number[] = [];
  private readonly idx: number[] = [];

  get indexCount(): number {
    return this.idx.length;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(at: Vector3, color: Color, w: Weights): number {
    const i = this.vertexCount;
    this.pos.push(at.x, at.y, at.z);
    this.col.push(color.r, color.g, color.b);
    const top = [...w].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = top.reduce((s, x) => s + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.si.push(top[k]?.[0] ?? 0);
      this.sw.push((top[k]?.[1] ?? 0) / sum);
    }
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /**
   * Tube through `rings` with `seg` vertices around each; `capStart` / `capEnd` close the ends
   * with a fan. Winding faces outwards for rings running along u × v.
   */
  loft(rings: readonly Ring[], seg: number, capStart = false, capEnd = false): void {
    const first = this.vertexCount;
    for (const r of rings) {
      const n = r.n ?? 2;
      for (let k = 0; k < seg; k++) {
        const t = (k / seg) * Math.PI * 2;
        const cs = Math.cos(t);
        const sn = Math.sin(t);
        const x = Math.sign(cs) * Math.abs(cs) ** (2 / n);
        const y = Math.sign(sn) * Math.abs(sn) ** (2 / n);
        p.copy(r.c)
          .addScaledVector(r.u, x * r.a)
          .addScaledVector(r.v, y * r.b + (y > 0 ? (r.front ?? 0) * y : 0));
        this.vertex(p, r.color, r.wAt ? r.wAt(p) : r.w);
      }
    }
    const startTri = this.idx.length;
    for (let j = 0; j + 1 < rings.length; j++) {
      const a0 = first + j * seg;
      const b0 = a0 + seg;
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        this.tri(a0 + k, a0 + k1, b0 + k);
        this.tri(b0 + k, a0 + k1, b0 + k1);
      }
    }
    const cap = (j: number, flip: boolean) => {
      const r = rings[j]!;
      const c = this.vertex(r.c, r.color, r.w);
      const o = first + j * seg;
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        if (flip) this.tri(c, o + k1, o + k);
        else this.tri(c, o + k, o + k1);
      }
    };
    if (capStart) cap(0, true);
    if (capEnd) cap(rings.length - 1, false);
    this.orientOutwards(startTri, rings);
  }

  /**
   * Flips the triangles from `startTri` on if they face into the loft: the summed face normals
   * of the side are compared with the directions from the ring centres.
   */
  orientOutwards(startTri: number, rings: readonly Ring[]): void {
    const P = (i: number) => new Vector3(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]);
    const centre = new Vector3();
    for (const r of rings) centre.add(r.c);
    centre.divideScalar(rings.length);
    let score = 0;
    const e1 = new Vector3();
    const e2 = new Vector3();
    for (let t = startTri; t < this.idx.length; t += 3) {
      const a = P(this.idx[t]!);
      e1.subVectors(P(this.idx[t + 1]!), a);
      e2.subVectors(P(this.idx[t + 2]!), a);
      const n = e1.cross(e2);
      // Nearest ring centre as the inside point (bent limbs).
      let best = centre;
      let bd = Infinity;
      for (const r of rings) {
        const d = r.c.distanceToSquared(a);
        if (d < bd) {
          bd = d;
          best = r.c;
        }
      }
      score += n.dot(a.clone().sub(best));
    }
    if (score >= 0) return;
    for (let t = startTri; t < this.idx.length; t += 3) {
      const b = this.idx[t + 1]!;
      this.idx[t + 1] = this.idx[t + 2]!;
      this.idx[t + 2] = b;
    }
  }

  /** Axis-aligned-ish box: centre, half extents along the given axes (unit, right-handed). */
  box(
    c: Vector3,
    ax: [Vector3, Vector3, Vector3],
    half: [number, number, number],
    color: Color,
    w: Weights,
  ): void {
    const [X, Y, Z] = ax;
    const corner = (sx: number, sy: number, sz: number) =>
      p
        .copy(c)
        .addScaledVector(X, sx * half[0])
        .addScaledVector(Y, sy * half[1])
        .addScaledVector(Z, sz * half[2]);
    // 6 faces, 4 own vertices each (flat normals).
    const faces: [number, number, number][][] = [
      [
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
        [1, -1, 1],
      ],
      [
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, 1, -1],
        [-1, -1, -1],
      ],
      [
        [-1, 1, -1],
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
      ],
      [
        [-1, -1, 1],
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
      ],
      [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
      [
        [1, -1, -1],
        [-1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
      ],
    ];
    for (const f of faces) {
      const pts = f.map(([a, b, d]) => corner(a, b, d).clone());
      const n = new Vector3()
        .subVectors(pts[1]!, pts[0]!)
        .cross(new Vector3().subVectors(pts[2]!, pts[0]!));
      const out = n.dot(pts[0]!.clone().sub(c)) >= 0;
      const v = pts.map((q) => this.vertex(q, color, w));
      if (out) {
        this.tri(v[0]!, v[1]!, v[2]!);
        this.tri(v[0]!, v[2]!, v[3]!);
      } else {
        this.tri(v[0]!, v[2]!, v[1]!);
        this.tri(v[0]!, v[3]!, v[2]!);
      }
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(this.si), 4));
    g.setAttribute('skinWeight', new BufferAttribute(new Float32Array(this.sw), 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
