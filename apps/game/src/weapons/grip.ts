import type { WeaponKind } from '@deadzone/protocol';

/**
 * How a weapon is held (hand placement + body pose, `anim/arm-pose.ts`):
 * - `one_hand`: swung in one hand (improvised, machete, hatchet): clip arms only.
 * - `two_hand`: crowbar, bats, axes, shovels: both hands on the shaft.
 * - `knife`: short blade in one hand, low and forward.
 * - `spear`: both hands, shaft forward at the hip.
 * - `pistol`: one hand, arm stretched out when aiming.
 * - `rifle`: stock at the shoulder, the other hand on the handguard.
 * - `chainsaw`: both hands in front of the body.
 */
export const GRIPS = [
  'one_hand',
  'two_hand',
  'knife',
  'spear',
  'pistol',
  'rifle',
  'chainsaw',
] as const;
export type Grip = (typeof GRIPS)[number];

export const isGrip = (v: unknown): v is Grip =>
  typeof v === 'string' && (GRIPS as readonly string[]).includes(v);

/** Fields of an item definition that decide the grip (raw pack JSON). */
export interface GripSource {
  id?: unknown;
  kind?: unknown;
  /** Content `grip` (Modules); when present it wins over the fallback below. */
  grip?: unknown;
  tags?: unknown;
  melee?: unknown;
}

/**
 * THE one place that maps an item to its grip. When content carries `grip` (planned in
 * `@deadzone/content` item schema), it is used as is; until then the fallback derives it from
 * kind / melee category / twoHanded / firearm tags.
 */
export function gripOfItem(item: GripSource): Grip | undefined {
  if (isGrip(item.grip)) return item.grip;
  const id = typeof item.id === 'string' ? item.id : '';
  if (id.endsWith('chainsaw')) return 'chainsaw';
  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (item.kind === 'weapon_ranged') {
    return tags.some((t) => t === 'base:firearm-rifle' || t === 'base:firearm-shotgun')
      ? 'rifle'
      : 'pistol';
  }
  if (item.kind !== 'weapon_melee') return undefined;
  const m = (typeof item.melee === 'object' && item.melee !== null ? item.melee : {}) as Record<
    string,
    unknown
  >;
  switch (m.category) {
    case 'blunt':
      // Short tools (hammer, wrenches) in one hand; shafts (crowbar, pipe, bats) in both.
      return m.twoHanded !== true &&
        tags.some((t) => t === 'base:tool-hammer' || t === 'base:tool-wrench')
        ? 'one_hand'
        : 'two_hand';
    case 'blade_short':
      return 'knife';
    case 'spear':
      return 'spear';
    case 'blade_long':
      return m.twoHanded === true ? 'two_hand' : 'one_hand';
    default:
      return m.twoHanded === true ? 'two_hand' : 'one_hand';
  }
}

/** Grip of a weapon the content index doesn't know, from the sim view (`weaponKind`). */
export function gripOfKind(kind: WeaponKind, twoHanded: boolean): Grip | undefined {
  switch (kind) {
    case 'firearm-short':
      return 'pistol';
    case 'firearm-long':
      return 'rifle';
    case 'spear':
      return 'spear';
    case 'blade':
      return twoHanded ? 'two_hand' : 'knife';
    case 'blunt':
      return twoHanded ? 'two_hand' : 'one_hand';
    default:
      return undefined;
  }
}
