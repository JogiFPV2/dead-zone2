import type { SimEvent } from '@deadzone/protocol';
import type { SoundId } from './audio-engine.js';

/** In-game one-shots on the effects bus (CC0 Kenney packs, ASSETS.md). */
export const STEP_CONCRETE = [
  'sfx-step-concrete0',
  'sfx-step-concrete1',
  'sfx-step-concrete2',
  'sfx-step-concrete3',
] as const;
export const STEP_WOOD = [
  'sfx-step-wood0',
  'sfx-step-wood1',
  'sfx-step-wood2',
  'sfx-step-wood3',
] as const;
export const HITS = ['sfx-hit0', 'sfx-hit1', 'sfx-hit2'] as const;
export const DOOR_OPEN = 'sfx-door-open';
export const DOOR_CLOSE = 'sfx-door-close';
/** Pill taken (`itemUsed` action `pill`, protocol 40): procedural, `synth.ts`. */
export const SWALLOW = 'sfx-swallow';
/** Procedural (`synth.ts`): firearms, zombies, glass, thrown items, storm. */
export const SHOTS = {
  pistol: 'sfx-shot-pistol',
  shotgun: 'sfx-shot-shotgun',
  rifle: 'sfx-shot-rifle',
} as const;
export const DRY_FIRE = 'sfx-dryfire';
export const RELOAD = 'sfx-reload';
export const GROANS = ['sfx-zombie-groan0', 'sfx-zombie-groan1', 'sfx-zombie-groan2'] as const;
export const ALERTS = ['sfx-zombie-alert0', 'sfx-zombie-alert1'] as const;
export const GLASS = 'sfx-glass';
export const THUD = 'sfx-thud';
export const THUNDER = 'sfx-thunder';
export const RAIN = 'amb-rain';
export const WORLD_SOUNDS: readonly SoundId[] = [
  ...STEP_CONCRETE,
  ...STEP_WOOD,
  ...HITS,
  DOOR_OPEN,
  DOOR_CLOSE,
  SWALLOW,
  ...Object.values(SHOTS),
  DRY_FIRE,
  RELOAD,
  ...GROANS,
  ...ALERTS,
  GLASS,
  THUD,
  THUNDER,
  RAIN,
];

/** Beyond this distance (tiles) world sounds are silent; linear falloff to it. */
export const HEARING_TILES = 18;
/** Stride (tiles) between footsteps: walking ≈ 2 steps/s, sprinting a bit faster per tile. */
export const STEP_TILES = 0.75;
const STEP_VOLUME = 0.45;

export interface Cue {
  id: SoundId;
  volume: number;
}

/** Gunshots carry much farther than steps or blows (tiles). */
export const SHOT_HEARING_TILES = 80;

/** Distance falloff 1 → 0 at `range` (HEARING_TILES by default). */
export function falloff(dx: number, dy: number, range = HEARING_TILES): number {
  const d = Math.hypot(dx, dy);
  return d >= range ? 0 : 1 - d / range;
}

/** Firearm sound by weapon id (`base:shotgun`, `base:hunting-rifle`…); pistols by default. */
export function shotSound(weapon: string): (typeof SHOTS)[keyof typeof SHOTS] {
  if (/shotgun|strzelb/.test(weapon)) return SHOTS.shotgun;
  if (/rifle|karabin|carbine/.test(weapon)) return SHOTS.rifle;
  return SHOTS.pistol;
}

/** Hit (melee/shove/zombie) and door open/close cues around the listener at (px, py). */
export function eventCues(
  events: readonly SimEvent[],
  px: number,
  py: number,
  pick = Math.random,
  /** Local player: only their own pill is heard. */
  localId?: number,
): Cue[] {
  const out: Cue[] = [];
  for (const e of events) {
    if (e.type === 'itemUsed') {
      if (e.action === 'pill' && localId !== undefined && e.playerId === localId)
        out.push({ id: SWALLOW, volume: 0.8 });
    } else if (e.type === 'shot') {
      if (e.jammed || e.rays.length === 0) {
        const v = falloff(e.x - px, e.y - py) * 0.7;
        if (v > 0) out.push({ id: DRY_FIRE, volume: v });
      } else {
        // Square falloff: loud nearby, still audible far away.
        const f = falloff(e.x - px, e.y - py, SHOT_HEARING_TILES);
        if (f > 0) out.push({ id: shotSound(e.weapon), volume: 0.15 + 0.85 * f * f });
      }
    } else if (e.type === 'reload') {
      // The event has no position: only the local player's own reload is heard.
      if ((e.phase === 'done' || e.phase === 'round') && e.playerId === localId)
        out.push({ id: e.phase === 'done' ? RELOAD : DRY_FIRE, volume: 0.7 });
    } else if (e.type === 'zombieAlerted') {
      const v = falloff(e.x - px, e.y - py) * 0.75;
      if (v > 0)
        out.push({ id: ALERTS[Math.floor(pick() * ALERTS.length)] ?? ALERTS[0], volume: v });
    } else if (e.type === 'windowSmashed') {
      const v = falloff(e.tx + 0.5 - px, e.ty + 0.5 - py) * 0.9;
      if (v > 0) out.push({ id: GLASS, volume: v });
    } else if (e.type === 'thrown') {
      const v = falloff(e.x - px, e.y - py) * 0.8;
      if (v > 0) out.push({ id: e.broke ? GLASS : THUD, volume: v });
    } else if (e.type === 'hit' && e.source !== 'shot') {
      const v = falloff(e.x - px, e.y - py) * (e.source === 'shove' ? 0.55 : 1);
      if (v > 0) out.push({ id: HITS[Math.floor(pick() * HITS.length)] ?? HITS[0], volume: v });
    } else if (
      e.type === 'openingChanged' &&
      e.kind === 'door' &&
      (e.state === 'open' || e.state === 'closed')
    ) {
      const v = falloff(e.tx + 0.5 - px, e.ty + 0.5 - py) * 0.8;
      if (v > 0) out.push({ id: e.state === 'open' ? DOOR_OPEN : DOOR_CLOSE, volume: v });
    }
  }
  return out;
}

/** Footsteps from the travelled distance of the local player (client side, no sim event). */
export class Footsteps {
  private acc = 0;
  private last: { x: number; y: number } | undefined;
  private n = 0;

  /** Returns a step cue when a stride was completed; `indoor` picks wood over concrete. */
  update(x: number, y: number, indoor: boolean, alive = true): Cue | undefined {
    const l = this.last;
    this.last = { x, y };
    if (!l || !alive) return undefined;
    const d = Math.hypot(x - l.x, y - l.y);
    // Teleports (spawn, load) are not steps.
    if (d > 2) return undefined;
    if (d < 1e-4) {
      this.acc = Math.min(this.acc, STEP_TILES * 0.6);
      return undefined;
    }
    this.acc += d;
    if (this.acc < STEP_TILES) return undefined;
    this.acc -= STEP_TILES;
    const set = indoor ? STEP_WOOD : STEP_CONCRETE;
    const id = set[this.n++ % set.length]!;
    return { id, volume: STEP_VOLUME };
  }
}
