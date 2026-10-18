import { footstepRadius, isSneaking } from '../ai/sneak.js';
import { floorZ } from '../world/levels.js';
import { lightLevelAt, playerVisibility, stealthOf } from '../ai/light.js';
import { sensedZombiesPatch, worldMapPatch } from '../map/player-map.js';
import { targetView } from '../combat/target.js';
import { furnitureActionsView } from '../furniture/menu.js';
import type { TileGrid } from '../world/grid.js';
import { vehicleStateViews } from '../vehicles/views.js';
import { pumpViews } from '../vehicles/pumps.js';
import { lureViews } from '../lures/lures.js';
import { craftingView } from '../crafting/crafting.js';
import { skillViews } from '../progress/skills.js';
import { Pen, PENALTY_SLOTS } from '../survival/penalties.js';
import { edgeKindOf, openingView } from '../openings/state.js';
import { unpackSwitchKey } from '../ai/state.js';
import { litWindows } from '../furniture/lighting.js';
import {
  BODY_PARTS,
  GAITS,
  GROUND_PILE_MARKER_TILES,
  STORAGE_MARKER_TILES,
  VIEW_STATS,
  WOUND_KINDS,
  type CharacterView,
  type ClockView,
  type WeaponKind,
  type CombatView,
  type MoodleView,
  type LitWindowView,
  LIT_WINDOWS_RANGE_TILES,
  type PlayerId,
  type PlayerView,
  type PenaltiesView,
  type SimViewPatch,
  type SleepView,
  type ViewStat,
  type WoundView,
  type UtilitiesView,
} from '@deadzone/protocol';
import {
  dayOf,
  gameMinuteAt,
  MINUTES_PER_DAY,
  minuteOfDay,
  minuteStartTick,
  ticksPerGameMinute,
} from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import {
  actionView,
  groundPilesView,
  storagesView,
  inventoryView,
  nearbyView,
  openContainerView,
} from '../items/views.js';
import { restCapOf, sleepRealSec, threatNearby } from '../systems/sleep.js';
import { DIRTY_MOODLE, dirtyFallback, SLEEP_SURFACES } from '../survival/state.js';
import { threatLevel } from '../ai/threat.js';
import { heldCondition, meleeOf } from '../combat/system.js';
import { twoHanded } from '../items/inventory.js';
import {
  capacityOf,
  effectiveSpread,
  firearmOf,
  reloadKindOf,
  reloadProgressOf,
} from '../combat/firearms.js';
import { defOf, maxCondition } from '../items/store.js';
import type { ItemDef } from '../content/adapter.js';
import { DEATH_CAUSES } from '../survival/state.js';
import { bandageDirty, woundBleeding } from '../survival/wounds.js';

function combatView(w: SimWorld, eid: number): CombatView {
  const cb = w.ai!.combat;
  const gun = firearmOf(w, eid);
  const m = meleeOf(w, cb, eid);
  const id = gun ? gun.item.id : m.item;
  const item = id === undefined ? undefined : w.items?.items.get(id);
  const def = item && w.items ? defOf(w.items, item) : undefined;
  const held = item && w.items && !gun ? heldCondition(w.items, item) : undefined;
  const v: CombatView = {
    zombiesKilled: cb.kills[eid] ?? 0,
    weapon: def?.id ?? null,
    condition: held ? held.condition : item ? item.condition : null,
    maxCondition: held ? held.max : def ? maxCondition(def) : null,
    readyTick: cb.readyTick[eid] ?? 0,
  };
  if (!gun) {
    v.melee = {
      source: m.source,
      damage: { min: m.damage.min, max: m.damage.max },
      rangeTiles: m.rangeTiles,
      attacksPerSec: m.attacksPerSec,
      staminaCost: m.staminaCost,
      critChance: m.critChance,
      twoHanded: m.twoHanded,
      ...(m.skill ? { skill: m.skill } : {}),
      breakChancePct: Math.round(m.lossChancePerUse * 1000) / 10,
      ...(held
        ? { conditionPct: held.max > 0 ? Math.round((held.condition / held.max) * 100) : 100 }
        : {}),
    };
  }
  if (gun && w.items) {
    v.ammo = gun.item.uses;
    v.capacity = capacityOf(w.items, gun.item, gun.def);
    v.jammed = w.items.jammed.has(gun.item.id);
    v.spread = Math.round(effectiveSpread(w, cb, eid, gun.def) * 10000) / 10000;
  }
  if (cb.reloadUntil[eid]) {
    v.reloadUntil = cb.reloadUntil[eid];
    const kind = reloadKindOf(cb, eid);
    if (kind) v.reloadKind = kind;
    v.reloadStartTick = cb.reloadStart[eid] ?? 0;
    v.reloadProgress = Math.round((reloadProgressOf(cb, eid, w.tick) ?? 0) * 1000) / 1000;
  }
  return v;
}

function weaponKind(def: ItemDef | undefined): WeaponKind {
  if (!def) return 'unarmed';
  if (def.kind === 'weapon_melee') {
    const c = def.melee.category;
    return c === 'blade_short' || c === 'blade_long' ? 'blade' : c === 'spear' ? 'spear' : 'blunt';
  }
  if (def.kind === 'weapon_ranged') {
    const c = def.ranged.category;
    return c === 'pistol' || c === 'revolver' ? 'firearm-short' : 'firearm-long';
  }
  return 'item';
}

/** Visible equipment of a player (hand_primary, back). */
export function characterView(w: SimWorld, eid: number): CharacterView | undefined {
  const st = w.items;
  const p = st?.players.get(w.c.StableId.value[eid] ?? 0);
  if (!st || !p) return undefined;
  const at = (slot: 'hand_primary' | 'back') => {
    const id = slot === 'back' ? p.backWeapon || p.slots.get(slot) : p.slots.get(slot);
    const item = id === undefined ? undefined : st.items.get(id);
    return item ? defOf(st, item) : undefined;
  };
  const primary = at('hand_primary');
  const primaryId = p.slots.get('hand_primary');
  const primaryItem = primaryId === undefined ? undefined : st.items.get(primaryId);
  return {
    stableId: w.c.StableId.value[eid] ?? 0,
    equippedPrimary: primary?.id ?? null,
    equippedBack: at('back')?.id ?? null,
    weaponKind: weaponKind(primary),
    twoHanded: primaryItem ? twoHanded(st, primaryItem) : false,
    sneaking: isSneaking(w, eid),
    stepNoiseTiles: stepNoiseTiles(w, eid),
  };
}

/** Footstep radius of the current gait while moving on foot (0 standing / in a vehicle). */
function stepNoiseTiles(w: SimWorld, eid: number): number {
  const { Velocity, MoveIntent, StableId } = w.c;
  if ((Velocity.x[eid] ?? 0) === 0 && (Velocity.y[eid] ?? 0) === 0) return 0;
  if (w.physics.bodies.get(StableId.value[eid] ?? 0)?.vehicle) return 0;
  const gait = GAITS[MoveIntent.gait[eid] ?? 1] ?? 'walk';
  return Math.round(footstepRadius(w, eid, gait) * 10) / 10;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Full wound list of a player for the UI (wound id order). */
export function woundViews(w: SimWorld, eid: number): WoundView[] {
  const s = w.survival;
  if (!s) return [];
  const cfg = s.content.survival.wounds;
  return (s.wounds.get(w.c.StableId.value[eid] ?? 0) ?? []).map((wd) => ({
    part: BODY_PARTS[wd.part] ?? 'torso_upper',
    wound: WOUND_KINDS[wd.kind] ?? 'scratch',
    bleeding: round1(woundBleeding(cfg, wd)),
    healed: round2(wd.healed),
    bandaged: wd.bandaged,
    bandageDirty: bandageDirty(cfg, wd),
    infected: wd.dirt,
    ...(wd.stitched ? { stitched: true } : {}),
    ...(wd.cleanUntilAge !== undefined && wd.ageMin < wd.cleanUntilAge
      ? { disinfected: true }
      : {}),
  }));
}

/**
 * Host-side view diff (docs 4.2): remembers what was sent last and returns only changes. Not
 * simulation state (never hashed); a fresh tracker sends everything once.
 */
export class ViewTracker {
  private clockKey = '';
  private alive: boolean | undefined;
  private sleeping: boolean | undefined;
  private sleepKey = '';
  private dirt = 0;
  private readonly stats = new Map<ViewStat, number>();
  private moodles: number[] = [];
  private woundsKey = '';
  private invHeaderKey = '';
  private readonly invContainers = new Map<number, string>();
  private openKey = '';
  private pilesKey = '';
  private storagesKey = '';
  private charactersKey = '';
  private storagesVersion = -1;
  private nearbyKey = '';
  private actionKey = '';
  private threat: number | undefined;
  private combatKey = '';
  private deathSent = false;
  private openingsVersion = 0;
  private lightsSig = '';
  private litKey = '';
  private luresKey = '';
  private utilitiesKey = '';
  private penaltiesKey = '';
  private skillsKey = '';
  private characterKey = '';
  private craftingKey = '';
  private vehicleKey = '';
  private vehiclesKey = '';
  private pumpsKey = '';
  private targetKey = '';
  private stealthKey = '';
  private furnitureKey = '';

  constructor(private readonly playerId: PlayerId = 0) {}

  diff(w: SimWorld, grid?: TileGrid): SimViewPatch | undefined {
    const patch: SimViewPatch = {};
    const minute = gameMinuteAt(w.clock, Math.max(0, w.tick - 1));
    const eid = w.players.get(this.playerId);
    const clock: ClockView = {
      day: dayOf(minute),
      minuteOfDay: minuteOfDay(minute),
      ticksPerGameMinute: ticksPerGameMinute(w.clock),
      minuteStartTick: minuteStartTick(w.clock, minute),
      fastForwardBlocked: eid !== undefined && threatNearby(w, eid),
      timeScale: (w.survival?.timeScale ?? 1) as 1 | 2 | 4,
    };
    const key = `${minute}|${clock.fastForwardBlocked}|${clock.timeScale}`;
    if (key !== this.clockKey) {
      this.clockKey = key;
      patch.clock = clock;
    }
    const s = w.survival;
    if (s && eid !== undefined) {
      const p: PlayerView = {};
      const alive = !s.dead[eid];
      if (alive !== this.alive) p.alive = this.alive = alive;
      const sleeping = s.asleep[eid] === 1;
      if (sleeping !== this.sleeping) p.sleeping = this.sleeping = sleeping;
      const sleep = sleepView(w, eid);
      const slk = sleep ? JSON.stringify(sleep) : '';
      if (slk !== this.sleepKey) {
        // A fresh tracker sends nothing while awake.
        if (this.sleepKey !== '' || sleep) p.sleep = sleep;
        this.sleepKey = slk;
      }
      // Dirt (protocol 33): whole points, when it changes (nothing while clean).
      const dirt = Math.round(s.dirt[eid] ?? 0);
      if (dirt !== this.dirt) p.dirt = this.dirt = dirt;
      for (const stat of VIEW_STATS) {
        const v = round1(s.vitals[stat][eid] ?? 0);
        if (this.stats.get(stat) !== v) {
          this.stats.set(stat, v);
          (p.stats ??= {})[stat] = v;
        }
      }
      const list = s.content.moodles;
      const changed: MoodleView[] = [];
      for (let i = 0; i < list.length; i++) {
        const level = s.moodles[eid * list.length + i] ?? 0;
        if ((this.moodles[i] ?? 0) !== level) changed.push({ id: list[i]!.id, level });
        this.moodles[i] = level;
      }
      if (dirtyFallback(s)) {
        const level = s.dirtyLevel[eid] ?? 0;
        if ((this.moodles[list.length] ?? 0) !== level) changed.push({ id: DIRTY_MOODLE, level });
        this.moodles[list.length] = level;
      }
      if (changed.length > 0) p.moodles = changed;
      const wounds = woundViews(w, eid);
      const wk = JSON.stringify(wounds);
      if (wk !== this.woundsKey) {
        this.woundsKey = wk;
        p.wounds = wounds;
      }
      const o = eid * PENALTY_SLOTS;
      const pen: PenaltiesView = {
        moveSpeed: round2(s.penalties[o + Pen.move] ?? 0),
        attackPower: round2(s.penalties[o + Pen.attack] ?? 0),
        actionSpeed: round2(s.penalties[o + Pen.action] ?? 0),
        visionRange: round2(s.penalties[o + Pen.vision] ?? 0),
        blur: round2(s.penalties[o + Pen.blur] ?? 0),
      };
      const pk = JSON.stringify(pen);
      if (pk !== this.penaltiesKey) {
        // A fresh tracker sends nothing while there are no penalties.
        if (this.penaltiesKey !== '' || Object.values(pen).some((v) => v > 0)) p.penalties = pen;
        this.penaltiesKey = pk;
      }
      const body = w.physics.bodies.get(w.c.StableId.value[eid] ?? 0);
      const seat = body?.vehicle ? { vehicleId: body.vehicle, seat: body.seat } : null;
      const vk = seat ? `${seat.vehicleId}:${seat.seat}` : '';
      if (vk !== this.vehicleKey) {
        p.vehicle = seat;
        this.vehicleKey = vk;
      }
      if (Object.keys(p).length > 0) patch.player = p;
    }
    if (w.items && eid !== undefined) this.diffItems(w, eid, patch);
    if (w.items) {
      const u: UtilitiesView = {
        power: w.items.powered,
        water: w.items.water,
        powerSource: w.items.powered ? 'grid' : null,
      };
      const uk = `${u.power ? 1 : 0}${u.water ? 1 : 0}`;
      if (uk !== this.utilitiesKey) {
        this.utilitiesKey = uk;
        patch.utilities = u;
      }
    }
    if (w.items) {
      const lures = lureViews(w.items);
      const lk = JSON.stringify(lures);
      if (lk !== this.luresKey) {
        if (this.luresKey !== '' || lures.length > 0) patch.lures = lures;
        this.luresKey = lk;
      }
    }
    if (eid !== undefined) {
      const map = worldMapPatch(w, w.c.StableId.value[eid] ?? 0);
      if (map) patch.worldMap = map;
      const sensed = sensedZombiesPatch(w, w.c.StableId.value[eid] ?? 0);
      if (sensed) patch.sensedZombies = sensed;
    }
    if (w.items && eid !== undefined) {
      const ch = w.items.characters.get(w.c.StableId.value[eid] ?? 0);
      const chk = ch ? JSON.stringify(ch) : '';
      if (chk !== this.characterKey) {
        this.characterKey = chk;
        if (ch) patch.characterProfile = ch;
      }
      const skills = skillViews(w, eid);
      const sk = JSON.stringify(skills);
      if (sk !== this.skillsKey) {
        this.skillsKey = sk;
        if (skills.length > 0) patch.skills = skills;
      }
      const crafting = craftingView(w, eid);
      const ck = crafting ? JSON.stringify(crafting) : '';
      if (ck !== this.craftingKey) {
        this.craftingKey = ck;
        if (crafting) patch.crafting = crafting;
      }
    }
    if (eid !== undefined && w.physics.vehicles.size + (this.vehiclesKey === '' ? 0 : 1) > 0) {
      const list = vehicleStateViews(w, eid);
      const key = JSON.stringify(list);
      if (key !== this.vehiclesKey) {
        if (this.vehiclesKey !== '' || list.length > 0) patch.vehicles = list;
        this.vehiclesKey = key;
      }
    }
    if (eid !== undefined && w.items) {
      const pumps = pumpViews(w, eid);
      const key = JSON.stringify(pumps);
      if (key !== this.pumpsKey) {
        if (this.pumpsKey !== '' || pumps.length > 0) patch.pumps = pumps;
        this.pumpsKey = key;
      }
    }
    if (eid !== undefined && w.ai && grid) {
      const target = targetView(w, grid, eid);
      const key = target ? JSON.stringify(target) : '';
      if (key !== this.targetKey) {
        // A fresh tracker sends nothing until there is a target.
        if (this.targetKey !== '' || target) patch.target = target;
        this.targetKey = key;
      }
    }
    if (eid !== undefined && w.ai) {
      // Before the first `light` step (fresh sim / old save) the level is computed here (not
      // stored: views never write state).
      let level = w.ai.lightLevel[eid] ?? -1;
      if (level < 0 && grid) {
        const { Position } = w.c;
        level = lightLevelAt(
          w,
          w.ai,
          grid,
          Position.x[eid] ?? 0,
          Position.y[eid] ?? 0,
          floorZ(w, eid),
        );
      }
      const vis = Math.round(playerVisibility(w, w.ai, eid, level) * 20) / 20;
      const light = Math.round(Math.max(0, level) * 20) / 20;
      const key = `${vis}|${light}`;
      if (key !== this.stealthKey) {
        this.stealthKey = key;
        patch.visibility = vis;
        patch.stealth = stealthOf(vis);
        patch.lightLevel = light;
      }
    }
    // Furniture / edge context menu: every 4 ticks (200 ms), full list on change.
    if (eid !== undefined && w.items && grid && w.tick % 4 === 0) {
      const furniture = furnitureActionsView(w, grid, eid);
      const key = JSON.stringify(furniture);
      if (key !== this.furnitureKey) {
        if (this.furnitureKey !== '' || furniture.length > 0) patch.furnitureActions = furniture;
        this.furnitureKey = key;
      }
    }
    if (w.openings.version !== this.openingsVersion) {
      this.openingsVersion = w.openings.version;
      const o = w.openings;
      patch.openings = [...new Set([...o.states.keys(), ...o.curtains])]
        .sort((a, b) => a - b)
        .map((k) => openingView(o, k, o.states.has(k) ? 0 : edgeKindOf(o, k)));
      // Light switches turned on (docs 9.53): when the set changed.
      const on = [...o.lightsOn].sort((a, b) => a - b);
      const sig = on.join(',');
      if (sig !== this.lightsSig) {
        this.lightsSig = sig;
        patch.lightsOn = on.map(unpackSwitchKey);
      }
    }
    // Lit windows (protocol 34): every 10 ticks near the player, full list when it changes.
    if (eid !== undefined && w.tick % 10 === 0 && (w.openings.lightsOn.size > 0 || this.litKey)) {
      const px = w.c.Position.x[eid] ?? 0;
      const py = w.c.Position.y[eid] ?? 0;
      const r = LIT_WINDOWS_RANGE_TILES;
      const lit: LitWindowView[] = litWindows(w)
        .filter((l) => Math.abs(l.wx - px) <= r && Math.abs(l.wy - py) <= r)
        .map((l) => ({ edge: l.key, x: l.wx, y: l.wy, z: l.z }))
        .sort((a, b) => a.edge - b.edge);
      const key = lit.map((l) => l.edge).join(',');
      if (key !== this.litKey) {
        this.litKey = key;
        patch.litWindows = lit;
      }
    }
    return Object.keys(patch).length > 0 ? patch : undefined;
  }

  /** Inventory (header + changed carried containers), open container, nearby, action. */
  private diffItems(w: SimWorld, eid: number, patch: SimViewPatch): void {
    const inv = inventoryView(w, eid);
    if (inv) {
      const { containers = [], ...header } = inv;
      const changed = [];
      const seen = new Set<number>();
      for (const c of containers) {
        seen.add(c.id);
        const key = JSON.stringify(c);
        if (this.invContainers.get(c.id) !== key) {
          this.invContainers.set(c.id, key);
          changed.push(c);
        }
      }
      const removed = [...this.invContainers.keys()].filter((id) => !seen.has(id));
      for (const id of removed) this.invContainers.delete(id);
      const headerKey = JSON.stringify(header);
      if (headerKey !== this.invHeaderKey || changed.length > 0 || removed.length > 0) {
        this.invHeaderKey = headerKey;
        patch.inventory = {
          ...header,
          ...(changed.length > 0 ? { containers: changed } : {}),
          ...(removed.length > 0 ? { removed } : {}),
        };
      }
    }
    const open = openContainerView(w, eid);
    const openKey = JSON.stringify(open);
    if (openKey !== this.openKey) {
      // First view: `null` is only sent after something was open.
      if (this.openKey !== '' || open) patch.container = open;
      this.openKey = openKey;
    }
    const nearby = nearbyView(w, eid);
    const nearbyKey = JSON.stringify(nearby);
    if (nearbyKey !== this.nearbyKey) {
      this.nearbyKey = nearbyKey;
      patch.nearby = nearby;
    }
    // Pile markers: twice a second is enough (walking 24 tiles takes seconds).
    if (w.tick % 10 === 0 || this.pilesKey === '') {
      const piles = groundPilesView(w, eid, GROUND_PILE_MARKER_TILES);
      const pilesKey = JSON.stringify(piles);
      if (pilesKey !== this.pilesKey) {
        this.pilesKey = pilesKey;
        patch.groundPiles = piles;
      }
    }
    // Storage fill: on item changes, else twice a second (walking brings new ones into range).
    if (w.items!.version !== this.storagesVersion || w.tick % 10 === 0) {
      this.storagesVersion = w.items!.version;
      const list = storagesView(w, eid, STORAGE_MARKER_TILES);
      const key = JSON.stringify(list);
      if (key !== this.storagesKey) {
        if (this.storagesKey !== '' || list.length > 0) patch.storages = list;
        this.storagesKey = key;
      }
    }
    const ch = characterView(w, eid);
    const chars = ch ? [ch] : [];
    const charKey = JSON.stringify(chars);
    if (charKey !== this.charactersKey) {
      this.charactersKey = charKey;
      patch.characters = chars;
    }
    const action = actionView(w, eid);
    const actionKey = JSON.stringify(action);
    if (actionKey !== this.actionKey) {
      if (this.actionKey !== '' || action) patch.action = action;
      this.actionKey = actionKey;
    }
    if (w.ai) {
      const threat = threatLevel(w, eid);
      if (threat !== this.threat) {
        this.threat = threat;
        patch.threat = threat;
      }
      const cv = combatView(w, eid);
      const ck = JSON.stringify(cv);
      if (ck !== this.combatKey) {
        this.combatKey = ck;
        patch.combat = cv;
      }
      const s = w.survival;
      if (s?.dead[eid] && !this.deathSent) {
        this.deathSent = true;
        const minute = gameMinuteAt(w.clock, Math.max(0, w.tick - 1));
        patch.death = {
          cause: DEATH_CAUSES[s.cause[eid] ?? 0] ?? 'wounds',
          day: dayOf(minute),
          daysSurvived: Math.max(0, Math.floor((minute - w.clock.startMinute) / MINUTES_PER_DAY)),
          zombiesKilled: w.ai.combat.kills[eid] ?? 0,
        };
      }
    }
  }
}

/** `player.sleep` (null while awake); `sleepStartTick` is derived from the ticks asleep. */
export function sleepView(w: SimWorld, eid: number): SleepView | null {
  const s = w.survival;
  if (!s?.asleep[eid]) return null;
  return {
    sleeping: true,
    sleepStartTick: Math.max(0, w.tick - (s.sleepTicks[eid] ?? 0)),
    surface: SLEEP_SURFACES[s.sleepSurface[eid] ?? 0] ?? 'floor',
    restCap: restCapOf(s, eid),
    restGained: Math.round((s.sleepRecovered[eid] ?? 0) * 10) / 10,
    realSec: Math.floor(sleepRealSec(s, eid)),
    saveAfterRealSec: s.content.survival.sleep.saveAfterRealSec,
    saveReady: s.sleepSaved[eid] === 1,
    ...(s.sleepUntil[eid] ? { wakeAtTick: minuteStartTick(w.clock, s.sleepUntil[eid] ?? 0) } : {}),
  };
}
