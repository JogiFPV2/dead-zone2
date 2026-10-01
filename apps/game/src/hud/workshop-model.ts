import type {
  CraftingView,
  RecipePartView,
  RecipeState,
  RecipeStatusView,
  SkillView,
  StationNearbyView,
} from '@deadzone/protocol';
import {
  categoryName,
  craftItemName,
  partName,
  recipeName,
  skillName,
  stationName,
} from './crafting-labels.js';
import type { HudContentIndex, HudStationDef } from './content-index.js';

/**
 * Workshop window view models (mockup workshop.png): stations on the left, the selected station's
 * recipes in the middle, the selected recipe on the right, the station upgrade at the bottom.
 * Pure functions of the sim's crafting view + content; the window only renders them.
 */

/** Recipes without a station („Ręcznie”). */
export const HAND = 'hand';

export type RecipeFilter = 'all' | 'available' | 'hideLocked';

export interface StationVM {
  key: string;
  name: string;
  /** 0 = not built nearby (hand: always 1 of 1). */
  level: number;
  maxLevel: number;
  built: boolean;
  selected: boolean;
  recipes: number;
  available: number;
  /** Tiles to the nearest one (built only). */
  distance?: number;
  /** Not built: what building it needs („Wymaga: Stolarka 2”). */
  needs?: string;
}

export type BadgeTone = 'ok' | 'combo' | 'warn' | 'lock';

export interface RecipeRowVM {
  id: string;
  name: string;
  category: string;
  /** Parts line („Deska ×3 · Gwoździe ×6 · Młotek”) or the blocking reason. */
  sub: string;
  subTone: 'muted' | 'warn' | 'danger';
  badge: string;
  tone: BadgeTone;
  locked: boolean;
  selected: boolean;
  item?: string;
}

export interface RecipeGroupVM {
  category: string;
  name: string;
  rows: RecipeRowVM[];
}

export interface PartVM {
  name: string;
  item?: string;
  have: number;
  need: number;
  ok: boolean;
}

export interface RecipeDetailVM {
  id: string;
  name: string;
  category: string;
  state: RecipeState;
  stateLabel: string;
  item?: string;
  resultCount: number;
  parts: PartVM[];
  tools: PartVM[];
  skills: { name: string; need: number; have: number; ok: boolean }[];
  /** Game minutes per piece. */
  minutes: number;
  /** How many can be made right now (0 when blocked). */
  max: number;
  station?: { name: string; level: number; minLevel: number; ok: boolean };
}

export interface UpgradeVM {
  stationName: string;
  toLevel: number;
  x: number;
  y: number;
  recipe: string;
  parts: PartVM[];
  tools: PartVM[];
  skills: { name: string; need: number; have: number; ok: boolean }[];
  minutes: number;
  ready: boolean;
}

const STATE_LABEL: Record<RecipeState, string> = {
  available: 'Dostępne',
  notLearned: 'Nieznany przepis',
  skillLocked: 'Za niska umiejętność',
  stationLevelLocked: 'Za niski poziom stanowiska',
  missingParts: 'Brak części',
};

const isLocked = (s: RecipeState): boolean =>
  s === 'notLearned' || s === 'skillLocked' || s === 'stationLevelLocked';

/** Recipe ids that upgrade a station (level ≥ 2): shown in the bottom bar, not in the list. */
export function upgradeRecipes(content: HudContentIndex): Set<string> {
  const out = new Set<string>();
  for (const st of content.stations?.values() ?? [])
    for (const l of st.levels) if (l.level >= 2 && l.recipe) out.add(l.recipe);
  return out;
}

/** How many times the recipe can be made from what is at hand (0 = blocked). */
export function maxCraftable(r: RecipeStatusView): number {
  if (r.state !== 'available') return 0;
  let n = 99;
  for (const p of r.parts) if (p.need > 0) n = Math.min(n, Math.floor(p.have / p.need));
  for (const t of r.tools) if (t.have < 1) n = 0;
  return Math.max(0, n === 99 ? 1 : n);
}

const partVM = (p: RecipePartView): PartVM => ({
  name: partName(p),
  ...(p.item ? { item: p.item } : {}),
  have: p.have,
  need: p.need,
  ok: p.have >= p.need,
});

const stationKey = (r: RecipeStatusView): string => r.station?.id ?? HAND;

/** Workshop recipes (craft, not station upgrades). */
export function workshopRecipes(
  view: CraftingView | undefined,
  content: HudContentIndex,
): RecipeStatusView[] {
  const up = upgradeRecipes(content);
  return (view?.recipes ?? []).filter((r) => r.kind === 'craft' && !up.has(r.id));
}

/** Nearest built station of `id` (highest level first). */
export function nearestStation(
  view: CraftingView | undefined,
  id: string,
  px: number,
  py: number,
): StationNearbyView | undefined {
  const list = (view?.stations ?? []).filter((s) => s.id === id);
  const d = (s: StationNearbyView) => Math.hypot(s.x + 0.5 - px, s.y + 0.5 - py);
  return list.sort((a, b) => b.level - a.level || d(a) - d(b))[0];
}

function buildNeeds(
  st: HudStationDef,
  recipes: ReadonlyMap<string, RecipeStatusView>,
): string | undefined {
  const r = recipes.get(st.levels[0]?.recipe ?? '');
  if (!r) return undefined;
  const skill = r.skills.find((s) => s.have < s.need);
  if (skill) return `Wymaga: ${skillName(skill.skill)} ${skill.need}`;
  const part = r.parts.find((p) => p.have < p.need);
  if (part) return `Brak: ${partName(part)} ${part.have}/${part.need}`;
  return r.state === 'available' ? 'Można zbudować (Ręcznie)' : undefined;
}

export function stationsVM(
  view: CraftingView | undefined,
  content: HudContentIndex,
  selected: string,
  px: number,
  py: number,
): StationVM[] {
  const recipes = workshopRecipes(view, content);
  const byId = new Map((view?.recipes ?? []).map((r) => [r.id, r]));
  const count = (key: string) => {
    const list = recipes.filter((r) => stationKey(r) === key);
    return { recipes: list.length, available: list.filter((r) => r.state === 'available').length };
  };
  const out: StationVM[] = [
    {
      key: HAND,
      name: stationName(HAND),
      level: 1,
      maxLevel: 1,
      built: true,
      selected: selected === HAND,
      ...count(HAND),
    },
  ];
  for (const st of content.stations?.values() ?? []) {
    const near = nearestStation(view, st.id, px, py);
    const needs = near ? undefined : buildNeeds(st, byId);
    out.push({
      key: st.id,
      name: stationName(st.id),
      level: near?.level ?? 0,
      maxLevel: st.levels.length,
      built: near !== undefined,
      selected: selected === st.id,
      ...count(st.id),
      ...(near ? { distance: Math.round(Math.hypot(near.x + 0.5 - px, near.y + 0.5 - py)) } : {}),
      ...(needs ? { needs } : {}),
    });
  }
  return out;
}

function rowSub(r: RecipeStatusView): { sub: string; subTone: RecipeRowVM['subTone'] } {
  if (r.state === 'notLearned')
    return { sub: 'Przepis nieznany (książki, zawód)', subTone: 'danger' };
  if (r.state === 'skillLocked') {
    const s = r.skills.find((x) => x.have < x.need);
    return {
      sub: s ? `Wymaga: ${skillName(s.skill)} ${s.need} (masz ${s.have})` : 'Wymaga umiejętności',
      subTone: 'danger',
    };
  }
  if (r.state === 'stationLevelLocked')
    return {
      sub: `Wymaga: ${stationName(r.station?.id ?? HAND).toLowerCase()} poz. ${r.station?.minLevel ?? 1}`,
      subTone: 'danger',
    };
  if (r.state === 'missingParts') {
    const miss = [...r.parts, ...r.tools].filter((p) => p.have < p.need);
    return {
      sub: `Brak: ${miss.map((p) => `${partName(p)} ${p.have}/${p.need}`).join(' · ')}`,
      subTone: 'warn',
    };
  }
  const parts = r.parts.map((p) => `${partName(p)} ×${p.need}`);
  const tools = r.tools.map((t) => partName(t));
  return { sub: [...parts, ...tools].join(' · '), subTone: 'muted' };
}

function badgeOf(r: RecipeStatusView): { badge: string; tone: BadgeTone } {
  switch (r.state) {
    case 'available': {
      const n = maxCraftable(r);
      return n >= 2 ? { badge: `Można +${n}`, tone: 'combo' } : { badge: 'Dostępne', tone: 'ok' };
    }
    case 'missingParts':
      return { badge: 'Brak części', tone: 'warn' };
    case 'skillLocked':
      return { badge: 'Umiejętność', tone: 'lock' };
    case 'stationLevelLocked':
      return { badge: 'Poz. stołu', tone: 'lock' };
    default:
      return { badge: 'Nieznany', tone: 'lock' };
  }
}

const firstResult = (content: HudContentIndex, id: string) => content.recipes?.get(id)?.results[0];

export function recipeGroupsVM(
  view: CraftingView | undefined,
  content: HudContentIndex,
  station: string,
  opts: { filter: RecipeFilter; query: string; selected: string | undefined },
): RecipeGroupVM[] {
  const q = opts.query.trim().toLowerCase();
  const groups = new Map<string, RecipeGroupVM>();
  for (const r of workshopRecipes(view, content)) {
    if (stationKey(r) !== station) continue;
    if (opts.filter === 'available' && r.state !== 'available') continue;
    if (opts.filter === 'hideLocked' && isLocked(r.state)) continue;
    const name = recipeName(r.id);
    if (q && !name.toLowerCase().includes(q)) continue;
    let g = groups.get(r.category);
    if (!g) {
      g = { category: r.category, name: categoryName(r.category), rows: [] };
      groups.set(r.category, g);
    }
    const res = firstResult(content, r.id);
    g.rows.push({
      id: r.id,
      name,
      category: r.category,
      ...rowSub(r),
      ...badgeOf(r),
      locked: isLocked(r.state),
      selected: r.id === opts.selected,
      ...(res ? { item: res.item } : {}),
    });
  }
  const order = (s: RecipeState) => (s === 'available' ? 0 : s === 'missingParts' ? 1 : 2);
  const state = new Map((view?.recipes ?? []).map((r) => [r.id, r.state]));
  for (const g of groups.values())
    g.rows.sort(
      (a, b) =>
        order(state.get(a.id)!) - order(state.get(b.id)!) || a.name.localeCompare(b.name, 'pl'),
    );
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

/** Selected recipe if still listed, else the first row. */
export function pickSelected(
  groups: readonly RecipeGroupVM[],
  sel: string | undefined,
): string | undefined {
  const rows = groups.flatMap((g) => g.rows);
  return rows.find((r) => r.id === sel)?.id ?? rows[0]?.id;
}

const skillsVM = (r: RecipeStatusView) =>
  r.skills.map((s) => ({
    name: skillName(s.skill),
    need: s.need,
    have: s.have,
    ok: s.have >= s.need,
  }));

export function recipeDetailVM(
  view: CraftingView | undefined,
  content: HudContentIndex,
  id: string | undefined,
): RecipeDetailVM | undefined {
  const r = view?.recipes.find((x) => x.id === id);
  if (!r) return undefined;
  const res = firstResult(content, r.id);
  return {
    id: r.id,
    name: recipeName(r.id),
    category: categoryName(r.category),
    state: r.state,
    stateLabel: STATE_LABEL[r.state],
    ...(res ? { item: res.item } : {}),
    resultCount: res?.count ?? 1,
    parts: r.parts.map(partVM),
    tools: r.tools.map(partVM),
    skills: skillsVM(r),
    minutes: r.durationMin,
    max: maxCraftable(r),
    ...(r.station
      ? {
          station: {
            name: stationName(r.station.id),
            level: r.station.level,
            minLevel: r.station.minLevel,
            ok: r.station.level >= r.station.minLevel,
          },
        }
      : {}),
  };
}

/** Upgrade of the selected (built) station to the next level, if there is one. */
export function upgradeVM(
  view: CraftingView | undefined,
  content: HudContentIndex,
  station: string,
  px: number,
  py: number,
): UpgradeVM | undefined {
  if (station === HAND) return undefined;
  const near = nearestStation(view, station, px, py);
  if (!near?.upgrade) return undefined;
  const r = view?.recipes.find((x) => x.id === near.upgrade);
  if (!r) return undefined;
  return {
    stationName: stationName(station),
    toLevel: near.level + 1,
    x: near.x,
    y: near.y,
    recipe: r.id,
    parts: r.parts.map(partVM),
    tools: r.tools.map(partVM),
    skills: skillsVM(r),
    minutes: r.durationMin,
    ready: r.state === 'available',
  };
}

/** Crafting skills with progress (skills any recipe asks for, then the rest with XP). */
export function craftSkillsVM(
  skills: readonly SkillView[],
  view: CraftingView | undefined,
): { name: string; level: number; pct: number }[] {
  const wanted = new Set((view?.recipes ?? []).flatMap((r) => r.skills.map((s) => s.skill)));
  return skills
    .filter((s) => wanted.has(s.id))
    .map((s) => ({
      name: skillName(s.id),
      level: s.level,
      pct: s.next ? Math.max(0, Math.min(1, s.xp / s.next)) : 1,
    }));
}

/** `1:04` from game minutes. */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

export { craftItemName };
