import type { CharacterAnim } from '../models/character-rig.js';
import { RUN_CLIP_SPEED, WALK_CLIP_SPEED, type AnimPose } from './pose.js';
import { easeMove } from '../world/furniture-moves.js';

/** How far the body leans after a pushed piece during the push (tiles), back after it. */
export const PUSH_FOLLOW = 0.3;
/** Settle of the body onto its sim place after the action (ms). */
export const BODY_SETTLE_MS = 250;

export type FurnitureMoveMode = 'push' | 'pull' | 'rotate';

/** `ActionView.furniture` of the running `moveFurniture` (protocol 38) plus its timing. */
export interface FurnitureMoveAction {
  mode: FurnitureMoveMode;
  dirX: number;
  dirY: number;
  /** Progress 0..1 of the action (sim ticks). */
  k: number;
  /** Action length (s). */
  seconds: number;
}

/** Body of a furniture move at progress `k` 0..1 of the action. */
export interface FurnitureMoveBody {
  anim: CharacterAnim;
  /** Clip playback rate (1 = clip speed): a slow step at the piece's speed. */
  rate: number;
  /** Lean (rad, + = forward, into the piece). */
  pitch: number;
  /** Extra heading swing (rad): working the piece round. */
  twist: number;
  /** Body offset along `dir` (tiles; pull = the step back with the piece). */
  along: number;
  /** Heading of the body (rad, sim), NaN = keep: faces the piece. */
  face: number;
}

/**
 * Clip and offsets of a furniture move from the action (`ActionView.furniture`), from its first
 * tick: push = a slow forward step along `dir` leaning into the piece, the body following it a
 * little; pull = a slow step back along `dir` (backwards gait, facing the piece), leaning back,
 * the whole tile with it; rotate = a slow shuffle leaning in with a heading swing while the
 * piece turns. The step speed is one tile per action (`seconds`), so the feet do not slide.
 */
export function furnitureMoveBody(a: FurnitureMoveAction): FurnitureMoveBody {
  const t = Math.min(1, Math.max(0, a.k));
  const speed = 1 / Math.max(0.2, a.seconds);
  switch (a.mode) {
    case 'push':
      return {
        anim: 'walk',
        rate: speed / WALK_CLIP_SPEED,
        pitch: 0.22,
        twist: 0,
        along: PUSH_FOLLOW * Math.sin(Math.PI * t),
        face: Math.atan2(a.dirY, a.dirX),
      };
    case 'pull':
      return {
        anim: 'back',
        // Backwards gait = the run-back clip slowed down (character-rig.ts).
        rate: speed / RUN_CLIP_SPEED,
        pitch: -0.14,
        twist: 0,
        along: easeMove(t),
        face: Math.atan2(-a.dirY, -a.dirX),
      };
    default:
      return {
        anim: 'walk',
        rate: (0.6 * speed) / WALK_CLIP_SPEED,
        pitch: 0.16,
        twist: 0.25 * Math.sin(Math.PI * t),
        along: 0,
        face: Number.NaN,
      };
  }
}

/**
 * One character's furniture move on screen, driven by its `moveFurniture` action (protocol 38
 * `ActionView.furniture`): `setAction` per frame, `apply` overrides the pose (clip, lean,
 * heading) and gives where to draw the body. After the action the body settles on its sim place:
 * a tile back after a finished pull (`completed`, from `furnitureMoved`), else where it stood.
 */
export class FurnitureMoveAnim {
  private action: FurnitureMoveAction | undefined;
  private key = '';
  /** Drawn body position when the action started (sim tiles). */
  private from = { x: 0, y: 0 };
  private dir = { x: 0, y: 0 };
  private mode: FurnitureMoveMode = 'push';
  private last: { x: number; y: number } | undefined;
  private settle: { from: { x: number; y: number }; start: number } | undefined;
  private clipTime = 0;
  /** The piece of the last action moved (`furnitureMoved`): a pull ends a tile back. */
  completed = false;

  /** Running action (undefined = none); `at` = where the body is drawn now (sim tiles). */
  setAction(a: FurnitureMoveAction | undefined, at: { x: number; y: number }): void {
    const key = a ? `${a.mode}|${a.dirX},${a.dirY}` : '';
    if (key !== this.key) {
      if (a) {
        this.from = { x: at.x, y: at.y };
        this.dir = { x: a.dirX, y: a.dirY };
        this.mode = a.mode;
        this.completed = false;
        this.settle = undefined;
        this.clipTime = 0;
      } else if (this.last) this.settle = { from: this.last, start: Number.NaN };
      this.key = key;
    }
    this.action = a;
  }

  get active(): boolean {
    return this.action !== undefined || this.settle !== undefined;
  }

  /** Current mode, undefined = none (tests, debugging). */
  get current(): FurnitureMoveMode | undefined {
    return this.action?.mode;
  }

  /**
   * Overrides `out` while the action runs; returns where to draw the body (sim tiles) during it
   * and the settle after it, or undefined = where the sim has it (pose untouched).
   */
  apply(nowMs: number, dt: number, out: AnimPose): { x: number; y: number } | undefined {
    const a = this.action;
    if (!a) {
      const s = this.settle;
      if (!s) return undefined;
      if (Number.isNaN(s.start)) s.start = nowMs;
      const k = (nowMs - s.start) / BODY_SETTLE_MS;
      if (k >= 1 || nowMs < s.start) {
        this.settle = undefined;
        this.last = undefined;
        return undefined;
      }
      const back = this.mode === 'pull' && this.completed ? 1 : 0;
      const tx = this.from.x + this.dir.x * back;
      const ty = this.from.y + this.dir.y * back;
      const e = easeMove(k);
      return { x: s.from.x + (tx - s.from.x) * e, y: s.from.y + (ty - s.from.y) * e };
    }
    const b = furnitureMoveBody(a);
    this.clipTime += dt * b.rate;
    out.anim = b.anim;
    out.time = this.clipTime;
    out.loop = true;
    out.pitch = b.pitch;
    out.twist = b.twist;
    out.roll = 0;
    out.faceTo = b.face;
    out.lockFacing = Number.isNaN(b.face);
    out.move = 1;
    this.last = { x: this.from.x + this.dir.x * b.along, y: this.from.y + this.dir.y * b.along };
    return this.last;
  }
}
