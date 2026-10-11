import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { aiSim, eventsOf, NOON } from '../test/ai-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { DEFAULT_STAGE4_CONFIG } from './config.js';
import { SNEAK, sneakVisibilityMul } from './sneak.js';
import { playerVisibility } from './light.js';

const F = DEFAULT_STAGE4_CONFIG.noise.footsteps;

function steps(sim: Sim, ticks: number) {
  const ev = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    ev.push(...sim.drainEvents());
  }
  return eventsOf(ev, 'playerNoise');
}

const characterOf = (sim: Sim) => {
  let last;
  for (let v = sim.drainView(); v; v = sim.drainView()) last = v.characters?.[0] ?? last;
  return last;
};

async function baseSim(zombies: { x: number; y: number }[] = []): Promise<Sim> {
  return createSim({
    seed: 3,
    map: buildMap({ width: 80, height: 80 }),
    spawn: { x: 10.5, y: 10.5 },
    content: await baseContent(),
    dev: true,
    clockStart: NOON,
    spawnZombies: zombies,
  });
}

describe('sneaking (setSneak)', () => {
  it('toggle: walking moves sneak (quiet, half speed), view says so', () => {
    const sim = aiSim();
    send(sim, { type: 'setSneak', on: true });
    send(sim, { type: 'move', dx: 0, dy: 1 });
    const y0 = sim.getPlayer()!.y;
    const pn = steps(sim, 80);
    expect(pn.length).toBeGreaterThan(3);
    expect(pn.every((e) => e.kind === 'sneak')).toBe(true);
    expect(pn.at(-1)!.radius).toBeCloseTo(F.sneak.radiusTiles, 4);
    const ch = characterOf(sim);
    expect(ch?.sneaking).toBe(true);
    expect(ch?.stepNoiseTiles).toBeCloseTo(F.sneak.radiusTiles, 1);
    const sneakDist = sim.getPlayer()!.y - y0;

    const walk = aiSim();
    send(walk, { type: 'move', dx: 0, dy: 1 });
    const w0 = walk.getPlayer()!.y;
    steps(walk, 80);
    const walkDist = walk.getPlayer()!.y - w0;
    expect(sneakDist / walkDist).toBeGreaterThan(0.4);
    expect(sneakDist / walkDist).toBeLessThan(0.62);
  });

  it('a later walking move keeps sneaking; off goes back to walking', () => {
    const sim = aiSim();
    send(sim, { type: 'setSneak', on: true });
    sim.step();
    send(sim, { type: 'move', dx: 1, dy: 0, gait: 'walk' });
    expect(steps(sim, 40).every((e) => e.kind === 'sneak')).toBe(true);
    send(sim, { type: 'setSneak', on: false });
    const pn = steps(sim, 40);
    expect(pn.at(-1)!.kind).toBe('step');
    expect(characterOf(sim)?.sneaking).toBe(false);
  });

  it('running turns sneaking off', () => {
    const sim = aiSim();
    send(sim, { type: 'setSneak', on: true });
    send(sim, { type: 'move', dx: 1, dy: 0, gait: 'run' });
    expect(steps(sim, 40).at(-1)!.kind).toBe('run');
    send(sim, { type: 'move', dx: 1, dy: 0 });
    expect(steps(sim, 40).at(-1)!.kind).toBe('step');
  });

  it('standing still: stepNoiseTiles 0', () => {
    const sim = aiSim();
    send(sim, { type: 'setSneak', on: true });
    steps(sim, 5);
    const ch = characterOf(sim);
    expect(ch?.sneaking).toBe(true);
    expect(ch?.stepNoiseTiles).toBe(0);
  });

  it('survives save / load', () => {
    const sim = aiSim();
    send(sim, { type: 'setSneak', on: true });
    sim.step();
    const loaded = aiSim({ load: sim.save() });
    send(loaded, { type: 'move', dx: 1, dy: 0 });
    expect(steps(loaded, 40).at(-1)!.kind).toBe('sneak');
  });

  it('skills: sneaking level 10 → × 0.4 radius and lower visibility; lightfoot quiets every step', async () => {
    const sim = await baseSim();
    send(sim, { type: 'debugSkill', skill: SNEAK.skill, level: 10 });
    send(sim, { type: 'setSneak', on: true });
    send(sim, { type: 'move', dx: 1, dy: 0 });
    const pn = steps(sim, 40);
    const r0 = pn.at(-1)!.radius;
    expect(r0).toBeLessThan(F.sneak.radiusTiles * 0.45);
    const w = sim.world;
    const eid = w.players.get(0)!;
    expect(sneakVisibilityMul(w, eid)).toBeCloseTo(
      DEFAULT_STAGE4_CONFIG.vision.sneakVisibilityMul * (1 - 10 * SNEAK.visibilityPerLevel),
      5,
    );
    expect(playerVisibility(w, w.ai!, eid)).toBeLessThan(0.4);
    send(sim, { type: 'debugSkill', skill: SNEAK.lightfootSkill, level: 10 });
    expect(steps(sim, 40).at(-1)!.radius).toBeCloseTo(r0 * (1 - 10 * SNEAK.lightfootPerLevel), 3);
  });

  it('XP for sneaking near a zombie only', async () => {
    const xp = (sim: Sim) => {
      let skills;
      for (let v = sim.drainView(); v; v = sim.drainView()) skills = v.skills ?? skills;
      return skills?.find((s) => s.id === SNEAK.skill);
    };
    const far = await baseSim();
    send(far, { type: 'setSneak', on: true });
    send(far, { type: 'move', dx: 1, dy: 0 });
    steps(far, 200);
    expect(xp(far)?.xp ?? 0).toBe(0);

    const near = await baseSim([{ x: 18.5, y: 14.5 }]);
    send(near, { type: 'setSneak', on: true });
    send(near, { type: 'move', dx: 1, dy: 0 });
    steps(near, 200);
    expect(xp(near)!.xp).toBeGreaterThan(0);
  });
});
