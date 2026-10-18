import { describe, expect, it, vi } from 'vitest';
import { fixtureContent, runMinutes, send, survivalSim } from '../test/content-fixtures.js';

// Heavy worlds (LOD, floors, long health runs): 5 s is too little on a busy shared box.
vi.setConfig({ testTimeout: 30_000 });

const rejected = (sim: ReturnType<typeof survivalSim>) =>
  sim.drainEvents().flatMap((e) => (e.type === 'commandRejected' ? [e.reason] : []));

describe('health: wounds, bleeding, bandages', () => {
  const content = fixtureContent();
  const cfg = content.worldSettings.survival.wounds;

  it('debug commands need dev mode', () => {
    const sim = survivalSim(content, { dev: false });
    send(sim, { type: 'debugWound', part: 'forearm_l', wound: 'laceration' });
    send(sim, { type: 'debugStat', stat: 'hunger', value: 50 });
    sim.step();
    expect(rejected(sim)).toEqual(['dev-only', 'dev-only']);
    expect(sim.getSurvival()!.wounds).toEqual([]);
  });

  it('a wound sets bleeding and pain from its kind and emits `wounded`', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugWound', part: 'forearm_l', wound: 'laceration' });
    sim.step();
    const s = sim.getSurvival()!;
    expect(s.stats.bleeding).toBe(cfg.types.laceration.bleeding);
    expect(s.stats.pain).toBe(cfg.types.laceration.pain);
    expect(s.wounds).toEqual([
      {
        part: 'forearm_l',
        wound: 'laceration',
        bleeding: cfg.types.laceration.bleeding,
        healed: 0,
        bandaged: false,
        bandageDirty: false,
        infected: false,
      },
    ]);
    expect(sim.drainEvents()).toContainEqual({
      type: 'wounded',
      tick: 0,
      playerId: 0,
      part: 'forearm_l',
      wound: 'laceration',
    });
  });

  it('bleeding drains health per point per minute, and clots after clotsAfterMin', () => {
    const sim = survivalSim(
      fixtureContent({ survival: { wounds: { dirtInfection: { unbandagedChancePerMin: 0 } } } }),
    );
    send(sim, { type: 'debugWound', part: 'thigh_r', wound: 'scratch' });
    runMinutes(sim, 11);
    const s = sim.getSurvival()!;
    expect(s.stats.health).toBeLessThan(100 - 9 * cfg.healthLossPerBleedingPerMin * 9);
    runMinutes(sim, cfg.types.scratch.clotsAfterMin);
    expect(sim.getSurvival()!.stats.bleeding).toBe(0);
  });

  it('a clean bandage stops bleeding; it gets dirty after dirtyAfterMin and bleeds a bit', () => {
    const sim = survivalSim(
      fixtureContent({ survival: { wounds: { dirtInfection: { dirtyBandageChancePerMin: 0 } } } }),
    );
    send(sim, { type: 'debugWound', part: 'torso_lower', wound: 'deep' });
    sim.step();
    expect(sim.getSurvival()!.stats.bleeding).toBe(cfg.types.deep.bleeding);
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:bandage' });
    send(sim, { type: 'bandage', part: 'torso_lower', itemId: 'fixture:bandage' });
    sim.step();
    // A timed action (`medical.durationMin` = 3): still bleeding until it completes.
    expect(sim.getAction()).toMatchObject({ kind: 'bandage', part: 'torso_lower' });
    expect(sim.getSurvival()!.stats.bleeding).toBeGreaterThan(0);
    // 3 min / (1 − heavy torso actionSpeed 0.15) ≈ 3.5 min (woundPenalties).
    runMinutes(sim, 3.6);
    expect(sim.getAction()).toBeNull();
    expect(sim.getSurvival()!.stats.bleeding).toBe(0);
    // The bandage was used up.
    expect(sim.getInventory()!.containers![0]!.items).toEqual([]);
    expect(sim.getSurvival()!.wounds[0]).toMatchObject({ bandaged: true, bandageDirty: false });
    runMinutes(sim, cfg.bandage.dirtyAfterMin + 1);
    const w = sim.getSurvival()!.wounds[0]!;
    expect(w.bandageDirty).toBe(true);
    expect(w.bleeding).toBeGreaterThan(0);
    expect(w.bleeding).toBeLessThanOrEqual(cfg.types.deep.bleeding * cfg.bandage.dirtyBleedingMul);
  });

  it('rejects bandages on parts without wounds and non-bandage items', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugWound', part: 'hand_l', wound: 'scratch' });
    send(sim, { type: 'bandage', part: 'hand_l' });
    sim.step();
    expect(rejected(sim)).toEqual(['no-item']);
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:bandage' });
    send(sim, { type: 'bandage', part: 'hand_r' });
    send(sim, { type: 'bandage', part: 'hand_l', itemId: 'fixture:pills' });
    send(sim, { type: 'bandage', part: 'hand_l', itemId: 'fixture:nope' });
    send(sim, { type: 'bandage', part: 'hand_l' });
    sim.step();
    expect(rejected(sim)).toEqual(['invalid-target', 'unknown-item', 'unknown-item']);
  });

  it('wounds heal in healMin; a clean bandage heals faster (healMul)', () => {
    const noDirt = { survival: { wounds: { dirtInfection: { unbandagedChancePerMin: 0 } } } };
    const open = survivalSim(fixtureContent(noDirt));
    const dressed = survivalSim(fixtureContent(noDirt));
    for (const sim of [open, dressed])
      send(sim, { type: 'debugWound', part: 'neck', wound: 'scratch' });
    send(dressed, { type: 'debugGiveItem', itemId: 'fixture:quick-bandage' });
    send(dressed, { type: 'bandage', part: 'neck' });
    const heal = cfg.types.scratch.healMin;
    runMinutes(open, heal / cfg.bandage.healMul + 2);
    runMinutes(dressed, heal / cfg.bandage.healMul + 2);
    expect(dressed.getSurvival()!.wounds).toEqual([]);
    expect(open.getSurvival()!.wounds).toHaveLength(1);
    runMinutes(open, heal);
    expect(open.getSurvival()!.wounds).toEqual([]);
  });

  it('dirt infection: open wounds roll per minute (health RNG), add pain and hurt', () => {
    const sim = survivalSim(
      fixtureContent({ survival: { wounds: { dirtInfection: { unbandagedChancePerMin: 1 } } } }),
    );
    send(sim, { type: 'debugWound', part: 'foot_l', wound: 'scratch' });
    runMinutes(sim, 2);
    const s = sim.getSurvival()!;
    expect(s.wounds[0]!.infected).toBe(true);
    expect(s.stats.pain).toBeGreaterThan(cfg.types.scratch.pain);
    const clean = survivalSim(
      fixtureContent({ survival: { wounds: { dirtInfection: { unbandagedChancePerMin: 1 } } } }),
    );
    send(clean, { type: 'debugWound', part: 'foot_l', wound: 'scratch' });
    send(clean, { type: 'debugGiveItem', itemId: 'fixture:quick-bandage' });
    send(clean, { type: 'bandage', part: 'foot_l' });
    runMinutes(clean, 10);
    expect(clean.getSurvival()!.wounds[0]!.infected).toBe(false);
  });

  it('bleeding out: `died` with cause bleeding, then no movement and commands rejected', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'debugWound', part: 'neck', wound: 'deep' });
    send(sim, { type: 'debugStat', stat: 'health', value: 1 });
    runMinutes(sim, 5);
    const died = sim.drainEvents().filter((e) => e.type === 'died');
    expect(died).toEqual([
      expect.objectContaining({ type: 'died', cause: 'bleeding', playerId: 0, day: 1 }),
    ]);
    const x = sim.getPlayer()!.x;
    send(sim, { type: 'move', dx: 1, dy: 0 });
    runMinutes(sim, 1);
    expect(sim.getPlayer()!.x).toBe(x);
    expect(rejected(sim)).toEqual(['dead']);
  });
});

describe('health: zombie infection and fever', () => {
  const fast = fixtureContent({
    survival: {
      wounds: {
        types: { bite: { zombieInfectionChance: 1 } },
        dirtInfection: { unbandagedChancePerMin: 0 },
      },
      infection: { incubationMin: { min: 30, max: 30 }, deathAfterMin: { min: 200, max: 200 } },
    },
  });

  it('a zombie bite infects; infection grows linearly, sickness and fever after incubation, death', () => {
    const sim = survivalSim(fast);
    send(sim, { type: 'debugWound', part: 'forearm_r', wound: 'bite', zombie: true });
    send(sim, { type: 'bandage', part: 'forearm_r' });
    runMinutes(sim, 21);
    let s = sim.getSurvival()!;
    expect(s.infected).toBe(true);
    expect(s.stats.infection).toBeCloseTo(10, 4);
    expect(s.stats.sickness).toBe(0);
    runMinutes(sim, 80);
    s = sim.getSurvival()!;
    expect(s.stats.infection).toBeCloseTo(50, 4);
    expect(s.stats.sickness).toBeCloseTo(50, 4);
    expect(s.stats['body-temperature-c']).toBeGreaterThan(37);
    runMinutes(sim, 110);
    expect(sim.drainEvents().find((e) => e.type === 'died')).toMatchObject({ cause: 'infection' });
  });

  it('non-zombie wounds never infect; the roll uses the health RNG (seeded)', () => {
    const plain = survivalSim(fast);
    send(plain, { type: 'debugWound', part: 'forearm_r', wound: 'bite' });
    runMinutes(plain, 2);
    expect(plain.getSurvival()!.infected).toBe(false);
    const content = fixtureContent();
    const outcome = (seed: number) => {
      const sim = survivalSim(content, { seed });
      send(sim, { type: 'debugWound', part: 'hand_l', wound: 'laceration', zombie: true });
      sim.step();
      return sim.getSurvival()!.infected;
    };
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const results = seeds.map(outcome);
    expect(results).toEqual(seeds.map(outcome));
    expect(results.some(Boolean)).toBe(true);
    expect(results.every(Boolean)).toBe(false);
  });
});
