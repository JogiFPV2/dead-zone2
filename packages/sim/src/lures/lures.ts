import type { Command, CommandRejectReason, LurePhase, LureView } from '@deadzone/protocol';
import { emitNoise } from '../ai/noise.js';
import { secToTicks } from '../ai/zombies.js';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems } from '../items/actions.js';
import { canReach, moveItem, playerItems } from '../items/inventory.js';
import {
  createItem,
  defOf,
  destroyItem,
  groundPile,
  type ItemInstance,
  type ItemStore,
} from '../items/store.js';
import type { ItemDef } from '../content/adapter.js';
import { moveCircle, type Vec2 } from '../world/collision.js';
import type { TileGrid } from '../world/grid.js';
import { walkableLine } from '../world/los.js';

type LureDef = Extract<ItemDef, { kind: 'lure' }>;
type LureCommand = Extract<Command, { type: 'placeLure' | 'triggerLure' | 'throw' }>;

/** Phase indices (state). */
export const LP = { idle: 0, armed: 1, sounding: 2, running: 3 } as const;
const PHASES: readonly LurePhase[] = ['idle', 'armed', 'sounding', 'running'];

/** A lure lying on the ground (keyed by item id in `ItemStore.lures`). World state. */
export interface LureState {
  phase: number;
  x: number;
  y: number;
  z: number;
  /** Armed: tick it fires. Sounding / running: tick the noise ends. */
  until: number;
  /** Runner direction (unit) and tiles left to run. */
  dirX: number;
  dirY: number;
  runLeft: number;
  /** Next tick a noise pulse is emitted. */
  nextPulse: number;
  /** Linger of the zombies drawn by this activation (s, rolled once per activation). */
  lingerSec: number;
}

/** Noise pulse while a lure sounds (zombies re-hear it). */
const PULSE_TICKS = 20;
/** Range of throwing an item without a `throwable` block (lures), tiles. */
const DEFAULT_THROW_TILES = 8;
/** Thud of a thrown item without `throwable.impactNoise`. */
const THUD = { radiusTiles: 4, volume: 0.3 };
const RUNNER_RADIUS = 0.2;

export const isLureCommand = (cmd: Command): cmd is LureCommand =>
  cmd.type === 'placeLure' || cmd.type === 'triggerLure' || cmd.type === 'throw';

const lureDef = (st: ItemStore, item: ItemInstance): LureDef | undefined => {
  const d = defOf(st, item);
  return d.kind === 'lure' ? d : undefined;
};

function event(
  w: SimWorld,
  item: ItemInstance,
  phase: LurePhase,
  l: { x: number; y: number; z: number },
  extra: { untilTick?: number; toX?: number; toY?: number } = {},
): void {
  w.events.push({
    type: 'lureChanged',
    tick: w.tick,
    item: item.id,
    def: defOf(w.items!, item).id,
    phase,
    x: Math.round(l.x * 100) / 100,
    y: Math.round(l.y * 100) / 100,
    z: l.z,
    ...extra,
  });
}

/** Direction from the command, else the aim / facing of the player, else +x. */
function direction(w: SimWorld, eid: number, dx?: number, dy?: number): { x: number; y: number } {
  let x = dx ?? 0;
  let y = dy ?? 0;
  if (x === 0 && y === 0) {
    const { AimIntent, Position, Velocity } = w.c;
    if (AimIntent.active[eid]) {
      x = (AimIntent.x[eid] ?? 0) - (Position.x[eid] ?? 0);
      y = (AimIntent.y[eid] ?? 0) - (Position.y[eid] ?? 0);
    } else {
      x = Velocity.x[eid] ?? 0;
      y = Velocity.y[eid] ?? 0;
    }
  }
  const len = Math.sqrt(x * x + y * y);
  return len > 1e-6 ? { x: x / len, y: y / len } : { x: 1, y: 0 };
}

/** Lays the lure at (x, y): electronic waits (battery inserted), timer lures arm. */
function lay(
  w: SimWorld,
  eid: number,
  item: ItemInstance,
  def: LureDef,
  x: number,
  y: number,
  z: number,
  delaySec: number | undefined,
  dir: { x: number; y: number },
): void {
  const st = w.items!;
  const l: LureState = {
    phase: LP.idle,
    x: Math.fround(x),
    y: Math.fround(y),
    z,
    until: 0,
    dirX: Math.fround(dir.x),
    dirY: Math.fround(dir.y),
    runLeft: 0,
    nextPulse: 0,
    lingerSec: 0,
  };
  const t = def.lure.trigger;
  if (t.type === 'timer') {
    const d = Math.min(t.delaySec.max, Math.max(t.delaySec.min, delaySec ?? t.delaySec.min));
    l.phase = LP.armed;
    l.until = w.tick + secToTicks(d);
  } else if (item.uses <= 0 && def.lure.power) {
    // Insert a battery from the inventory (if any): `activationsPerBattery` activations.
    const p = playerItems(w, eid);
    const tag = def.lure.power.batteryTag;
    const battery = p
      ? carriedItems(st, p.inventory).find((i) => defOf(st, i).tags.includes(tag))
      : undefined;
    if (battery) {
      if (battery.count > 1) battery.count--;
      else destroyItem(st, battery);
      item.uses = def.lure.power.activationsPerBattery;
    }
  }
  st.lures.set(item.id, l);
  st.version++;
  event(w, item, PHASES[l.phase]!, l, l.phase === LP.armed ? { untilTick: l.until } : {});
}

/** `placeLure` / `triggerLure` / `throw` (docs 2.5 `lures`). */
export function applyLureCommand(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  cmd: LureCommand,
): CommandRejectReason | undefined {
  const st = w.items;
  const p = playerItems(w, eid);
  if (!st || !p) return 'invalid-state';
  if (w.survival?.asleep[eid]) return 'invalid-state';
  const { Position } = w.c;
  const px = Position.x[eid] ?? 0;
  const py = Position.y[eid] ?? 0;
  const pz = Position.z[eid] ?? 0;
  if (cmd.type === 'triggerLure') return trigger(w, eid, cmd.item, px, py, pz);
  const found = st.items.get(cmd.item);
  if (!found) return 'no-item';
  if (!canReach(w, eid, found.loc)) return 'out-of-range';
  const def = defOf(st, found);
  const lure = lureDef(st, found);
  if (cmd.type === 'placeLure') {
    if (!lure) return 'invalid-target';
    const item = moveItem(w, found, groundPile(st, Math.floor(px), Math.floor(py), pz), 1);
    lay(w, eid, item, lure, px, py, pz, cmd.delaySec, direction(w, eid, cmd.dirX, cmd.dirY));
    return undefined;
  }
  // throw
  const range = def.throwable?.rangeTiles ?? (lure ? DEFAULT_THROW_TILES : 0);
  if (range <= 0) return 'invalid-target';
  let dx = cmd.x - px;
  let dy = cmd.y - py;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > range) {
    dx *= range / d;
    dy *= range / d;
  }
  // Walls stop the flight: the last free point on the line (quarter-tile steps).
  const steps = Math.max(1, Math.ceil(Math.min(d, range) * 4));
  let lx = px;
  let ly = py;
  for (let i = 1; i <= steps; i++) {
    const nx = px + (dx * i) / steps;
    const ny = py + (dy * i) / steps;
    if (!walkableLine(grid, pz, lx, ly, nx, ny)) break;
    lx = nx;
    ly = ny;
  }
  const item = moveItem(w, found, groundPile(st, Math.floor(lx), Math.floor(ly), pz), 1);
  const t = def.throwable;
  const noise = t?.impactNoise ?? THUD;
  emitNoise(w, lx, ly, pz, noise.radiusTiles, noise.volume, 'impact');
  const broke = t?.breaksOnImpact === true;
  w.events.push({
    type: 'thrown',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    item: item.id,
    def: def.id,
    fromX: Math.round(px * 100) / 100,
    fromY: Math.round(py * 100) / 100,
    x: Math.round(lx * 100) / 100,
    y: Math.round(ly * 100) / 100,
    z: pz,
    broke,
  });
  if (broke) {
    const pile = st.containers.get(item.loc)!;
    destroyItem(st, item);
    if (t.brokenInto) {
      const into = st.content.itemIndex.get(t.brokenInto);
      if (into !== undefined) {
        const ground = groundPile(st, pile.x, pile.y, pile.z);
        createItem(st, into, ground.id, 1, gameMinuteAt(w.clock, w.tick));
      }
    }
    return undefined;
  }
  if (lure)
    lay(w, eid, item, lure, lx, ly, pz, cmd.delaySec, direction(w, eid, cmd.dirX, cmd.dirY));
  return undefined;
}

function trigger(
  w: SimWorld,
  eid: number,
  itemId: number | undefined,
  px: number,
  py: number,
  pz: number,
): CommandRejectReason | undefined {
  const st = w.items!;
  const p = playerItems(w, eid)!;
  const carried = carriedItems(st, p.inventory);
  const hasRemote = (tag: string) => carried.some((i) => defOf(st, i).tags.includes(tag));
  let best: { item: ItemInstance; l: LureState; d2: number } | undefined;
  let reason: CommandRejectReason = itemId === undefined ? 'invalid-target' : 'no-item';
  for (const id of [...st.lures.keys()].sort((a, b) => a - b)) {
    if (itemId !== undefined && id !== itemId) continue;
    const item = st.items.get(id);
    const l = st.lures.get(id)!;
    const def = item && lureDef(st, item);
    if (!item || !def || def.lure.trigger.type !== 'remote') {
      reason = 'invalid-target';
      continue;
    }
    if (!hasRemote(def.lure.trigger.remoteTag)) {
      reason = 'missing-tool';
      continue;
    }
    const dx = l.x - px;
    const dy = l.y - py;
    const d2 = dx * dx + dy * dy;
    const r = def.lure.trigger.rangeTiles;
    if (l.z !== pz || d2 > r * r) {
      reason = 'out-of-range';
      continue;
    }
    if (l.phase !== LP.idle || (def.lure.power && item.uses <= 0)) {
      reason = 'invalid-state';
      continue;
    }
    if (!best || d2 < best.d2) best = { item, l, d2 };
  }
  if (!best) return reason;
  const def = lureDef(st, best.item)!;
  if (def.lure.power) best.item.uses--;
  start(w, best.item, def, best.l, LP.sounding);
  return undefined;
}

function start(w: SimWorld, item: ItemInstance, def: LureDef, l: LureState, phase: number): void {
  const rng = w.rng.ai;
  const lg = def.lure.lingerSec;
  l.phase = phase;
  l.until = w.tick + secToTicks(def.lure.durationSec);
  l.nextPulse = w.tick;
  l.lingerSec = Math.fround(lg.min + rng.nextFloat() * (lg.max - lg.min));
  l.runLeft = phase === LP.running ? Math.fround(def.lure.runner?.distanceTiles ?? 0) : 0;
  w.items!.version++;
  event(
    w,
    item,
    PHASES[phase]!,
    l,
    phase === LP.running
      ? {
          untilTick: l.until,
          toX: Math.round((l.x + l.dirX * l.runLeft) * 100) / 100,
          toY: Math.round((l.y + l.dirY * l.runLeft) * 100) / 100,
        }
      : { untilTick: l.until },
  );
}

const tmp: Vec2 = { x: 0, y: 0 };

/**
 * Pipeline `lures` (after AI, before movement of the next tick): timers fire, runners move,
 * sounding lures pulse noise (`lure.noise`, source `lure`, zombies linger `lingerSec`), finished
 * ones go idle (remote) or are used up (`consumedOnUse`). A lure picked up stops.
 */
export function lureSystem(w: SimWorld, grid: TileGrid): void {
  const st = w.items;
  if (!st || st.lures.size === 0) return;
  for (const id of [...st.lures.keys()].sort((a, b) => a - b)) {
    const l = st.lures.get(id)!;
    const item = st.items.get(id);
    const def = item && lureDef(st, item);
    const loc = item && st.containers.get(item.loc);
    if (!item || !def || loc?.kind !== 'ground') {
      st.lures.delete(id);
      st.version++;
      if (item) event(w, item, 'removed', l);
      continue;
    }
    if (l.phase === LP.armed && w.tick >= l.until) {
      start(w, item, def, l, def.lure.runner ? LP.running : LP.sounding);
    }
    if (l.phase === LP.running && l.runLeft > 0) {
      const runner = def.lure.runner!;
      const step = Math.min(l.runLeft, runner.speedTilesPerSec / 20);
      moveCircle(grid, l.z, l.x, l.y, l.dirX * step, l.dirY * step, RUNNER_RADIUS, tmp);
      const mx = tmp.x - l.x;
      const my = tmp.y - l.y;
      const moved = Math.sqrt(mx * mx + my * my);
      l.x = tmp.x;
      l.y = tmp.y;
      // Blocked by a wall: stops there.
      l.runLeft = moved < step * 0.5 ? 0 : Math.fround(l.runLeft - moved);
      st.version++;
    }
    if (l.phase === LP.sounding || l.phase === LP.running) {
      if (w.tick >= l.nextPulse && w.tick < l.until) {
        l.nextPulse = w.tick + PULSE_TICKS;
        const n = def.lure.noise;
        emitNoise(w, l.x, l.y, l.z, n.radiusTiles, n.volume, 'lure', l.lingerSec);
      }
      if (w.tick >= l.until) {
        if (def.lure.consumedOnUse) {
          event(w, item, 'spent', l);
          st.lures.delete(id);
          destroyItem(st, item);
        } else {
          l.phase = LP.idle;
          l.until = 0;
          st.version++;
          event(w, item, 'idle', l);
        }
        continue;
      }
      // A runner keeps its position in the ground pile under it (pick-up where it stopped).
      if (l.phase === LP.running) {
        const tx = Math.floor(l.x);
        const ty = Math.floor(l.y);
        if (loc.x !== tx || loc.y !== ty) moveItem(w, item, groundPile(st, tx, ty, l.z), 1);
      }
    }
  }
}

export function lureViews(st: ItemStore): LureView[] {
  return [...st.lures.keys()]
    .sort((a, b) => a - b)
    .flatMap((id) => {
      const l = st.lures.get(id)!;
      const item = st.items.get(id);
      if (!item) return [];
      const v: LureView = {
        item: id,
        def: defOf(st, item).id,
        phase: PHASES[l.phase] as LureView['phase'],
        x: Math.round(l.x * 10) / 10,
        y: Math.round(l.y * 10) / 10,
        z: l.z,
      };
      if (l.phase !== LP.idle) v.untilTick = l.until;
      const def = lureDef(st, item);
      if (def?.lure.power) v.charges = item.uses;
      return v;
    });
}

/** Hash section (only when lures exist, older goldens stay). */
export function hashLures(
  st: ItemStore,
  h: { u32(v: number): unknown; f32(v: number): unknown },
): void {
  if (st.lures.size === 0) return;
  h.u32(st.lures.size);
  for (const id of [...st.lures.keys()].sort((a, b) => a - b)) {
    const l = st.lures.get(id)!;
    h.u32(id);
    h.u32(l.phase);
    h.f32(l.x);
    h.f32(l.y);
    h.u32(l.z + 128);
    h.u32(l.until);
    h.f32(l.dirX);
    h.f32(l.dirY);
    h.f32(l.runLeft);
    h.u32(l.nextPulse);
    h.f32(l.lingerSec);
  }
}
