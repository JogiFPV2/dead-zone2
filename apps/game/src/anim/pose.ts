import { TICKS_PER_SECOND } from '@deadzone/sim';
import type { CharacterAnim } from '../models/character-rig.js';
import { GETUP_TICKS, KNOCKDOWN_FALL_TICKS, type BodyState, type PhysState } from './contract.js';

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
}

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

  pose(p: PhysState, tickF: number, ctx: PoseContext, out: AnimPose): AnimPose {
    const tps = TICKS_PER_SECOND;
    out.pitch = out.roll = out.twist = out.recoil = 0;
    out.faceTo = Number.NaN;
    out.lockFacing = false;
    out.loop = false;
    out.move = 0;
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
    } else if (s === 'dead' || s === 'knockdown' || s === 'getup') {
      this.held = undefined;
    }
    const h = this.held;
    if (h && tickF - h.start < h.ticks) return this.timed(h, tickF, ctx, out);
    this.held = undefined;
    out.state = s;
    const ts = Math.max(0, (tickF - p.stateStartTick) / tps);
    if (s === 'dead' || s === 'knockdown') {
      const len = ctx.clipLen('dead');
      const fall = s === 'knockdown' ? KNOCKDOWN_FALL_TICKS / tps : len;
      out.anim = 'dead';
      out.time = (Math.min(ts, fall) / fall) * len;
      out.faceTo = p.lastHitTick >= 0 ? p.hitFromDir : Number.NaN;
      out.lockFacing = ts > 0.25;
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
