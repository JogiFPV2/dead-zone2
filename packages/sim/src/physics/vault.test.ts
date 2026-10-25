import type { SimEdgeKind, SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT_CONFIG } from '../combat/config.js';
import { createSim, type Sim, type SimOptions } from '../sim.js';
import { eventsOf, NOON } from '../test/ai-fixtures.js';
import { baseContent, fixtureContent } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { rejectedReasons } from '../test/item-fixtures.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';
import { physicsHit } from './system.js';
import { tripChance } from './vault.js';

/**
 * Column x = 20: a low fence (edge id 2) for y ∈ [20, 30), a window (edge id 3) at y = 32,
 * walls elsewhere on that column. Floor everywhere.
 */
const map = () =>
  buildMap({
    wallW: (x) => x === 20,
    edgeId: (x, y) => (x === 20 && y >= 20 && y < 30 ? 2 : x === 20 && y === 32 ? 3 : 1),
    edgeKinds: [null, 'wall', 'fence', 'window'] as (SimEdgeKind | null)[],
  });

const harmless = {
  ...DEFAULT_COMBAT_CONFIG,
  zombie: { ...DEFAULT_COMBAT_CONFIG.zombie, hitChance: 0 },
};
const withVault = (v: Partial<PhysicsConfig['vault']>): PhysicsConfig => ({
  ...DEFAULT_PHYSICS_CONFIG,
  vault: { ...DEFAULT_PHYSICS_CONFIG.vault, ...v },
});

function vaultSim(
  spawn: { x: number; y: number },
  extra: Partial<SimOptions> = {},
  zombies: { x: number; y: number }[] = [],
): Sim {
  return createSim({
    seed: 5,
    map: map(),
    spawn,
    content: fixtureContent(),
    dev: true,
    clockStart: NOON,
    combatConfig: harmless,
    ...(zombies.length ? { spawnZombies: zombies } : {}),
    ...extra,
  });
}

/** Per-sim `seq` (hash-comparable runs). */
function cmds(sim: Sim) {
  let seq = 0;
  const send = (c: Record<string, unknown>) =>
    sim.enqueue({ ...c, tick: sim.tick, playerId: 0, seq: seq++ } as never);
  return {
    vault: () => send({ type: 'vault' }),
    move: (dx: number, dy: number, gait?: string) =>
      send({ type: 'move', dx, dy, ...(gait ? { gait } : {}) }),
    opening: (tx: number, ty: number, state: string) =>
      send({ type: 'debugOpening', tx, ty, side: 'w', state }),
  };
}

const player = (sim: Sim) => sim.getPlayer()!;
const pbody = (sim: Sim) =>
  [...sim.world.physics.bodies.values()].find((b) => b.kind === 'player')!;
const physKinds = (ev: readonly SimEvent[]) => eventsOf(ev, 'physics').map((e) => e.kind);

/** Steps n ticks collecting events. */
function run(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    out.push(...sim.drainEvents());
  }
  return out;
}

describe('vault: fences', () => {
  it('a standing fence blocks walking; vault crosses it in ~1 s (state vault, then idle)', () => {
    const sim = vaultSim({ x: 18.5, y: 25.5 }, { physicsConfig: withVault({ tripFence: 0 }) });
    const c = cmds(sim);
    c.move(1, 0);
    run(sim, 40);
    expect(player(sim).x).toBeLessThan(20);
    expect(player(sim).x).toBeGreaterThan(19.6);
    c.move(0, 0);
    c.vault();
    sim.step();
    sim.drainEvents();
    const start = sim.tick - 1;
    expect(pbody(sim).state).toBe('vault');
    expect(pbody(sim).stateDuration).toBe(DEFAULT_PHYSICS_CONFIG.vault.fenceTicks);
    const xs: number[] = [];
    const ev: SimEvent[] = [];
    for (let i = 0; i < 25; i++) {
      sim.step();
      ev.push(...sim.drainEvents());
      xs.push(player(sim).x);
    }
    // Moves monotonically across x = 20 and lands landTiles beyond it.
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!);
    expect(player(sim).x).toBeCloseTo(20 + DEFAULT_PHYSICS_CONFIG.vault.landTiles, 4);
    expect(pbody(sim).state).toBe('idle');
    const landed = eventsOf(ev, 'physics').find((e) => e.kind === 'vaulted')!;
    expect(landed.tick - start).toBe(DEFAULT_PHYSICS_CONFIG.vault.fenceTicks);
    // Back in control on the far side.
    c.move(1, 0);
    run(sim, 20);
    expect(player(sim).x).toBeGreaterThan(21);
  });

  it('rejects without a fence in reach, through a wall, a closed window or a knocked-over fence', () => {
    const far = vaultSim({ x: 17.5, y: 25.5 });
    cmds(far).vault();
    far.step();
    expect(rejectedReasons(far)).toEqual(['invalid-target']);
    const wall = vaultSim({ x: 19.7, y: 15.5 });
    cmds(wall).vault();
    wall.step();
    expect(rejectedReasons(wall)).toEqual(['invalid-target']);
    const win = vaultSim({ x: 19.7, y: 32.5 });
    cmds(win).vault();
    win.step();
    expect(rejectedReasons(win)).toEqual(['invalid-target']);
    const down = vaultSim({ x: 19.7, y: 25.5 });
    const c = cmds(down);
    c.opening(20, 25, 'broken');
    c.vault();
    down.step();
    expect(rejectedReasons(down)).toEqual(['invalid-target']);
  });

  it('tripping: knock-down on the far side (tripped + fellDown), then getup → idle', () => {
    const sim = vaultSim(
      { x: 19.7, y: 25.5 },
      { physicsConfig: withVault({ tripFence: 1, tripMax: 1 }) },
    );
    cmds(sim).vault();
    const ev = run(sim, DEFAULT_PHYSICS_CONFIG.vault.fenceTicks + 1);
    expect(physKinds(ev)).toEqual(expect.arrayContaining(['tripped', 'fellDown']));
    expect(physKinds(ev)).not.toContain('vaulted');
    expect(pbody(sim).state).toBe('knockdown');
    expect(player(sim).x).toBeGreaterThan(20.3);
    const later = run(sim, 100);
    expect(physKinds(later)).toContain('gotUp');
    expect(pbody(sim).state).toBe('idle');
  });

  it('trip chance grows with running, load and fatigue, drops with Nimble / Fitness', async () => {
    const sim = vaultSim({ x: 19.7, y: 25.5 });
    sim.step();
    const w = sim.world;
    const eid = w.players.get(0)!;
    const b = pbody(sim);
    const v = DEFAULT_PHYSICS_CONFIG.vault;
    const base = { ...b, state: 'idle' as const, carriedKg: 0, capacityKg: 12, endurance: 100 };
    const p = (o: Partial<typeof b>) => tripChance(w, eid, { ...base, ...o }, 3);
    expect(p({})).toBeCloseTo(v.tripFence, 5);
    expect(p({ state: 'run' })).toBeCloseTo(v.tripFence + v.tripRun, 5);
    expect(p({ carriedKg: 20 })).toBeGreaterThan(p({ carriedKg: 10 }));
    expect(p({ endurance: 5 })).toBeGreaterThan(p({ endurance: 60 }));
    expect(p({ state: 'run', carriedKg: 30, endurance: 0 })).toBeCloseTo(v.tripMax, 5);

    const based = createSim({
      seed: 1,
      map: map(),
      spawn: { x: 19.7, y: 25.5 },
      content: await baseContent(),
      dev: true,
      clockStart: NOON,
    });
    based.step();
    const bw = based.world;
    const beid = bw.players.get(0)!;
    const bb = { ...pbody(based), state: 'run' as const, carriedKg: 0, endurance: 100 };
    const before = tripChance(bw, beid, bb, 3);
    let seq = 0;
    for (const [skill, level] of [
      ['base:nimble', 5],
      ['base:fitness', 5],
    ] as const) {
      based.enqueue({
        type: 'debugSkill',
        skill,
        level,
        tick: based.tick,
        playerId: 0,
        seq: seq++,
      });
    }
    based.step();
    const after = tripChance(bw, beid, bb, 3);
    expect(after).toBeLessThan(before * 0.7);
    expect(after).toBeGreaterThanOrEqual(before * v.tripSkillFloor - 1e-6);
  });

  it('hits during the vault do not stop it; deterministic and survives save / load', () => {
    const go = (saveAt?: number) => {
      let sim = vaultSim({ x: 19.7, y: 25.5 }, {}, [{ x: 18.9, y: 25.5 }]);
      cmds(sim).vault();
      const hashes: number[] = [];
      for (let i = 0; i < 40; i++) {
        if (i === 5) {
          const w = sim.world;
          const zid = [...w.c.Zombie.is.keys()].find((e) => w.c.Zombie.is[e] === 1)!;
          physicsHit(w, zid, w.players.get(0)!, 'shove', 1);
        }
        if (i === saveAt) {
          sim = vaultSim({ x: 19.7, y: 25.5 }, { load: sim.save() }, [{ x: 18.9, y: 25.5 }]);
        }
        sim.step();
        if (i === 6) expect(pbody(sim).state).toBe('vault');
        hashes.push(sim.hash());
      }
      return hashes;
    };
    const a = go();
    expect(go()).toEqual(a);
    expect(go(10)).toEqual(a);
  });
});

describe('vault: windows', () => {
  it('through an open window: slower than a fence, no cut', () => {
    const sim = vaultSim({ x: 19.7, y: 32.5 }, { physicsConfig: withVault({ glassChance: 1 }) });
    const c = cmds(sim);
    c.opening(20, 32, 'open');
    c.vault();
    sim.step();
    expect(pbody(sim).stateDuration).toBe(DEFAULT_PHYSICS_CONFIG.vault.windowTicks);
    const ev = run(sim, DEFAULT_PHYSICS_CONFIG.vault.windowTicks + 1);
    expect(player(sim).x).toBeGreaterThan(20.3);
    expect(eventsOf(ev, 'wounded')).toEqual([]);
  });

  it('through a broken window: glass may cut (scratch / laceration on an arm, hand or thigh)', () => {
    const sim = vaultSim(
      { x: 19.7, y: 32.5 },
      { physicsConfig: withVault({ glassChance: 1, tripWindow: 0 }) },
    );
    const c = cmds(sim);
    c.opening(20, 32, 'broken');
    c.vault();
    const ev = run(sim, DEFAULT_PHYSICS_CONFIG.vault.windowTicks + 2);
    const cuts = eventsOf(ev, 'wounded');
    expect(cuts).toHaveLength(1);
    expect(['scratch', 'laceration']).toContain(cuts[0]!.wound);
    expect(['forearm_l', 'forearm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r']).toContain(
      cuts[0]!.part,
    );
  });
});

describe('vault: zombies', () => {
  it('cannot pass a standing fence; climb over a knocked-over one slowly', () => {
    const cross = (state?: string) => {
      const sim = vaultSim({ x: 30.5, y: 25.5 }, {}, [{ x: 17.5, y: 25.5 }]);
      const c = cmds(sim);
      if (state) c.opening(20, 25, state);
      let seq = 100;
      const ticks = { at20: -1, at22: -1 };
      for (let i = 0; i < 600; i++) {
        if (i % 40 === 0) {
          sim.enqueue({
            type: 'debugNoise',
            x: 30.5,
            y: 25.5,
            radiusTiles: 40,
            tick: sim.tick,
            playerId: 0,
            seq: seq++,
          });
        }
        sim.step();
        const zx = sim.getZombies()[0]!.x;
        if (ticks.at20 < 0 && zx > 19.4) ticks.at20 = i;
        if (ticks.at22 < 0 && zx > 21) ticks.at22 = i;
      }
      return { ...ticks, x: sim.getZombies()[0]!.x };
    };
    const standing = cross();
    expect(standing.x).toBeLessThan(20);
    const down = cross('broken');
    expect(down.x).toBeGreaterThan(21);
  });
});

describe('vault: windows next to slanted walls (all-windows map test, docs 9.63)', () => {
  const segMap = (segs: { x0: number; y0: number; x1: number; y1: number }[]) =>
    buildMap({
      wallW: (x) => x === 20,
      edgeId: (x, y) => (x === 20 && y >= 20 && y < 30 ? 2 : x === 20 && y === 32 ? 3 : 1),
      edgeKinds: [null, 'wall', 'fence', 'window'] as (SimEdgeKind | null)[],
      wallSegments: segs,
    });
  const climb = (segs: { x0: number; y0: number; x1: number; y1: number }[]) => {
    const sim = vaultSim({ x: 19.7, y: 32.5 }, { map: segMap(segs) });
    const c = cmds(sim);
    c.opening(20, 32, 'open');
    sim.step();
    c.vault();
    sim.step();
    const rejected = rejectedReasons(sim);
    const ev = run(sim, DEFAULT_PHYSICS_CONFIG.vault.windowTicks + 2);
    return { sim, rejected, vaulted: physKinds(ev).includes('vaulted') };
  };

  it('lands beside a segment end that covers the straight landing spot (gap off the raster)', () => {
    const { sim, rejected, vaulted } = climb([{ x0: 20.55, y0: 32.32, x1: 20.9, y1: 32.0 }]);
    expect(rejected).toEqual([]);
    expect(vaulted).toBe(true);
    expect(player(sim).x).toBeGreaterThan(20.3);
    expect(player(sim).y).toBeCloseTo(32.65, 4);
  });

  it('rejects when an exact wall seals the window (no gap), instead of landing through it', () => {
    const { sim, rejected, vaulted } = climb([{ x0: 20.2, y0: 31.5, x1: 20.2, y1: 33.5 }]);
    expect(rejected).toEqual(['invalid-target']);
    expect(vaulted).toBe(false);
    expect(player(sim).x).toBeLessThan(20);
  });
});
