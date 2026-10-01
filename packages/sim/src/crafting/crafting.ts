import {
  CHUNK_SIZE,
  type Command,
  type CommandRejectReason,
  type CraftingView,
  type RecipePartView,
  type RecipeState,
  type RecipeStatusView,
  type StationNearbyView,
} from '@deadzone/protocol';
import { newAction, registerAction, startAction } from '../actions/queue.js';
import type { RecipeDef } from '../content/adapter.js';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { addPieces, carriedItems } from '../items/actions.js';
import { carriedLoad, hardLimit, playerItems, stableIdOf } from '../items/inventory.js';
import {
  defOf,
  destroyItem,
  groundPile,
  maxCondition,
  tileKey,
  type ActionState,
  type ItemInstance,
  type ItemStore,
} from '../items/store.js';
import { addXp, learnRecipe, progressOf } from '../progress/skills.js';
import { applyLeisure } from '../leisure/leisure.js';
import { floorZ } from '../world/levels.js';

/** A station within the crafting radius: a station item on a ground pile, or a map object. */
export interface StationAt {
  id: string;
  level: number;
  x: number;
  y: number;
  z: number;
  /** Station item lying on a ground pile (upgradable); undefined for map objects. */
  item: ItemInstance | undefined;
}

interface Sources {
  /** Carried items first (UI order), then items in nearby containers (by container id). */
  items: ItemInstance[];
  stations: StationAt[];
}

/** Items and stations within `crafting.nearbyRadiusTiles` (same floor; searched storage only). */
export function craftSources(w: SimWorld, eid: number): Sources {
  const st = w.items!;
  const p = playerItems(w, eid);
  const items = p ? carriedItems(st, p.inventory) : [];
  const stations: StationAt[] = [];
  const { Position } = w.c;
  const px = Position.x[eid] ?? 0;
  const py = Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const r = st.content.crafting.nearbyRadiusTiles;
  const near = (x: number, y: number): boolean => {
    const dx = x + 0.5 - px;
    const dy = y + 0.5 - py;
    return dx * dx + dy * dy <= r * r;
  };
  const sid = stableIdOf(w, eid);
  const containers: number[] = [];
  const x0 = Math.floor(px - r);
  const y0 = Math.floor(py - r);
  for (let y = y0; y <= Math.floor(py + r); y++) {
    for (let x = x0; x <= Math.floor(px + r); x++) {
      if (!near(x, y)) continue;
      const key = tileKey(x, y, z);
      for (const id of st.worldByTile.get(key) ?? []) {
        if (st.containers.get(id)?.searchedBy.includes(sid)) containers.push(id);
      }
      const pile = st.ground.get(key);
      if (pile !== undefined) containers.push(pile);
    }
  }
  containers.sort((a, b) => a - b);
  for (const cid of containers) {
    const c = st.containers.get(cid)!;
    for (const item of carriedItems(st, cid)) {
      items.push(item);
      const s = st.content.stationOfItem.get(item.def);
      if (s && item.loc === cid && c.kind === 'ground')
        stations.push({ ...s, x: c.x, y: c.y, z: c.z, item });
    }
  }
  // Stations placed on the map (fixed objects: usable, not upgradable).
  const cx0 = Math.floor((px - r) / CHUNK_SIZE);
  const cy0 = Math.floor((py - r) / CHUNK_SIZE);
  for (let cy = cy0; cy <= Math.floor((py + r) / CHUNK_SIZE); cy++) {
    for (let cx = cx0; cx <= Math.floor((px + r) / CHUNK_SIZE); cx++) {
      for (const obj of w.map.getChunk(cx, cy, z)?.objects ?? []) {
        const idx = st.content.itemIndex.get(obj.contentId);
        const s = idx === undefined ? undefined : st.content.stationOfItem.get(idx);
        const x = cx * CHUNK_SIZE + obj.x;
        const y = cy * CHUNK_SIZE + obj.y;
        if (s && near(x, y)) stations.push({ ...s, x, y, z, item: undefined });
      }
    }
  }
  return { items, stations };
}

type Need = { item: string; tag?: undefined } | { tag: string; item?: undefined };
const matches = (st: ItemStore, item: ItemInstance, n: Need): boolean => {
  const def = defOf(st, item);
  return n.item !== undefined ? def.id === n.item : def.tags.includes(n.tag);
};
/** Bags / storage with something inside are not consumed (nor used as tools). */
const usable = (st: ItemStore, item: ItemInstance): boolean =>
  !item.inner || (st.containers.get(item.inner)?.items.length ?? 0) === 0;

export interface RecipeEval {
  state: RecipeState;
  reason: CommandRejectReason | undefined;
  parts: RecipePartView[];
  tools: RecipePartView[];
  skills: { skill: string; need: number; have: number }[];
  station: { id: string; minLevel: number; level: number } | undefined;
  /** Pieces to consume (item → count), only when all parts are there. */
  take: [ItemInstance, number][];
  toolItems: ItemInstance[];
  repairItem: ItemInstance | undefined;
  durationMin: number;
}

const partOf = (n: Need, have: number, need: number): RecipePartView =>
  n.item !== undefined ? { item: n.item, have, need } : { tag: n.tag, have, need };

/** Recipe state for a player: learned, skills, station level, parts and tools at hand. */
export function evalRecipe(
  w: SimWorld,
  eid: number,
  ri: number,
  src: Sources,
  prefer: readonly number[] = [],
): RecipeEval {
  const st = w.items!;
  const r = st.content.recipes[ri]!;
  const prog = progressOf(w, eid);
  const learned = !r.requiresLearning || (prog?.known.includes(ri) ?? false);
  const skills = r.skills.map((s) => {
    const i = st.content.skillIndex.get(s.skill);
    return { skill: s.skill, need: s.level, have: i === undefined ? 0 : (prog?.level[i] ?? 0) };
  });
  const skillOk = skills.every((s) => s.have >= s.need);
  let station: RecipeEval['station'];
  let stationMul = 1;
  if (r.station) {
    const level = src.stations
      .filter((s) => s.id === r.station!.id)
      .reduce((m, s) => Math.max(m, s.level), 0);
    station = { id: r.station.id, minLevel: r.station.minLevel, level };
    const def = st.content.stations.get(r.station.id);
    stationMul = def?.levels.find((l) => l.level === level)?.craftTimeMultiplier ?? 1;
  }
  const stationOk = !station || station.level >= station.minLevel;
  // Ingredients: selected items first, then carried, then nearby (greedy, in recipe order).
  const order = [
    ...prefer.flatMap((id) => {
      const it = st.items.get(id);
      return it ? [it] : [];
    }),
    ...src.items.filter((i) => !prefer.includes(i.id)),
  ].filter((i) => usable(st, i));
  const used = new Map<ItemInstance, number>();
  const parts: RecipePartView[] = [];
  let partsOk = true;
  for (const ing of r.ingredients) {
    let left = ing.count;
    let have = 0;
    for (const it of order) {
      if (!matches(st, it, ing)) continue;
      const free = it.count - (used.get(it) ?? 0);
      if (free <= 0) continue;
      have += free;
      const k = Math.min(left, free);
      if (k > 0) used.set(it, (used.get(it) ?? 0) + k);
      left -= k;
    }
    if (left > 0) partsOk = false;
    parts.push(partOf(ing, have, ing.count));
  }
  // Repair recipes: a damaged target item (not consumed) must be at hand.
  let repairItem: ItemInstance | undefined;
  if (r.repair) {
    const rep = r.repair;
    repairItem = order.find((it) => {
      const max = maxCondition(defOf(st, it));
      return matches(st, it, rep) && max > 0 && it.condition < max && !used.has(it);
    });
    if (!repairItem) partsOk = false;
    parts.push(partOf(rep, repairItem ? 1 : 0, 1));
  }
  const toolItems: ItemInstance[] = [];
  const tools: RecipePartView[] = r.tools.map((t) => {
    const found = order.find(
      (it) =>
        matches(st, it, t) &&
        (used.get(it) ?? 0) < it.count &&
        (maxCondition(defOf(st, it)) === 0 || it.condition > 0),
    );
    if (found) toolItems.push(found);
    else partsOk = false;
    return partOf(t, found ? 1 : 0, 1);
  });
  let extra = Infinity;
  for (const s of skills) extra = Math.min(extra, s.have - s.need);
  if (!Number.isFinite(extra)) extra = 0;
  const cfg = st.content.crafting;
  const skillMul = Math.max(cfg.minTimeMultiplier, 1 - cfg.timeReductionPerSkillLevel * extra);
  const durationMin = Math.round(r.durationMin * stationMul * skillMul * 100) / 100;
  const state: RecipeState = !learned
    ? 'notLearned'
    : !skillOk
      ? 'skillLocked'
      : !stationOk
        ? 'stationLevelLocked'
        : !partsOk
          ? 'missingParts'
          : 'available';
  const reason: CommandRejectReason | undefined = {
    notLearned: 'not-learned' as const,
    skillLocked: 'skill-too-low' as const,
    stationLevelLocked: 'no-station' as const,
    missingParts: tools.some((t) => t.have === 0)
      ? ('missing-tool' as const)
      : ('missing-parts' as const),
    available: undefined,
  }[state];
  return {
    state,
    reason,
    parts,
    tools,
    skills,
    station,
    take: partsOk ? [...used] : [],
    toolItems,
    repairItem,
    durationMin,
  };
}

/** The station item lying on tile (x, y) within the radius and its upgrade recipe. */
function upgradeTarget(
  w: SimWorld,
  src: Sources,
  x: number,
  y: number,
): { at: StationAt; recipe: number } | CommandRejectReason {
  const st = w.items!;
  const at = src.stations.find((s) => s.x === x && s.y === y);
  if (!at) return 'no-station';
  if (!at.item) return 'invalid-target';
  const next = st.content.stations.get(at.id)?.levels.find((l) => l.level === at.level + 1);
  const recipe = next ? st.content.recipeIndex.get(next.recipe) : undefined;
  return recipe === undefined ? 'invalid-target' : { at, recipe };
}

export type CraftCommand = Extract<Command, { type: 'craft' | 'combine' | 'upgradeStation' }>;
export const isCraftCommand = (cmd: Command): cmd is CraftCommand =>
  cmd.type === 'craft' || cmd.type === 'combine' || cmd.type === 'upgradeStation';

export function applyCraftCommand(
  w: SimWorld,
  eid: number,
  cmd: CraftCommand,
): CommandRejectReason | undefined {
  const st = w.items;
  if (!st || !playerItems(w, eid)) return 'invalid-state';
  if (cmd.type === 'craft') {
    const ri = st.content.recipeIndex.get(cmd.recipe);
    if (ri === undefined) return 'unknown-item';
    for (let i = 0; i < (cmd.count ?? 1); i++) {
      const reason = startAction(w, eid, newAction('craft', { recipe: ri + 1 }));
      if (reason) return i === 0 ? reason : undefined;
    }
    return undefined;
  }
  if (cmd.type === 'upgradeStation') {
    const t = upgradeTarget(w, craftSources(w, eid), cmd.x, cmd.y);
    if (typeof t === 'string') return t;
    const pile = st.ground.get(tileKey(t.at.x, t.at.y, t.at.z)) ?? 0;
    return startAction(
      w,
      eid,
      newAction('craft', { recipe: t.recipe + 1, use: [t.at.item!.id], container: pile }),
    );
  }
  // combine: the selected items must all be carried / nearby and covered by one recipe.
  const src = craftSources(w, eid);
  const picked = cmd.items.map((id) => st.items.get(id));
  if (picked.some((i) => !i || !src.items.includes(i))) return 'no-item';
  const sel = picked as ItemInstance[];
  const only = cmd.recipe === undefined ? undefined : st.content.recipeIndex.get(cmd.recipe);
  if (cmd.recipe !== undefined && only === undefined) return 'unknown-item';
  const candidates: number[] = [];
  st.content.recipes.forEach((r, ri) => {
    if (r.kind !== 'combine' || (only !== undefined && ri !== only)) return;
    const covers = (it: ItemInstance) =>
      r.ingredients.some((ing) => matches(st, it, ing)) || (r.repair && matches(st, it, r.repair));
    if (sel.every(covers)) candidates.push(ri);
  });
  if (candidates.length === 0) return 'invalid-target';
  const use = sel.map((i) => i.id);
  const best =
    candidates.find((ri) => evalRecipe(w, eid, ri, src, use).state === 'available') ??
    candidates[0]!;
  return startAction(w, eid, newAction('craft', { recipe: best + 1, use }));
}

const recipeOf = (w: SimWorld, a: ActionState): RecipeDef | undefined =>
  a.recipe ? w.items?.content.recipes[a.recipe - 1] : undefined;

/** Registers `craft` and `read` (idempotent, called with the item actions). */
export function registerCraftActions(): void {
  registerAction('craft', {
    validate(w, eid, a) {
      if (!recipeOf(w, a)) return 'unknown-item';
      return evalRecipe(w, eid, a.recipe - 1, craftSources(w, eid), a.use).reason;
    },
    durationMin(w, eid, a) {
      return evalRecipe(w, eid, a.recipe - 1, craftSources(w, eid), a.use).durationMin;
    },
    complete(w, eid, a) {
      const st = w.items!;
      const r = recipeOf(w, a)!;
      const ev = evalRecipe(w, eid, a.recipe - 1, craftSources(w, eid), a.use);
      // Where heavy results go: the upgraded station's tile, else the player's tile.
      const target = st.containers.get(a.container);
      const { Position } = w.c;
      const tile = target
        ? { x: target.x, y: target.y, z: target.z }
        : {
            x: Math.floor(Position.x[eid] ?? 0),
            y: Math.floor(Position.y[eid] ?? 0),
            z: floorZ(w, eid),
          };
      for (const [item, n] of ev.take) {
        if (n >= item.count) destroyItem(st, item);
        else {
          item.count -= n;
          st.version++;
        }
      }
      r.tools.forEach((t, i) => {
        const tool = ev.toolItems[i];
        if (!tool || t.durabilityLoss <= 0 || maxCondition(defOf(st, tool)) === 0) return;
        tool.condition = Math.max(0, tool.condition - t.durabilityLoss);
        if (tool.condition === 0) destroyItem(st, tool);
        st.version++;
      });
      const minute = gameMinuteAt(w.clock, w.tick);
      const p = playerItems(w, eid)!;
      let pile: number | undefined;
      for (const res of r.results) {
        const def = st.content.itemIndex.get(res.item);
        if (def === undefined) continue;
        const d = st.content.items[def]!;
        const heavy =
          st.content.stationOfItem.has(def) ||
          carriedLoad(st, p) + d.weightKg * res.count > hardLimit(w, eid) + 1e-6;
        const into = heavy ? groundPile(st, tile.x, tile.y, tile.z).id : p.inventory;
        if (heavy) pile = into;
        addPieces(st, def, into, res.count, minute);
      }
      if (r.repair && ev.repairItem) {
        const max = maxCondition(defOf(st, ev.repairItem));
        const add = Math.ceil((max * r.repair.restorePct) / 100);
        ev.repairItem.condition = Math.min(max, ev.repairItem.condition + add);
        st.version++;
      }
      for (const x of r.xp) addXp(w, eid, x.skill, x.amount);
      w.events.push({
        type: 'crafted',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        recipe: r.id,
        results: r.results.map((x) => ({ def: x.item, count: x.count })),
        ...(pile !== undefined ? { container: pile } : {}),
      });
    },
  });

  registerAction('read', {
    validate(w, _eid, a) {
      const item = w.items?.items.get(a.item);
      return item && defOf(w.items!, item).kind === 'literature' ? undefined : 'no-item';
    },
    durationMin(w, _eid, a) {
      const def = defOf(w.items!, w.items!.items.get(a.item)!);
      return def.kind === 'literature' ? def.literature.readMin : 1;
    },
    complete(w, eid, a) {
      const st = w.items!;
      const def = defOf(st, st.items.get(a.item)!);
      const prog = progressOf(w, eid);
      if (def.kind !== 'literature' || !prog) return;
      const lit = def.literature;
      for (const id of lit.unlocksRecipes) {
        const ri = st.content.recipeIndex.get(id);
        if (ri === undefined || !learnRecipe(st, prog, ri)) continue;
        w.events.push({
          type: 'recipeLearned',
          tick: w.tick,
          playerId: w.c.Player.id[eid] ?? 0,
          recipe: id,
        });
      }
      const book = lit.skillBook;
      const si = book ? st.content.skillIndex.get(book.skill) : undefined;
      if (book && si !== undefined) {
        const lvl = prog.level[si] ?? 0;
        if (lvl >= book.minLevel && lvl <= book.maxLevel)
          prog.xpMul[si] = Math.max(prog.xpMul[si] ?? 1, book.multiplier);
      }
      // Leisure session: fatigue rest + boredom / stress (`leisure.read` + the item's own).
      applyLeisure(w, eid, 'read', {
        boredom: lit.boredomReduction,
        stress: lit.stressReduction,
      });
      st.version++;
    },
  });
}

// ── View ────────────────────────────────────────────────────────────────────────────────────

const cache = new WeakMap<SimWorld, Map<number, { key: string; view: CraftingView }>>();

/** All recipes with their state + stations nearby (cached per items version and tile). */
export function craftingView(w: SimWorld, eid: number): CraftingView | undefined {
  const st = w.items;
  if (!st || st.content.recipes.length === 0 || !playerItems(w, eid)) return undefined;
  const { Position } = w.c;
  const key = `${st.version}|${Math.floor((Position.x[eid] ?? 0) * 2)},${Math.floor((Position.y[eid] ?? 0) * 2)},${floorZ(w, eid)}`;
  let per = cache.get(w);
  if (!per) {
    per = new Map<number, { key: string; view: CraftingView }>();
    cache.set(w, per);
  }
  const hit = per.get(eid);
  if (hit?.key === key) return hit.view;
  const src = craftSources(w, eid);
  const recipes: RecipeStatusView[] = st.content.recipes.map((r, ri) => {
    const ev = evalRecipe(w, eid, ri, src);
    const v: RecipeStatusView = {
      id: r.id,
      kind: r.kind,
      category: r.category,
      state: ev.state,
      parts: ev.parts,
      tools: ev.tools,
      skills: ev.skills,
      durationMin: ev.durationMin,
    };
    if (ev.station) v.station = ev.station;
    return v;
  });
  const stations: StationNearbyView[] = src.stations.map((s) => {
    const next = st.content.stations.get(s.id)?.levels.find((l) => l.level === s.level + 1);
    return {
      id: s.id,
      level: s.level,
      x: s.x,
      y: s.y,
      upgrade: s.item && next ? next.recipe : null,
    };
  });
  stations.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const view = { recipes, stations };
  per.set(eid, { key, view });
  return view;
}

/** Item def index → combine recipes it is part of (learned ones) and whether one is ready. */
export function combineMarks(
  w: SimWorld,
  eid: number,
): Map<number, { recipes: string[]; ready: boolean }> {
  const out = new Map<number, { recipes: string[]; ready: boolean }>();
  const st = w.items;
  const view = craftingView(w, eid);
  const p = playerItems(w, eid);
  if (!st || !view || !p) return out;
  for (const item of carriedItems(st, p.inventory)) {
    if (out.has(item.def)) continue;
    const recipes: string[] = [];
    let ready = false;
    st.content.recipes.forEach((r, ri) => {
      if (r.kind !== 'combine') return;
      const s = view.recipes[ri]!;
      if (s.state === 'notLearned') return;
      const part =
        r.ingredients.some((ing) => matches(st, item, ing)) ||
        (r.repair !== undefined && matches(st, item, r.repair));
      if (!part) return;
      recipes.push(r.id);
      if (s.state === 'available') ready = true;
    });
    if (recipes.length > 0) out.set(item.def, { recipes, ready });
  }
  return out;
}
