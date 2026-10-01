import {
  SNAPSHOT_ENTITY_STRIDE,
  SnapshotAnim,
  SnapshotEntityKind,
  SnapshotField,
  type SimEvent,
} from '@deadzone/protocol';
import {
  DEFAULT_COMBAT_CONFIG,
  TICKS_PER_SECOND,
  WALK_SPEED_TILES_PER_SECOND,
  splitmix32,
  type CombatConfig,
} from '@deadzone/sim';
import {
  GETUP_TICKS,
  HIT_TICKS,
  KNOCKDOWN_FALL_TICKS,
  type BodyState,
  type PhysEvent,
  type PhysEventType,
  type PhysState,
} from './contract.js';
import {
  ENTITY_PHYS_STATES,
  PHYS_SNAPSHOT_STRIDE,
  PhysField,
  isPhysicsEvent,
} from './phys-layout.js';

/**
 * Visual reaction tuning (the push itself is sim physics since #66, which dropped these fields
 * from CombatConfig): former combat defaults, used only for the hit-reaction strength.
 */
const KNOCKBACK_TILES = 0.5;
const STAGGER_SEC_PER_KNOCKBACK = 0.6;
const SHOVE_PUSH_TILES = 0.7;
const SHOVE_STAGGER_SEC = 1.2;

/** Walk speed in tiles per tick (fallback `maxSpeed`). */
const WALK_PER_TICK = WALK_SPEED_TILES_PER_SECOND / TICKS_PER_SECOND;
/** A jump longer than this between two snapshots is a teleport, not motion (tiles). */
const TELEPORT_TILES = 2;
/** Share of shoved zombies that fall over (visual only, deterministic per id + tick). */
export const KNOCKDOWN_SHARE = 0.35;
/** A local shove command counts for an attack that starts within this many ticks. */
const LOCAL_ACTION_TICKS = 10;
/** Contract events kept until drained. */
const MAX_EVENTS = 64;
/** Peak speed decay per tick (maxSpeed follows the fastest recent motion). */
const PEAK_DECAY = 0.98;

const TIMED: ReadonlySet<BodyState> = new Set([
  'attack',
  'hit',
  'stagger',
  'push',
  'knockdown',
  'getup',
]);

const secToTicks = (s: number): number => Math.max(1, Math.round(s * TICKS_PER_SECOND));

/** Deterministic uint32 gait seed of a zombie from its StableId (until the sim sends one). */
export const gaitSeedOf = (id: number): number =>
  splitmix32(Math.imul(id, 0x2c1b3c6d) ^ 0x5bd1e995)() >>> 0;

/** Deterministic 0..1 from (id, tick) for visual-only choices. */
const roll = (id: number, tick: number): number =>
  (splitmix32(Math.imul(id, 0x27d4eb2d) ^ Math.imul(tick, 0x165667b1))() >>> 0) / 0x1_0000_0000;

interface Body {
  phys: PhysState;
  kind: number;
  x: number;
  y: number;
  tick: number;
  seen: number;
  /** Snapshot anim of the previous snapshot (attack edge detection). */
  snapAnim: number;
}

export interface PhysAdapterOptions {
  combat?: CombatConfig;
  /** `melee.knockback` of the weapon `attacker` (StableId) swings; undefined = unarmed. */
  knockbackOf?: (attacker: number) => number | undefined;
  /** PlayerId of the local player (`shot` events). */
  localPlayer?: number;
  /**
   * Snapshot entity stride (default: the protocol's). 16 = physics fields of sim #62 present:
   * state / timing / knockback / hit direction / gait seed are read, not derived.
   */
  stride?: number;
}

/**
 * Physics/animation state per entity in the contract shape (`anim/contract.ts`).
 *
 * Sim physics (#62, stride 16, `anim/phys-layout.ts`): `state`, `stateStartTick`,
 * `stateDuration`, `knockback`, `hitFromDir` and `gaitSeed` are copied from the snapshot and the
 * `physics` events (`attackStart` ... `died`) are forwarded; `facing` is the snapshot facing and
 * `vel` / `maxSpeed` come from position deltas. A client-side attack pose for firearm `shot`s
 * is kept over the sim's locomotion state.
 *
 * Fallback (stride 8, or zombie records without a gait seed such as the mock crowd): everything
 * is DERIVED from snapshot `anim` and `hit` events (durations from `DEFAULT_COMBAT_CONFIG`);
 * knockdown + get-up are then a visual-only guess for shoved zombies inside the sim's stagger.
 *
 * View-only: nothing here is sent back to the sim.
 */
export class PhysAdapter {
  private readonly bodies = new Map<number, Body>();
  private readonly events: PhysEvent[] = [];
  private readonly cfg: CombatConfig;
  private readonly knockbackOf: (attacker: number) => number | undefined;
  private readonly localPlayer: number;
  private generation = 0;
  private localAction: { kind: 'attack' | 'shove'; tick: number } | undefined;
  private readonly stride: number;
  /** The sim sends physics fields (#62 layout); otherwise everything is derived. */
  readonly simPhysics: boolean;
  /** StableId of the local player (first snapshot record). */
  localId = -1;
  /** Latest snapshot tick. */
  tick = 0;

  constructor(opts: PhysAdapterOptions = {}) {
    this.cfg = opts.combat ?? DEFAULT_COMBAT_CONFIG;
    this.knockbackOf = opts.knockbackOf ?? (() => undefined);
    this.localPlayer = opts.localPlayer ?? 0;
    this.stride = opts.stride ?? SNAPSHOT_ENTITY_STRIDE;
    this.simPhysics = this.stride >= PHYS_SNAPSHOT_STRIDE;
  }

  get(id: number): PhysState | undefined {
    return this.bodies.get(id)?.phys;
  }

  /** Contract events since the last call (oldest first). */
  drainEvents(): PhysEvent[] {
    return this.events.splice(0);
  }

  /** The local player just sent `attack` / `shove` (tells a swing from a shove). */
  noteLocalAction(kind: 'attack' | 'shove', tick = this.tick): void {
    this.localAction = { kind, tick };
  }

  pushSnapshot(tick: number, buf: Float32Array): void {
    const gen = ++this.generation;
    this.tick = tick;
    const stride = this.stride;
    const n = Math.floor(buf.length / stride);
    const u32 = this.simPhysics ? new Uint32Array(buf.buffer, buf.byteOffset, buf.length) : null;
    for (let e = 0; e < n; e++) {
      const o = e * stride;
      const id = buf[o + SnapshotField.stableId] ?? 0;
      if (e === 0) this.localId = id;
      const x = buf[o + SnapshotField.x] ?? 0;
      const y = buf[o + SnapshotField.y] ?? 0;
      const kind = buf[o + SnapshotField.kind] ?? 0;
      // Animals have no skeleton physics yet (TODO: animal renderer, docs 9.19).
      if (kind === SnapshotEntityKind.animal) continue;
      const anim = buf[o + SnapshotField.anim] ?? 0;
      let b = this.bodies.get(id);
      if (!b) {
        b = this.create(id, kind, x, y, tick, anim);
        this.bodies.set(id, b);
      }
      const dt = Math.max(1, tick - b.tick);
      let vx = (x - b.x) / dt;
      let vy = (y - b.y) / dt;
      if (Math.hypot(x - b.x, y - b.y) > TELEPORT_TILES) vx = vy = 0;
      const p = b.phys;
      p.vel.x = vx;
      p.vel.y = vy;
      p.maxSpeed = Math.max(WALK_PER_TICK, Math.hypot(vx, vy), p.maxSpeed * PEAK_DECAY);
      p.facing = buf[o + SnapshotField.facingRad] ?? 0;
      b.x = x;
      b.y = y;
      b.tick = tick;
      b.seen = gen;
      if (!u32 || !this.readSim(b, buf, u32, o, tick)) this.resolve(id, b, anim, tick);
      b.snapAnim = anim;
    }
    for (const [id, b] of this.bodies) if (b.seen !== gen) this.bodies.delete(id);
  }

  pushEvents(events: readonly { type: string }[]): void {
    for (const ev of events) {
      if (isPhysicsEvent(ev)) {
        // #62: the sim's own physics events (state already in the snapshot).
        if (ev.kind === 'hitLanded') {
          const b = this.bodies.get(ev.entity);
          if (b) b.phys.lastHitTick = ev.tick;
        }
        // Level events (v8) have no animation event yet; the state is in the snapshot.
        if (
          ev.kind === 'startedFalling' ||
          ev.kind === 'landed' ||
          ev.kind === 'vaulted' ||
          ev.kind === 'tripped'
        )
          continue;
        this.emit(ev.kind, ev.entity, ev.tick);
        continue;
      }
      const e = ev as SimEvent;
      if (e.type === 'hit' && !this.simPhysics) this.onHit(e);
      else if (e.type === 'shot' && e.playerId === this.localPlayer) this.onShot(e.tick);
    }
  }

  /**
   * Copies the #62 physics fields of one record. False when they are missing / invalid (the
   * caller falls back to deriving the state).
   */
  private readSim(b: Body, buf: Float32Array, u32: Uint32Array, o: number, tick: number): boolean {
    const si = buf[o + PhysField.state];
    const raw = si === undefined ? undefined : ENTITY_PHYS_STATES[si];
    if (!raw) return false;
    // Protocol v8/v9 states until the rig has own clips: climbing walks, falling staggers,
    // vaulting plays the push (arms forward over the fence).
    const state =
      raw === 'climb' ? 'walk' : raw === 'fall' ? 'stagger' : raw === 'vault' ? 'push' : raw;
    const seed = u32[o + PhysField.gaitSeed] ?? 0;
    // Zombies always get a gait seed from the physics module: none = no physics body in this
    // record (mock crowd, older data), derive instead.
    if (b.kind === SnapshotEntityKind.zombie && seed === 0) return false;
    const p = b.phys;
    const start = u32[o + PhysField.stateStartTick] ?? tick;
    let dur = buf[o + PhysField.stateDuration] ?? 0;
    // Contract here: knockdown stateDuration is the time lying after the fall (see pose.ts).
    if (state === 'knockdown') dur = Math.max(0, dur - KNOCKDOWN_FALL_TICKS);
    const prev = p.state;
    // A client-side shot pose (the sim has no swing for firearms) isn't cut by locomotion.
    const keepShot =
      prev === 'attack' &&
      tick - p.stateStartTick < p.stateDuration &&
      (state === 'idle' || state === 'walk' || state === 'run');
    if (!keepShot) {
      p.state = state;
      p.stateStartTick = start;
      p.stateDuration = dur;
    }
    p.knockback.dirX = buf[o + PhysField.knockbackDirX] ?? 0;
    p.knockback.dirY = buf[o + PhysField.knockbackDirY] ?? 0;
    p.knockback.strength = buf[o + PhysField.knockbackStrength] ?? 0;
    p.hitFromDir = buf[o + PhysField.hitFromDir] ?? 0;
    p.gaitSeed = seed;
    if (
      state !== prev &&
      (state === 'hit' || state === 'stagger' || state === 'knockdown') &&
      p.lastHitTick < start
    )
      p.lastHitTick = start;
    return true;
  }

  /** A firearm shot of the local player (the sim has no swing for it): attack state. */
  private onShot(tick: number): void {
    const b = this.bodies.get(this.localId);
    if (!b || b.phys.state === 'dead') return;
    this.enter(b.phys, 'attack', tick, secToTicks(this.cfg.attackAnimSec));
    this.emit('attackStart', this.localId, tick);
  }

  private create(id: number, kind: number, x: number, y: number, tick: number, anim: number): Body {
    const dead = anim === SnapshotAnim.dead;
    return {
      kind,
      x,
      y,
      tick,
      seen: 0,
      snapAnim: anim,
      phys: {
        facing: 0,
        vel: { x: 0, y: 0 },
        maxSpeed: WALK_PER_TICK,
        state: dead ? 'dead' : 'idle',
        // Corpses already down when first seen: no fall animation.
        stateStartTick: dead ? tick - 1000 : tick,
        stateDuration: 0,
        knockback: { dirX: 0, dirY: 0, strength: 0 },
        lastHitTick: -1,
        hitFromDir: 0,
        gaitSeed: kind === SnapshotEntityKind.zombie ? gaitSeedOf(id) : 0,
      },
    };
  }

  private enter(p: PhysState, state: BodyState, tick: number, duration = 0): void {
    p.state = state;
    p.stateStartTick = tick;
    p.stateDuration = duration;
  }

  private emit(type: PhysEventType, entityId: number, tick: number): void {
    this.events.push({ type, entityId, tick });
    // Nobody has to drain them: keep only the recent ones.
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  /** Picks the body state from the snapshot anim and the running timed state. */
  private resolve(id: number, b: Body, anim: number, tick: number): void {
    const p = b.phys;
    if (anim === SnapshotAnim.dead) {
      if (p.state !== 'dead') {
        this.enter(p, 'dead', tick);
        this.emit('died', id, tick);
      }
      return;
    }
    if (p.state === 'dead') this.enter(p, 'idle', tick);
    const elapsed = tick - p.stateStartTick;
    if (p.state === 'knockdown') {
      if (elapsed < KNOCKDOWN_FALL_TICKS + p.stateDuration) return;
      this.enter(p, 'getup', tick, GETUP_TICKS);
      return;
    }
    const swingStart = anim === SnapshotAnim.attack && b.snapAnim !== SnapshotAnim.attack;
    if (p.state === 'getup' && elapsed >= p.stateDuration) this.emit('gotUp', id, tick);
    else if (TIMED.has(p.state) && elapsed < p.stateDuration && !swingStart) return;
    if (anim === SnapshotAnim.attack) {
      if (!swingStart && (p.state === 'attack' || p.state === 'push')) return;
      const local = this.localAction;
      const shove =
        id === this.localId && local?.kind === 'shove' && tick - local.tick <= LOCAL_ACTION_TICKS;
      this.enter(p, shove ? 'push' : 'attack', tick, secToTicks(this.cfg.attackAnimSec));
      this.emit('attackStart', id, tick);
      return;
    }
    // Snapshots without a locomotion hint (mock crowd: anim 0) still walk when they move.
    const moving = b.phys.vel.x !== 0 || b.phys.vel.y !== 0;
    const next: BodyState =
      anim === SnapshotAnim.run ? 'run' : anim === SnapshotAnim.walk || moving ? 'walk' : 'idle';
    if (p.state !== next) this.enter(p, next, tick);
  }

  private onHit(e: Extract<SimEvent, { type: 'hit' }>): void {
    const t = this.bodies.get(e.target);
    if (!t) return;
    const a = this.bodies.get(e.attacker);
    const p = t.phys;
    let dx = t.x - (a?.x ?? e.x);
    let dy = t.y - (a?.y ?? e.y);
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      dx /= len;
      dy /= len;
    } else {
      dx = -Math.cos(p.facing);
      dy = -Math.sin(p.facing);
    }
    p.lastHitTick = e.tick;
    p.hitFromDir = Math.atan2(-dy, -dx);
    this.emit('hitLanded', e.target, e.tick);
    const cfg = this.cfg;
    let strength: number;
    let stagger = 0;
    if (e.source === 'shove') {
      strength = Math.min(1, SHOVE_PUSH_TILES / (KNOCKBACK_TILES * 2));
      stagger = secToTicks(SHOVE_STAGGER_SEC);
    } else if (e.source === 'melee') {
      const kb = this.knockbackOf(e.attacker) ?? cfg.unarmed.knockback;
      strength = Math.min(1, kb);
      if (kb > 0) stagger = secToTicks(STAGGER_SEC_PER_KNOCKBACK * kb);
    } else {
      strength = e.source === 'shot' ? 0.4 : 0.2;
    }
    p.knockback.dirX = dx;
    p.knockback.dirY = dy;
    p.knockback.strength = strength;
    if (e.killed || p.state === 'dead' || p.state === 'knockdown' || p.state === 'getup') return;
    const zombie = t.kind === SnapshotEntityKind.zombie;
    const lie = stagger - KNOCKDOWN_FALL_TICKS - GETUP_TICKS;
    if (e.source === 'shove' && zombie && lie >= 2 && roll(e.target, e.tick) < KNOCKDOWN_SHARE) {
      this.enter(p, 'knockdown', e.tick, lie);
      this.emit('fellDown', e.target, e.tick);
    } else if (stagger > HIT_TICKS) {
      this.enter(p, 'stagger', e.tick, stagger);
      this.emit('staggered', e.target, e.tick);
    } else {
      this.enter(p, 'hit', e.tick, HIT_TICKS);
    }
  }
}
