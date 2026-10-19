import type { GenInfra, GenPole, GenSpan } from '@deadzone/map/world-source';
import type { AttachPoint } from '@deadzone/content/wires';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { CHUNK_SIZE } from '../chunk.js';
import { MIRROR_SUFFIX, type InfraKit } from './kit.js';

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

/** World position (three x, y, z) of attach point `a` of pole `p`. Pure (tests). */
export function attachWorld(p: GenPole, a: AttachPoint): [number, number, number] {
  const lx = p.mirror ? -a.x : a.x;
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return [p.x + lx * c + a.z * s, a.y, p.y - lx * s + a.z * c];
}

/** Barrier arms of a level crossing: hinge (local x, y, z) and yaw; arm along local -z. */
export const BOOM_HINGES = [
  { x: -4.6, y: 1.25, z: 4.3, rot: 0 },
  { x: 4.6, y: 1.25, z: -4.3, rot: Math.PI },
] as const;

/**
 * Wire polylines of a span (every attach id on both poles), parabolic sag `sag` × span; the
 * contact wire (CW) hangs straight from the hangers. Flat segment pairs (x, y, z) clipped to
 * the chunk box (x0..x0 + C, z0..z0 + C): a span crossing several chunks is drawn piece by piece,
 * once. Pure (tests).
 */
export function spanSegments(
  span: GenSpan,
  attach: (model: string) => readonly AttachPoint[] | undefined,
  box: { x0: number; z0: number; size: number },
): number[] {
  const out: number[] = [];
  const pa = attach(span.a.m);
  const pb = attach(span.b.m);
  if (!pa || !pb) return out;
  for (const a of pa) {
    const b = pb.find((q) => q.id === a.id);
    if (!b) continue;
    const A = attachWorld(span.a, a);
    const B = attachWorld(span.b, b);
    const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
    const sag = a.id === 'CW' ? 0 : span.sag * len;
    const n = Math.max(6, Math.min(24, Math.ceil(len / 6)));
    const pt = (t: number): [number, number, number] => [
      A[0] + (B[0] - A[0]) * t,
      A[1] + (B[1] - A[1]) * t - 4 * sag * t * (1 - t),
      A[2] + (B[2] - A[2]) * t,
    ];
    for (let i = 0; i < n; i++) {
      const p = pt(i / n);
      const q = pt((i + 1) / n);
      const c = clip(p, q, box);
      if (c) out.push(...c);
    }
  }
  return out;
}

/** Segment p–q clipped to the box in x / z (Liang–Barsky), undefined when outside. */
function clip(
  p: [number, number, number],
  q: [number, number, number],
  b: { x0: number; z0: number; size: number },
): number[] | undefined {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dz = q[2] - p[2];
  for (const [d, e] of [
    [-dx, p[0] - b.x0],
    [dx, b.x0 + b.size - p[0]],
    [-dz, p[2] - b.z0],
    [dz, b.z0 + b.size - p[2]],
  ] as const) {
    if (d === 0) {
      if (e < 0) return undefined;
      continue;
    }
    const r = e / d;
    if (d < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 >= t1) return undefined;
  }
  const at = (t: number) => [p[0] + dx * t, p[1] + (q[1] - p[1]) * t, p[2] + dz * t];
  return [...at(t0), ...at(t1)];
}

/**
 * Power lines, railway and catenary of the streamed chunks (`GenColumn.infra`): instanced
 * models per chunk (towers, poles, track tiles, switches, buffer stops, crossings with raised
 * barrier arms, masts) and wire line segments clipped to the chunk. Render only.
 */
export class InfraLayer {
  readonly root = new Group();
  private readonly chunks = new Map<string, Group>();
  private readonly wireMat = new LineBasicMaterial({ color: 0x262829 });

  constructor(private readonly kit: InfraKit) {
    this.root.name = 'infra';
  }

  loadChunk(cx: number, cy: number, infra: GenInfra | undefined): void {
    this.unloadChunk(cx, cy);
    if (!infra) return;
    const g = new Group();
    g.name = `infra:${cx},${cy}`;
    const m = new Matrix4();
    const q = new Quaternion();
    const tilt = new Quaternion();
    const v = new Vector3();
    const s = new Vector3(1, 1, 1);
    const byModel = new Map<string, Matrix4[]>();
    const add = (id: string, mat: Matrix4) => {
      let l = byModel.get(id);
      if (!l) byModel.set(id, (l = []));
      l.push(mat);
    };
    for (const p of infra.poles) {
      const id = p.mirror ? p.m + MIRROR_SUFFIX : p.m;
      q.setFromAxisAngle(Y, p.rot);
      add(id, new Matrix4().compose(v.set(p.x, 0, p.y), q, s.set(1, 1, 1)));
      if (p.m === 'przejazd-kat-a') {
        // Barrier arms raised (open); a separate model so the sim can lower them later.
        for (const h of BOOM_HINGES) {
          const c = Math.cos(p.rot);
          const sn = Math.sin(p.rot);
          const wx = p.x + h.x * c + h.z * sn;
          const wz = p.y - h.x * sn + h.z * c;
          tilt.setFromAxisAngle(X, Math.PI / 2);
          const qq = new Quaternion().setFromAxisAngle(Y, p.rot + h.rot).multiply(tilt);
          add(
            'przejazd-rogatka-ramie',
            new Matrix4().compose(new Vector3(wx, h.y, wz), qq, new Vector3(1, 1, 1)),
          );
        }
      }
    }
    for (let i = 0; i + 3 < infra.track.length; i += 4) {
      q.setFromAxisAngle(Y, infra.track[i + 2]!);
      add(
        'tor-kafel-1m',
        new Matrix4().compose(
          v.set(infra.track[i]!, 0, infra.track[i + 1]),
          q,
          s.set(1, 1, infra.track[i + 3]),
        ),
      );
    }
    for (const [id, list] of byModel) {
      const geo = this.kit.geometries.get(id);
      if (!geo) continue;
      const mesh = new InstancedMesh(geo, this.kit.material, list.length);
      mesh.name = `infra:${id}`;
      list.forEach((mat, i) => mesh.setMatrixAt(i, mat));
      mesh.castShadow = id !== 'tor-kafel-1m';
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      g.add(mesh);
    }
    const box = { x0: cx * CHUNK_SIZE, z0: cy * CHUNK_SIZE, size: CHUNK_SIZE };
    const pts: number[] = [];
    for (const span of infra.spans)
      pts.push(...spanSegments(span, (id) => this.kit.attach.get(id), box));
    if (pts.length) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
      geo.computeBoundingSphere();
      const lines = new LineSegments(geo, this.wireMat);
      lines.name = 'infra:wires';
      g.add(lines);
    }
    m.identity();
    this.chunks.set(`${cx},${cy}`, g);
    this.root.add(g);
  }

  unloadChunk(cx: number, cy: number): void {
    const k = `${cx},${cy}`;
    const g = this.chunks.get(k);
    if (!g) return;
    this.root.remove(g);
    for (const o of g.children) {
      if (o instanceof InstancedMesh) o.dispose();
      // `instanceof LineSegments` narrows to LineSegments<any>, so geometry needs its type back.
      if (o instanceof LineSegments) (o.geometry as BufferGeometry).dispose();
    }
    this.chunks.delete(k);
  }

  /** Loaded chunks (tests). */
  get size(): number {
    return this.chunks.size;
  }
}
