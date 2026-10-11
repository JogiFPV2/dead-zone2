import type { DeepReadonly } from '../bundle/deep-freeze.js';
import type { Item } from '../schemas/item/item.js';
import type { LootCategory } from '../schemas/loot-category.js';

/** Jedzenie świeże dłużej niż tyle minut gry (60 dni) liczy się jako trwałe (`food-canned`). */
export const SHELF_STABLE_FRESH_MIN = 60 * 24 * 60;

/** Tag → kategoria, sprawdzane po kolei przed rodzajem przedmiotu. */
const TAG_RULES: readonly (readonly [string, LootCategory])[] = [
  ['base:cookware', 'cookware'],
  ['base:tool-fire-starter', 'household'],
  ['base:tool-needle', 'household'],
  ['base:thread', 'household'],
  ['base:light', 'electronics'],
  ['base:battery', 'electronics'],
  ['base:electronics', 'electronics'],
  ['base:electronics-salvage', 'electronics'],
  ['base:lure-remote', 'electronics'],
  ['base:car-part', 'vehicle'],
  ['base:car-key', 'vehicle'],
  ['base:fuel', 'vehicle'],
  ['base:tool-hose', 'vehicle'],
  ['base:fabric', 'fabric'],
  ['base:glass', 'junk'],
  ['base:metal-scrap', 'material'],
  ['base:masonry', 'material'],
];

/** Tagi narzędzi, które mimo `base:tool-*` są bronią (noże, maczeta, tasak). */
const BLADE_TAGS = new Set(['base:tool-knife']);

type AnyItem = DeepReadonly<Item>;

function foodCategory(item: Extract<AnyItem, { kind: 'food' }>): LootCategory {
  const sp = item.food.spoilage;
  if (item.tags.includes('base:food-canned') || !sp || sp.freshMin >= SHELF_STABLE_FRESH_MIN)
    return 'food-canned';
  return 'food-fresh';
}

function meleeCategory(item: AnyItem): LootCategory {
  if (item.tags.some((t) => BLADE_TAGS.has(t))) return 'weapon';
  return item.tags.some((t) => t.startsWith('base:tool-')) ? 'tool' : 'weapon';
}

/**
 * Kategoria lootu przedmiotu: jawne `lootCategory` albo reguły z `kind` i tagów
 * (np. nóż kuchenny → `weapon`, młotek → `tool`, konserwa → `food-canned`).
 */
export function lootCategoryOf(item: Item | AnyItem): LootCategory {
  if (item.lootCategory) return item.lootCategory;
  switch (item.kind) {
    case 'weapon_ranged':
      return 'firearm';
    case 'ammo':
    case 'ammo_box':
    case 'magazine':
      return 'ammo';
    case 'food':
      return foodCategory(item);
    case 'drink':
      return 'drink';
    case 'clothing':
      return 'clothing';
    case 'container':
      return 'bag';
    case 'medical':
      return 'medical';
    case 'literature':
      return 'literature';
    case 'vhs':
      return 'vhs';
    case 'placeable':
      return 'furniture';
    default:
      break;
  }
  for (const [tag, cat] of TAG_RULES) if (item.tags.includes(tag)) return cat;
  switch (item.kind) {
    case 'weapon_melee':
      return meleeCategory(item);
    case 'tool':
      return 'tool';
    case 'material':
      return 'material';
    default:
      return 'misc';
  }
}
