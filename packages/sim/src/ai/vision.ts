import { Pen, penaltyMul } from '../survival/penalties.js';
import { EQUIP_SLOTS, GAITS } from '@deadzone/protocol';
import { gameMinuteAt, minuteOfDay } from '../core/clock.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { defOf } from '../items/store.js';
import type { VisionConfig } from './config.js';
import type { AiWorld } from './state.js';

/**
 * Sight model shared by players and zombies: range = base range × light at the target. Daylight
 * is 1 by day and `vision.nightFactor` at night (linear dawn / dusk); lights (map objects with a
 * `light` block, a light held in hand) raise it by `lightBonus × intensity` (max 1) within their
 * radius (`worldSettings.vision`). A `dark` zone counts as night; a player there without light is
 * invisible to zombies (but still heard).
 */
export function daylight(cfg: VisionConfig, mod: number): number {
  const night = cfg.nightFactor;
  if (mod < cfg.dawnStartMin || mod >= cfg.duskEndMin) return night;
  if (mod < cfg.dawnEndMin)
    return night + ((1 - night) * (mod - cfg.dawnStartMin)) / (cfg.dawnEndMin - cfg.dawnStartMin);
  if (mod < cfg.duskStartMin) return 1;
  return 1 - ((1 - night) * (mod - cfg.duskStartMin)) / (cfg.duskEndMin - cfg.duskStartMin);
}

export const currentDaylight = (w: SimWorld, cfg: VisionConfig): number =>
  Math.fround(daylight(cfg, minuteOfDay(gameMinuteAt(w.clock, w.tick))));

export function inDarkZone(ai: AiWorld, x: number, y: number, z: number): boolean {
  for (const zn of ai.darkZones) {
    if (zn.z !== z) continue;
    for (const r of zn.rects)
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
  }
  return false;
}

/** Sight factor with light: base + lightBonus × intensity, at most 1 (never below base). */
const lit = (vc: VisionConfig, base: number, light: number): number =>
  Math.min(1, Math.max(base, base + vc.lightBonus * light));

const HANDS = EQUIP_SLOTS.filter((s) => s === 'hand_primary' || s === 'hand_secondary');

/**
 * Light held in hand (tool with `light`, e.g. a flashlight, or a placeable with `light` that needs
 * no mains power): radius and intensity. Cone and battery are not simulated yet (always lit).
 */
export function heldLight(
  w: SimWorld,
  eid: number,
): { radius: number; intensity: number } | undefined {
  const st = w.items;
  const p = st?.players.get(w.c.StableId.value[eid] ?? 0);
  if (!st || !p) return undefined;
  let best: { radius: number; intensity: number } | undefined;
  for (const slot of HANDS) {
    const id = p.slots.get(slot);
    const item = id === undefined ? undefined : st.items.get(id);
    if (!item) continue;
    const def = defOf(st, item);
    const l =
      def.kind === 'tool'
        ? def.light
        : def.kind === 'placeable' && !def.placeable.light?.requiresPower
          ? def.placeable.light
          : undefined;
    if (!l) continue;
    if (!best || l.intensity > best.intensity)
      best = { radius: l.radiusTiles, intensity: l.intensity };
  }
  return best;
}

/** Brightest light at a point (static lights and lights held by players), 0 = none. */
export function lightAt(w: SimWorld, ai: AiWorld, x: number, y: number, z: number): number {
  let best = 0;
  const powered = w.items?.powered ?? true;
  for (const l of ai.lights) {
    if (l.z !== z || l.intensity <= best || (l.requiresPower && !powered)) continue;
    const dx = x - l.x;
    const dy = y - l.y;
    if (dx * dx + dy * dy <= l.radius * l.radius) best = l.intensity;
  }
  const { Position } = w.c;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if ((Position.z[eid] ?? 0) !== z || w.survival?.dead[eid]) continue;
    const h = heldLight(w, eid);
    if (!h || h.intensity <= best) continue;
    const dx = x - (Position.x[eid] ?? 0);
    const dy = y - (Position.y[eid] ?? 0);
    if (dx * dx + dy * dy <= h.radius * h.radius) best = h.intensity;
  }
  return best;
}

/**
 * How visible a player is right now (0 = invisible, 1 = full daylight range): max(daylight
 * unless in a dark zone, light at the player) × `sneakVisibilityMul` when sneaking.
 */
export function playerVisibility(w: SimWorld, ai: AiWorld, eid: number, day: number): number {
  if (w.survival?.dead[eid]) return 0;
  const { Position, MoveIntent } = w.c;
  const x = Position.x[eid] ?? 0;
  const y = Position.y[eid] ?? 0;
  const z = Position.z[eid] ?? 0;
  const vc = ai.cfg.vision;
  if (!vc.enabled) return 1;
  const dark = inDarkZone(ai, Math.floor(x), Math.floor(y), z);
  const light = lightAt(w, ai, x, y, z);
  if (dark && light <= 0) return 0;
  let v = lit(vc, dark ? vc.nightFactor : day, light);
  if (GAITS[MoveIntent.gait[eid] ?? 1] === 'sneak') v *= ai.cfg.vision.sneakVisibilityMul;
  return Math.fround(v);
}

/**
 * Sight loss of the player (`worldSettings.survival.woundPenalties`: head wounds, pain, fever,
 * bleeding; capped at `maxPenalty`). Without content: 1.
 */
export function sightPenaltyMul(w: SimWorld, _ai: AiWorld, eid: number): number {
  return Math.fround(penaltyMul(w, eid, Pen.vision));
}

/** Player sight range in tiles at their position (daylight / lights, pain, fever). */
export function playerSightRange(w: SimWorld, ai: AiWorld, eid: number): number {
  const { Position } = w.c;
  const x = Position.x[eid] ?? 0;
  const y = Position.y[eid] ?? 0;
  const z = Position.z[eid] ?? 0;
  const vc = ai.cfg.vision;
  const dark = inDarkZone(ai, Math.floor(x), Math.floor(y), z);
  const base = dark ? vc.nightFactor : currentDaylight(w, vc);
  const light = vc.enabled ? lit(vc, base, lightAt(w, ai, x, y, z)) : 1;
  return Math.fround(vc.playerSightTiles * light * sightPenaltyMul(w, ai, eid));
}
