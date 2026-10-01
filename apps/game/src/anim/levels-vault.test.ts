import { describe, expect, it } from 'vitest';
import { SnapshotEntityKind } from '@deadzone/protocol';
import { TICKS_PER_SECOND } from '@deadzone/sim';
import { WINDOW_VAULT_TICKS, type PhysState } from './contract.js';
import { BodyMotion, PLAYER_MOTION } from './motion.js';
import { PhysAdapter } from './phys-adapter.js';
import { ENTITY_PHYS_STATES, PhysField } from './phys-layout.js';
import {
  CLIMB_DOWN_PITCH,
  CLIMB_UP_PITCH,
  FENCE_HOP,
  PoseTracker,
  TRIP_STUMBLE_TICKS,
  WINDOW_SILL,
  newPose,
  type PoseContext,
} from './pose.js';

type PhysName = (typeof ENTITY_PHYS_STATES)[number];
interface Rec {
  id: number;
  x: number;
  kind: number;
  state: PhysName;
  start: number;
  dur?: number;
  seed?: number;
}

function snap16(...recs: Rec[]): Float32Array {
  const f = new Float32Array(recs.length * 16);
  const u = new Uint32Array(f.buffer);
  recs.forEach((r, i) => {
    const o = i * 16;
    f[o] = r.id;
    f[o + 1] = r.x;
    f[o + 5] = r.kind;
    f[o + 7] = 1;
    f[o + PhysField.state] = ENTITY_PHYS_STATES.indexOf(r.state);
    u[o + PhysField.stateStartTick] = r.start;
    f[o + PhysField.stateDuration] = r.dur ?? 0;
    u[o + PhysField.gaitSeed] = r.seed ?? 0;
  });
  return f;
}

const P = SnapshotEntityKind.player;
const Z = SnapshotEntityKind.zombie;

const body = (over: Partial<PhysState> = {}): PhysState => ({
  facing: 0,
  vel: { x: 0, y: 0 },
  maxSpeed: 0.1,
  state: 'idle',
  stateStartTick: 0,
  stateDuration: 0,
  knockback: { dirX: 0, dirY: 0, strength: 0 },
  lastHitTick: -1,
  hitFromDir: 0,
  gaitSeed: 0,
  ...over,
});
const ctx = (over: Partial<PoseContext> = {}): PoseContext => ({
  weapon: 'unarmed',
  speed: 2,
  clipLen: () => 1,
  loopTime: 0.25,
  ...over,
});

describe('floors and vaults in the PhysAdapter (protocol v10)', () => {
  it('passes climb / fall / vault through instead of walk / stagger / push', () => {
    const a = new PhysAdapter({ stride: 16 });
    a.pushSnapshot(
      10,
      snap16(
        { id: 1, x: 0, kind: P, state: 'vault', start: 9, dur: 20 },
        { id: 2, x: 1, kind: Z, state: 'climb', start: 5, seed: 7 },
        { id: 3, x: 2, kind: Z, state: 'fall', start: 8, dur: 9, seed: 9 },
      ),
    );
    expect(a.get(1)?.state).toBe('vault');
    expect(a.get(1)?.stateDuration).toBe(20);
    expect(a.get(2)?.state).toBe('climb');
    expect(a.get(3)?.state).toBe('fall');
  });

  it('forwards startedFalling / landed / tripped and fellFromHeight with its numbers', () => {
    const a = new PhysAdapter({ stride: 16 });
    a.pushSnapshot(10, snap16({ id: 1, x: 0, kind: P, state: 'idle', start: 0 }));
    a.drainEvents();
    a.pushEvents([
      { type: 'physics', tick: 11, kind: 'startedFalling', entity: 1 },
      { type: 'physics', tick: 20, kind: 'landed', entity: 1 },
      { type: 'fellFromHeight', tick: 20, entity: 1, levels: 2, damage: 31.5, killed: false },
      { type: 'physics', tick: 30, kind: 'tripped', entity: 1 },
    ] as never);
    const ev = a.drainEvents();
    expect(ev.map((e) => e.type)).toEqual([
      'startedFalling',
      'landed',
      'fellFromHeight',
      'tripped',
    ]);
    expect(ev[2]?.fall).toEqual({ levels: 2, damage: 31.5, killed: false });
    expect(a.get(1)?.tripTick).toBe(30);
  });

  it('marks bodies outside the active 5 × 5 chunk window as frozen (#98)', () => {
    const a = new PhysAdapter({ stride: 16 });
    a.pushSnapshot(
      10,
      snap16(
        { id: 1, x: 10, kind: P, state: 'idle', start: 0 },
        { id: 2, x: 2 * 32 + 5, kind: Z, state: 'walk', start: 0, seed: 3 },
        { id: 3, x: 3 * 32 + 5, kind: Z, state: 'walk', start: 0, seed: 4 },
      ),
    );
    expect(a.get(1)?.frozen).toBe(false);
    expect(a.get(2)?.frozen).toBe(false);
    expect(a.get(3)?.frozen).toBe(true);
  });
});

describe('poses for stairs, falls, vaults and trips', () => {
  it('climb: walk clip leaning into the flight, with a step bob', () => {
    const t = new PoseTracker();
    const up = t.pose(body({ state: 'climb' }), 10, ctx({ vz: 0.4 }), newPose());
    expect(up.anim).toBe('walk');
    expect(up.pitch).toBe(CLIMB_UP_PITCH);
    expect(up.lift).toBeGreaterThan(0);
    const down = t.pose(body({ state: 'climb' }), 10, ctx({ vz: -0.4 }), newPose());
    expect(down.pitch).toBe(CLIMB_DOWN_PITCH);
    const stand = t.pose(body({ state: 'climb' }), 10, ctx({ speed: 0 }), newPose());
    expect(stand.anim).toBe('idle');
    expect(stand.lift).toBe(0);
  });

  it('fall: thrown back with arms up, facing locked; knock-down follows', () => {
    const t = new PoseTracker();
    const p = t.pose(
      body({ state: 'fall', stateStartTick: 0, stateDuration: 9 }),
      6,
      ctx(),
      newPose(),
    );
    expect(p.anim).toBe('hit');
    expect(p.pitch).toBeLessThan(-0.3);
    expect(p.lockFacing).toBe(true);
  });

  it('vault: a hop over a fence (1 s), a crawl at sill height through a window (1.5 s)', () => {
    const fence = body({ state: 'vault', stateStartTick: 0, stateDuration: TICKS_PER_SECOND });
    const f = new PoseTracker().pose(fence, TICKS_PER_SECOND * 0.47, ctx(), newPose());
    expect(f.anim).toBe('push');
    expect(f.lift).toBeGreaterThan(FENCE_HOP * 0.9);
    const win = body({ state: 'vault', stateStartTick: 0, stateDuration: 30 });
    expect(win.stateDuration).toBeGreaterThanOrEqual(WINDOW_VAULT_TICKS);
    const w = new PoseTracker().pose(win, 15, ctx(), newPose());
    expect(w.lift).toBeCloseTo(WINDOW_SILL, 5);
    expect(w.pitch).toBeGreaterThan(0.8);
    const done = new PoseTracker().pose(win, 30, ctx(), newPose());
    expect(done.lift).toBeCloseTo(0, 5);
  });

  it('tripped knock-down: stumble forward first, then the fall of the dead clip', () => {
    const kd = body({ state: 'knockdown', stateStartTick: 40, stateDuration: 30, tripTick: 40 });
    const t = new PoseTracker();
    const s = t.pose(kd, 42, ctx(), newPose());
    expect(s.anim).toBe('stagger');
    expect(s.pitch).toBeGreaterThan(0);
    const f = t.pose(kd, 40 + TRIP_STUMBLE_TICKS + 2, ctx(), newPose());
    expect(f.anim).toBe('dead');
    expect(f.time).toBeGreaterThan(0);
  });

  it('frozen bodies hold their last pose', () => {
    const t = new PoseTracker();
    const out = newPose();
    t.pose(body({ state: 'walk' }), 10, ctx({ loopTime: 0.3 }), out);
    const time = out.time;
    t.pose(body({ state: 'walk', frozen: true }), 50, ctx({ loopTime: 0.9 }), out);
    expect(out.time).toBe(time);
    expect(out.move).toBe(0);
  });
});

describe('BodyMotion on stairs', () => {
  it('follows a fractional z without snapping and reports the vertical speed', () => {
    const m = new BodyMotion();
    m.update(5, 5, 0, 0, 0, -1, 0.016, PLAYER_MOTION);
    m.update(5, 4.98, 0.02, 0, 0, -1, 0.016, PLAYER_MOTION);
    m.update(5, 4.96, 0.04, 0, 0, -1, 0.016, PLAYER_MOTION);
    expect(m.z).toBeCloseTo(0.04, 5);
    expect(m.vz).toBeGreaterThan(0);
    expect(m.y).toBeGreaterThan(4.96);
    // A teleport to another floor snaps.
    m.update(5, 4.96, 2, 0, 0, 0, 0.016, PLAYER_MOTION);
    expect(m.z).toBe(2);
    expect(m.vz).toBe(0);
  });
});
