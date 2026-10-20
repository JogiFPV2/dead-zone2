import type { CommandRejectReason } from '@deadzone/protocol';
import { noteContainerSearched } from '../map/player-map.js';
import { ModSlot, type ItemDef } from '../content/adapter.js';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { ACTION_KINDS, registerAction } from '../actions/queue.js';
import { registerCraftActions } from '../crafting/crafting.js';
import { registerLeisureActions } from '../leisure/leisure.js';
import { registerVehicleActions } from '../vehicles/actions.js';
import { isVehicleContainer, vehicleContainerBlock } from '../vehicles/containers.js';
import { registerLockActions } from '../furniture/locks.js';
import { disinfectPart, registerWoundCareActions } from '../survival/wound-care.js';
import { registerHygieneActions } from '../survival/hygiene.js';
import { registerWaterActions } from '../furniture/water.js';
import { registerFurnitureMoveActions } from '../physics/furniture.js';
import { rollPoisoning, rollSpoiledFood } from '../survival/poisoning.js';
import { registerOpeningActions } from '../openings/timed.js';
import { clampStat, modded } from '../survival/state.js';
import { bandagePart } from '../survival/wounds.js';
import { canReach, containerInReach, playerItems, stableIdOf, tileInReach } from './inventory.js';
import { generateLoot } from './loot.js';
import { revealHidden, searchable, searchSecMin } from './search.js';
import { freshness } from './spoilage.js';
import {
  createItem,
  defOf,
  destroyItem,
  fullUses,
  maxCondition,
  stackLimit,
  type ActionState,
  type ItemInstance,
  type ItemStore,
} from './store.js';

/**
 * Durations the data does not define yet (game minutes). Proposal for Modules: `food.eatMin`,
 * `drink.drinkMin`, `ammoBox.unpackMin`.
 */
export const EAT_PORTION_MIN = 1;
export const DRINK_USE_MIN = 0.5;
export const UNPACK_MIN = 0.5;

type Nutrition = Extract<ItemDef, { kind: 'food' }>['food']['nutrition'];

/** Items the player carries: main inventory, then bags in it (depth first, UI order). */
export function carriedItems(st: ItemStore, containerId: number, out: ItemInstance[] = []) {
  for (const id of st.containers.get(containerId)?.items ?? []) {
    const item = st.items.get(id);
    if (!item) continue;
    out.push(item);
    if (item.inner) carriedItems(st, item.inner, out);
  }
  return out;
}

export function hasToolTag(w: SimWorld, eid: number, tag: string): boolean {
  const st = w.items!;
  const p = playerItems(w, eid);
  if (!p) return false;
  return carriedItems(st, p.inventory).some((i) => defOf(st, i).tags.includes(tag));
}

/** Adds `n` fresh pieces of `def` to a container, filling matching stacks first. */
export function addPieces(
  st: ItemStore,
  def: number,
  containerId: number,
  n: number,
  ageStamp: number,
  burnt = false,
): void {
  const d = st.content.items[def]!;
  const max = stackLimit(st, d);
  const c = st.containers.get(containerId);
  if (!c) return;
  let left = n;
  if (max > 1) {
    for (const id of c.items) {
      const other = st.items.get(id);
      if (!other || other.def !== def || other.count >= max || other.inner) continue;
      if (other.uses !== fullUses(d) || other.condition !== maxCondition(d)) continue;
      if ((other.burnt ?? false) !== burnt) continue;
      const k = Math.min(left, max - other.count);
      other.count += k;
      left -= k;
      if (left === 0) break;
    }
  }
  while (left > 0) {
    const k = Math.min(left, max);
    const item = createItem(st, def, containerId, k, ageStamp);
    if (burnt) item.burnt = true;
    left -= k;
  }
  st.version++;
}

/** One use of an item is gone: `uses − 1`, then the stack shrinks; `emptyInto` replaces it. */
export function consumeUse(w: SimWorld, item: ItemInstance, emptyInto: string | undefined): void {
  const st = w.items!;
  const def = defOf(st, item);
  item.uses = Math.max(0, item.uses - 1);
  st.version++;
  if (item.uses > 0) return;
  const loc = item.loc;
  if (item.count > 1) {
    item.count--;
    item.uses = fullUses(def);
  } else {
    destroyItem(st, item);
  }
  const empty = emptyInto ? st.content.itemIndex.get(emptyInto) : undefined;
  if (empty !== undefined) addPieces(st, empty, loc, 1, gameMinuteAt(w.clock, w.tick));
}

/**
 * Nutrition of one portion (`scale` = 1 / portions for food, 1 for a drink use). Hunger below 0
 * turns into satiety (`nutrition.satiety.perKcalWhenFull`), calories go to the energy balance.
 * Not yet: macros, food `sicknessChance` and effects of rotten food (drinks roll it, docs 9.60).
 */
export function applyNutrition(w: SimWorld, eid: number, n: Nutrition, scale: number): void {
  const s = w.survival;
  if (!s) return;
  const v = s.vitals;
  const cfg = s.content.survival.nutrition;
  const kcal = n.calories * scale;
  const dh = n.hunger * scale;
  let hunger = (v.hunger[eid] ?? 0) + dh;
  if (hunger < 0) {
    const over = dh < 0 ? Math.min(1, -hunger / -dh) : 0;
    v.satiety[eid] = clampStat((v.satiety[eid] ?? 0) + cfg.satiety.perKcalWhenFull * kcal * over);
    hunger = 0;
  }
  v.hunger[eid] = clampStat(hunger);
  v.thirst[eid] = clampStat((v.thirst[eid] ?? 0) + n.thirst * scale);
  v.boredom[eid] = clampStat((v.boredom[eid] ?? 0) + n.boredom * scale);
  v.unhappiness[eid] = clampStat((v.unhappiness[eid] ?? 0) + n.unhappiness * scale);
  v.stress[eid] = clampStat((v.stress[eid] ?? 0) + n.stress * scale);
  s.kcal[eid] = Math.fround((s.kcal[eid] ?? 0) + kcal);
}

function reachableItem(w: SimWorld, eid: number, a: ActionState): ItemInstance | undefined {
  const item = w.items?.items.get(a.item);
  return item && canReach(w, eid, item.loc) ? item : undefined;
}

function itemUsed(w: SimWorld, eid: number, a: ActionState, item: ItemInstance): void {
  const st = w.items!;
  const fr = freshness(st, item, gameMinuteAt(w.clock, w.tick));
  w.events.push({
    type: 'itemUsed',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    action: ACTION_KINDS[a.kind] ?? 'eat',
    itemId: defOf(st, item).id,
    ...(fr ? { freshness: fr } : {}),
  });
}

function foodCheck(w: SimWorld, eid: number, a: ActionState): CommandRejectReason | undefined {
  const item = reachableItem(w, eid, a);
  if (!item) return w.items?.items.has(a.item) ? 'out-of-range' : 'no-item';
  const def = defOf(w.items!, item);
  if (def.kind !== 'food' || item.uses <= 0) return 'no-item';
  if (def.food.openWith && !hasToolTag(w, eid, def.food.openWith)) return 'missing-tool';
  return undefined;
}

let registered = false;

/** Registers the item action handlers (idempotent; called by createSim). */
export function registerItemActions(): void {
  if (registered) return;
  registered = true;
  registerCraftActions();
  registerLeisureActions();
  registerOpeningActions();
  registerLockActions();
  registerWoundCareActions();
  registerHygieneActions();
  registerWaterActions();
  registerVehicleActions();
  registerFurnitureMoveActions();

  registerAction('search', {
    validate(w, eid, a) {
      if (a.spot)
        return tileInReach(w, eid, a.spot.x, a.spot.y, a.spot.z) ? undefined : 'out-of-range';
      const st = w.items!;
      const c = st.containers.get(a.container);
      if (!c || !searchable(c)) return 'no-item';
      if (isVehicleContainer(c.kind)) return vehicleContainerBlock(w, eid, c);
      return containerInReach(w, eid, c) ? undefined : 'out-of-range';
    },
    durationMin(w, eid, a) {
      const st = w.items!;
      const c = a.spot ? undefined : st.containers.get(a.container);
      // Storage with its own `searchMin` keeps it; corpses, spots and the rest: `searchSec`.
      const base =
        (c && (c.kind === 'world' || isVehicleContainer(c.kind))
          ? st.content.containerTypes[c.type]?.searchMin
          : undefined) ?? searchSecMin(w);
      const speed = w.survival ? modded(w.survival, eid, ModSlot['search-speed'], 1) : 1;
      return speed > 0 ? base / speed : base;
    },
    complete(w, eid, a) {
      const st = w.items!;
      if (a.spot) {
        const found = revealHidden(w, a.spot);
        w.events.push({
          type: 'spotSearched',
          tick: w.tick,
          playerId: w.c.Player.id[eid] ?? 0,
          ...a.spot,
          found,
        });
        return;
      }
      const c = st.containers.get(a.container)!;
      const first = !c.lootDone;
      const locks = w.openings.cfg.locks;
      generateLoot(st, c, w.clock.startMinute, {
        map: w.map,
        keyTag: locks?.keyTag ?? 'base:building-key',
        corpseRadiusTiles: locks?.corpseKeyRadiusTiles ?? 24,
      });
      const sid = stableIdOf(w, eid);
      if (!c.searchedBy.includes(sid)) c.searchedBy.push(sid);
      noteContainerSearched(w, eid, c);
      const p = playerItems(w, eid)!;
      p.open = c.id;
      st.version++;
      w.events.push({
        type: 'containerOpened',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        container: c.id,
        firstSearch: first,
      });
    },
  });

  registerAction('eat', {
    validate: foodCheck,
    durationMin: () => EAT_PORTION_MIN,
    complete(w, eid, a) {
      const item = w.items!.items.get(a.item)!;
      const def = defOf(w.items!, item);
      if (def.kind !== 'food') return;
      itemUsed(w, eid, a, item);
      const portion = 1 / def.food.portions;
      if (item.burnt) {
        // Burnt food: less nutrition, a bit of unhappiness (`crafting.burn`).
        const burn = w.items!.content.crafting.burn;
        applyNutrition(w, eid, def.food.nutrition, portion * burn.nutritionMultiplier);
        const v = w.survival?.vitals.unhappiness;
        if (v) v[eid] = clampStat((v[eid] ?? 0) + burn.unhappiness * portion);
      } else applyNutrition(w, eid, def.food.nutrition, portion);
      // Spoiled food and `sicknessChance` (docs 9.66): chance of food poisoning.
      rollPoisoning(w, eid, def.food.nutrition.sicknessChance ?? 0);
      if (freshness(w.items!, item, gameMinuteAt(w.clock, w.tick)) === 'rotten')
        rollSpoiledFood(w, eid, def.food);
      consumeUse(w, item, def.food.emptyInto);
    },
  });

  registerAction('drink', {
    validate(w, eid, a) {
      const item = reachableItem(w, eid, a);
      if (!item) return w.items?.items.has(a.item) ? 'out-of-range' : 'no-item';
      return defOf(w.items!, item).kind === 'drink' && item.uses > 0 ? undefined : 'no-item';
    },
    durationMin: () => DRINK_USE_MIN,
    complete(w, eid, a) {
      const item = w.items!.items.get(a.item)!;
      const def = defOf(w.items!, item);
      if (def.kind !== 'drink') return;
      itemUsed(w, eid, a, item);
      applyNutrition(w, eid, def.drink.perUse, 1);
      // Tainted water (dirty-water bottle): chance of food poisoning (docs 9.60).
      rollPoisoning(w, eid, def.drink.perUse.sicknessChance ?? 0);
      consumeUse(w, item, def.drink.emptyInto);
    },
  });

  registerAction('bandage', {
    validate(w, eid, a) {
      const item = reachableItem(w, eid, a);
      if (!item) return w.items?.items.has(a.item) ? 'out-of-range' : 'no-item';
      const s = w.survival;
      if (!s?.content.bandageItems.has(defOf(w.items!, item).id)) return 'unknown-item';
      const sid = stableIdOf(w, eid);
      const has = (s.wounds.get(sid) ?? []).some((wd) => wd.part === a.part);
      return has ? undefined : 'invalid-target';
    },
    durationMin(w, _eid, a) {
      const def = defOf(w.items!, w.items!.items.get(a.item)!);
      return def.kind === 'medical' ? def.medical.durationMin : 1;
    },
    complete(w, eid, a) {
      const item = w.items!.items.get(a.item)!;
      itemUsed(w, eid, a, item);
      bandagePart(w, eid, a.part);
      // Sterile dressing (`disinfect` effect): also cleans the wounds.
      const def = defOf(w.items!, item);
      if (def.kind === 'medical' && def.medical.effects.includes('disinfect'))
        disinfectPart(w, eid, a.part, def.medical.potency);
      consumeUse(w, item, undefined);
    },
  });

  registerAction('unpack', {
    validate(w, eid, a) {
      const item = reachableItem(w, eid, a);
      if (!item) return w.items?.items.has(a.item) ? 'out-of-range' : 'no-item';
      const def = defOf(w.items!, item);
      if (def.kind !== 'ammo_box') return 'no-item';
      return w.items!.content.itemIndex.has(def.ammoBox.ammo) ? undefined : 'unknown-item';
    },
    durationMin: () => UNPACK_MIN,
    complete(w, eid, a) {
      const st = w.items!;
      const item = st.items.get(a.item)!;
      const def = defOf(st, item);
      if (def.kind !== 'ammo_box') return;
      itemUsed(w, eid, a, item);
      const loc = item.loc;
      if (item.count > 1) {
        item.count--;
        st.version++;
      } else destroyItem(st, item);
      addPieces(
        st,
        st.content.itemIndex.get(def.ammoBox.ammo)!,
        loc,
        def.ammoBox.count,
        gameMinuteAt(w.clock, w.tick),
      );
    },
  });
}
