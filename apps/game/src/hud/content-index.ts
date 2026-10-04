import type { PackFile } from '@deadzone/content';
import { EQUIP_SLOTS, type EquipSlot } from '@deadzone/protocol';
import { TV_TAG, readSleepSettings, type HudSleepSettings } from './sleep-settings.js';

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
  /** Firearms (`weapon_ranged`): what the firearm HUD needs. */
  ranged?: HudRangedDef;
  /** Magazines: rounds they take and how many. */
  magazine?: { ammo: string; capacity: number };
  /** Drinks: uses of a full item (`drink.uses`), shown as a fill bar (inventory v3 „Stan”). */
  fillMax?: number;
  /** Bags: `bag.weightReductionPct` (inventory v3 section header `−30% wagi`). */
  bagReductionPct?: number;
  /** Furniture you can sleep on (`placeable.sleepSurface`). */
  sleepSurface?: 'bed' | 'sofa';
  /** A TV (`placeable.power` + the leisure TV tag): `watchTv` nearby. */
  tv?: boolean;
}

export interface HudRangedDef {
  ammo: string;
  feed: 'internal' | 'magazine';
  /** Internal feed capacity (magazine feed: the magazine's). */
  capacity?: number;
  /** Magazine feed: magazine item id. */
  magazine?: string;
  rangeTiles: number;
  /** `shotNoise.radiusTiles` (m). */
  noiseRadius: number;
  /** `damage.min` / `damage.max` (tooltip „Obrażenia”). */
  damage?: { min: number; max: number };
  reloadSec: number;
  /** Internal feed loaded one round at a time (pump shotgun, hunting rifle). */
  loadSecPerRound?: number;
}

/** Crafting station: level items and the recipe that builds / upgrades to each level. */
export interface HudStationDef {
  id: string;
  levels: readonly { level: number; item: string; recipe: string; craftTimeMultiplier: number }[];
}

/** Recipe results (the sim's crafting view has the state, content has what comes out). */
export interface HudRecipeDef {
  id: string;
  results: readonly { item: string; count: number }[];
  /** Repair recipes restore an item instead of producing one. */
  repair?: boolean;
}

export interface HudContentIndex {
  moodles: ReadonlyMap<string, HudMoodleDef>;
  items: ReadonlyMap<string, HudItemDef>;
  stations?: ReadonlyMap<string, HudStationDef>;
  recipes?: ReadonlyMap<string, HudRecipeDef>;
  /** Tag → item whose icon stands in for the tag in recipes (`tags/*.json`, `iconItem`). */
  tagIcons?: ReadonlyMap<string, string>;
  /** `worldSettings.survival.sleep` / `leisure` (sleep screen, leisure buttons). */
  sleep?: HudSleepSettings;
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

/** Two-handed melee weapons, shotguns and rifles may also go on the back (sim #67). */
function longWeapon(i: Obj, kind: string): boolean {
  if (kind === 'weapon_melee') return isObj(i.melee) && i.melee.twoHanded === true;
  if (kind !== 'weapon_ranged' || !isObj(i.ranged)) return false;
  return i.ranged.category === 'shotgun' || i.ranged.category === 'rifle';
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : d);

function rangedOf(i: Obj): HudRangedDef | undefined {
  const r = i.ranged;
  if (!isObj(r) || typeof r.ammo !== 'string') return undefined;
  const feed = isObj(r.feed) ? r.feed : {};
  const mag = feed.type === 'magazine';
  return {
    ammo: r.ammo,
    feed: mag ? 'magazine' : 'internal',
    ...(!mag && typeof feed.capacity === 'number' ? { capacity: feed.capacity } : {}),
    ...(mag && typeof feed.magazine === 'string' ? { magazine: feed.magazine } : {}),
    rangeTiles: num(r.rangeTiles, 20),
    noiseRadius: isObj(r.shotNoise) ? num(r.shotNoise.radiusTiles) : 0,
    ...(isObj(r.damage) && typeof r.damage.min === 'number' && typeof r.damage.max === 'number'
      ? { damage: { min: r.damage.min, max: r.damage.max } }
      : {}),
    reloadSec: num(r.reloadSec, 2),
    ...(typeof r.loadSecPerRound === 'number' ? { loadSecPerRound: r.loadSecPerRound } : {}),
  };
}

function equipSlotsOf(i: Obj, kind: string): EquipSlot[] {
  if (isObj(i.clothing) && isSlot(i.clothing.slot)) return [i.clothing.slot];
  if (isObj(i.bag) && Array.isArray(i.bag.slots)) return i.bag.slots.filter(isSlot);
  if (kind === 'weapon_melee' || kind === 'weapon_ranged' || kind === 'tool') {
    return longWeapon(i, kind)
      ? ['hand_primary', 'hand_secondary', 'back']
      : ['hand_primary', 'hand_secondary'];
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
  const stations = new Map<string, HudStationDef>();
  const recipes = new Map<string, HudRecipeDef>();
  const tagIcons = new Map<string, string>();
  let sleep: HudSleepSettings | undefined;
  for (const f of files) {
    if (!('json' in f)) continue;
    if (f.path.startsWith('stations/')) {
      for (const st of list(f.json)) {
        if (typeof st.id !== 'string' || !Array.isArray(st.levels)) continue;
        const levels = list(st.levels).map((l) => ({
          level: typeof l.level === 'number' ? l.level : 1,
          item: typeof l.item === 'string' ? l.item : '',
          recipe: typeof l.recipe === 'string' ? l.recipe : '',
          craftTimeMultiplier:
            typeof l.craftTimeMultiplier === 'number' ? l.craftTimeMultiplier : 1,
        }));
        stations.set(st.id, { id: st.id, levels });
      }
    } else if (f.path.startsWith('recipes/')) {
      for (const r of list(f.json)) {
        if (typeof r.id !== 'string') continue;
        const results = (Array.isArray(r.results) ? list(r.results) : [])
          .filter((x) => typeof x.item === 'string')
          .map((x) => ({
            item: x.item as string,
            count: typeof x.count === 'number' ? x.count : 1,
          }));
        recipes.set(r.id, { id: r.id, results, ...(isObj(r.repair) ? { repair: true } : {}) });
      }
    } else if (f.path.startsWith('tags/')) {
      for (const t of list(f.json)) {
        if (typeof t.id === 'string' && typeof t.iconItem === 'string')
          tagIcons.set(t.id, t.iconItem);
      }
    } else if (f.path.startsWith('world-settings/')) {
      sleep = readSleepSettings(f.json) ?? sleep;
    } else if (f.path.startsWith('moodles/')) {
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
        const ranged = rangedOf(i);
        const magazine =
          isObj(i.magazine) && typeof i.magazine.ammo === 'string'
            ? { ammo: i.magazine.ammo, capacity: num(i.magazine.capacity) }
            : undefined;
        const placeable = isObj(i.placeable) ? i.placeable : undefined;
        const surface = placeable?.sleepSurface;
        const tags = Array.isArray(i.tags) ? i.tags : [];
        const tv = isObj(placeable?.power) && tags.includes(TV_TAG);
        items.set(i.id, {
          id: i.id,
          kind,
          maxStack: typeof i.maxStack === 'number' ? i.maxStack : 1,
          weightKg: typeof i.weightKg === 'number' ? i.weightKg : 0,
          ...(melee ? { meleeCategory: melee } : {}),
          ...(durabilityMax !== undefined ? { durabilityMax } : {}),
          ...(equipSlots.length ? { equipSlots } : {}),
          ...(kind === 'food' || kind === 'drink' || kind === 'medical' ? { usable: true } : {}),
          ...(ranged ? { ranged } : {}),
          ...(magazine ? { magazine } : {}),
          ...(surface === 'bed' || surface === 'sofa' ? { sleepSurface: surface } : {}),
          ...(tv ? { tv: true } : {}),
          ...(isObj(i.drink) && typeof i.drink.uses === 'number' ? { fillMax: i.drink.uses } : {}),
          ...(isObj(i.bag) && typeof i.bag.weightReductionPct === 'number'
            ? { bagReductionPct: i.bag.weightReductionPct }
            : {}),
        });
      }
    }
  }
  return { moodles, items, stations, recipes, tagIcons, ...(sleep ? { sleep } : {}) };
}
