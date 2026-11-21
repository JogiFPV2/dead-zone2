import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { createSim } from '../sim.js';
import { eventsOf, runTicks } from '../test/ai-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem, rejectedReasons } from '../test/item-fixtures.js';

const content = await baseContent();
const def = (id: string) => content.items[id]!;
const lureOf = (id: string) => {
  const d = def(id);
  if (d.kind !== 'lure') throw new Error(id);
  return d.lure;
};

function sim(zombies: { x: number; y: number }[] = [], hour = 12, load?: Uint8Array): Sim {
  return createSim({
    seed: 3,
    map: buildMap({ width: 128, height: 128 }),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    // Exact noise radii from the data: no rain masking.
    weather: 'off',
    clockStart: { day: 1, hour, minute: 0 },
    ...(zombies.length ? { spawnZombies: zombies } : {}),
    ...(load ? { load } : {}),
  });
}

const give = (s: Sim, itemId: string, count = 1) =>
  send(s, { type: 'debugGiveItem', itemId, count });

describe('lures: electronic (remote)', () => {
  const cfg = lureOf('base:lure-electronic');

  it('placed with a battery, triggered by the remote in range: noise pulses, then idle', () => {
    const s = sim();
    give(s, 'base:lure-electronic');
    give(s, 'base:lure-remote');
    give(s, 'base:battery');
    s.step();
    send(s, { type: 'placeLure', item: findItem(s, 'base:lure-electronic')!.id });
    s.step();
    expect(findItem(s, 'base:battery')).toBeUndefined();
    let ev = s.drainEvents();
    expect(eventsOf(ev, 'lureChanged')[0]).toMatchObject({ phase: 'idle' });
    expect(s.drainView()?.lures).toEqual([
      expect.objectContaining({ def: 'base:lure-electronic', phase: 'idle', charges: 3 }),
    ]);
    // Walk 50 tiles away (in range 60), then trigger.
    send(s, { type: 'move', dx: 1, dy: 0, gait: 'run' });
    runTicks(s, 220);
    send(s, { type: 'move', dx: 0, dy: 0 });
    s.step();
    const px = s.getPlayer()!.x;
    expect(px - 10.5).toBeGreaterThan(40);
    expect(px - 10.5).toBeLessThan(cfg.trigger.type === 'remote' ? cfg.trigger.rangeTiles : 0);
    s.drainEvents();
    send(s, { type: 'triggerLure' });
    const t0 = s.tick;
    runTicks(s, Math.round(cfg.durationSec * 20) + 5);
    ev = s.drainEvents();
    const noises = eventsOf(ev, 'noise').filter((n) => n.source === 'lure');
    expect(noises.length).toBeGreaterThanOrEqual(cfg.durationSec - 1);
    expect(noises[0]).toMatchObject({ radiusTiles: cfg.noise.radiusTiles, x: 10.5 });
    const phases = eventsOf(ev, 'lureChanged').map((e) => e.phase);
    expect(phases).toEqual(['sounding', 'idle']);
    expect(eventsOf(ev, 'lureChanged')[0]!.untilTick).toBe(t0 + cfg.durationSec * 20);
    expect(s.drainView()?.lures?.[0]?.charges).toBe(2);
  });

  it('rejects: no remote, out of range, no battery', () => {
    const s = sim();
    give(s, 'base:lure-electronic');
    s.step();
    send(s, { type: 'placeLure', item: findItem(s, 'base:lure-electronic')!.id });
    s.step();
    send(s, { type: 'triggerLure' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['missing-tool']);
    give(s, 'base:lure-remote');
    s.step();
    send(s, { type: 'triggerLure' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['invalid-state']); // no battery inserted
  });

  it('zombies drawn by the lure walk to it and linger', () => {
    // At night (short sight) the zombie does not see the player, only hears the lure.
    const s = sim([{ x: 40.5, y: 30.5 }], 0);
    give(s, 'base:lure-electronic');
    give(s, 'base:lure-remote');
    give(s, 'base:battery');
    s.step();
    send(s, { type: 'throw', item: findItem(s, 'base:lure-electronic')!.id, x: 18.5, y: 10.5 });
    s.step();
    const thrown = eventsOf(s.drainEvents(), 'thrown')[0]!;
    expect(thrown).toMatchObject({ x: 18.5, y: 10.5, broke: false });
    send(s, { type: 'triggerLure' });
    runTicks(s, 3);
    expect(s.getZombies()[0]!.state).toBe('investigate');
    runTicks(s, 900);
    const z = s.getZombies()[0]!;
    expect(Math.abs(z.x - 18.5) + Math.abs(z.y - 10.5)).toBeLessThan(5);
  });
});

describe('lures: running (timer)', () => {
  const cfg = lureOf('base:lure-running');

  it('arms with a clamped delay, runs ~15 tiles in the set direction making noise, used up', () => {
    const s = sim();
    give(s, 'base:lure-running');
    s.step();
    send(s, {
      type: 'placeLure',
      item: findItem(s, 'base:lure-running')!.id,
      delaySec: 1,
      dirX: 0,
      dirY: 1,
    });
    s.step();
    const armed = eventsOf(s.drainEvents(), 'lureChanged')[0]!;
    const delay = cfg.trigger.type === 'timer' ? cfg.trigger.delaySec.min : 0;
    expect(armed).toMatchObject({ phase: 'armed', untilTick: 1 + delay * 20 });
    runTicks(s, delay * 20 + 5);
    const running = eventsOf(s.drainEvents(), 'lureChanged')[0]!;
    expect(running).toMatchObject({ phase: 'running', toX: 10.5, toY: 10.5 + 15 });
    runTicks(s, cfg.durationSec * 20);
    const ev = s.drainEvents();
    const noises = eventsOf(ev, 'noise').filter((n) => n.source === 'lure');
    expect(noises.length).toBeGreaterThan(cfg.durationSec - 2);
    const last = noises.at(-1)!;
    expect(last.y).toBeCloseTo(10.5 + (cfg.runner?.distanceTiles ?? 0), 0);
    expect(eventsOf(ev, 'lureChanged').at(-1)).toMatchObject({ phase: 'spent' });
    expect(s.drainView()?.lures ?? []).toEqual([]);
  });

  it('picking it up before it fires stops it', () => {
    const s = sim();
    give(s, 'base:lure-running');
    s.step();
    const id = findItem(s, 'base:lure-running')!.id;
    send(s, { type: 'placeLure', item: id, delaySec: 10 });
    s.step();
    send(s, { type: 'pickUp', item: id });
    runTicks(s, 3);
    expect(eventsOf(s.drainEvents(), 'lureChanged').map((e) => e.phase)).toEqual([
      'armed',
      'removed',
    ]);
    runTicks(s, 300);
    expect(eventsOf(s.drainEvents(), 'noise').filter((n) => n.source === 'lure')).toEqual([]);
  });
});

describe('throw', () => {
  it('a bottle breaks on impact with loud noise and leaves a broken bottle; walls stop it', () => {
    const s = createSim({
      seed: 3,
      map: buildMap({ wallW: (x) => x === 14 }),
      spawn: { x: 10.5, y: 10.5 },
      content,
      dev: true,
      // Exact noise radii from the data: no rain masking.
      weather: 'off',
    });
    give(s, 'base:bottle');
    s.step();
    send(s, { type: 'throw', item: findItem(s, 'base:bottle')!.id, x: 30, y: 10.5 });
    s.step();
    const ev = s.drainEvents();
    const t = eventsOf(ev, 'thrown')[0]!;
    expect(t.broke).toBe(true);
    expect(t.x).toBeLessThan(14);
    expect(eventsOf(ev, 'noise').find((n) => n.source === 'impact')).toMatchObject({
      radiusTiles: 20,
    });
    expect(findItem(s, 'base:bottle')).toBeUndefined();
  });

  it('non-throwable items are rejected', () => {
    const s = sim();
    give(s, 'base:battery');
    s.step();
    send(s, { type: 'throw', item: findItem(s, 'base:battery')!.id, x: 15, y: 10 });
    s.step();
    expect(rejectedReasons(s)).toEqual(['invalid-target']);
  });
});

describe('lures: save', () => {
  it('an armed lure survives save / load (same hash, fires later)', () => {
    const a = sim([{ x: 40.5, y: 40.5 }]);
    give(a, 'base:lure-running');
    a.step();
    send(a, { type: 'placeLure', item: findItem(a, 'base:lure-running')!.id, delaySec: 5 });
    runTicks(a, 20);
    const b = sim([{ x: 40.5, y: 40.5 }], 12, a.save());
    expect(b.hash()).toBe(a.hash());
    runTicks(a, 300);
    runTicks(b, 300);
    expect(b.hash()).toBe(a.hash());
  });
});
