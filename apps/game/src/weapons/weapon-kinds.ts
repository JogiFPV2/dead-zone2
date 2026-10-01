import type { PackFile } from '@deadzone/content';
import type { WeaponClass } from '../anim/pose.js';

/** What the views need to know about a weapon item. */
export interface WeaponInfo {
  id: string;
  cls: WeaponClass;
  /** `melee.knockback` (0 for firearms). */
  knockback: number;
  /** Drawn length (world units, character = 1.6). */
  length: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v : [v]).filter(isObj);

/** Default drawn length per class (world units). */
const LENGTH: Record<WeaponClass, number> = {
  unarmed: 0,
  one_handed: 0.5,
  two_handed: 0.85,
  stab: 0.3,
  firearm: 0.3,
};

/**
 * Swing class of an item: firearm (`weapon_ranged`), stab (short blades, spears), two-handed
 * (`melee.twoHanded`), else one-handed. Undefined for non-weapons.
 */
export function classifyWeapon(item: Obj): WeaponClass | undefined {
  if (item.kind === 'weapon_ranged') return 'firearm';
  if (item.kind !== 'weapon_melee' || !isObj(item.melee)) return undefined;
  const m = item.melee;
  const cat = typeof m.category === 'string' ? m.category : '';
  if (cat === 'blade_short' || cat === 'spear') return 'stab';
  return m.twoHanded === true ? 'two_handed' : 'one_handed';
}

function lengthOf(item: Obj, cls: WeaponClass): number {
  if (cls === 'stab' && isObj(item.melee) && item.melee.category === 'spear') return 1.5;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const long = tags.some((t) => t === 'base:firearm-shotgun' || t === 'base:firearm-rifle');
  if (cls === 'firearm' && long) return 0.95;
  return LENGTH[cls];
}

/** Weapon items of raw pack files (validated by the sim worker; only the fields read here). */
export function buildWeaponIndex(files: readonly PackFile[]): Map<string, WeaponInfo> {
  const out = new Map<string, WeaponInfo>();
  for (const f of files) {
    if (!('json' in f) || !f.path.startsWith('items/')) continue;
    for (const i of list(f.json)) {
      if (typeof i.id !== 'string') continue;
      const cls = classifyWeapon(i);
      if (!cls) continue;
      const melee = isObj(i.melee) ? i.melee : {};
      const knockback = typeof melee.knockback === 'number' ? melee.knockback : 0;
      out.set(i.id, { id: i.id, cls, knockback, length: lengthOf(i, cls) });
    }
  }
  return out;
}
