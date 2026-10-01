import { describe, expect, it } from 'vitest';
import type { PhysState } from './contract.js';
import { gaitOf, gaitOffsets, type GaitOffsets } from './gait.js';
import { gaitSeedOf } from './phys-adapter.js';
import { BodyMotion, PLAYER_MOTION, ZOMBIE_MOTION } from './motion.js';
import { PoseTracker, newPose, type PoseContext } from './pose.js';

const phys = (over: Partial<PhysState> = {}): PhysState => ({
  facing: 0,
  vel: { x: 0, y: 0 },
  maxSpeed: 0.15,
  state: 'idle',
  stateStartTick: 0,
  stateDuration: 0,
  knockback: { dirX: 0, dirY: 0, strength: 0 },
  lastHitTick: -1,
  hitFromDir: 0,
  gaitSeed: 0,
  ...over,
});

describe('gait', () => {
  it('is deterministic per seed and differs between zombies', () => {
    expect(gaitOf(gaitSeedOf(5))).toEqual(gaitOf(gaitSeedOf(5)));
    const rates = new Set([1, 2, 3, 4, 5, 6].map((id) => gaitOf(gaitSeedOf(id)).rate.toFixed(3)));
    expect(rates.size).toBe(6);
  });

  it('sways side to side while walking and stays bounded', () => {
    const g = gaitOf(gaitSeedOf(9));
    const o: GaitOffsets = { roll: 0, pitch: 0, yaw: 0, bob: 0 };
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 3; t += 0.05) {
      gaitOffsets(g, t, 1, o);
      min = Math.min(min, o.roll);
      max = Math.max(max, o.roll);
      expect(Math.abs(o.yaw)).toBeLessThan(0.3);
      expect(o.bob).toBeLessThanOrEqual(0);
      expect(o.pitch).toBeGreaterThan(0);
    }
    expect(max - min).toBeGreaterThan(0.05);
    expect(Math.max(Math.abs(min), Math.abs(max))).toBeLessThan(0.4);
  });
});

describe('BodyMotion', () => {
  it('ramps up to the sim speed instead of jumping and never lags too far', () => {
    const m = new BodyMotion();
    m.update(0, 0, 0, 0, 0, 0, 0, PLAYER_MOTION);
    let x = 0;
    const speeds: number[] = [];
    for (let i = 0; i < 60; i++) {
      x += 3 / 60;
      m.update(x, 0, 0, 0, 3, 0, 1 / 60, PLAYER_MOTION);
      speeds.push(m.speed);
      expect(Math.abs(m.x - x)).toBeLessThanOrEqual(PLAYER_MOTION.maxLag + 1e-9);
    }
    expect(speeds[0]).toBeLessThanOrEqual(PLAYER_MOTION.accel / 60 + 1e-9);
    for (let i = 1; i < speeds.length; i++)
      expect(speeds[i]! - speeds[i - 1]!).toBeLessThanOrEqual(PLAYER_MOTION.accel / 60 + 1e-9);
    expect(speeds.at(-1)).toBeCloseTo(3, 1);
    expect(m.x).toBeCloseTo(x, 1);
  });

  it('turns at a limited rate along the short arc', () => {
    const m = new BodyMotion();
    m.update(0, 0, 0, 0, 0, 0, 0, ZOMBIE_MOTION);
    m.update(0, 0, 0, 3, 0, 0, 0.1, ZOMBIE_MOTION);
    expect(m.facing).toBeGreaterThan(0);
    expect(m.facing).toBeLessThanOrEqual(ZOMBIE_MOTION.turnRate * 0.1 + 1e-9);
    m.update(0, 0, 0, -3, 0, 0, 0.1, ZOMBIE_MOTION, ZOMBIE_MOTION.turnRate, true);
    expect(m.facing).toBeGreaterThan(0);
  });

  it('snaps on teleports', () => {
    const m = new BodyMotion();
    m.update(0, 0, 0, 0, 0, 0, 0, PLAYER_MOTION);
    m.update(10, 0, 0, 0, 0, 0, 1 / 60, PLAYER_MOTION);
    expect(m.x).toBe(10);
  });
});

describe('PoseTracker', () => {
  const ctx = (over: Partial<PoseContext> = {}): PoseContext => ({
    weapon: 'unarmed',
    speed: 0,
    clipLen: () => 1,
    loopTime: 0,
    ...over,
  });

  it('picks the attack clip by weapon class and holds it after the sim state ends', () => {
    const cases = [
      ['unarmed', 'attack'],
      ['one_handed', 'slash'],
      ['two_handed', 'slash'],
      ['stab', 'attack'],
      ['firearm', 'shoot'],
    ] as const;
    for (const [weapon, anim] of cases) {
      const t = new PoseTracker();
      const p = phys({ state: 'attack', stateStartTick: 10, stateDuration: 8 });
      expect(t.pose(p, 12, ctx({ weapon }), newPose()).anim).toBe(anim);
      p.state = 'idle';
      p.stateStartTick = 17;
      expect(t.pose(p, 17.5, ctx({ weapon }), newPose()).anim).toBe(anim);
    }
    const t = new PoseTracker();
    const two = t.pose(
      phys({ state: 'attack', stateStartTick: 0, stateDuration: 8 }),
      2,
      ctx({ weapon: 'two_handed' }),
      newPose(),
    );
    expect(Math.abs(two.twist)).toBeGreaterThan(0.1);
  });

  it('leans back when staggered and falls / gets up with the death clip', () => {
    const t = new PoseTracker();
    const st = t.pose(
      phys({ state: 'stagger', stateDuration: 24, knockback: { dirX: 1, dirY: 0, strength: 1 } }),
      6,
      ctx(),
      newPose(),
    );
    expect(st.anim).toBe('stagger');
    expect(st.pitch).toBeLessThan(-0.1);
    const down = t.pose(
      phys({
        state: 'knockdown',
        stateStartTick: 0,
        stateDuration: 5,
        lastHitTick: 0,
        hitFromDir: 2,
      }),
      40,
      ctx(),
      newPose(),
    );
    expect(down.anim).toBe('dead');
    expect(down.time).toBeCloseTo(1);
    expect(down.faceTo).toBe(2);
    const up = t.pose(
      phys({ state: 'getup', stateStartTick: 0, stateDuration: 10 }),
      5,
      ctx(),
      newPose(),
    );
    expect(up.anim).toBe('getup');
    expect(up.time).toBeCloseTo(0.5);
  });

  it('walks only when the drawn body moves and raises the gun after a shot', () => {
    const t = new PoseTracker();
    expect(t.pose(phys({ state: 'walk' }), 1, ctx({ speed: 0 }), newPose()).anim).toBe('idle');
    expect(t.pose(phys({ state: 'walk' }), 1, ctx({ speed: 2 }), newPose()).anim).toBe('walk');
    expect(t.pose(phys({ state: 'run' }), 1, ctx({ speed: 5 }), newPose()).anim).toBe('run');
    const g = new PoseTracker();
    expect(g.pose(phys(), 1, ctx({ weapon: 'firearm' }), newPose()).anim).toBe('idle_gun');
    g.pose(
      phys({ state: 'attack', stateStartTick: 2, stateDuration: 8 }),
      3,
      ctx({ weapon: 'firearm' }),
      newPose(),
    );
    expect(
      g.pose(phys({ stateStartTick: 10 }), 12, ctx({ weapon: 'firearm' }), newPose()).anim,
    ).toBe('aim');
  });
});
