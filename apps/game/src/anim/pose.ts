import { TICKS_PER_SECOND } from '@deadzone/sim';
import type { CharacterAnim } from '../models/character-rig.js';
import {
  GETUP_TICKS,
  KNOCKDOWN_FALL_TICKS,
  WINDOW_VAULT_TICKS,
  type BodyState,
  type PhysState,
} from './contract.js';

/** How the held weapon swings (`weapons/weapon-kinds.ts`). */
export type WeaponClass = 'unarmed' | 'one_handed' | 'two_handed' | 'stab' | 'firearm';

/** Walk / run speeds (tiles/s) at which the clips play at rate 1 (no foot sliding). */
export const WALK_CLIP_SPEED = 2.4;
export const RUN_CLIP_SPEED = 5;
/** Below this drawn speed the body stands (tiles/s). */
const STAND_SPEED = 0.25;

/**
 * Seconds a reaction / attack stays on screen. The sim's `anim = attack` lasts
 * `attackAnimSec`, the swings read better a little longer, so the view holds them.
 */
const SHOW_SEC: Partial<Record<BodyState, number>> = { hit: 0.45, push: 0.45 };
const ATTACK_SEC: Record<WeaponClass, number> = {
  unarmed: 0.45,
  one_handed: 0.55,
  two_handed: 0.8,
  stab: 0.45,
  firearm: 0.35,
};
/** After a shot the gun stays raised (aim stub until the sim has an aim command). */
const AIM_HOLD_SEC = 1.2;

export interface AnimPose {
  anim: CharacterAnim;
  /** Clip time (s); loops are wrapped by the player of the clip. */
  time: number;
  loop: boolean;
  /** Extra body lean (rad, + = forward) and roll (rad) on top of the clip. */
  pitch: number;
  roll: number;
  /** Extra heading (rad): torso swing of a wide two-handed blow. */
  twist: number;
  /** Firearm recoil 0..1. */
  recoil: number;
  /** Heading the body turns to (fall away from the hit), NaN = keep the motion facing. */
  faceTo: number;
  /** Heading frozen (lying / dead). */
  lockFacing: boolean;
  /** 0..1 share of locomotion (gait sway). */
  move: number;
  /** Extra body height (m): step bob on stairs. */
  lift: number;
  /** Shown state (may be a held reaction after the sim state ended). */
  state: BodyState;
}

export const newPose = (): AnimPose => ({
  anim: 'idle',
  time: 0,
  loop: true,
  pitch: 0,
  roll: 0,
  twist: 0,
  recoil: 0,
  faceTo: Number.NaN,
  lockFacing: false,
  move: 0,
  lift: 0,
  state: 'idle',
});

export interface PoseContext {
  weapon: WeaponClass;
  /** Drawn speed (tiles/s). */
  speed: number;
  /** Clip length (s) of `anim` (1 when unknown). */
  clipLen: (anim: CharacterAnim) => number;
  /** Seconds of locomotion clip time accumulated by the caller (loops). */
  loopTime: number;
  /** Drawn vertical speed (levels/s, + = up); stairs lean. 0 when unknown. */
  vz?: number;
}

/** Forward lean going up / back lean going down a flight of stairs (rad). */
export const CLIMB_UP_PITCH = 0.16;
export const CLIMB_DOWN_PITCH = -0.07;
/** Step bob on stairs (m, peak), twice per walk cycle. */
export const CLIMB_BOB = 0.05;
/** Peak hop over a low fence (m) and the body height crawling through a window sill (m). */
export const FENCE_HOP = 0.55;
export const WINDOW_SILL = 0.75;
/** Ticks of the forward stumble at the start of a knock-down after a trip (then the fall). */
export const TRIP_STUMBLE_TICKS = 6;

const smooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/** Smooth 0 -> 1 -> 0 envelope over p in 0..1. */
const bell = (p: number): number => (p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p));
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

interface Held {
  state: BodyState;
  start: number;
  /** Ticks the state stays on screen. */
  ticks: number;
  weapon: WeaponClass;
  strength: number;
}

/**
 * Per-entity choice of clip + procedural offsets from the contract state. Holds short
 * reactions / swings on screen for their full length after the sim state moved on.
 * Reads only (view-side), no allocation per call.
 */
export class PoseTracker {
  private held: Held | undefined;
  private lastShotTick = Number.NEGATIVE_INFINITY;

  private posed = false;

  pose(p: PhysState, tickF: number, ctx: PoseContext, out: AnimPose): AnimPose {
    // Frozen outside the sim's active window (#98): hold the last pose, no gait sway.
    if (p.frozen && this.posed) {
      out.move = 0;
      return out;
    }
    this.posed = true;
    const tps = TICKS_PER_SECOND;
    out.pitch = out.roll = out.twist = out.recoil = 0;
    out.faceTo = Number.NaN;
    out.lockFacing = false;
    out.loop = false;
    out.move = 0;
    out.lift = 0;
    const s = p.state;
    if (s === 'attack' || s === 'push' || s === 'hit' || s === 'stagger') {
      const h = this.held;
      if (!h || h.start !== p.stateStartTick || h.state !== s) {
        const sec =
          s === 'attack'
            ? ATTACK_SEC[ctx.weapon]
            : s === 'stagger'
              ? Math.max(0.5, p.stateDuration / tps)
              : (SHOW_SEC[s] ?? 0.45);
        this.held = {
          state: s,
          start: p.stateStartTick,
          ticks: Math.max(p.stateDuration, sec * tps),
          weapon: ctx.weapon,
          strength: p.knockback.strength,
        };
        if (s === 'attack' && ctx.weapon === 'firearm') this.lastShotTick = p.stateStartTick;
      }
    } else if (
      s === 'dead' ||
      s === 'knockdown' ||
      s === 'getup' ||
      s === 'fall' ||
      s === 'vault'
    ) {
      this.held = undefined;
    }
    const h = this.held;
    if (h && tickF - h.start < h.ticks) return this.timed(h, tickF, ctx, out);
    this.held = undefined;
    out.state = s;
    const ts = Math.max(0, (tickF - p.stateStartTick) / tps);
    if (s === 'vault') return vaultPose(p, ts, ctx, out);
    if (s === 'knockdown' && p.tripTick !== undefined && p.tripTick >= 0) {
      // Tripped on a vault: a stumble forward first, then the usual fall (below, delayed).
      const since = tickF - p.stateStartTick;
      if (p.tripTick >= p.stateStartTick - 1 && since < TRIP_STUMBLE_TICKS) {
        const k = clamp01(since / TRIP_STUMBLE_TICKS);
        out.anim = 'stagger';
        out.time = 0.3 * ctx.clipLen('stagger') * k;
        out.pitch = 0.5 * Math.sin((Math.PI / 2) * k);
        out.roll = 0.1 * Math.sin(Math.PI * k);
        out.lockFacing = true;
        return out;
      }
    }
    if (s === 'dead' || s === 'knockdown') {
      const len = ctx.clipLen('dead');
      const fall = s === 'knockdown' ? KNOCKDOWN_FALL_TICKS / tps : len;
      const tripped =
        s === 'knockdown' && (p.tripTick ?? -1) >= p.stateStartTick - 1
          ? TRIP_STUMBLE_TICKS / tps
          : 0;
      out.anim = 'dead';
      out.time = (Math.min(Math.max(0, ts - tripped), fall) / fall) * len;
      out.faceTo = p.lastHitTick >= 0 ? p.hitFromDir : Number.NaN;
      out.lockFacing = ts > 0.25;
      return out;
    }
    if (s === 'fall') {
      // Free fall: thrown back, arms up (frozen mid-flail of the hit clip), wobbling; the sim
      // follows with `knockdown` (the fall-over + lying of the dead clip) or `dead`.
      const len = ctx.clipLen('hit');
      const k = clamp01(ts / 0.25);
      out.anim = 'hit';
      out.time = 0.55 * len * k;
      out.pitch = -0.4 * k;
      out.roll = 0.14 * Math.sin(ts * 15) * k;
      out.lockFacing = true;
      return out;
    }
    if (s === 'getup') {
      const len = ctx.clipLen('getup');
      out.anim = 'getup';
      out.time = clamp01(ts / ((p.stateDuration || GETUP_TICKS) / tps)) * len;
      out.lockFacing = true;
      return out;
    }
    // Locomotion from the drawn speed (no skating when the sim speed jumps).
    out.loop = true;
    out.time = ctx.loopTime;
    const moving = ctx.speed > STAND_SPEED && s !== 'idle';
    out.move = clamp01(ctx.speed / WALK_CLIP_SPEED);
    const gun = ctx.weapon === 'firearm';
    if (!moving) {
      out.anim = gun
        ? tickF - this.lastShotTick < AIM_HOLD_SEC * tps
          ? 'aim'
          : 'idle_gun'
        : 'idle';
      out.move = 0;
    } else out.anim = s === 'run' ? 'run' : 'walk';
    if (s === 'climb' && moving) {
      // Stairs: lean into the flight, shorter steps lifting the body twice per cycle.
      const vz = ctx.vz ?? 0;
      out.pitch = vz > 0.02 ? CLIMB_UP_PITCH : vz < -0.02 ? CLIMB_DOWN_PITCH : 0;
      const cycle = ctx.clipLen(out.anim) || 1;
      out.lift = CLIMB_BOB * Math.abs(Math.sin((ctx.loopTime / cycle) * Math.PI * 2));
    }
    return out;
  }

  /** Playback rate of the current loop for a drawn speed (tiles/s). */
  static loopRate(anim: CharacterAnim, speed: number): number {
    if (anim === 'walk') return Math.max(0.5, Math.min(1.6, speed / WALK_CLIP_SPEED));
    if (anim === 'run') return Math.max(0.6, Math.min(1.5, speed / RUN_CLIP_SPEED));
    // Backwards / side gaits are run clips played slower (walk pace), see character-rig.ts.
    if (anim === 'back' || anim === 'strafeLeft' || anim === 'strafeRight')
      return Math.max(0.35, Math.min(1, speed / RUN_CLIP_SPEED));
    return 1;
  }

  private timed(h: Held, tickF: number, ctx: PoseContext, out: AnimPose): AnimPose {
    const dur = h.ticks / TICKS_PER_SECOND;
    const ts = Math.max(0, (tickF - h.start) / TICKS_PER_SECOND);
    const p = clamp01(ts / dur);
    out.state = h.state;
    const fit = (anim: CharacterAnim): void => {
      out.anim = anim;
      out.time = p * ctx.clipLen(anim);
    };
    // Wind-up to one side, follow-through to the other.
    const swing = (amp: number): number => amp * Math.cos(Math.PI * p) * Math.sqrt(bell(p) || 0);
    switch (h.state) {
      case 'attack':
        switch (h.weapon) {
          case 'one_handed':
            fit('slash');
            out.twist = swing(0.35);
            break;
          case 'two_handed':
            fit('slash');
            out.twist = swing(0.8);
            out.pitch = 0.1 * bell(p);
            break;
          case 'stab':
            fit('attack');
            out.pitch = 0.16 * bell(p);
            break;
          case 'firearm':
            fit('shoot');
            out.recoil = Math.exp(-ts * 10);
            out.pitch = -0.07 * out.recoil;
            break;
          default:
            fit('attack');
            out.pitch = 0.08 * bell(p);
        }
        break;
      case 'push':
        fit('push');
        out.pitch = 0.12 * bell(p);
        break;
      case 'hit':
        fit('hit');
        out.pitch = -(0.1 + 0.15 * h.strength) * bell(p);
        break;
      default:
        // Stagger: thrown back, then catching the balance with a wobble.
        fit('stagger');
        out.pitch = -(0.15 + 0.3 * h.strength) * bell(Math.pow(p, 0.6));
        out.roll = 0.12 * Math.sin(p * Math.PI * 3) * (1 - p);
    }
    return out;
  }
}

/**
 * Vault over a low fence (short `stateDuration`) or through a window (≥ WINDOW_VAULT_TICKS):
 * progress from the sim's state timing. Fence: plant the hands (push clip), hop with the legs
 * swung to the side. Window: lean in and down over the sill, crawl through at sill height,
 * stand up on the far side. The sim moves the position across the edge meanwhile.
 */
function vaultPose(p: PhysState, ts: number, ctx: PoseContext, out: AnimPose): AnimPose {
  const dur = Math.max(1, p.stateDuration) / TICKS_PER_SECOND;
  const k = clamp01(ts / dur);
  const len = ctx.clipLen('push');
  out.anim = 'push';
  out.lockFacing = true;
  if (p.stateDuration >= WINDOW_VAULT_TICKS) {
    // 0..0.3 lean in and climb onto the sill, 0.3..0.7 through, 0.7..1 down and up.
    const up = smooth(k / 0.3);
    const down = smooth((k - 0.7) / 0.3);
    out.time = len * (0.3 + 0.4 * Math.min(1, k / 0.3));
    out.pitch = 0.95 * up * (1 - down);
    out.lift = WINDOW_SILL * up * (1 - down);
    out.roll = 0.06 * Math.sin(Math.PI * 4 * k) * up * (1 - down);
  } else {
    // Hands on the rail at 0.2, over the top at 0.5, landing at 0.85.
    const hop = bell(clamp01((k - 0.1) / 0.75));
    out.time = len * Math.min(1, k / 0.35) * 0.5;
    out.pitch = 0.35 * hop;
    out.lift = FENCE_HOP * hop;
    out.roll = 0.22 * hop;
  }
  return out;
}
