import type { CharacterProfileView, EquipSlot, ItemView } from '@deadzone/protocol';
import type { InventoryState } from '../state/game-state.js';
import {
  hairStyleOf,
  wornKey,
  type BaseLook,
  type WornClothes,
} from '../models/painted-body/wardrobe.js';

/** Clothing slots drawn on the body (`EquipSlot` minus hands / back / belt). */
const CLOTHING_SLOTS = [
  'head',
  'face',
  'torso_inner',
  'torso_outer',
  'hands',
  'legs',
  'feet',
] as const satisfies readonly EquipSlot[];

/** Carried item by id (main inventory and carried bags). */
export function carriedItem(inv: InventoryState | undefined, id: number): ItemView | undefined {
  if (!inv) return undefined;
  for (const c of Object.values(inv.containers)) {
    const it = c.items.find((i) => i.id === id);
    if (it) return it;
  }
  return undefined;
}

/** What the player wears, by clothing slot (from the inventory's equipped slots). */
export function wornClothesOf(inv: InventoryState | undefined): WornClothes {
  const out: WornClothes = {};
  if (!inv) return out;
  for (const slot of CLOTHING_SLOTS) {
    const id = inv.equipped[slot];
    const it = id === undefined ? undefined : carriedItem(inv, id);
    if (it) out[slot] = { def: it.def, tint: it.tint };
  }
  return out;
}

/** Skin, hair colour and cut of a created character (`characterProfile`). */
export function baseLookOf(
  profile: CharacterProfileView,
  hex: (palette: string, color: string | undefined) => string | undefined,
): BaseLook {
  const head = profile.appearance.parts.head ?? profile.appearance.parts.hair;
  return {
    skin: hex('base:skin', profile.appearance.skin) ?? '#d6a27c',
    hair: hex('base:hair', head?.colors.primary) ?? '#3a281c',
    hairStyle: hairStyleOf(head?.part),
  };
}

/** Key of the whole dressed look (redress only when it changes). */
export const dressKey = (base: BaseLook | undefined, worn: WornClothes): string =>
  `${base ? `${base.skin}/${base.hair}/${base.hairStyle}` : '-'}|${wornKey(worn)}`;
