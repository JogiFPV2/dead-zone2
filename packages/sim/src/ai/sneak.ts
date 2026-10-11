import { GAITS, type Gait } from '@deadzone/protocol';
import { ModSlot } from '../content/adapter.js';
import type { SimWorld } from '../core/world.js';
import { SPRINT_NOISE_MUL } from '../physics/constants.js';
import { addXp, skillLevel } from '../progress/skills.js';
import { modded } from '../survival/state.js';
import { floorZ } from '../world/levels.js';
import { DEFAULT_STAGE4_CONFIG } from './config.js';

/**
 * Sneaking (docs 9.43). `setSneak {on}` sets the toggle `MoveIntent.sneak` (saved with the
 * component); while it is on a walking `move` becomes gait `sneak` (× `movement.sneakSpeedMul`
 * speed, sneak footsteps, × `vision.sneakVisibilityMul` visibility). `run` / `sprint` clear it.
 *
 * Skills: `base:sneaking` makes sneak footsteps quieter and the sneaker harder to see,
 * `base:lightfoot` makes every footstep quieter. XP: every sneak footstep with a living zombie
 * within `SNEAK.xpNearTiles` on the same floor.
 */
export const SNEAK = {
  skill: 'base:sneaking',
  lightfootSkill: 'base:lightfoot',
  /** Sneak footstep radius × (1 − this × `base:sneaking` level): level 10 = × 0.4. */
  noisePerLevel: 0.06,
  /** Every footstep radius × (1 − this × `base:lightfoot` level): level 10 = × 0.7. */
  lightfootPerLevel: 0.03,
  /** Sneaking visibility × (1 − this × `base:sneaking` level): level 10 = × 0.6 (0.36 total). */
  visibilityPerLevel: 0.04,
  /** XP per sneak footstep (every 0.5 s) with a zombie this close: sneaking / lightfoot. */
  xpNearTiles: 10,
  xpPerStep: 0.5,
  lightfootXpPerStep: 0.2,
} as const;

const SNEAK_GAIT = GAITS.indexOf('sneak');
const WALK_GAIT = GAITS.indexOf('walk');

/** `setSneak`: toggles sneaking and switches a walking intent to sneak (and back). */
export function applySetSneak(w: SimWorld, eid: number, on: boolean): void {
  const { MoveIntent } = w.c;
  MoveIntent.sneak[eid] = on ? 1 : 0;
  const g = MoveIntent.gait[eid] ?? WALK_GAIT;
  if (on && g === WALK_GAIT) MoveIntent.gait[eid] = SNEAK_GAIT;
  else if (!on && g === SNEAK_GAIT) MoveIntent.gait[eid] = WALK_GAIT;
}

/** Gait of a `move` with the toggle: walk → sneak while on; run / sprint turn the toggle off. */
export function moveGait(w: SimWorld, eid: number, gait: Gait | undefined): number {
  const g = gait ?? 'walk';
  if (g === 'run' || g === 'sprint') w.c.MoveIntent.sneak[eid] = 0;
  if (g === 'walk' && w.c.MoveIntent.sneak[eid] === 1) return SNEAK_GAIT;
  return GAITS.indexOf(g);
}

export const isSneaking = (w: SimWorld, eid: number): boolean =>
  (w.c.MoveIntent.gait[eid] ?? WALK_GAIT) === SNEAK_GAIT;

const lvl = (w: SimWorld, eid: number, skill: string): number =>
  w.items ? skillLevel(w, eid, skill) : 0;

/**
 * Footstep noise radius (tiles) of `gait` for this player: gait radius (`noise.footsteps`, sprint
 * × `SPRINT_NOISE_MUL`) × sneaking / lightfoot skills × stat `footstep-noise` (traits).
 */
export function footstepRadius(w: SimWorld, eid: number, gait: Gait): number {
  const cfg = (w.ai?.cfg ?? DEFAULT_STAGE4_CONFIG).noise;
  const f = cfg.footsteps[gait === 'sprint' ? 'run' : gait];
  let base = gait === 'sprint' ? f.radiusTiles * SPRINT_NOISE_MUL : f.radiusTiles;
  if (gait === 'sneak') base *= 1 - SNEAK.noisePerLevel * lvl(w, eid, SNEAK.skill);
  base *= 1 - SNEAK.lightfootPerLevel * lvl(w, eid, SNEAK.lightfootSkill);
  const s = w.survival;
  return Math.fround(s ? modded(s, eid, ModSlot['footstep-noise'], base) : base);
}

/** Visibility multiplier of a sneaking player (`vision.sneakVisibilityMul` × skill). */
export function sneakVisibilityMul(w: SimWorld, eid: number): number {
  const base = (w.ai?.cfg ?? DEFAULT_STAGE4_CONFIG).vision.sneakVisibilityMul;
  return base * (1 - SNEAK.visibilityPerLevel * lvl(w, eid, SNEAK.skill));
}

/** XP for a sneak footstep near a living zombie (same floor, `SNEAK.xpNearTiles`). */
export function sneakStepXp(w: SimWorld, eid: number): void {
  const ai = w.ai;
  if (!ai || ai.zombieCount === 0 || !w.items) return;
  const { Position, Zombie } = w.c;
  const x = Position.x[eid] ?? 0;
  const y = Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const r = SNEAK.xpNearTiles;
  let near = false;
  ai.spatial.query(x, y, r, (zid) => {
    if (near || Zombie.is[zid] !== 1 || (Zombie.hp[zid] ?? 0) <= 0) return;
    if (floorZ(w, zid) !== z) return;
    const dx = (Position.x[zid] ?? 0) - x;
    const dy = (Position.y[zid] ?? 0) - y;
    if (dx * dx + dy * dy <= r * r) near = true;
  });
  if (!near) return;
  addXp(w, eid, SNEAK.skill, SNEAK.xpPerStep);
  addXp(w, eid, SNEAK.lightfootSkill, SNEAK.lightfootXpPerStep);
}
