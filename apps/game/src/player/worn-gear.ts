import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHARACTER_LAYER } from '../render/graphics-style.js';
import { createGripSockets, type GripSockets, type HeldCategory } from '../weapons/grip-sockets.js';
import { heldGeometry, isPoolCategory } from '../weapons/held-items.js';
import type { WeaponInfo } from '../weapons/weapon-kinds.js';
import type { WeaponModels } from '../weapons/weapon-models.js';

/**
 * What the player carries, drawn on the body (Paweł 25.11, „widać plecak, kij bejsbolowy”):
 * the worn bag on the back, the fanny pack on the belt, and items in the hands that the weapon
 * mounts do not draw (anything in the left hand; a non-weapon item in the right one).
 */
export interface GearSpec {
  /** Bag worn on the back (`back` slot, item id). */
  back?: string | undefined;
  /** Bag on the belt (`belt` slot). */
  belt?: string | undefined;
  /** Left hand: a weapon (`weapon`) or another item by held category. */
  left?: HandItem | undefined;
  /** Right hand, only when it holds no weapon (the weapon mount draws those). */
  right?: HandItem | undefined;
}

export interface HandItem {
  id: string;
  category: HeldCategory;
  weapon?: WeaponInfo | undefined;
}

/** Shape of a worn bag (metres; size from its capacity). */
interface BagLook {
  w: number;
  h: number;
  d: number;
  color: string;
  trim: string;
  /** Rolled sleeping mat on top (big hiking bags). */
  roll?: string;
  /** Side pouches (military). */
  pouches?: boolean;
}

/** Looks of the base worn bags; other bags fall back by capacity-like size. */
export const BAG_LOOKS: Readonly<Record<string, BagLook>> = {
  'base:school-backpack': { w: 0.27, h: 0.34, d: 0.12, color: '#28324a', trim: '#8a4b32' },
  'base:hiking-bag': { w: 0.3, h: 0.44, d: 0.16, color: '#34473a', trim: '#2a1f17' },
  'base:big-hiking-bag': {
    w: 0.34,
    h: 0.56,
    d: 0.2,
    color: '#8a4b32',
    trim: '#3b2a20',
    roll: '#5b5e3a',
  },
  'base:military-backpack': {
    w: 0.34,
    h: 0.48,
    d: 0.2,
    color: '#4a5236',
    trim: '#34392a',
    pouches: true,
  },
  'base:duffel-bag': { w: 0.5, h: 0.24, d: 0.24, color: '#2f3133', trim: '#7a7c7e' },
};
const DEFAULT_BAG: BagLook = BAG_LOOKS['base:hiking-bag']!;

const colored = (g: BufferGeometry, hex: string): BufferGeometry => {
  const n = g.toNonIndexed();
  const c = new Color(hex);
  const count = n.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) arr.set([c.r, c.g, c.b], i * 3);
  n.setAttribute('color', new Float32BufferAttribute(arr, 3));
  n.deleteAttribute('uv');
  return n;
};

/**
 * Backpack in back space: origin on the back between the shoulder blades, +Y up, +Z away from
 * the back, +X to the right; hangs down from the shoulders.
 */
export function backpackGeometry(look: BagLook): BufferGeometry {
  const { w, h, d } = look;
  const parts: BufferGeometry[] = [];
  const box = (
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    c = look.color,
  ) => parts.push(colored(new BoxGeometry(sx, sy, sz).translate(x, y, z), c));
  const top = 0.06;
  // Main body, the lid over its top, a front pocket.
  box(w, h, d, 0, top - h / 2, d / 2);
  box(w * 1.02, 0.07, d * 1.05, 0, top - 0.01, d / 2 + 0.005, look.trim);
  box(w * 0.7, h * 0.35, 0.05, 0, top - h * 0.68, d + 0.02, look.trim);
  // Shoulder straps over the shoulders to the front of the chest.
  for (const s of [-1, 1]) {
    box(0.045, 0.03, 0.26, s * w * 0.3, top + 0.02, -0.08, look.trim);
    box(0.045, 0.3, 0.02, s * w * 0.3, top - 0.13, -0.23, look.trim);
  }
  if (look.pouches)
    for (const s of [-1, 1])
      box(0.06, h * 0.4, d * 0.7, s * (w / 2 + 0.03), top - h * 0.55, d / 2, look.trim);
  if (look.roll) {
    const r = new CylinderGeometry(0.07, 0.07, w * 1.15, 10).rotateZ(Math.PI / 2);
    parts.push(colored(r.translate(0, top + 0.08, d / 2), look.roll));
  }
  for (const p of parts) p.deleteAttribute('normal');
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

/** Fanny pack in belt space: origin at the front of the belt, +Z forward, +Y up. */
export function fannyPackGeometry(): BufferGeometry {
  const parts = [
    colored(new BoxGeometry(0.22, 0.1, 0.07).translate(0, -0.01, 0.04), '#2f3133'),
    colored(new BoxGeometry(0.16, 0.012, 0.075).translate(0, 0.035, 0.045), '#8a4b32'),
  ];
  for (const p of parts) p.deleteAttribute('normal');
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

const bone = (root: Object3D, name: string): Object3D | undefined =>
  root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, ''));
const pos = (o: Object3D): Vector3 => new Vector3().setFromMatrixPosition(o.matrixWorld);

/** Group under `parent` whose world frame is (x, y, z) at `at` (from the current pose). */
function frameAt(parent: Object3D, at: Vector3, x: Vector3, y: Vector3, z: Vector3): Group {
  const world = new Matrix4().makeBasis(x, y, z).setPosition(at);
  const local = new Matrix4().copy(parent.matrixWorld).invert().multiply(world);
  const g = new Group();
  local.decompose(g.position, g.quaternion, g.scale);
  parent.add(g);
  return g;
}

/** Back and belt frames of a character (model faces +Z), from its current pose. */
function bodyFrames(object: Object3D): { back: Group; belt: Group } | undefined {
  object.updateMatrixWorld(true);
  const chest = bone(object, 'Chest') ?? bone(object, 'Torso');
  const hips = bone(object, 'Hips');
  if (!chest || !hips) return undefined;
  const q = object.getWorldQuaternion(new Quaternion());
  const fwd = new Vector3(0, 0, 1).applyQuaternion(q).normalize();
  const up = new Vector3(0, 1, 0);
  // Back frame: +Z away from the back (−forward), +X to the character's right.
  const bz = fwd.clone().negate();
  const bx = new Vector3().crossVectors(up, bz).normalize();
  const backAt = pos(chest).addScaledVector(fwd, -0.11).addScaledVector(up, 0.04);
  const back = frameAt(chest, backAt, bx, up, bz);
  // Belt frame: at the front of the belt.
  const beltAt = pos(hips).addScaledVector(fwd, 0.09).addScaledVector(up, 0.08);
  const belt = frameAt(hips, beltAt, new Vector3().crossVectors(up, fwd).normalize(), up, fwd);
  return { back, belt };
}

/** One shared material for all gear meshes (vertex colours). */
const material = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });

/** Gear drawn on one animated character (`attach` once the first pose exists). */
export class WornGear {
  private frames: { back: Group; belt: Group } | undefined;
  private sockets: GripSockets | undefined;
  private readonly mat = material();
  private readonly geoms = new Map<string, BufferGeometry>();
  private readonly shown = new Map<string, { key: string; object: Object3D }>();
  private spec: GearSpec = {};
  private models: WeaponModels | undefined;
  /** Weapon sling mount on the back and its rest position (pushed out over a backpack). */
  private sling: { mount: Group; rest: Vector3 } | undefined;
  /** Anim v2 draws non-weapon hand items itself (shared pool): skip those here. */
  poolHands = false;

  attach(object: Object3D, sling?: Group): void {
    this.frames = bodyFrames(object);
    this.sockets = createGripSockets(object);
    if (sling) this.sling = { mount: sling, rest: sling.position.clone() };
    this.apply();
  }

  set(spec: GearSpec, models: WeaponModels): void {
    this.models = models;
    this.spec = spec;
    this.apply();
  }

  /** Ids of what is drawn now (tests, dev). */
  drawn(): Record<string, string> {
    return Object.fromEntries([...this.shown].map(([k, v]) => [k, v.key]));
  }

  private geometry(key: string, make: () => BufferGeometry): BufferGeometry {
    let g = this.geoms.get(key);
    if (!g) this.geoms.set(key, (g = make()));
    return g;
  }

  private mesh(g: BufferGeometry): Mesh {
    const m = new Mesh(g, this.mat);
    m.castShadow = true;
    m.layers.enable(CHARACTER_LAYER);
    return m;
  }

  /** Shows `make()` under `parent` at `slot` while `key` stays the same. */
  private show(
    slot: string,
    key: string | undefined,
    parent: Object3D | undefined,
    make: () => Object3D | undefined,
  ): void {
    const cur = this.shown.get(slot);
    if (cur?.key === (key ?? '') && (key === undefined || cur.object.parent === parent)) return;
    cur?.object.removeFromParent();
    this.shown.delete(slot);
    if (key === undefined || !parent) return;
    const o = make();
    if (!o) return;
    o.traverse((c) => c.layers.enable(CHARACTER_LAYER));
    parent.add(o);
    this.shown.set(slot, { key, object: o });
  }

  private apply(): void {
    const f = this.frames;
    if (!f) return;
    const { back, belt, left, right } = this.spec;
    const look = back ? (BAG_LOOKS[back] ?? DEFAULT_BAG) : undefined;
    this.show('back', back, f.back, () =>
      this.mesh(this.geometry(`bag:${back}`, () => backpackGeometry(look!))),
    );
    // A slung weapon goes over the backpack.
    if (this.sling) {
      const out = look ? look.d + 0.02 : 0;
      this.sling.mount.position
        .copy(this.sling.rest)
        .add(new Vector3(0, 0, out).applyQuaternion(this.sling.mount.quaternion));
    }
    this.show('belt', belt, f.belt, () => this.mesh(this.geometry('fanny', fannyPackGeometry)));
    for (const [side, item] of [
      ['L', left],
      ['R', right],
    ] as const) {
      const pool = this.poolHands && item && !item.weapon && isPoolCategory(item.category);
      const it = pool ? undefined : item;
      const sock = it ? this.sockets?.socket(it.category, side) : undefined;
      this.show(`hand${side}`, it?.id, sock, () => {
        if (it?.weapon && this.models) {
          const w = it.weapon;
          void this.models.load(w).then(() => {
            const cur = this.shown.get(`hand${side}`);
            if (cur?.key !== it.id || !this.models) return;
            const parent = cur.object.parent;
            cur.object.removeFromParent();
            cur.object = this.models.create(w);
            cur.object.traverse((c) => c.layers.enable(CHARACTER_LAYER));
            parent?.add(cur.object);
          });
          return this.models.create(w);
        }
        if (!it || !isPoolCategory(it.category)) return undefined;
        return this.mesh(
          this.geometry(`held:${it.category}`, () => heldGeometry(it.category as never)),
        );
      });
    }
  }

  dispose(): void {
    for (const g of this.geoms.values()) g.dispose();
    this.mat.dispose();
  }
}
