import { describe, expect, it } from 'vitest';
import { shotForce } from '../combat/firearms.js';
import { createRng } from '../core/rng.js';
import { createSim, type Sim } from '../sim.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem } from '../test/item-fixtures.js';
import { DEFAULT_PHYSICS_CONFIG, type FirearmCategory } from './constants.js';
import { resolveHit } from './reactions.js';
import { addBody, createPhysicsWorld } from './step.js';

const K = DEFAULT_PHYSICS_CONFIG.firearms;

/** Reaction shares of `n` firearm hits on a zombie at distance `t` (all pellets hit). */
function reactions(cat: FirearmCategory, t: number, pellets = 1, n = 2000) {
  const pw = createPhysicsWorld(createRng(9));
  const a = addBody(pw, { id: 1, kind: 'player', x: 0, y: 0, strength: 10 });
  const z = addBody(pw, { id: 2, kind: 'zombie', x: t, y: 0, facing: Math.PI });
  const force = Math.min(1, shotForce(K[cat], t, pellets) * pellets);
  const out = { hit: 0, stagger: 0, knockdown: 0 };
  const rng = createRng(4);
  for (let i = 0; i < n; i++) {
    const hit = {
      attackerId: 1,
      targetId: 2,
      kind: 'shot' as const,
      force,
      maxReaction: K[cat].maxReaction,
    };
    out[resolveHit(a, z, hit, rng).reaction]++;
  }
  return { hit: out.hit / n, stagger: out.stagger / n, knockdown: out.knockdown / n };
}

describe('firearm knock-back', () => {
  it('force: full up close, falls off with distance, pellets split it', () => {
    expect(shotForce(K.shotgun, 1, 1)).toBe(K.shotgun.force);
    expect(shotForce(K.shotgun, 1, 8) * 8).toBeCloseTo(K.shotgun.force, 6);
    expect(shotForce(K.shotgun, 6, 1)).toBeLessThan(shotForce(K.shotgun, 3, 1));
    expect(shotForce(K.shotgun, 100, 1)).toBeCloseTo(K.shotgun.force * K.shotgun.minMul, 6);
  });

  it('pistol only staggers; rifle medium; shotgun up close often knocks down', () => {
    const pistol = reactions('pistol', 1.5);
    expect(pistol.knockdown).toBe(0);
    expect(pistol.stagger).toBeGreaterThan(0.2);
    const revolver = reactions('revolver', 1.5);
    expect(revolver.knockdown).toBe(0);
    const rifle = reactions('rifle', 3);
    const shotgun = reactions('shotgun', 1.5, 8);
    const far = reactions('shotgun', 9, 8);
    expect(shotgun.knockdown).toBeGreaterThan(0.35);
    expect(rifle.knockdown).toBeGreaterThan(0);
    expect(rifle.knockdown).toBeLessThan(shotgun.knockdown / 2);
    expect(far.knockdown).toBeLessThan(shotgun.knockdown / 3);
    // The shooter's strength does not matter for firearms.
    expect(rifle.stagger + rifle.knockdown).toBeGreaterThan(pistol.stagger);
  });

  it('a shotgun hit up close pushes the zombie back (physics hit, knock-back away from the shooter)', async () => {
    const content = await baseContent();
    const sim: Sim = createSim({
      seed: 3,
      map: buildMap({ width: 64, height: 64 }),
      spawn: { x: 10.5, y: 10.5 },
      content,
      dev: true,
      clockStart: { day: 1, hour: 12, minute: 0 },
      spawnZombies: [{ x: 12, y: 10.5 }],
    });
    send(sim, { type: 'debugGiveItem', itemId: 'base:double-barrel-shotgun', count: 1 });
    send(sim, { type: 'debugGiveItem', itemId: 'base:shotgun-shell', count: 4 });
    sim.step();
    const gun = findItem(sim, 'base:double-barrel-shotgun')!;
    send(sim, { type: 'equip', item: gun.id, slot: 'hand_primary' });
    send(sim, { type: 'aim', x: 20, y: 10.5 });
    sim.step();
    send(sim, { type: 'reload' });
    for (let i = 0; i < 200; i++) sim.step();
    sim.drainEvents();
    const zx = sim.getZombies()[0]!.x;
    send(sim, { type: 'attack' });
    const ev = [];
    for (let i = 0; i < 4; i++) {
      sim.step();
      ev.push(...sim.drainEvents());
    }
    const shots = eventsOf(ev, 'hit').filter((e) => e.source === 'shot');
    expect(shots.length).toBeGreaterThan(0);
    const landed = eventsOf(ev, 'physics').filter((e) => e.kind === 'hitLanded');
    expect(landed).toHaveLength(1);
    const zb = [...sim.world.physics.bodies.values()].find((b) => b.kind === 'zombie')!;
    expect(zb.knockback.dirX).toBeGreaterThan(0.9);
    expect(['hit', 'stagger', 'knockdown', 'dead']).toContain(zb.state);
    expect(sim.getZombies()[0]!.x).toBeGreaterThan(zx);
  });
});
