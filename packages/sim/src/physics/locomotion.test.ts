import { decodeSnapshot, GAITS, type Gait } from '@deadzone/protocol';
import { dsincos } from '../vehicles/math.js';
import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS } from '../core/constants.js';
import { createSim } from '../sim.js';
import { buildMap } from '../test/fixtures.js';
import { moveGait, run } from '../test/helpers.js';
import {
  locoSim,
  profileRun,
  sample,
  trace,
  turnRun,
  type LocoSample,
} from '../test/locomotion-fixtures.js';
import { fixtureContent, send } from '../test/content-fixtures.js';
import { SKIN, slideCircle } from '../world/collision.js';
import { TileGrid } from '../world/grid.js';
import { GAIT_PROFILES, LOCO_SPEED_MPS, PIVOT_SPEED_MPS, SPRINT_SPEED_MUL } from './constants.js';
import { locomotionStep, projectOnContacts, turnRate, type LocoOut } from './locomotion.js';

const R = PLAYER_RADIUS;
const out: LocoOut = { vx: 0, vy: 0, a: 0, accel: 0 };

describe('locomotion: gait profiles', () => {
  it('speeds in m/s: walk 1.5, run ×2.5, sneak ½ walk, sprint 1.3 × run', () => {
    expect(LOCO_SPEED_MPS.walk).toBe(1.5);
    expect(LOCO_SPEED_MPS.run).toBe(1.5 * 2.5);
    expect(LOCO_SPEED_MPS.sneak).toBe(0.75);
    expect(LOCO_SPEED_MPS.sprint).toBeCloseTo(LOCO_SPEED_MPS.run * SPRINT_SPEED_MUL, 9);
    for (const g of ['sneak', 'walk', 'run', 'sprint'] as const) {
      expect(profileRun(g).maxSpeed).toBeCloseTo(LOCO_SPEED_MPS[g], 4);
    }
  });

  // Time to max speed (ticks at 20 Hz) and braking distance (m) per gait.
  const expected: Record<Gait, { ticks: number; brake: [number, number] }> = {
    sneak: { ticks: 4, brake: [0.03, 0.06] },
    walk: { ticks: 6, brake: [0.14, 0.2] },
    run: { ticks: 13, brake: [0.85, 1.05] },
    sprint: { ticks: 22, brake: [1.7, 2.0] },
  };
  it.each(GAITS)('%s: time to max speed and braking distance', (g) => {
    const p = profileRun(g);
    expect(p.ticksToMax).toBe(expected[g].ticks);
    expect(p.brakeDist).toBeGreaterThanOrEqual(expected[g].brake[0]);
    expect(p.brakeDist).toBeLessThanOrEqual(expected[g].brake[1]);
    // Never above the target, never backwards while braking (no overshoot).
    for (const s of p.samples) expect(s.speed).toBeLessThanOrEqual(LOCO_SPEED_MPS[g] + 1e-4);
    for (const s of p.samples) expect(s.vx).toBeGreaterThanOrEqual(0);
  });

  it('acceleration is jerk-limited: it builds up gradually and never exceeds the profile', () => {
    for (const g of GAITS) {
      const p = profileRun(g);
      const prof = GAIT_PROFILES[g];
      const acc = p.samples.map((s, i) => (s.speed - (p.samples[i - 1]?.speed ?? 0)) * 20);
      expect(acc[0]!).toBeCloseTo(prof.jerk / 20, 3); // first tick: jerk · dt
      for (let i = 0; i < acc.length; i++) {
        expect(acc[i]!).toBeLessThanOrEqual(prof.accel + 1e-3);
        expect(acc[i]!).toBeGreaterThanOrEqual(-prof.brake - 1e-3);
        if (i > 0 && i < p.release)
          expect(acc[i]! - acc[i - 1]!).toBeLessThanOrEqual(prof.jerk / 20 + 1e-3);
      }
    }
  });

  it('longer and slower to reach and to stop: sneak < walk < run < sprint', () => {
    const r = GAITS.map((g) => profileRun(g));
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.ticksToMax).toBeGreaterThan(r[i - 1]!.ticksToMax);
      expect(r[i]!.brakeDist).toBeGreaterThan(r[i - 1]!.brakeDist);
    }
  });

  it('pure step: lands on the target without overshoot, holds, and brakes to exactly 0', () => {
    let v = 0;
    let a = 0;
    for (let i = 0; i < 40; i++) {
      locomotionStep(v, 0, a, 1.5, 0, GAIT_PROFILES.walk, 1, out);
      expect(out.vx).toBeLessThanOrEqual(1.5);
      v = out.vx;
      a = out.a;
    }
    expect(v).toBe(1.5);
    expect(a).toBe(0);
    for (let i = 0; i < 40; i++) {
      locomotionStep(v, 0, a, 0, 0, GAIT_PROFILES.walk, 1, out);
      expect(out.vx).toBeGreaterThanOrEqual(0);
      v = out.vx;
      a = out.a;
    }
    expect(v).toBe(0);
    // No control (knocked down): nothing changes.
    locomotionStep(1, 0, 3, 0, 2, GAIT_PROFILES.walk, 0, out);
    expect([out.vx, out.vy, out.a]).toEqual([1, 0, 0]);
  });
});

describe('locomotion: turning', () => {
  it('the movement turn rate falls with speed (walk > run > sprint)', () => {
    const w = turnRate(LOCO_SPEED_MPS.walk);
    const r = turnRate(LOCO_SPEED_MPS.run);
    const s = turnRate(LOCO_SPEED_MPS.sprint);
    expect(w).toBeGreaterThan(r * 2);
    expect(r).toBeGreaterThan(s * 1.3);
    expect((w * 180) / Math.PI).toBeGreaterThan(600);
    expect((s * 180) / Math.PI).toBeLessThan(200);
  });

  it('90°: quick at a walk, wider and slower at a run, slower still at a sprint', () => {
    const walk = turnRun('walk', 90);
    const runT = turnRun('run', 90);
    const sprint = turnRun('sprint', 90);
    expect(walk.ticksToAlign).toBeLessThanOrEqual(3);
    expect(runT.ticksToAlign).toBeGreaterThan(walk.ticksToAlign * 2);
    expect(sprint.ticksToAlign).toBeGreaterThan(runT.ticksToAlign);
    expect(walk.overshoot).toBeLessThan(0.15);
    expect(runT.overshoot).toBeGreaterThan(walk.overshoot * 4);
    expect(sprint.overshoot).toBeGreaterThan(runT.overshoot);
    // A turn slows a little (corner speed), it does not stop.
    expect(runT.minSpeed).toBeGreaterThan(LOCO_SPEED_MPS.run * 0.6);
  });

  it('180° goes through braking: speed drops below the pivot speed before reversing', () => {
    for (const g of ['walk', 'run', 'sprint'] as const) {
      const t = turnRun(g, 180);
      expect(t.minSpeed).toBeLessThan(PIVOT_SPEED_MPS);
      const after = t.samples.slice(t.turnAt);
      // While faster than the pivot speed it only brakes along +x (never moves sideways).
      for (const s of after)
        if (s.speed > PIVOT_SPEED_MPS && s.vx > 0) expect(Math.abs(s.vy)).toBe(0);
      expect(t.overshoot).toBeCloseTo(profileRun(g).brakeDist, 1);
      expect(after.at(-1)!.vx).toBeLessThan(-LOCO_SPEED_MPS[g] * 0.99);
    }
    expect(turnRun('run', 180).ticksToAlign).toBeGreaterThan(turnRun('walk', 180).ticksToAlign);
  });

  it('facing stays separate: aiming backwards while running forwards', () => {
    const sim = locoSim(20.5, 32.5);
    moveGait(sim, 1, 0, 'run');
    send(sim, { type: 'aim', x: 0, y: 32.5 });
    run(sim, 30);
    expect(sim.getPlayer()!.facing).toBe(32768);
    expect(sample(sim).vx).toBeCloseTo(LOCO_SPEED_MPS.run, 4);
  });
});

describe('locomotion: walls', () => {
  const wall = { wallW: (x: number) => x === 12 };

  it('slides along a wall without losing tangential speed (parallel and at 30°)', () => {
    // Parallel, touching the wall.
    const a = locoSim(12 - R - SKIN, 4.5, wall);
    moveGait(a, 0, 1, 'run');
    trace(a, 40);
    const y = a.getPlayer()!.y;
    run(a, 10);
    expect((a.getPlayer()!.y - y) * 2).toBeCloseTo(LOCO_SPEED_MPS.run, 4);
    // 30° into the wall: the tangential part (cos 30°) is kept exactly, every tick.
    const b = locoSim(10.5, 4.5, wall);
    moveGait(b, 0.5, Math.sqrt(3) / 2, 'run');
    const s = trace(b, 60);
    const touching = s.filter((p) => p.x >= 12 - R - 2 * SKIN);
    expect(touching.length).toBeGreaterThan(20);
    for (const p of touching.slice(5)) {
      expect(p.vx).toBe(0);
      expect(p.vy).toBeCloseTo((LOCO_SPEED_MPS.run * Math.sqrt(3)) / 2, 4);
    }
    for (const p of s) expect(p.x).toBeLessThanOrEqual(12 - R);
  });

  it('inner corner: pushing into it gives the same position every tick (zero variance)', () => {
    const corner = { wallW: (x: number) => x === 12, wallN: (_x: number, y: number) => y === 8 };
    for (const g of ['walk', 'sprint'] as const) {
      const sim = locoSim(9.5, 10.5, corner);
      moveGait(sim, 1, -1, g);
      run(sim, 60);
      const pts = trace(sim, 200);
      const xs = new Set(pts.map((p) => p.x));
      const ys = new Set(pts.map((p) => p.y));
      expect(xs.size).toBe(1);
      expect(ys.size).toBe(1);
      expect(pts.every((p) => p.speed === 0)).toBe(true);
      expect(pts[0]!.x).toBeCloseTo(12 - R - SKIN, 4);
      expect(pts[0]!.y).toBeCloseTo(8 + R + SKIN, 4);
      expect(decodeSnapshot(sim.snapshot())[0]!.speed).toBe(0);
    }
  });

  it('rounds the end of a wall instead of getting stuck on it', () => {
    // A 2-tile wall piece x = 12, y ∈ [5, 7); walking +x just above its end.
    const piece = { wallW: (x: number, y: number) => x === 12 && (y === 5 || y === 6) };
    const sim = locoSim(9.5, 4.85, piece);
    moveGait(sim, 1, 0, 'walk');
    const s = trace(sim, 80);
    expect(s.at(-1)!.x).toBeGreaterThan(13);
    // It slid around the corner point (y went up, smoothly: no tick stops dead).
    expect(Math.min(...s.map((p) => p.y))).toBeLessThan(5 - R + 0.001);
    const moving = s.slice(8);
    for (const p of moving) expect(p.speed).toBeGreaterThan(0.3);
    for (const p of s) {
      const dx = p.x - 12;
      const dy = p.y < 5 ? p.y - 5 : p.y > 7 ? p.y - 7 : 0;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(R);
    }
  });

  it('no jitter along a long wall made of many segments (constant speed, constant x)', () => {
    const sim = locoSim(10.5, 2.5, wall);
    moveGait(sim, 1, 1, 'walk');
    run(sim, 30);
    const s = trace(sim, 100);
    expect(new Set(s.map((p) => p.x)).size).toBe(1);
    for (const p of s) expect(p.vy).toBeCloseTo(1.5 * Math.SQRT1_2, 5);
  });

  it('no tunnelling: substeps stop at a thin wall at any speed', () => {
    const grid = new TileGrid(buildMap({ ...wall, width: 128, height: 64 }));
    for (const d of [0.1, 0.29, 0.6, 5, 1000]) {
      expect(slideCircle(grid, 0, 11.5, 5.5, d, 0.3 * d, R).x).toBeLessThanOrEqual(12 - R);
      expect(slideCircle(grid, 0, 12.5, 5.5, -d, 0.3 * d, R).x).toBeGreaterThanOrEqual(12 + R);
    }
    // Through a corner diagonal too (void tile corner).
    const g2 = new TileGrid(buildMap({ floor: (x, y) => (x === 20 && y === 20 ? 0 : 1) }));
    const p = slideCircle(g2, 0, 18.5, 18.5, 3, 3, R);
    const cx = Math.max(20, Math.min(21, p.x));
    const cy = Math.max(20, Math.min(21, p.y));
    expect(Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)).toBeGreaterThanOrEqual(R);
    // A very fast walk (40 tiles per tick) in the sim.
    const sim = createSim({
      seed: 1,
      map: buildMap(wall),
      spawn: { x: 10.5, y: 5.5 },
      walkSpeedTilesPerSecond: 800,
    });
    moveGait(sim, 1, 0, 'walk');
    run(sim, 20);
    expect(sim.getPlayer()!.x).toBeLessThanOrEqual(12 - R);
  });

  it('projection: a two-normal corner removes everything going into it', () => {
    const o = { x: 0, y: 0 };
    projectOnContacts(1, -1, [-1, 0, 0, 1], o);
    expect(o).toEqual({ x: 0, y: 0 });
    projectOnContacts(1, 1, [-1, 0], o);
    expect(o).toEqual({ x: 0, y: 1 });
    projectOnContacts(-1, 1, [-1, 0], o);
    expect(o).toEqual({ x: -1, y: 1 });
  });
});

describe('locomotion: sprint, snapshot, determinism', () => {
  it('sprint costs endurance (twice the run drain) and needs 25 endurance', () => {
    const drain = (gait: Gait): number => {
      const sim = createSim({
        seed: 7,
        map: buildMap({ width: 256, height: 64 }),
        spawn: { x: 4.5, y: 30.5 },
        content: fixtureContent(),
        dev: true,
      });
      send(sim, { type: 'move', dx: 1, dy: 0, gait });
      const e0 = sim.getSurvival()!.stats.endurance;
      run(sim, 600);
      return e0 - sim.getSurvival()!.stats.endurance;
    };
    const r = drain('run');
    const s = drain('sprint');
    expect(r).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(r * 1.5);
  });

  it('snapshot: actual speed (m/s), longitudinal accel (m/s²) and gait', () => {
    const sim = locoSim(4.5, 10.5);
    moveGait(sim, 1, 0, 'sprint');
    run(sim, 3);
    let p = decodeSnapshot(sim.snapshot())[0]!;
    expect(p.gait).toBe(GAITS.indexOf('sprint'));
    expect(p.accel).toBeGreaterThan(0);
    expect(p.speed).toBeCloseTo(sample(sim).speed, 4);
    run(sim, 40);
    p = decodeSnapshot(sim.snapshot())[0]!;
    expect(p.speed).toBeCloseTo(LOCO_SPEED_MPS.sprint, 3);
    expect(p.accel).toBe(0);
    moveGait(sim, 0, 0, 'sprint');
    run(sim, 3);
    p = decodeSnapshot(sim.snapshot())[0]!;
    expect(p.accel).toBeLessThan(0);
  });

  const script = (seed: number) => {
    const sim = locoSim(
      30.5,
      30.5,
      {
        wallW: (x, y) => x % 9 === 0 && y % 7 !== 3,
        wallN: (x, y) => y % 11 === 0 && x % 5 !== 2,
      },
      seed,
    );
    const hashes: number[] = [];
    let k = seed;
    for (let t = 0; t < 600; t++) {
      if (t % 17 === 0) {
        k = (Math.imul(k, 1103515245) + 12345) >>> 0;
        const a = (k % 360) * (Math.PI / 180);
        // Own seq numbers (the queue's last seq is in the hash).
        const r = sim.enqueue({
          type: 'move',
          dx: dsincos(a)[1],
          dy: dsincos(a)[0],
          gait: GAITS[(k >>> 9) % 4]!,
          tick: sim.tick,
          playerId: 0,
          seq: t + 1,
        });
        expect(r.ok).toBe(true);
      }
      sim.step();
      if (t % 50 === 49) hashes.push(sim.hash());
    }
    return { sim, hashes };
  };

  it('deterministic: same script → same hashes; save / load keeps the hash and the motion', () => {
    expect(script(3).hashes).toEqual(script(3).hashes);
    const a = script(5).sim;
    const b = createSim({
      seed: 5,
      map: buildMap({
        width: 128,
        height: 64,
        wallW: (x, y) => x % 9 === 0 && y % 7 !== 3,
        wallN: (x, y) => y % 11 === 0 && x % 5 !== 2,
      }),
      load: a.save(),
    });
    expect(b.hash()).toBe(a.hash());
    const ta: LocoSample[] = trace(a, 30);
    const tb: LocoSample[] = trace(b, 30);
    expect(tb).toEqual(ta);
    expect(b.hash()).toBe(a.hash());
  });
});
