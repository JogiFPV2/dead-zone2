import {
  DEFAULT_WINDOW_COVER_BLOCKS_SIGHT,
  DEFAULT_WINDOW_COVER_LIGHT_PASS,
  DEFAULT_WINDOW_COVER_SETUP_SEC,
} from '@deadzone/content';
import { windowBlocker } from './window-blocker.js';
import type { CommandRejectReason } from '@deadzone/protocol';
import { registerAction } from '../actions/queue.js';
import { emitNoise, type PlayerNoiseBy } from '../ai/noise.js';
import { gridOf } from '../ai/commands.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { gameMinuteAt, ticksPerGameMinute } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { addPieces, carriedItems, hasToolTag } from '../items/actions.js';
import { activeHandOf, carriedLoad, hardLimit, playerItems, reachTarget } from '../items/inventory.js';
import {
  defOf,
  destroyItem,
  groundPile,
  type ActionState,
  type ItemInstance,
} from '../items/store.js';
import { canVault, startVault, type VaultTarget } from '../physics/vault.js';
import { addXp, skillLevel } from '../progress/skills.js';
import { woundKindIndex } from '../survival/state.js';
import { inflictWound } from '../survival/wounds.js';
import { floorZ } from '../world/levels.js';
import {
  damageOpening,
  edgeAt,
  edgeCentre,
  edgeInReach,
  emitOpeningChanged,
  windowSmashed,
} from './actions.js';
import {
  isBarricadable,
  isDoorLike,
  edgeTiles,
  OpeningKind,
  OS,
  setOpening,
  topPlankHp,
  unpackKey,
} from './state.js';

/**
 * Timed actions on door / window / gate edges (docs 9.25): smash a window, climb through it,
 * clear the shards, nail / pull planks, force a locked door. Values: `worldSettings.openings`.
 * They run in the shared action queue (`action` view with `progress`, started / completed /
 * interrupted events); moving interrupts them (not the climb), zombies nearby do not (PZ: you
 * barricade while they bang on the door). The target edge is `ActionState.edge`.
 */

/** BODY_PARTS index of the right hand (bare-handed smash). */
const HAND_R = 10;

type Target = ReturnType<typeof edgeAt>;

/** The action's edge, when it still exists and is in reach (else the reject reason). */
function target(w: SimWorld, eid: number, a: ActionState): Target | CommandRejectReason {
  if (a.edge === undefined) return 'invalid-target';
  const k = unpackKey(a.edge);
  const t = edgeAt(gridOf(w), w, a.edge % 2, k.tx, k.ty, k.z);
  if (t.kind === OpeningKind.wall) return 'invalid-target';
  if (!edgeInReach(w, eid, a.edge)) return 'out-of-range';
  return t;
}

/**
 * Window cover reach (docs 9.78): `reachTarget` to the edge's tile on the player's side (walls,
 * closed doors between block it), then the usual edge reach.
 */
function coverTarget(w: SimWorld, eid: number, a: ActionState): Target | CommandRejectReason {
  if (a.edge === undefined) return 'invalid-target';
  const k = unpackKey(a.edge);
  const [t0, t1] = edgeTiles(a.edge);
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  const d = (t: { x: number; y: number }) => (t.x + 0.5 - px) ** 2 + (t.y + 0.5 - py) ** 2;
  const near = d(t0) <= d(t1) ? t0 : t1;
  const block = reachTarget(w, eid, { x: near.x, y: near.y, z: k.z });
  if (block) return block;
  const t = target(w, eid, a);
  if (typeof t === 'string') return t;
  return t.kind === OpeningKind.window ? t : 'invalid-target';
}

/** `windowCover` of item def index `def` with the content defaults, or undefined. */
function coverOf(
  w: SimWorld,
  def: number,
): { lightPass: number; blocksSight: boolean; setupSec: number } | undefined {
  const d = w.items?.content.items[def];
  const c = d?.windowCover;
  if (!c) return undefined;
  return {
    lightPass: c.lightPass ?? DEFAULT_WINDOW_COVER_LIGHT_PASS,
    blocksSight: c.blocksSight ?? DEFAULT_WINDOW_COVER_BLOCKS_SIGHT,
    setupSec: c.setupSec ?? DEFAULT_WINDOW_COVER_SETUP_SEC,
  };
}

/** Item id → `setupSec` of its cover (defaults when the item lost `windowCover`). */
function coverSecOfId(w: SimWorld, id: string | undefined): number {
  const def = id === undefined ? undefined : w.items?.content.itemIndex.get(id);
  return (
    (def === undefined ? undefined : coverOf(w, def)?.setupSec) ?? DEFAULT_WINDOW_COVER_SETUP_SEC
  );
}

/** Real seconds (at ×1) → game minutes (the queue converts back with the wound slowdown). */
const secMin = (w: SimWorld, sec: number): number =>
  (sec * TICKS_PER_SECOND) / ticksPerGameMinute(w.clock);

/** Carpentry: × (1 − level × `carpentryTimePerLevel`), at least × `minTimeMul`. */
function carpentryMul(w: SimWorld, eid: number): number {
  const b = w.openings.cfg.barricade;
  return Math.max(b.minTimeMul, 1 - skillLevel(w, eid, b.skill) * b.carpentryTimePerLevel);
}

/** Carried pieces of item `id` (inventory + bags, UI order). */
function carriedOf(w: SimWorld, eid: number, id: string): ItemInstance[] {
  const st = w.items;
  const p = playerItems(w, eid);
  const def = st?.content.itemIndex.get(id);
  if (!st || !p || def === undefined) return [];
  return carriedItems(st, p.inventory).filter((i) => i.def === def);
}

const countOf = (items: readonly ItemInstance[]): number => items.reduce((n, i) => n + i.count, 0);

/** Uses up `n` pieces (first stacks first). */
function consume(w: SimWorld, items: readonly ItemInstance[], n: number): void {
  const st = w.items!;
  for (const item of items) {
    if (n <= 0) break;
    const k = Math.min(n, item.count);
    n -= k;
    if (k >= item.count) destroyItem(st, item);
    else item.count -= k;
  }
  st.version++;
}

/** Gives `n` pieces of item `id`: into the inventory, or on the ground when too heavy. */
function give(w: SimWorld, eid: number, id: string, n: number): void {
  const st = w.items;
  const p = playerItems(w, eid);
  const def = st?.content.itemIndex.get(id);
  if (!st || !p || def === undefined || n <= 0) return;
  const kg = st.content.items[def]!.weightKg * n;
  const heavy = carriedLoad(st, p) + kg > hardLimit(w, eid) + 1e-6;
  const { Position } = w.c;
  const into = heavy
    ? groundPile(
        st,
        Math.floor(Position.x[eid] ?? 0),
        Math.floor(Position.y[eid] ?? 0),
        floorZ(w, eid),
      ).id
    : p.inventory;
  addPieces(st, def, into, n, gameMinuteAt(w.clock, w.tick));
}

function noiseAt(
  w: SimWorld,
  key: number,
  n: { radiusTiles: number; volume: number },
  by: PlayerNoiseBy,
): void {
  const k = unpackKey(key);
  const c = edgeCentre(key % 2, k.tx, k.ty);
  emitNoise(w, c.x, c.y, k.z, n.radiusTiles, n.volume, 'impact', 0, by);
}

const vaultTarget = (key: number): VaultTarget => {
  const k = unpackKey(key);
  return { side: key % 2, tx: k.tx, ty: k.ty };
};

/** `forceDoor` method: chosen in the menu (`force-pry` / `force-kick`), else a crowbar when carried. */
export const forceMethod = (w: SimWorld, eid: number, a?: ActionState): 'pry' | 'kick' =>
  a?.method === 'kick' || a?.method === 'pry'
    ? a.method
    : hasToolTag(w, eid, w.openings.cfg.barricade.pryTag)
      ? 'pry'
      : 'kick';

/** Wears something with `window.gloveTag` (gloves) in any equipment slot. */
export function wearsGloves(w: SimWorld, eid: number): boolean {
  const st = w.items;
  const p = playerItems(w, eid);
  if (!st || !p) return false;
  // Gloves are clothing worn on the hands (slot `hands`); holding them in a hand does not count.
  const tag = w.openings.cfg.window.gloveTag ?? 'base:gloves';
  const id = p.slots.get('hands');
  const item = id === undefined ? undefined : st.items.get(id);
  return !!item && defOf(st, item).tags.includes(tag);
}

let registered = false;

/** Registers the openings action handlers (idempotent; via `registerItemActions`). */
export function registerOpeningActions(): void {
  if (registered) return;
  registered = true;

  registerAction('smashWindow', {
    validate(w, eid, a) {
      const t = target(w, eid, a);
      if (typeof t === 'string') return t;
      if (t.kind !== OpeningKind.window) return 'invalid-target';
      if (t.planks > 0 || (t.state !== OS.closed && t.state !== OS.open)) return 'invalid-state';
      return undefined;
    },
    durationMin: (w) => secMin(w, w.openings.cfg.window.smashSec),
    ignore: ['threat'],
    complete(w, eid, a) {
      const key = a.edge!;
      const t = target(w, eid, a) as Target;
      const p = playerItems(w, eid);
      const withHand = !p?.slots.get(p ? activeHandOf(p) : 'hand_primary');
      setOpening(w.openings, key, t.kind, OS.broken, 0, { cleared: 0 });
      windowSmashed(w, key, 'player', { playerId: w.c.Player.id[eid] ?? 0, withHand }, eid);
      emitOpeningChanged(w, key, t.kind, 'player');
      if (withHand && w.rng.actions.nextFloat() < w.openings.cfg.window.handCutChance)
        inflictWound(w, eid, HAND_R, woundKindIndex('laceration'));
    },
  });

  registerAction('climbThrough', {
    validate(w, eid, a) {
      const t = target(w, eid, a);
      if (typeof t === 'string') return t;
      if (t.kind !== OpeningKind.window) return 'invalid-target';
      if (t.planks > 0 || (t.state !== OS.open && t.state !== OS.broken)) return 'invalid-state';
      // A piece in front of the window: the menu offers to move it (`sim.windowBlocker`).
      if (windowBlocker(w, eid, a.edge!)) return 'blocked-by-furniture';
      return canVault(w, gridOf(w), eid, vaultTarget(a.edge!));
    },
    durationMin: () => 0,
    ticks: (w) => w.physics.cfg.vault.windowTicks,
    begin(w, eid, a) {
      startVault(w, gridOf(w), eid, vaultTarget(a.edge!));
    },
    // The vault moved the player across; landing (trip, glass) is the physics' job.
    validateEnd: () => undefined,
    ignore: ['threat', 'moved'],
    complete() {},
  });

  registerAction('removeGlass', {
    validate(w, eid, a) {
      const t = target(w, eid, a);
      if (typeof t === 'string') return t;
      if (t.kind !== OpeningKind.window) return 'invalid-target';
      if (t.planks > 0 || t.state !== OS.broken || t.e?.cleared) return 'invalid-state';
      return undefined;
    },
    durationMin: (w) => secMin(w, w.openings.cfg.window.removeGlassSec),
    ignore: ['threat'],
    complete(w, eid, a) {
      const t = target(w, eid, a) as Target;
      setOpening(w.openings, t.key, t.kind, OS.broken, 0, { cleared: 1 });
      const g = w.openings.cfg.window;
      give(w, eid, g.glassItem, g.glassPieces);
      emitOpeningChanged(w, t.key, t.kind, 'player');
      // Bare hands on broken glass (PZ): a chance to cut the hand.
      if (!wearsGloves(w, eid) && w.rng.actions.nextFloat() < (g.clearGlassCutChance ?? 0))
        inflictWound(w, eid, HAND_R, woundKindIndex('laceration'));
    },
  });

  registerAction('barricade', {
    validate(w, eid, a) {
      const t = target(w, eid, a);
      if (typeof t === 'string') return t;
      const b = w.openings.cfg.barricade;
      if (!isBarricadable(t.kind)) return 'invalid-target';
      if (t.planks >= b.maxPlanks) return 'invalid-state';
      if (isDoorLike(t.kind) && (t.state === OS.open || t.state === OS.broken))
        return 'invalid-state';
      if (!hasToolTag(w, eid, b.hammerTag)) return 'missing-tool';
      if (countOf(carriedOf(w, eid, b.plankItem)) < 1) return 'missing-parts';
      if (countOf(carriedOf(w, eid, b.nailsItem)) < b.nailsPerPlank) return 'missing-parts';
      return undefined;
    },
    durationMin: (w, eid) => secMin(w, w.openings.cfg.barricade.addSec) * carpentryMul(w, eid),
    begin(w, eid, a) {
      noiseAt(w, a.edge!, w.openings.cfg.barricade.noise, { eid, kind: 'board' });
    },
    ignore: ['threat'],
    complete(w, eid, a) {
      const t = target(w, eid, a) as Target;
      const b = w.openings.cfg.barricade;
      consume(w, carriedOf(w, eid, b.plankItem), 1);
      consume(w, carriedOf(w, eid, b.nailsItem), b.nailsPerPlank);
      const hp = t.e?.hp;
      setOpening(w.openings, t.key, t.kind, t.state, hp, {
        planks: t.planks + 1,
        bhp: (t.planks > 0 ? (t.e?.bhp ?? 0) : 0) + b.plankHp,
      });
      addXp(w, eid, b.skill, b.xpPerPlank);
      emitOpeningChanged(w, t.key, t.kind, 'player');
    },
  });

  registerAction('removeBarricade', {
    validate(w, eid, a) {
      const t = target(w, eid, a);
      if (typeof t === 'string') return t;
      const b = w.openings.cfg.barricade;
      if (t.planks <= 0) return 'invalid-state';
      if (!hasToolTag(w, eid, b.hammerTag) && !hasToolTag(w, eid, b.pryTag)) return 'missing-tool';
      return undefined;
    },
    durationMin: (w, eid) => secMin(w, w.openings.cfg.barricade.removeSec) * carpentryMul(w, eid),
    ignore: ['threat'],
    complete(w, eid, a) {
      const t = target(w, eid, a) as Target;
      const b = w.openings.cfg.barricade;
      const o = w.openings;
      const top = topPlankHp(o.cfg, t.e);
      setOpening(o, t.key, t.kind, t.state, t.e?.hp, {
        planks: t.planks - 1,
        bhp: Math.max(0, (t.e?.bhp ?? 0) - top),
      });
      let nails = 0;
      for (let i = 0; i < b.nailsPerPlank; i++)
        if (w.rng.actions.nextFloat() < b.nailReturnChance) nails++;
      give(w, eid, b.plankItem, 1);
      give(w, eid, b.nailsItem, nails);
      addXp(w, eid, b.skill, b.xpPerRemove);
      emitOpeningChanged(w, t.key, t.kind, 'player');
    },
  });

  // Window covers (protocol 47, docs 9.78): hang / take down; no movement change.
  registerAction('coverWindow', {
    validate(w, eid, a) {
      const t = coverTarget(w, eid, a);
      if (typeof t === 'string') return t;
      if (w.openings.covers.has(t.key)) return 'invalid-state';
      const st = w.items;
      const p = playerItems(w, eid);
      const item = st?.items.get(a.item);
      if (!st || !p || !item) return 'missing-parts';
      if (!coverOf(w, item.def)) return 'invalid-target';
      if (!carriedItems(st, p.inventory).includes(item)) return 'missing-parts';
      return undefined;
    },
    durationMin: (w, _eid, a) => {
      const item = w.items?.items.get(a.item);
      return secMin(w, (item && coverOf(w, item.def)?.setupSec) ?? DEFAULT_WINDOW_COVER_SETUP_SEC);
    },
    ignore: ['threat'],
    complete(w, eid, a) {
      const t = coverTarget(w, eid, a) as Target;
      const st = w.items!;
      const item = st.items.get(a.item)!;
      const c = coverOf(w, item.def)!;
      const id = defOf(st, item).id;
      consume(w, [item], 1);
      w.openings.covers.set(t.key, {
        item: id,
        lightPass: c.lightPass,
        blocksSight: c.blocksSight,
      });
      w.openings.version++;
      emitOpeningChanged(w, t.key, t.kind, 'player');
    },
  });

  registerAction('uncoverWindow', {
    validate(w, eid, a) {
      const t = coverTarget(w, eid, a);
      if (typeof t === 'string') return t;
      return w.openings.covers.has(t.key) ? undefined : 'invalid-state';
    },
    durationMin: (w, _eid, a) =>
      secMin(w, coverSecOfId(w, w.openings.covers.get(a.edge ?? -1)?.item)),
    ignore: ['threat'],
    complete(w, eid, a) {
      const t = coverTarget(w, eid, a) as Target;
      const c = w.openings.covers.get(t.key)!;
      w.openings.covers.delete(t.key);
      w.openings.version++;
      give(w, eid, c.item, 1);
      emitOpeningChanged(w, t.key, t.kind, 'player');
    },
  });

  // Building keys and lockpicks: furniture/locks.ts (`useKey`, `pickLock`).
  registerAction('forceDoor', {
    validate(w, eid, a) {
      const t = target(w, eid, a);
      if (typeof t === 'string') return t;
      if (!isDoorLike(t.kind)) return 'invalid-target';
      if (t.planks > 0 || t.state !== OS.locked) return 'invalid-state';
      if (a.method === 'pry' && !hasToolTag(w, eid, w.openings.cfg.barricade.pryTag))
        return 'missing-tool';
      return undefined;
    },
    durationMin: (w, eid, a) => {
      const f = w.openings.cfg.force;
      return secMin(w, forceMethod(w, eid, a) === 'pry' ? f.prySec : f.kickSec);
    },
    ignore: ['threat'],
    complete(w, eid, a) {
      const t = target(w, eid, a) as Target;
      const f = w.openings.cfg.force;
      const method = forceMethod(w, eid, a);
      noiseAt(w, t.key, method === 'pry' ? f.pryNoise : f.kickNoise, { eid, kind: method });
      const chance =
        (method === 'pry' ? f.pryChance : f.kickChance) +
        skillLevel(w, eid, f.strengthSkill) * f.chancePerStrength;
      let success = w.rng.actions.nextFloat() < chance;
      if (success) {
        setOpening(w.openings, t.key, t.kind, OS.broken, 0);
        emitOpeningChanged(w, t.key, t.kind, 'player');
      } else {
        damageOpening(w, t.key, t.kind, f.failDamage, 'player', eid);
        success = w.openings.states.get(t.key)?.state === OS.broken;
      }
      const k = unpackKey(t.key);
      w.events.push({
        type: 'doorForced',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        tx: k.tx,
        ty: k.ty,
        z: k.z,
        side: k.side,
        method,
        success,
      });
    },
  });
}
