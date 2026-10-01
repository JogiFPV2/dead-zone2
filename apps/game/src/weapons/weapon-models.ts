import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  LoadingManager,
  Mesh,
  Vector3,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { placeholderMaterial } from '../lighting/materials.js';
import type { WeaponInfo } from './weapon-kinds.js';

/**
 * Held / slung weapon models: the same source models the item icons are rendered from
 * (`tools/assets/icons/items.json` + `icons/src/`), bundled by Vite. Weapons without a model
 * get a grey placeholder shape of their class.
 *
 * Normalised weapon space: +Y runs from the handle to the head (melee) or from the stock to the
 * muzzle (firearms), the origin is the grip point, 1 unit = 1 world unit.
 */
const SRC = '../../../../tools/assets/icons/';
const ITEMS = import.meta.glob<unknown>('../../../../tools/assets/icons/items.json', {
  import: 'default',
  eager: true,
});
const GLB = import.meta.glob<string>('../../../../tools/assets/icons/src/**/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
});
const PNG = import.meta.glob<string>('../../../../tools/assets/icons/src/**/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** Item id -> source model path under `icons/src/` (from the icon list). */
export function weaponSources(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(raw)) return out;
  for (const e of raw as unknown[]) {
    if (typeof e !== 'object' || e === null) continue;
    const { items, src } = e as { items?: unknown; src?: unknown };
    if (!Array.isArray(items) || typeof src !== 'string') continue;
    for (const id of items) if (typeof id === 'string') out.set(id, src);
  }
  return out;
}

const SOURCES = weaponSources(ITEMS[`${SRC}items.json`]);

/** Grip point as a share of the length from the handle (stock) end. */
const GRIP_MELEE = 0.12;
const GRIP_FIREARM = 0.3;

/** Max of the two cross extents of the points whose position along `axis` is in [a, b]. */
function spread(pts: readonly Vector3[], axis: number, a: number, b: number): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    const t = p.getComponent(axis);
    if (t < a || t > b) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p.getComponent(k));
      hi[k] = Math.max(hi[k]!, p.getComponent(k));
    }
  }
  let s = 0;
  for (let k = 0; k < 3; k++) if (k !== axis && hi[k]! > lo[k]!) s = Math.max(s, hi[k]! - lo[k]!);
  return s;
}

/**
 * Wraps `o` into weapon space: longest axis -> +Y scaled to `info.length`, handle (melee: the
 * slimmer end, the head is the bulky one) or stock (firearms: the bulkier end, the muzzle is
 * slim) towards -Y, grip point at the origin.
 */
export function normalizeWeapon(o: Object3D, info: WeaponInfo): Group {
  o.position.set(0, 0, 0);
  o.rotation.set(0, 0, 0);
  o.scale.set(1, 1, 1);
  o.updateMatrixWorld(true);
  const pts: Vector3[] = [];
  o.traverse((m) => {
    if (!(m instanceof Mesh)) return;
    m.castShadow = true;
    const pos = (m.geometry as BufferGeometry).getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++)
      pts.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  });
  const box = new Box3().setFromPoints(pts);
  const size = box.getSize(new Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const min = box.min.getComponent(axis);
  const len = Math.max(1e-6, size.getComponent(axis));
  const lowEnd = spread(pts, axis, min, min + len * 0.2);
  const highEnd = spread(pts, axis, min + len * 0.8, min + len);
  const gun = info.cls === 'firearm';
  // Head (melee) / muzzle (gun) at the high end?
  const headHigh = gun ? highEnd <= lowEnd : highEnd >= lowEnd;
  const dir = new Vector3().setComponent(axis, headHigh ? 1 : -1);
  const grip = box.getCenter(new Vector3());
  const share = gun ? GRIP_FIREARM : GRIP_MELEE;
  grip.setComponent(axis, headHigh ? min + len * share : min + len * (1 - share));
  const k = info.length / len;
  const wrap = new Group();
  wrap.name = `weapon:${info.id}`;
  o.quaternion.setFromUnitVectors(dir, new Vector3(0, 1, 0));
  o.scale.setScalar(k);
  o.position.copy(grip.multiplyScalar(-k).applyQuaternion(o.quaternion));
  wrap.add(o);
  return wrap;
}

/** Placeholder colours: light enough to read against dark clothes in the isometric view. */
export const PLACEHOLDER_HANDLE = '#9a6a3c';
export const PLACEHOLDER_STEEL = '#d3d8de';
const PLACEHOLDER_GUN = '#5d646c';

/** Head shape of a weapon without a model, from its id / `melee.category`. */
export function placeholderHead(info: WeaponInfo): 'gun' | 'axe' | 'blade' | 'spear' | 'club' {
  if (info.cls === 'firearm') return 'gun';
  if (/axe|hatchet|cleaver/.test(info.id)) return 'axe';
  if (info.category === 'spear') return 'spear';
  if (info.category === 'blade_short' || info.category === 'blade_long') return 'blade';
  return 'club';
}

/**
 * Stand-in in weapon space for weapons without a source model (22 of 36 melee weapons): wooden
 * handle + steel head shaped by the weapon kind. Thick and light on purpose; the old 2 cm dark
 * grey stick vanished against the character in game ("no weapon in hand").
 */
export function placeholderWeapon(info: WeaponInfo): Group {
  const g = new Group();
  g.name = `weapon:${info.id}`;
  const L = info.length;
  const wood = placeholderMaterial(PLACEHOLDER_HANDLE);
  const steel = placeholderMaterial(PLACEHOLDER_STEEL);
  const head = placeholderHead(info);
  const handle = (share: number, r: number, mat = wood): void => {
    const m = new Mesh(new CylinderGeometry(r, r * 1.15, L * share, 8), mat);
    m.position.y = L * (share / 2 - GRIP_MELEE);
    g.add(m);
  };
  const box = (w: number, h: number, d: number, x: number, y: number, mat = steel): void => {
    const m = new Mesh(new BoxGeometry(w, h, d), mat);
    m.position.set(x, y, 0);
    g.add(m);
  };
  switch (head) {
    case 'gun': {
      const dark = placeholderMaterial(PLACEHOLDER_GUN);
      const body = new Mesh(new BoxGeometry(0.06, L, 0.1), dark);
      body.position.y = L * (0.5 - GRIP_FIREARM);
      const grip = new Mesh(new BoxGeometry(0.05, 0.07, 0.14), dark);
      grip.position.set(0, -0.02, -0.07);
      g.add(body, grip);
      break;
    }
    case 'axe':
      handle(1, 0.03);
      box(0.16, Math.max(0.1, L * 0.16), 0.035, 0.07, L * (0.9 - GRIP_MELEE));
      break;
    case 'spear':
      handle(0.85, 0.025);
      box(0.05, L * 0.15, 0.02, 0, L * (0.92 - GRIP_MELEE));
      break;
    case 'blade':
      handle(0.28, 0.028, placeholderMaterial('#3b3f45'));
      box(0.07, L * 0.64, 0.015, 0, L * (0.6 - GRIP_MELEE));
      break;
    default:
      handle(0.72, 0.032);
      box(0.08, L * 0.3, 0.08, 0, L * (0.85 - GRIP_MELEE));
  }
  g.traverse((m) => {
    if (m instanceof Mesh) m.castShadow = true;
  });
  return g;
}

/** Loads and caches the weapon models; `create` is sync (placeholder until loaded). */
export class WeaponModels {
  private readonly loaded = new Map<string, Object3D>();
  private readonly pending = new Map<string, Promise<void>>();

  /** Item ids that have a source model. */
  static hasModel(id: string): boolean {
    return SOURCES.has(id);
  }

  /** A fresh weapon-space object for `info` (the model if loaded, else a placeholder). */
  create(info: WeaponInfo): Object3D {
    const src = this.loaded.get(info.id);
    return src ? normalizeWeapon(src.clone(), info) : placeholderWeapon(info);
  }

  /** Loads the model of `info.id` once; resolves when ready (or failed / no model). */
  load(info: WeaponInfo): Promise<void> {
    const src = SOURCES.get(info.id);
    if (!src) return Promise.resolve();
    let p = this.pending.get(info.id);
    if (!p) {
      p = loadSource(src)
        .then((o) => void this.loaded.set(info.id, o))
        .catch((e: unknown) => console.warn(`weapon model ${src}`, e));
      this.pending.set(info.id, p);
    }
    return p;
  }
}

/** Kenney kits reference `Textures/colormap.png` next to the model: point it at the bundle. */
function loadSource(src: string): Promise<Object3D> {
  const url = GLB[`${SRC}src/${src}`];
  if (!url) return Promise.reject(new Error(`no bundled model ${src}`));
  const dir = src.slice(0, src.lastIndexOf('/') + 1);
  const manager = new LoadingManager();
  manager.setURLModifier((u) => {
    const m = /Textures\/[^/?#]+\.png/.exec(u);
    return (m && PNG[`${SRC}src/${dir}${m[0]}`]) || u;
  });
  return new GLTFLoader(manager).loadAsync(url).then((g) => g.scene);
}
