import type {
  ContentBundle,
  CraftingSettings,
  LightingSettings,
  WaterSettings,
} from '@deadzone/content';

/**
 * What the sim reads from a `ContentBundle` (a full bundle is assignable). Kept structural so
 * tests can pass a hand-made fixture and the sim never imports content at runtime (no zod).
 */
export type SimContent = Pick<
  ContentBundle,
  'worldSettings' | 'moodles' | 'items' | 'containers' | 'lootTables'
> &
  Partial<
    Pick<
      ContentBundle,
      | 'zombieTypes'
      | 'animalTypes'
      | 'vehicleTypes'
      | 'recipes'
      | 'skills'
      | 'stations'
      | 'traits'
      | 'professions'
      | 'appearanceParts'
      | 'palettes'
      | 'tiles'
    >
  >;
export type TraitDef = ContentBundle['traits'][string];
export type ProfessionDef = ContentBundle['professions'][string];
export type AppearancePartDef = ContentBundle['appearanceParts'][string];
export type PaletteDef = ContentBundle['palettes'][string];
export type CharacterCreationSettings = ContentBundle['worldSettings']['characterCreation'];
export type RecipeDef = ContentBundle['recipes'][string];
export type SkillDef = ContentBundle['skills'][string];
export type StationDef = ContentBundle['stations'][string];
export type ZombieTypeDef = ContentBundle['zombieTypes'][string];
export type AnimalTypeDef = ContentBundle['animalTypes'][string];
export type VehicleTypeDef = ContentBundle['vehicleTypes'][string];
export type ItemDef = ContentBundle['items'][string];
export type ContainerTypeDef = ContentBundle['containers'][string];
export type LootTableDef = ContentBundle['lootTables'][string];
export type SurvivalSettings = ContentBundle['worldSettings']['survival'];
type MoodleDef = ContentBundle['moodles'][string];
type ModifierDef = MoodleDef['levels'][number]['modifiers'][number];
export type ConditionDef = NonNullable<ModifierDef['when']>;

/** Rate stats the survival systems read from the modifier cache (index = slot). */
export const MOD_STATS = [
  'hunger-rate',
  'thirst-rate',
  'fatigue-rate',
  'endurance-regen',
  'healing-rate',
  'move-speed',
  'search-speed',
  'carry-capacity-kg',
  'footstep-noise',
  'food-sickness-chance',
] as const;
export type ModStat = (typeof MOD_STATS)[number];
export const ModSlot = Object.fromEntries(MOD_STATS.map((s, i) => [s, i])) as Record<
  ModStat,
  number
>;

export interface CompiledModifier {
  slot: number;
  op: 'add' | 'mul';
  value: number;
  when: ConditionDef | undefined;
}

export interface CompiledMoodle {
  id: string;
  /** Content stat id, e.g. `hunger`, `body-temperature-c`. */
  stat: string;
  rising: boolean;
  maxLevel: number;
  /** f32-rounded thresholds, index = level − 1. */
  enterAt: number[];
  exitAt: number[];
  /** Modifiers of each level (only rate stats in MOD_STATS; others are for later systems). */
  modifiers: CompiledModifier[][];
}

/** Content prepared once per sim: sorted, numeric indices, f32 thresholds. */
export interface ContentIndex {
  dayLengthMinutes: number;
  survival: SurvivalSettings;
  /** Sorted by id (numeric index = position; part of the state hash). */
  moodles: CompiledMoodle[];
  moodleIndex: ReadonlyMap<string, number>;
  /** Moodle indices that count as "Cold" for sleep quality (body temperature, falling). */
  coldMoodles: number[];
  /** Medical items with `stop_bleeding` (valid `bandage.itemId`). */
  bandageItems: ReadonlySet<string>;
  /** Item definitions sorted by id (numeric index = position; part of the state hash). */
  items: ItemDef[];
  itemIndex: ReadonlyMap<string, number>;
  /** Storage types sorted by id. */
  containerTypes: ContainerTypeDef[];
  containerTypeIndex: ReadonlyMap<string, number>;
  /** Loot tables sorted by id (table choice by room + container is the first match). */
  lootTables: LootTableDef[];
  lootTableById: ReadonlyMap<string, LootTableDef>;
  /** Zombie types sorted by id (index = `Zombie.type`, part of the state hash). */
  zombieTypes: ZombieTypeDef[];
  zombieTypeIndex: ReadonlyMap<string, number>;
  /** Animal types sorted by id (index = `Animal.type` = snapshot `variant`, hashed). */
  animalTypes: AnimalTypeDef[];
  animalTypeIndex: ReadonlyMap<string, number>;
  /** Vehicle types sorted by id (index = `Vehicle.type` = vehicle snapshot `variant`, hashed). */
  vehicleTypes: VehicleTypeDef[];
  vehicleTypeIndex: ReadonlyMap<string, number>;
  carry: ContentBundle['worldSettings']['carry'];
  loot: ContentBundle['worldSettings']['loot'];
  /** `worldSettings.vision` (optional for older bundles). */
  vision: ContentBundle['worldSettings']['vision'] | undefined;
  /** `worldSettings.openings` (optional for older bundles). */
  openings: ContentBundle['worldSettings']['openings'] | undefined;
  /** `worldSettings.firearms` (optional for older bundles). */
  firearms: ContentBundle['worldSettings']['firearms'] | undefined;
  /** `worldSettings.noise` (between floors; optional for older bundles). */
  noise: ContentBundle['worldSettings']['noise'] | undefined;
  /** `worldSettings.ai` (losing the track; optional for older bundles). */
  aiSettings: ContentBundle['worldSettings']['ai'] | undefined;
  /** `worldSettings.combat` (#298; optional, sim falls back to `DEFAULT_*`). */
  combatSettings: ContentBundle['worldSettings']['combat'] | undefined;
  /** `worldSettings.movement` (walk speed, gait multipliers; optional for older bundles). */
  movement: ContentBundle['worldSettings']['movement'] | undefined;
  /** `worldSettings.simLod` (big-map LOD; optional for older bundles). */
  simLod: ContentBundle['worldSettings']['simLod'] | undefined;
  /** `worldSettings.water` (tank drink, bottle fill; optional for older bundles, docs 9.59). */
  water: WaterSettings | undefined;
  /** `worldSettings.vehicles` (vehicle gameplay; optional for older bundles). */
  vehicles: ContentBundle['worldSettings']['vehicles'] | undefined;
  /** `worldSettings.utilities` (mains power / water shutoff; optional for older bundles). */
  utilities: ContentBundle['worldSettings']['utilities'] | undefined;
  /**
   * `worldSettings.furnitureFootprint` / `furnitureTall` / `furnitureLongSideAccess` (optional
   * for older bundles: footprint off).
   */
  furniture: {
    footprint: boolean;
    tall: readonly string[];
    longSide: readonly string[];
    /** `worldSettings.furnitureFixed`: fixtures that cannot be moved (reason `fixed`). */
    fixed: readonly string[];
  };
  /** `worldSettings.loot.search` with defaults (search action, spot radius). */
  search: { searchSec: number; spotRadiusTiles: number };
  /** Loot tables with a `scatter` block (sorted by id): items spread over the map at init. */
  scatterTables: LootTableDef[];
  /** Tile id → tags (`tiles/`), for `scatter.terrain`. */
  tileTags: ReadonlyMap<string, readonly string[]>;
  /** Skills sorted by id (index = position in `PlayerProgress.level/xp`). */
  skills: SkillDef[];
  skillIndex: ReadonlyMap<string, number>;
  /** Recipes sorted by id (index = `ActionState.recipe − 1`, `PlayerProgress.known`). */
  recipes: RecipeDef[];
  recipeIndex: ReadonlyMap<string, number>;
  stations: ReadonlyMap<string, StationDef>;
  /** Item index → the station it is when placed (`placeable.station`). */
  stationOfItem: ReadonlyMap<number, { id: string; level: number }>;
  crafting: CraftingConfig;
  /** `worldSettings.lighting` (switches, curtains, lit-window lure); bundles without it: no lure. */
  lighting: LightingSettings;
  traits: ReadonlyMap<string, TraitDef>;
  professions: ReadonlyMap<string, ProfessionDef>;
  appearanceParts: ReadonlyMap<string, AppearancePartDef>;
  palettes: ReadonlyMap<string, PaletteDef>;
  /** `worldSettings.characterCreation` (undefined in older bundles / fixtures). */
  characterCreation: CharacterCreationSettings | undefined;
  /** Rate-stat modifiers (MOD_STATS only) of traits and professions by id. */
  traitMods: ReadonlyMap<string, CompiledModifier[]>;
  professionMods: ReadonlyMap<string, CompiledModifier[]>;
}

/** `worldSettings.crafting` with defaults (older bundles / fixtures). */
export interface CraftingConfig {
  nearbyRadiusTiles: number;
  timeReductionPerSkillLevel: number;
  minTimeMultiplier: number;
  /** Burning cooked food (docs 9.52); bundles without it never burn. */
  burn: BurnConfig;
}

export type BurnConfig = Omit<CraftingSettings['burn'], 'stations'> & {
  stations: readonly string[];
};

const NO_LIGHTING: LightingSettings = {
  switchTag: 'base:light-switch',
  lure: { enabled: false, maxSky: 0, radiusTiles: 0, volume: 0, lingerSec: 0 },
};

const NO_BURN: BurnConfig = {
  enabled: false,
  stations: [],
  skill: 'base:cooking',
  chance: 0,
  chancePerSkillLevel: 0,
  nutritionMultiplier: 1,
  unhappiness: 0,
};

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function furnitureSettings(ws: Partial<ContentBundle['worldSettings']>): ContentIndex['furniture'] {
  return {
    footprint: ws.furnitureFootprint ?? true,
    tall: ws.furnitureTall ?? [],
    longSide: ws.furnitureLongSideAccess ?? [],
    fixed: ws.furnitureFixed ?? [],
  };
}

export function compileContent(content: SimContent): ContentIndex {
  const ids = Object.keys(content.moodles).sort(byId);
  const moodles: CompiledMoodle[] = ids.map((id) => {
    const m = content.moodles[id]!;
    return {
      id,
      stat: m.stat,
      rising: m.direction !== 'falling',
      maxLevel: m.levels.length,
      enterAt: m.levels.map((l) => Math.fround(l.enterAt)),
      exitAt: m.levels.map((l) => Math.fround(l.exitAt)),
      modifiers: m.levels.map((l) =>
        l.modifiers.flatMap((mod): CompiledModifier[] => {
          const slot = (ModSlot as Record<string, number | undefined>)[mod.stat];
          return slot === undefined ? [] : [{ slot, op: mod.op, value: mod.value, when: mod.when }];
        }),
      ),
    };
  });
  const bandageItems = new Set<string>();
  for (const id of Object.keys(content.items).sort(byId)) {
    const item = content.items[id]!;
    if (item.kind === 'medical' && item.medical.effects.includes('stop_bleeding')) {
      bandageItems.add(id);
    }
  }
  const itemIds = Object.keys(content.items).sort(byId);
  const typeIds = Object.keys(content.containers).sort(byId);
  const tableIds = Object.keys(content.lootTables).sort(byId);
  const zombieIds = Object.keys(content.zombieTypes ?? {}).sort(byId);
  const animalIds = Object.keys(content.animalTypes ?? {}).sort(byId);
  const vehicleIds = Object.keys(content.vehicleTypes ?? {}).sort(byId);
  const skillIds = Object.keys(content.skills ?? {}).sort(byId);
  const recipeIds = Object.keys(content.recipes ?? {}).sort(byId);
  const itemIndex = new Map(itemIds.map((id, i) => [id, i]));
  const stationOfItem = new Map<number, { id: string; level: number }>();
  itemIds.forEach((id, i) => {
    const d = content.items[id]!;
    if (d.kind === 'placeable' && d.placeable.station) stationOfItem.set(i, d.placeable.station);
  });
  const cs = (content.worldSettings as { crafting?: Partial<CraftingConfig> }).crafting ?? {};
  const compileMods = (mods: readonly ModifierDef[]): CompiledModifier[] =>
    mods.flatMap((mod): CompiledModifier[] => {
      const slot = (ModSlot as Record<string, number | undefined>)[mod.stat];
      return slot === undefined ? [] : [{ slot, op: mod.op, value: mod.value, when: mod.when }];
    });
  const sortedEntries = <T>(r: Readonly<Record<string, T>> | undefined): [string, T][] =>
    Object.keys(r ?? {})
      .sort(byId)
      .map((id) => [id, r![id]!]);
  const traits = sortedEntries(content.traits);
  const professions = sortedEntries(content.professions);
  return {
    traits: new Map(traits),
    professions: new Map(professions),
    appearanceParts: new Map(sortedEntries(content.appearanceParts)),
    palettes: new Map(sortedEntries(content.palettes)),
    characterCreation: (content.worldSettings as { characterCreation?: CharacterCreationSettings })
      .characterCreation,
    traitMods: new Map(traits.map(([id, t]) => [id, compileMods(t.modifiers)])),
    professionMods: new Map(professions.map(([id, p]) => [id, compileMods(p.modifiers)])),
    skills: skillIds.map((id) => content.skills![id]!),
    skillIndex: new Map(skillIds.map((id, i) => [id, i])),
    recipes: recipeIds.map((id) => content.recipes![id]!),
    recipeIndex: new Map(recipeIds.map((id, i) => [id, i])),
    stations: new Map(Object.entries(content.stations ?? {})),
    stationOfItem,
    crafting: {
      nearbyRadiusTiles: cs.nearbyRadiusTiles ?? 3,
      timeReductionPerSkillLevel: cs.timeReductionPerSkillLevel ?? 0.05,
      minTimeMultiplier: cs.minTimeMultiplier ?? 0.5,
      burn: cs.burn ?? NO_BURN,
    },
    lighting: (content.worldSettings as { lighting?: LightingSettings }).lighting ?? NO_LIGHTING,
    zombieTypes: zombieIds.map((id) => content.zombieTypes![id]!),
    zombieTypeIndex: new Map(zombieIds.map((id, i) => [id, i])),
    animalTypes: animalIds.map((id) => content.animalTypes![id]!),
    animalTypeIndex: new Map(animalIds.map((id, i) => [id, i])),
    vehicleTypes: vehicleIds.map((id) => content.vehicleTypes![id]!),
    vehicleTypeIndex: new Map(vehicleIds.map((id, i) => [id, i])),
    items: itemIds.map((id) => content.items[id]!),
    itemIndex,
    containerTypes: typeIds.map((id) => content.containers[id]!),
    containerTypeIndex: new Map(typeIds.map((id, i) => [id, i])),
    lootTables: tableIds.map((id) => content.lootTables[id]!),
    lootTableById: new Map(tableIds.map((id) => [id, content.lootTables[id]!])),
    carry: content.worldSettings.carry,
    loot: content.worldSettings.loot,
    vision: content.worldSettings.vision,
    openings: content.worldSettings.openings,
    firearms: content.worldSettings.firearms,
    noise: content.worldSettings.noise,
    aiSettings: (content.worldSettings as { ai?: ContentBundle['worldSettings']['ai'] }).ai,
    combatSettings: content.worldSettings.combat,
    movement: (content.worldSettings as { movement?: ContentBundle['worldSettings']['movement'] })
      .movement,
    simLod: (content.worldSettings as { simLod?: ContentBundle['worldSettings']['simLod'] }).simLod,
    water: (content.worldSettings as { water?: WaterSettings }).water,
    vehicles: (content.worldSettings as { vehicles?: ContentBundle['worldSettings']['vehicles'] })
      .vehicles,
    utilities: (
      content.worldSettings as { utilities?: ContentBundle['worldSettings']['utilities'] }
    ).utilities,
    furniture: furnitureSettings(content.worldSettings),
    search: {
      searchSec: content.worldSettings.loot.search?.searchSec ?? 3.5,
      spotRadiusTiles: content.worldSettings.loot.search?.spotRadiusTiles ?? 1.5,
    },
    scatterTables: tableIds.map((id) => content.lootTables[id]!).filter((t) => t.scatter),
    tileTags: new Map(sortedEntries(content.tiles).map(([id, t]) => [id, t.tags])),
    dayLengthMinutes: content.worldSettings.dayLengthMinutes,
    survival: content.worldSettings.survival,
    moodles,
    moodleIndex: new Map(ids.map((id, i) => [id, i])),
    coldMoodles: moodles.flatMap((m, i) =>
      m.stat === 'body-temperature-c' && !m.rising ? [i] : [],
    ),
    bandageItems,
  };
}
