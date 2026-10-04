import type { CharacterView, WeaponKind } from '@deadzone/protocol';
import type { WeaponClass } from '../anim/pose.js';
import type { WeaponInfo } from './weapon-kinds.js';
import { gripOfKind, isGrip, type Grip } from './grip.js';

export interface Loadout {
  /** Weapon drawn in the right hand. */
  hand: WeaponInfo | undefined;
  /** Weapon slung on the back (PZ style). */
  back: WeaponInfo | undefined;
}

/** Drawn length of a weapon the content index doesn't know (world units). */
const FALLBACK_LENGTH: Record<WeaponClass, number> = {
  unarmed: 0,
  one_handed: 0.5,
  two_handed: 0.85,
  stab: 0.3,
  firearm: 0.3,
};

/**
 * Swing class from the sim's `weaponKind` / `twoHanded` (view `characters[]`). Blades: the sim
 * reports short and long blades alike, so the content class decides between a stab and a swing.
 */
export function weaponClassOf(
  kind: WeaponKind,
  twoHanded: boolean,
  content: WeaponClass | undefined,
): WeaponClass {
  switch (kind) {
    case 'firearm-short':
    case 'firearm-long':
      return 'firearm';
    case 'spear':
      return 'stab';
    case 'blade':
      if (twoHanded) return 'two_handed';
      return content === 'stab' ? 'stab' : 'one_handed';
    case 'blunt':
      return twoHanded ? 'two_handed' : 'one_handed';
    default:
      return 'unarmed';
  }
}

/**
 * Weapons to draw on a character, from the sim's visible equipment (view `characters[]`):
 * `equippedPrimary` in the hand (swing class from `weaponKind`), `equippedBack` on the back when
 * it is a weapon (backpacks are not drawn here). Models / lengths come from the content index.
 */
export function weaponLoadout(
  c: CharacterView | undefined,
  weapons: ReadonlyMap<string, WeaponInfo>,
): Loadout {
  if (!c) return { hand: undefined, back: undefined };
  let hand: WeaponInfo | undefined;
  if (c.equippedPrimary && c.weaponKind !== 'unarmed' && c.weaponKind !== 'item') {
    const known = weapons.get(c.equippedPrimary);
    const cls = weaponClassOf(c.weaponKind, c.twoHanded, known?.cls);
    const grip = known?.grip ?? gripOfKind(c.weaponKind, c.twoHanded);
    hand = known
      ? { ...known, cls }
      : {
          id: c.equippedPrimary,
          cls,
          knockback: 0,
          length: FALLBACK_LENGTH[cls],
          ...(grip ? { grip } : {}),
        };
  }
  const back = c.equippedBack ? weapons.get(c.equippedBack) : undefined;
  return { hand, back };
}

const GRIP_CLASS: Record<Grip, WeaponClass> = {
  one_hand: 'one_handed',
  two_hand: 'two_handed',
  knife: 'stab',
  spear: 'stab',
  pistol: 'firearm',
  rifle: 'firearm',
  chainsaw: 'two_handed',
};

/**
 * Dev `?hold=<item id>[@grip]` (or a bare grip name, e.g. `chainsaw`): the weapon shown in the hand
 * regardless of the inventory. Undefined when the param is empty or names nothing known.
 */
export function devHoldWeapon(
  param: string | null,
  weapons: ReadonlyMap<string, WeaponInfo>,
): WeaponInfo | undefined {
  if (!param) return undefined;
  const [id = '', at] = param.split('@');
  const forced = isGrip(at) ? at : undefined;
  const known = weapons.get(id);
  if (known) return forced ? { ...known, grip: forced } : known;
  const grip = forced ?? (isGrip(id) ? id : undefined);
  if (!grip) return undefined;
  const cls = GRIP_CLASS[grip];
  return { id: `dev:${grip}`, cls, knockback: 0, length: grip === 'chainsaw' ? 0.9 : 0.6, grip };
}
