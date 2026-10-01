import type { SimEdgeKind, SimZombieSpawn } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { createSim } from '../sim.js';
import { aiSim, eventsOf, NOON } from '../test/ai-fixtures.js';
import { fixtureContent, send } from '../test/content-fixtures.js';
import { rejectedReasons } from '../test/item-fixtures.js';
import { EF } from '../openings/state.js';
import { TileGrid } from '../world/grid.js';
import { buildMap } from '../test/fixtures.js';
import { hordeSim, stepScripted } from '../test/horde-fixtures.js';
import { DEFAULT_PHYSICS_CONFIG, FENCE_HP, type PhysicsConfig } from './constants.js';

/** Room x/y ∈ [20, 30) with one opening in the west wall at (20, 25) (edge id 2). */
const room = (kind: SimEdgeKind) => ({
  wallW: (x: number, y: number) => (x === 20 || x === 30) && y >= 20 && y < 30,
  wallN: (x: number, y: number) => (y === 20 || y === 30) && x >= 20 && x < 30,
  edgeId: (x: number, y: number) => (x === 20 && y === 25 ? 2 : 1),
  edgeKinds: [null, 'wall', kind] as const,
});
const EDGE = { tx: 20, ty: 25, side: 'w' } as const;

const noCrowd: PhysicsConfig = {
  ...DEFAULT_PHYSICS_CONFIG,
  crowd: { ...DEFAULT_PHYSICS_CONFIG.crowd, enabled: false },
};
/** Like main before crowds: no pressure and no zombie–zombie pushing. */
const mainLike: PhysicsConfig = {
  ...DEFAULT_PHYSICS_CONFIG,
  crowd: {
    ...DEFAULT_PHYSICS_CONFIG.crowd,
    enabled: false,
    separation: { ...DEFAULT_PHYSICS_CONFIG.crowd.separation, stiffness: 0 },
  },
};

interface PerfHost {
  performance: { now(): number };
  process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };
}
// Test-only access to the host clock; the sim itself never reads real time.
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;

/** `n` zombies west of the room (two columns, rows around y = 25.5). */
const crowd = (n: number): SimZombieSpawn[] =>
  Array.from({ length: n }, (_, i) => ({ x: 13.5 - (i % 2), y: 25.5 + ((i >> 1) % 4) - 1.5 }));

interface Run {
  /** Tick of the first blow / of breaking (−1 = never). */
  first: number;
  broken: number;
  maxLevel: number;
  byCrowd: number;
  hash: number;
}

/** Ticks until the opening breaks (−1 = not within `limit`), drawn by noise inside the room. */
function run(opts: {
  n: number;
  kind?: SimEdgeKind;
  physicsConfig?: PhysicsConfig;
  spawn?: { x: number; y: number };
  seed?: number;
  limit?: number;
}): Run {
  const sim = aiSim({
    map: room(opts.kind ?? 'door'),
    spawn: opts.spawn ?? { x: 28.5, y: 28.5 },
    zombies: crowd(opts.n),
    seed: opts.seed ?? 3,
    ...(opts.physicsConfig ? { physicsConfig: opts.physicsConfig } : {}),
  });
  const r: Run = { first: -1, broken: -1, maxLevel: 0, byCrowd: 0, hash: 0 };
  let seq = 0;
  for (let i = 0; i < (opts.limit ?? 3000) && r.broken < 0; i++) {
    // Own `seq` per sim (the hash covers it), so two runs are comparable.
    if (i % 60 === 0) {
      const noise = { type: 'debugNoise', x: 25.5, y: 25.5, radiusTiles: 40 } as const;
      sim.enqueue({ ...noise, tick: sim.tick, playerId: 0, seq: seq++ });
    }
    sim.step();
    const ev = sim.drainEvents();
    for (const e of eventsOf(ev, 'openingChanged')) {
      expect(e).toMatchObject(EDGE);
      if (e.by === 'crowd') r.byCrowd++;
      if (r.first < 0) r.first = i;
      if (e.state === 'broken') r.broken = i;
    }
    for (const e of eventsOf(ev, 'openingPressure')) r.maxLevel = Math.max(r.maxLevel, e.level);
  }
  r.hash = sim.hash();
  return r;
}

describe('physics: low fence edge', () => {
  it('standing: blocks movement only; knocked over: slow; no door / window commands', () => {
    const sim = aiSim({ map: room('fence'), spawn: { x: 20.5, y: 25.5 } });
    const g = new TileGrid(buildMap(room('fence')), sim.world.openings);
    expect(g.flagsW(20, 25, 0) & (EF.blocksMove | EF.blocksSight | EF.muffles)).toBe(EF.blocksMove);
    send(sim, { type: 'toggleDoor', ...EDGE });
    send(sim, { type: 'debugOpening', ...EDGE, state: 'barricaded' });
    send(sim, { type: 'debugOpening', ...EDGE, state: 'broken' });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['invalid-target', 'invalid-state']);
    expect(g.flagsW(20, 25, 0) & (EF.blocksMove | EF.slow)).toBe(EF.slow);
  });
});

describe('physics: crowd pressure', () => {
  it('one zombie breaks a door exactly as fast as without crowd pressure', () => {
    const on = run({ n: 1 });
    const off = run({ n: 1, physicsConfig: noCrowd });
    expect(on.broken).toBeGreaterThan(0);
    expect(on.broken).toBe(off.broken);
    expect(on.byCrowd).toBe(0);
    expect(on.maxLevel).toBe(0);
  });

  it('a crowd of 8 breaks a door ≈ 2× faster than 8 without pressure (≥ 5× a lone zombie)', () => {
    const one = run({ n: 1 });
    const eight = run({ n: 8 });
    const eightOff = run({ n: 8, physicsConfig: noCrowd });
    expect(eight.broken).toBeGreaterThan(0);
    expect(eight.byCrowd).toBeGreaterThan(0);
    expect(eight.maxLevel).toBeGreaterThanOrEqual(2);
    // Bash time only (from the first blow; walking to the door is not counted).
    const bash = (r: Run) => r.broken - r.first;
    const vsOff = bash(eightOff) / bash(eight);
    expect(vsOff).toBeGreaterThanOrEqual(1.6);
    expect(vsOff).toBeLessThanOrEqual(3);
    const vsOne = bash(one) / bash(eight);
    expect(vsOne).toBeGreaterThanOrEqual(5);
    expect(vsOne).toBeLessThanOrEqual(16);
  });

  it('a player holding the door from the inside slows the crowd down', () => {
    const free = run({ n: 8 });
    const held = run({ n: 8, spawn: { x: 20.6, y: 25.5 } });
    expect(held.broken < 0 || held.broken > free.broken).toBe(true);
  });

  it('a crowd knocks a low fence over; a lone zombie only bangs on it', () => {
    const one = run({ n: 1, kind: 'fence', limit: 600 });
    expect(one.broken).toBe(-1);
    const eight = run({ n: 8, kind: 'fence', limit: 600 });
    expect(eight.broken).toBeGreaterThan(0);
    expect(eight.byCrowd).toBeGreaterThan(0);
    expect(FENCE_HP).toBeGreaterThan(0);
  });

  it('a crowd breaks a closed window at once', () => {
    const r = run({ n: 8, kind: 'window', limit: 1500 });
    expect(r.broken).toBeGreaterThan(0);
    expect(r.byCrowd).toBeGreaterThan(0);
  });

  it('is deterministic (same seed → same ticks and hash)', () => {
    const a = run({ n: 8, seed: 9 });
    const b = run({ n: 8, seed: 9 });
    expect(b).toEqual(a);
  });

  it('save / load during a crowd push keeps the hash', () => {
    const opts = {
      seed: 4,
      map: buildMap(room('door')),
      spawn: { x: 28.5, y: 28.5 },
      dev: true,
      content: fixtureContent(),
      clockStart: NOON,
      spawnZombies: crowd(8),
    };
    const a = createSim(opts);
    a.enqueue({
      type: 'debugNoise',
      x: 25.5,
      y: 25.5,
      radiusTiles: 40,
      tick: 0,
      playerId: 0,
      seq: 0,
    });
    for (let i = 0; i < 100; i++) a.step();
    expect(a.world.physics.pressure.size).toBe(1);
    const b = createSim({ ...opts, load: a.save() });
    expect(b.hash()).toBe(a.hash());
    for (let i = 0; i < 100; i++) {
      a.step();
      b.step();
    }
    expect(b.hash()).toBe(a.hash());
  });

  it('200 zombies: crowd pressure and pushing cost little over main', { timeout: 120_000 }, () => {
    const time = (cfg?: PhysicsConfig): number => {
      const sim = hordeSim(200, 5, cfg);
      for (let i = 0; i < 200; i++) stepScripted(sim);
      let best = Infinity;
      for (let b = 0; b < 3; b++) {
        const t0 = host.performance.now();
        for (let i = 0; i < 150; i++) stepScripted(sim);
        best = Math.min(best, (host.performance.now() - t0) / 150);
      }
      return best;
    };
    const base = time(mainLike);
    const crowdOn = time();
    host.process.stderr.write(
      `[perf] 200 zombies: crowd ${crowdOn.toFixed(2)} ms vs main-like ${base.toFixed(2)} ms\n`,
    );
    expect(crowdOn).toBeLessThanOrEqual(base * 1.5 + 0.5);
  });

  it('zombies push each other apart by mass: the lighter one gives way more', () => {
    const sim = aiSim({
      spawn: { x: 40.5, y: 40.5 },
      zombies: [
        { x: 10.5, y: 10.5 },
        { x: 10.8, y: 10.5 },
      ],
    });
    sim.step();
    const [a, b] = [...sim.world.physics.bodies.values()].filter((x) => x.kind === 'zombie');
    a!.bodyMassKg = 180;
    sim.step();
    expect(a!.pushX).toBeLessThan(0);
    expect(b!.pushX).toBeGreaterThan(0);
    expect(Math.abs(b!.pushX)).toBeCloseTo(Math.abs(a!.pushX) * 2, 4);
  });

  it('a crowd packed at a door stays calm (no jitter from pushing)', () => {
    const calm = (stiffness: number) => {
      const sim = aiSim({
        map: room('door'),
        spawn: { x: 28.5, y: 28.5 },
        zombies: crowd(8),
        content: fixtureContent({ openings: { doorHp: 5000 } }),
        physicsConfig: {
          ...DEFAULT_PHYSICS_CONFIG,
          crowd: {
            ...DEFAULT_PHYSICS_CONFIG.crowd,
            separation: { ...DEFAULT_PHYSICS_CONFIG.crowd.separation, stiffness },
          },
        },
      });
      let seq = 0;
      let flips = 0;
      let path = 0;
      let prev = sim.getZombies().map((z) => ({ x: z.x, y: z.y }));
      const last: { x: number; y: number }[] = [];
      for (let i = 0; i < 500; i++) {
        if (i % 60 === 0) {
          const noise = { type: 'debugNoise', x: 25.5, y: 25.5, radiusTiles: 40 } as const;
          sim.enqueue({ ...noise, tick: sim.tick, playerId: 0, seq: seq++ });
        }
        sim.step();
        const now = sim.getZombies().map((z) => ({ x: z.x, y: z.y }));
        if (i >= 300) {
          now.forEach((p, k) => {
            const dx = p.x - prev[k]!.x;
            const dy = p.y - prev[k]!.y;
            path += Math.sqrt(dx * dx + dy * dy);
            const l = last[k];
            // A clear reversal of a visible step (not sub-pixel noise).
            if (l && dx * l.x + dy * l.y < -1e-4) flips++;
            last[k] = { x: dx, y: dy };
          });
        }
        prev = now;
      }
      return { flips, speed: path / 8 / 200 };
    };
    const pushing = calm(DEFAULT_PHYSICS_CONFIG.crowd.separation.stiffness);
    const none = calm(0);
    expect(pushing.speed).toBeLessThan(0.02);
    expect(pushing.flips).toBeLessThanOrEqual(Math.max(10, none.flips * 2));
  });
});
