import type { PackFile } from '@deadzone/content';
import { EQUIP_SLOTS, type EquipSlot } from '@deadzone/protocol';

/** What the HUD needs from content (names are i18n keys; texts come from labels.ts for now). */
export interface HudMoodleDef {
  id: string;
  polarity: 'negative' | 'positive';
}

export interface HudItemDef {
  id: string;
  kind: string;
  maxStack: number;
  /** Melee category (`blade_short`, `improvised`, …) for the icon. */
  meleeCategory?: string;
  /** Weight of one piece (kg). */
  weightKg: number;
  /** Max durability (weapons, clothing) for `ItemView.condition`. */
  durabilityMax?: number;
  /** Slots the item can be equipped in, first = default (clothing, bags, weapons in hand). */
  equipSlots?: readonly EquipSlot[];
  /** Food, drink or medical: `useItem` (eat, drink, apply). */
  usable?: boolean;
}

export interface HudContentIndex {
  moodles: ReadonlyMap<string, HudMoodleDef>;
  items: ReadonlyMap<string, HudItemDef>;
}

export const EMPTY_HUD_CONTENT: HudContentIndex = { moodles: new Map(), items: new Map() };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v : [v]).filter(isObj);

const isSlot = (v: unknown): v is EquipSlot =>
  typeof v === 'string' && (EQUIP_SLOTS as readonly string[]).includes(v);

/** `durability.max` at the top level or in the melee / ranged / clothing block. */
function durabilityOf(i: Obj): number | undefined {
  for (const block of [i, i.melee, i.ranged, i.clothing]) {
    if (isObj(block) && isObj(block.durability) && typeof block.durability.max === 'number') {
      return block.durability.max;
    }
  }
  return undefined;
}

function equipSlotsOf(i: Obj, kind: string): EquipSlot[] {
  if (isObj(i.clothing) && isSlot(i.clothing.slot)) return [i.clothing.slot];
  if (isObj(i.bag) && Array.isArray(i.bag.slots)) return i.bag.slots.filter(isSlot);
  if (kind === 'weapon_melee' || kind === 'weapon_ranged' || kind === 'tool') {
    return ['hand_primary', 'hand_secondary'];
  }
  return [];
}

/**
 * Reads moodle polarity and item kinds straight from raw pack files (already validated by the
 * sim worker; here only the fields the HUD shows, without pulling zod into the main thread).
 */
export function buildHudContentIndex(files: readonly PackFile[]): HudContentIndex {
  const moodles = new Map<string, HudMoodleDef>();
  const items = new Map<string, HudItemDef>();
  for (const f of files) {
    if (!('json' in f)) continue;
    if (f.path.startsWith('moodles/')) {
      for (const m of list(f.json)) {
        if (typeof m.id !== 'string') continue;
        moodles.set(m.id, {
          id: m.id,
          polarity: m.polarity === 'positive' ? 'positive' : 'negative',
        });
      }
    } else if (f.path.startsWith('items/')) {
      for (const i of list(f.json)) {
        if (typeof i.id !== 'string') continue;
        const melee =
          isObj(i.melee) && typeof i.melee.category === 'string' ? i.melee.category : '';
        const kind = typeof i.kind === 'string' ? i.kind : 'misc';
        const durabilityMax = durabilityOf(i);
        const equipSlots = equipSlotsOf(i, kind);
        items.set(i.id, {
          id: i.id,
          kind,
          maxStack: typeof i.maxStack === 'number' ? i.maxStack : 1,
          weightKg: typeof i.weightKg === 'number' ? i.weightKg : 0,
          ...(melee ? { meleeCategory: melee } : {}),
          ...(durabilityMax !== undefined ? { durabilityMax } : {}),
          ...(equipSlots.length ? { equipSlots } : {}),
          ...(kind === 'food' || kind === 'drink' || kind === 'medical' ? { usable: true } : {}),
        });
      }
    }
  }
  return { moodles, items };
}
