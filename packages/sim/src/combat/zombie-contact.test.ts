import type { SimEvent, SimEdgeKind } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE4_CONFIG, type Stage4Config } from '../ai/config.js';
import { aiSim, eventsOf } from '../test/ai-fixtures.js';
import { send } from '../test/content-fixtures.js';
import type { Sim } from '../sim.js';
import type { MapSpec } from '../test/fixtures.js';
import { TileGrid } from '../world/grid.js';
import { OpeningKind, OS, openingKey, setOpening, sideIndex } from '../openings/state.js';
import { DEFAULT_COMBAT_CONFIG } from './config.js';
import { DEFAULT_ZOMBIE_ATTACK_REACH_M, DEFAULT_ZOMBIE_WINDUP_MS } from '@deadzone/content';
import { zombieInContact } from './system.js';

/**
 * Zombie attacks (PZ-like): only in contact (body gap ≤ 0.3, edge to edge), a visible 0.6 s
 * wind-up, the blow lands only if the target is still in contact, never through walls, windows
 * or exact walls (docs 9.65).
 */
const WIDE: Stage4Config = {
  ...DEFAULT_STAGE4_CONFIG,
  vision: { ...DEFAULT_STAGE4_CONFIG.vision, fovHalfAngleDeg: 180 },
};
const SURE = {
  ...DEFAULT_COMBAT_CONFIG,
  zombie: { ...DEFAULT_COMBAT_CONFIG.zombie, hitChance: 1 },
};
const REACH = DEFAULT_ZOMBIE_ATTACK_REACH_M;

const zombieEid = (s: Sim): number => {
  for (let e = 0; e < 4096; e++) if (s.world.c.Zombie.is[e] === 1) return e;
  throw new Error('no zombie');
};
const gap = (s: Sim): number => {
  const z = s.getZombies()[0]!;
  const p = s.getPlayer()!;
  return Math.sqrt((z.x - p.x) ** 2 + (z.y - p.y) ** 2) - 0.6;
};
const attackStarts = (ev: SimEvent[], s: Sim) =>
  eventsOf(ev, 'physics').filter(
    (e) => e.kind === 'attackStart' && e.entity === s.getZombies()[0]!.stableId,
  );

describe('zombie attacks: contact, wind-up, escape', () => {
  it('the defaults: contact gap 0.3 m, wind-up 500–800 ms; the chase stops inside the gap', () => {
    expect(REACH).toBe(0.3);
    expect(DEFAULT_ZOMBIE_WINDUP_MS).toEqual({ min: 500, max: 800 });
    expect(DEFAULT_STAGE4_CONFIG.ai.reachTiles).toBeLessThan(REACH);
  });

  it('the first swing starts only in contact, and lands 0.5–0.8 s (10–16 ticks) later', () => {
    const s = aiSim({ zombies: [{ x: 16.5, y: 10.5 }], aiConfig: WIDE, combatConfig: SURE });
    let start: number | undefined;
    let gapAtStart = Infinity;
    let hitTick: number | undefined;
    for (let i = 0; i < 400 && hitTick === undefined; i++) {
      s.step();
      const ev = s.drainEvents();
      if (start === undefined && attackStarts(ev, s).length > 0) {
        start = s.tick - 1;
        gapAtStart = gap(s);
      }
      if (s.getSurvival()!.stats.health < 100) hitTick = s.tick - 1;
    }
    expect(start).toBeDefined();
    expect(gapAtStart).toBeLessThanOrEqual(REACH + 0.01);
    // 500–800 ms at 20 Hz.
    expect(hitTick! - start!).toBeGreaterThanOrEqual(10);
    expect(hitTick! - start!).toBeLessThanOrEqual(16);
  });

  it('stepping out of reach during the wind-up makes the blow miss', () => {
    const s = aiSim({ zombies: [{ x: 16.5, y: 10.5 }], aiConfig: WIDE, combatConfig: SURE });
    let started = false;
    for (let i = 0; i < 400 && !started; i++) {
      s.step();
      started = attackStarts(s.drainEvents(), s).length > 0;
    }
    expect(started).toBe(true);
    // Run away west at once (run ≈ 4.8 m/s vs the zombie's chase): out of the gap mid wind-up.
    send(s, { type: 'move', dx: -1, dy: 0, gait: 'run' });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 18; i++) {
      s.step();
      ev.push(...s.drainEvents());
    }
    expect(gap(s)).toBeGreaterThan(REACH);
    const hits = eventsOf(ev, 'physics').filter(
      (e) => e.kind === 'hitLanded' && e.entity === s.getPlayer()!.stableId,
    );
    expect(hits).toEqual([]);
    expect(s.world.ai!.combat.zombieHitAt[zombieEid(s)]).toBe(0);
    expect(s.getSurvival()!.stats.health).toBe(100);
  });

  it('per-type attackReachM and windupMs from zombieTypes override the defaults', () => {
    const s = aiSim({ zombies: [{ x: 16.5, y: 10.5 }], aiConfig: WIDE, combatConfig: SURE });
    const types = s.world.ai!.types;
    for (const t of types)
      t.def = { ...t.def, attackReachM: 0.6, windupMs: { min: 300, max: 300 } };
    let start: number | undefined;
    let gapAtStart = 0;
    let hitTick: number | undefined;
    for (let i = 0; i < 400 && hitTick === undefined; i++) {
      s.step();
      const ev = s.drainEvents();
      if (start === undefined && attackStarts(ev, s).length > 0) {
        start = s.tick - 1;
        gapAtStart = gap(s);
      }
      if (s.getSurvival()!.stats.health < 100) hitTick = s.tick - 1;
    }
    // Starts already at the wider gap (the chase still closes in), lands after 300 ms = 6 ticks.
    expect(gapAtStart).toBeLessThanOrEqual(0.61);
    expect(gapAtStart).toBeGreaterThan(REACH);
    expect(hitTick! - start!).toBe(6);
  });

  it('is deterministic (same seed → same hash after a fight)', () => {
    const go = () => {
      const s = aiSim({ zombies: [{ x: 16.5, y: 10.5 }], aiConfig: WIDE, combatConfig: SURE });
      for (let i = 0; i < 300; i++) s.step();
      return s.hash();
    };
    expect(go()).toBe(go());
  });
});

describe('zombie attacks: never through walls, windows or exact walls', () => {
  // Player at (10.5, 10.5), zombie at (11.3, 10.5): gap 0.2, the tile edge x = 11 between them.
  const contact = (map: MapSpec, setup?: (s: Sim) => void) => {
    const s = aiSim({ map, zombies: [{ x: 11.3, y: 10.5 }], aiConfig: WIDE });
    setup?.(s);
    const grid = new TileGrid(s.world.openings.map, s.world.openings);
    return zombieInContact(s.world, grid, zombieEid(s), s.world.players.get(0)!, REACH);
  };
  const edge = (kind: SimEdgeKind) => ({
    wallW: (x: number, y: number) => x === 11 && y === 10,
    edgeId: () => 2,
    edgeKinds: [null, 'wall', kind] as (SimEdgeKind | null)[],
  });

  it('open floor: in contact', () => {
    expect(contact({})).toBe(true);
  });

  it('a wall, a closed window, an open window and a broken window block the blow', () => {
    expect(contact({ wallW: (x: number, y: number) => x === 11 && y === 10 })).toBe(false);
    expect(contact(edge('window'))).toBe(false);
    for (const st of [OS.open, OS.broken])
      expect(
        contact(edge('window'), (s) =>
          setOpening(
            s.world.openings,
            openingKey(sideIndex('w'), 11, 10, 0),
            OpeningKind.window,
            st,
          ),
        ),
      ).toBe(false);
  });

  it('an open door lets the blow through, a closed one does not', () => {
    expect(contact(edge('door'))).toBe(false);
    expect(
      contact(edge('door'), (s) =>
        setOpening(
          s.world.openings,
          openingKey(sideIndex('w'), 11, 10, 0),
          OpeningKind.door,
          OS.open,
        ),
      ),
    ).toBe(true);
  });

  it('an exact slanted wall (wallSegments) between the bodies blocks the blow', () => {
    expect(contact({ wallSegments: [{ x0: 10.7, y0: 9.5, x1: 11.1, y1: 11.5 }] })).toBe(false);
  });
});
