import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Color,
  Group,
  InstancedMesh,
  LineDashedMaterial,
  Matrix4,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  SpotLight,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SnapshotVehicle } from '@deadzone/protocol';
import { simToWorld } from '../sim/coords.js';
import type { HudVehicleType } from '../hud/content-index.js';
import type { RealCarModel } from '../render/real/real-car.js';

/**
 * PLACEHOLDER cars (no car models yet; Designer sends them later): a low body box, a cabin, four
 * wheels, head- and tail-lights, one spot light per car with `headlights` on. Plus the dashed
 * accent ellipse on the ground under the car the F key targets (spec §2 „Cel”).
 *
 * Draw calls: a car is 11 meshes (+ shadow passes). Parked cars (still, lights off, brake off,
 * tyres whole) are drawn instead as instances of their type's merged geometry: two
 * `InstancedMesh`es per type (paint with a per-instance colour, the rest vertex-coloured), so a
 * street of parked cars costs a few draw calls. A car that moves or lights up gets its own group.
 */

const ACCENT = 0xf0c06a;
const PAINT = [0x9a4c38, 0x3f6a4e, 0x4e6274, 0x8a7a55, 0x734260];
const WHEEL_R = 0.32;

interface CarMesh {
  root: Group;
  /** Drawn as an instance of its type (parked); the group is hidden. */
  parked: boolean;
  body: Group;
  head: MeshStandardMaterial;
  tail: MeshStandardMaterial;
  light: SpotLight;
  wheels: Mesh[];
  /** Latest and previous pose (interpolated between snapshots). */
  cur: SnapshotVehicle;
  prev: SnapshotVehicle;
  at: number;
}

const wheelGeo = new CylinderGeometry(WHEEL_R, WHEEL_R, 0.22, 14);
wheelGeo.rotateX(Math.PI / 2);
const wheelMat = new MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.9 });
const glassMat = new MeshStandardMaterial({ color: 0x23323b, roughness: 0.2, metalness: 0.3 });

/** Marks a mesh whose geometry / material belong to someone else (the realistic style's car). */
const SHARED = 'dzSharedCar';

function buildCar(t: HudVehicleType, id: number, real?: RealCarModel): CarMesh {
  const root = new Group();
  root.name = `car-${id}`;
  const body = new Group();
  root.add(body);
  const L = t.length;
  const W = t.width;
  if (real) {
    // Realistic style: Designer's sedan (wheels modelled in), shared geometry and material.
    const car = new Mesh(real.geometryFor(t), real.material);
    car.name = 'car-pbr';
    car.castShadow = true;
    car.receiveShadow = true;
    car.userData[SHARED] = true;
    body.add(car);
  } else {
    const paint = new MeshStandardMaterial({
      color: PAINT[id % PAINT.length] ?? 0x7a3b2e,
      roughness: 0.55,
      metalness: 0.15,
    });
    const lower = new Mesh(new BoxGeometry(L, 0.55, W), paint);
    lower.position.y = WHEEL_R + 0.22;
    const cabin = new Mesh(new BoxGeometry(L * 0.5, 0.48, W * 0.86), paint);
    cabin.position.set(-L * 0.06, WHEEL_R + 0.74, 0);
    const glass = new Mesh(new BoxGeometry(L * 0.52, 0.36, W * 0.88), glassMat);
    glass.position.copy(cabin.position);
    glass.position.y -= 0.02;
    body.add(lower, glass, cabin);
    for (const m of [lower, cabin]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  }
  const head = new MeshStandardMaterial({
    color: 0xe8e2c8,
    emissive: 0xfff1c0,
    emissiveIntensity: 0.2,
  });
  const tail = new MeshStandardMaterial({
    color: 0x5a1612,
    emissive: 0xc8453c,
    emissiveIntensity: 0.2,
  });
  for (const side of [-1, 1]) {
    const h = new Mesh(new BoxGeometry(0.04, 0.12, 0.32), head);
    h.position.set(L / 2 + 0.01, WHEEL_R + 0.3, side * (W / 2 - 0.25));
    const tl = new Mesh(new BoxGeometry(0.04, 0.12, 0.3), tail);
    tl.position.set(-L / 2 - 0.01, WHEEL_R + 0.32, side * (W / 2 - 0.22));
    body.add(h, tl);
  }
  const wheels: Mesh[] = [];
  const wx = L / 2 - 0.75;
  // FL, FR, RL, RR (nose +x, left = −z in sim terms is +y… local −z is the car's left side).
  // The realistic sedan has its own wheels (no spin / flat tyre in that pilot).
  for (const [x, z] of real
    ? []
    : ([
        [wx, -W / 2 + 0.12],
        [wx, W / 2 - 0.12],
        [-wx, -W / 2 + 0.12],
        [-wx, W / 2 - 0.12],
      ] as const)) {
    const wh = new Mesh(wheelGeo, wheelMat);
    wh.position.set(x, WHEEL_R, z);
    wh.castShadow = true;
    root.add(wh);
    wheels.push(wh);
  }
  const light = new SpotLight(0xfff1d0, 0, 22, 0.55, 0.6, 1.2);
  light.position.set(L / 2, WHEEL_R + 0.35, 0);
  const aim = new Object3D();
  aim.position.set(L / 2 + 8, -0.5, 0);
  light.target = aim;
  root.add(light, aim);
  const zero = {} as SnapshotVehicle;
  return { root, body, head, tail, light, wheels, parked: false, cur: zero, prev: zero, at: 0 };
}

/** Frees a car's own geometry and materials (wheel / glass geometry and materials are shared). */
function disposeCar(m: CarMesh): void {
  m.root.traverse((o) => {
    if (!(o instanceof Mesh) || o.userData[SHARED]) return;
    const mesh = o as Mesh<BufferGeometry, MeshStandardMaterial>;
    if (mesh.geometry !== wheelGeo) mesh.geometry.dispose();
    const mat = mesh.material;
    if (mat !== wheelMat && mat !== glassMat) mat.dispose();
  });
  m.light.dispose();
}

const paintInstanceMat = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
const restInstanceMat = new MeshStandardMaterial({ roughness: 0.6, vertexColors: true });

/**
 * Merged geometry of a car type (built once from a car group): paint parts, and the rest with its
 * colour baked into vertex colours (glass, wheels, lights off).
 */
function mergedCar(t: HudVehicleType): { paint: BufferGeometry; rest: BufferGeometry } {
  const car = buildCar(t, 0);
  car.root.updateMatrixWorld(true);
  const paint: BufferGeometry[] = [];
  const rest: BufferGeometry[] = [];
  const paintMat = (car.body.children[0] as Mesh).material;
  car.root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const g = (o.geometry as BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    g.deleteAttribute('uv');
    if (o.material === paintMat) {
      paint.push(g);
      return;
    }
    const c = (o.material as MeshStandardMaterial).color;
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    rest.push(g);
  });
  disposeCar(car);
  const merged = {
    paint: mergeGeometries(paint) ?? new BufferGeometry(),
    rest: mergeGeometries(rest) ?? new BufferGeometry(),
  };
  for (const g of [...paint, ...rest]) g.dispose();
  return merged;
}

/** No driver, still, unlit, no brake light, tyres whole: drawn as an instance. */
function isParked(v: SnapshotVehicle): boolean {
  return (
    Math.abs(v.speed) < 1e-3 &&
    !v.driverId &&
    !v.headlights &&
    !v.brakeLight &&
    !(v.tires ?? []).some((t) => t <= 0)
  );
}

/** Dashed ellipse (car outline + margin) in the car's local frame, on the ground. */
function buildTarget(): Group {
  const g = new Group();
  const pts: number[] = [];
  const n = 72;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(Math.cos(a), 0, Math.sin(a));
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const line = new LineLoop(
    geo,
    new LineDashedMaterial({
      color: ACCENT,
      dashSize: 0.09,
      gapSize: 0.07,
      transparent: true,
      opacity: 0.75,
    }),
  );
  line.computeLineDistances();
  const fill = new Mesh(
    new RingGeometry(0, 1, 48),
    new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.05, depthWrite: false }),
  );
  fill.rotation.x = -Math.PI / 2;
  g.add(fill, line);
  g.visible = false;
  return g;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class VehicleView {
  readonly root = new Group();
  private readonly cars = new Map<number, CarMesh>();
  private readonly target = buildTarget();
  private targetId: number | undefined;
  /** Merged geometry per vehicle variant (parked instances). */
  private readonly merged = new Map<number, { paint: BufferGeometry; rest: BufferGeometry }>();
  private parkedMeshes: InstancedMesh[] = [];
  /** Signature of the parked set (ids + poses) the instances were built for. */
  private parkedKey = '';

  constructor(
    private readonly typeOf: (variant: number) => HudVehicleType | undefined,
    private readonly tickMs: number,
    /** Realistic style: Designer's sedan instead of the placeholder boxes. */
    private readonly real?: RealCarModel,
  ) {
    this.root.name = 'vehicles';
    this.root.add(this.target);
  }

  /** A new vehicle snapshot (every sim tick). */
  push(list: readonly SnapshotVehicle[], now: number): void {
    const seen = new Set<number>();
    for (const v of list) {
      seen.add(v.stableId);
      let m = this.cars.get(v.stableId);
      const t = this.typeOf(v.variant);
      if (!t) continue;
      if (!m) {
        m = buildCar(t, v.stableId, this.real);
        m.prev = v;
        this.cars.set(v.stableId, m);
        this.root.add(m.root);
      } else m.prev = this.pose(m, now);
      m.cur = v;
      m.at = now;
    }
    for (const [id, m] of this.cars) {
      if (seen.has(id)) continue;
      this.root.remove(m.root);
      disposeCar(m);
      this.cars.delete(id);
    }
  }

  /** Draw calls of the cars (tests / perf): instanced batches + meshes of the cars with own groups. */
  get drawnMeshes(): number {
    let n = this.parkedMeshes.length;
    for (const m of this.cars.values()) {
      if (!m.parked) m.root.traverse((o) => void (o instanceof Mesh && n++));
    }
    return n;
  }

  /** (Re)builds the parked instances when the parked set or a parked pose changed. */
  private syncParked(): void {
    const parked: CarMesh[] = [];
    let key = '';
    for (const m of this.cars.values()) {
      const p = m.cur;
      m.parked = isParked(p) && isParked(m.prev) && this.typeOf(p.variant) !== undefined;
      m.root.visible = !m.parked;
      if (!m.parked) continue;
      parked.push(m);
      key += `${p.stableId}:${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z},${p.facingRad.toFixed(3)};`;
    }
    if (key === this.parkedKey) return;
    this.parkedKey = key;
    for (const im of this.parkedMeshes) {
      this.root.remove(im);
      im.dispose();
    }
    this.parkedMeshes = [];
    const byVariant = new Map<number, CarMesh[]>();
    for (const m of parked) {
      const list = byVariant.get(m.cur.variant) ?? [];
      list.push(m);
      byVariant.set(m.cur.variant, list);
    }
    const w = { x: 0, y: 0, z: 0 };
    const mat = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    const pos = new Vector3();
    const color = new Color();
    for (const [variant, cars] of byVariant) {
      if (this.real) {
        this.addParkedReal(variant, cars);
        continue;
      }
      let g = this.merged.get(variant);
      if (!g) this.merged.set(variant, (g = mergedCar(this.typeOf(variant)!)));
      // Instances relative to the first car: small float32 offsets far from (0, 0).
      simToWorld(cars[0]!.cur.x, cars[0]!.cur.y, cars[0]!.cur.z, w);
      const origin = { ...w };
      const paint = new InstancedMesh(g.paint, paintInstanceMat, cars.length);
      const rest = new InstancedMesh(g.rest, restInstanceMat, cars.length);
      cars.forEach((m, i) => {
        const p = m.cur;
        simToWorld(p.x, p.y, p.z, w);
        mat.compose(
          pos.set(w.x - origin.x, w.y - origin.y, w.z - origin.z),
          q.setFromAxisAngle(up, -p.facingRad),
          one,
        );
        paint.setMatrixAt(i, mat);
        rest.setMatrixAt(i, mat);
        paint.setColorAt(i, color.setHex(PAINT[p.stableId % PAINT.length] ?? 0x7a3b2e));
      });
      for (const im of [paint, rest]) {
        im.name = `parked-cars-${variant}`;
        im.position.set(origin.x, origin.y, origin.z);
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.root.add(im);
        this.parkedMeshes.push(im);
      }
    }
  }

  /** Realistic style: parked cars of a type as one InstancedMesh of the PBR sedan. */
  private addParkedReal(variant: number, cars: readonly CarMesh[]): void {
    const real = this.real;
    const t = this.typeOf(variant);
    if (!real || !t) return;
    const w = { x: 0, y: 0, z: 0 };
    simToWorld(cars[0]!.cur.x, cars[0]!.cur.y, cars[0]!.cur.z, w);
    const origin = { ...w };
    const im = new InstancedMesh(real.geometryFor(t), real.material, cars.length);
    const mat = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    const pos = new Vector3();
    cars.forEach((m, i) => {
      const p = m.cur;
      simToWorld(p.x, p.y, p.z, w);
      mat.compose(
        pos.set(w.x - origin.x, w.y - origin.y, w.z - origin.z),
        q.setFromAxisAngle(up, -p.facingRad),
        one,
      );
      im.setMatrixAt(i, mat);
    });
    im.name = `parked-cars-pbr-${variant}`;
    im.position.set(origin.x, origin.y, origin.z);
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    this.root.add(im);
    this.parkedMeshes.push(im);
  }

  /** Interpolated pose of car `m` at `now`. */
  private pose(m: CarMesh, now: number): SnapshotVehicle {
    const t = Math.min(1, (now - m.at) / this.tickMs);
    return {
      ...m.cur,
      x: lerp(m.prev.x, m.cur.x, t),
      y: lerp(m.prev.y, m.cur.y, t),
      z: lerp(m.prev.z, m.cur.z, t),
      facingRad: lerpAngle(m.prev.facingRad, m.cur.facingRad, t),
    };
  }

  /** Interpolated pose of car `id` (HUD anchors), undefined when not in the snapshot. */
  poseOf(id: number, now: number): SnapshotVehicle | undefined {
    const m = this.cars.get(id);
    return m ? this.pose(m, now) : undefined;
  }

  /** Car the F key targets (dashed ellipse), undefined = none. */
  setTarget(id: number | undefined): void {
    this.targetId = id;
  }

  update(now: number, dtMs: number): void {
    this.syncParked();
    const w = { x: 0, y: 0, z: 0 };
    for (const m of this.cars.values()) {
      const p = this.pose(m, now);
      simToWorld(p.x, p.y, p.z, w);
      m.root.position.set(w.x, w.y, w.z);
      m.root.rotation.y = -p.facingRad;
      const lit = p.headlights;
      m.head.emissiveIntensity = lit ? 2.2 : 0.2;
      m.light.intensity = lit ? 260 : 0;
      m.tail.emissiveIntensity = p.brakeLight ? 2.5 : lit ? 1 : 0.2;
      // Wheels: front steer, all spin with the speed.
      const roll = (p.speed * dtMs) / 1000 / WHEEL_R;
      m.wheels.forEach((wh, i) => {
        wh.rotation.z -= roll;
        if (i < 2) wh.rotation.y = -(p.steer ?? 0) * 0.5;
        const tyre = p.tires?.[i] ?? 1;
        wh.scale.set(1, tyre <= 0 ? 0.7 : 1, 1);
      });
      if (m.cur.stableId === this.targetId) {
        const t = this.typeOf(m.cur.variant);
        if (t) {
          this.target.visible = true;
          this.target.position.set(w.x, w.y + 0.03, w.z);
          this.target.rotation.y = -p.facingRad;
          this.target.scale.set(t.length * 0.5 + 0.55, 1, t.width * 0.5 + 0.55);
        }
      }
    }
    if (this.targetId === undefined || !this.cars.has(this.targetId)) this.target.visible = false;
  }
}
