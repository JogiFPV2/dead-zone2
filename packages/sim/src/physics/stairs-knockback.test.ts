import { describe, expect, it } from 'vitest';
import { sortedQuery } from '../core/world.js';
import { DEFAULT_COMBAT_CONFIG } from '../combat/config.js';
import type { Sim } from '../sim.js';
import { commander } from '../test/level-fixtures.js';
import { inA, inB, levelSim, mapA } from '../test/stairs-fixtures.js';
import { physicsHit } from './system.js';

/**
 * Silnik bug (osm-okulickiego, block P+5, `?zspawn=2`): with zombies at the stairwell the player
 * did not get up to the 1st floor. A zombie's hit / shove knocked the player into a flight's
 * corridor from the side or through the entrance without putting it on the flight (`stair` 0),
 * so it then walked along under the flight on the ground floor. Knock-back now enters a corridor
 * only through the entrance (onto the flight), like walking (`flightZones` in `stairs.ts`).
 */
const pbody = (sim: Sim) =>
  [...sim.world.physics.bodies.values()].find((b) => b.kind === 'player')!;

/** The player is in a flight's tiles on the ground floor without being on the flight. */
const underFlight = (sim: Sim) => {
  const p = sim.getPlayer()!;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  return pbody(sim).stair === 0 && p.z < 1 && (inA(tx, ty) || inB(tx, ty));
};

function shove(spawn: { x: number; y: number }, zombie: { x: number; y: number }) {
  const sim = levelSim(mapA(), spawn, [{ ...zombie, z: 0 }]);
  sim.step();
  const w = sim.world;
  const zid = sortedQuery(w, 'zombies', [w.c.Zombie])[0]!;
  physicsHit(w, zid, w.players.get(0)!, 'shove', 1);
  let bad = 0;
  for (let i = 0; i < 40; i++) {
    sim.step();
    if (underFlight(sim)) bad++;
  }
  return { sim, bad };
}

describe('stairs: knock-back never leaves a body under a flight', () => {
  it('shoved from the side into open flight B: stays beside it', () => {
    const { sim, bad } = shove({ x: 31.6, y: 29.5 }, { x: 32.3, y: 29.5 });
    expect(bad).toBe(0);
    expect(sim.getPlayer()!.x).toBeGreaterThan(30.9);
  });

  it('shoved up through the entrance of flight B: ends on the flight (or before it)', () => {
    const { sim, bad } = shove({ x: 30.5, y: 31.6 }, { x: 30.5, y: 32.3 });
    expect(bad).toBe(0);
    const b = pbody(sim);
    if (sim.getPlayer()!.y < 31) expect(b.stair).toBeGreaterThan(0);
  });

  it('two biting zombies behind the player at the bottom of flight A: the player gets up', () => {
    const sim = levelSim(
      mapA(),
      { x: 17.5, y: 20.5 },
      [
        { x: 15.5, y: 20.5, z: 0 },
        { x: 15.5, y: 20.9, z: 0 },
      ],
      { combatConfig: DEFAULT_COMBAT_CONFIG },
    );
    commander(sim).move(1, 0);
    let under = 0;
    let t = 0;
    for (; t < 900 && sim.getPlayer()!.z < 1; t++) {
      sim.step();
      if (underFlight(sim)) under++;
    }
    expect(under).toBe(0);
    expect(sim.getPlayer()!.z).toBe(1);
  });
});
