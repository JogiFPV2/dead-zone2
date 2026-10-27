import type { BufferGeometry, Matrix4 } from 'three';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Float32BufferAttribute,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { placeholderMaterial } from '../lighting/materials.js';
import { gripOfItem, type Grip, type GripSource } from './grip.js';
import type { PackFile } from '@deadzone/content';
import { HELD_CATEGORIES, isTwoHanded, type HeldCategory } from './grip-sockets.js';

/**
 * Items in hand (anim-spec §3 / §5): what category an item is held as, which hand takes it,
 * and one instanced pool per non-weapon item shape (flashlight, food, tool, plank, bag) shared
 * by every character: a draw call per shape in use, not per character.
 */

/** Category of a held weapon by its grip. */
export const GRIP_CATEGORY: Record<Grip, HeldCategory> = {
  one_hand: 'melee1',
  two_hand: 'twoHanded',
  knife: 'knife',
  spear: 'twoHanded',
  pistol: 'pistol',
  rifle: 'rifle',
  chainsaw: 'twoHanded',
};

interface HeldSource extends GripSource {
  bag?: unknown;
}

const hasTag = (tags: unknown, t: string): boolean => Array.isArray(tags) && tags.includes(t);

/** Held category of a raw content item; undefined = drawn in no hand (books, clothing…). */
export function heldCategoryOf(item: HeldSource): HeldCategory | undefined {
  const grip = gripOfItem(item);
  if (grip) return GRIP_CATEGORY[grip];
  const id = typeof item.id === 'string' ? item.id : '';
  if (hasTag(item.tags, 'base:flashlight') || id.endsWith('flashlight')) return 'flashlight';
  if (hasTag(item.tags, 'base:bag-hand')) return 'bag';
  if (id === 'base:plank' || hasTag(item.tags, 'base:plank')) return 'plank';
  switch (item.kind) {
    case 'food':
    case 'drink':
    case 'medical':
      return 'food';
    case 'tool':
      return 'tool';
    default:
      return undefined;
  }
}

/** Held categories by item id of raw pack files (`items/*.json`). */
export function buildHeldIndex(files: readonly PackFile[]): Map<string, HeldCategory> {
  const out = new Map<string, HeldCategory>();
  for (const f of files) {
    if (!('json' in f) || !f.path.startsWith('items/')) continue;
    const list: unknown[] = Array.isArray(f.json) ? f.json : [f.json];
    for (const i of list) {
      if (typeof i !== 'object' || i === null) continue;
      const it = i as HeldSource;
      const c = typeof it.id === 'string' ? heldCategoryOf(it) : undefined;
      if (c) out.set(it.id as string, c);
    }
  }
  return out;
}

export interface HeldHands {
  R?: HeldCategory;
  L?: HeldCategory;
}

/**
 * anim-spec §3 hand rule: the primary (weapon / tool) goes in the right hand; two-handed items
 * take both hands (the left item is put away); the secondary (flashlight, can, small item) goes
 * in the left; no primary + flashlight: the flashlight moves to the right hand.
 */
export function heldHands(primary?: HeldCategory, secondary?: HeldCategory): HeldHands {
  if (primary && isTwoHanded(primary)) return { R: primary };
  if (!primary && secondary === 'flashlight') return { R: 'flashlight' };
  const out: HeldHands = {};
  if (primary) out.R = primary;
  if (secondary) out.L = secondary;
  return out;
}

/** Shapes drawn by the pool (weapons keep their own models, `weapon-models.ts`). */
export const POOL_CATEGORIES = ['flashlight', 'food', 'tool', 'plank', 'bag'] as const;
export type PoolCategory = (typeof POOL_CATEGORIES)[number];
export const isPoolCategory = (c: HeldCategory | undefined): c is PoolCategory =>
  (POOL_CATEGORIES as readonly string[]).includes(c ?? '');

const tint = (g: BufferGeometry, hex: string): BufferGeometry => {
  const c = new Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
};

/** Low-poly shape per category (grip point at the origin, +Y along the item; ≤ 60 tris). */
export function heldGeometry(c: PoolCategory): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, hex: string, y = 0, z = 0): void => {
    g.translate(0, y, z);
    parts.push(tint(g.toNonIndexed(), hex));
  };
  switch (c) {
    case 'flashlight': // 0.2 m tube, head forward (+Y)
      add(new CylinderGeometry(0.018, 0.018, 0.16, 6, 1, true), '#2b2e33', 0.02);
      add(new CylinderGeometry(0.028, 0.02, 0.05, 6, 1, true), '#e8e2c8', 0.11);
      break;
    case 'food': // can, 0.1 m
      add(new CylinderGeometry(0.033, 0.033, 0.1, 6), '#b8442e', 0.0);
      break;
    case 'tool': // short handle + head
      add(new BoxGeometry(0.03, 0.22, 0.03), '#3b3f45', 0.06);
      add(new BoxGeometry(0.08, 0.04, 0.03), '#c9ced4', 0.18);
      break;
    case 'plank': // 1 m board, grip near the bottom
      add(new BoxGeometry(0.1, 1.0, 0.025), '#a57a4a', 0.4);
      break;
    case 'bag': // hangs below the hand
      add(new BoxGeometry(0.06, 0.12, 0.01), '#2e3237', -0.06);
      add(new BoxGeometry(0.34, 0.3, 0.14), '#4a5a3a', -0.27);
      break;
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

/** Triangle count of a non-indexed geometry. */
export const triangles = (g: BufferGeometry): number =>
  (g.index ? g.index.count : g.getAttribute('position').count) / 3;

export interface HeldInstance {
  category: PoolCategory;
  /** World matrix of the grip socket (× item scale). */
  matrix: Matrix4;
}

/**
 * One InstancedMesh per pool shape with `capacity` slots, all on one material (vertex colours):
 * a shape nobody holds is hidden (no draw call), so a scene costs at most one call per shape in
 * use; 32 characters with flashlights are still one call.
 */
export class HeldItemPool {
  readonly meshes = new Map<PoolCategory, InstancedMesh>();
  readonly material: MeshStandardMaterial;

  constructor(
    parent: Object3D,
    readonly capacity = 32,
  ) {
    this.material = placeholderMaterial('#ffffff');
    this.material.vertexColors = true;
    for (const c of POOL_CATEGORIES) {
      const m = new InstancedMesh(heldGeometry(c), this.material, capacity);
      m.name = `held:${c}`;
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false;
      // No shadow pass: a shadow would double the calls (budget +3, anim-spec §5).
      this.meshes.set(c, m);
      parent.add(m);
    }
  }

  /** Writes this frame's held items (extra ones over the capacity are dropped). */
  update(items: readonly HeldInstance[]): void {
    const n = new Map<PoolCategory, number>();
    for (const it of items) {
      const m = this.meshes.get(it.category)!;
      const i = n.get(it.category) ?? 0;
      if (i >= this.capacity) continue;
      m.setMatrixAt(i, it.matrix);
      n.set(it.category, i + 1);
    }
    for (const [c, m] of this.meshes) {
      m.count = n.get(c) ?? 0;
      m.visible = m.count > 0;
      if (m.count > 0) m.instanceMatrix.needsUpdate = true;
    }
  }

  /** Draw calls this frame (visible shapes). */
  get drawCalls(): number {
    let k = 0;
    for (const m of this.meshes.values()) if (m.visible) k++;
    return k;
  }
}

/**
 * Dev `?held=<R>[,<L>]`: item ids or category names in the hands (e.g. `?held=,flashlight`,
 * `?held=base:canned-beans`); undefined when empty.
 */
export function devHeld(
  param: string | null,
  index: ReadonlyMap<string, HeldCategory>,
): { primary?: HeldCategory; secondary?: HeldCategory } | undefined {
  if (!param) return undefined;
  const cat = (s: string | undefined): HeldCategory | undefined =>
    !s ? undefined : (index.get(s) ?? (isHeldCategory(s) ? s : undefined));
  const [a, b] = param.split(',');
  const primary = cat(a);
  const secondary = cat(b);
  return { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}) };
}

const isHeldCategory = (s: string): s is HeldCategory =>
  (HELD_CATEGORIES as readonly string[]).includes(s);
