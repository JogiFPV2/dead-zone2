import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { createSim } from '../sim.js';
import { eventsOf, runTicks } from '../test/ai-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem, rejectedReasons } from '../test/item-fixtures.js';

const content = await baseContent();
const ranged = (id: string) => {
  const d = content.items[id]!;
  if (d.kind !== 'weapon_ranged') throw new Error(id);
  return d.ranged;
};

function sim(zombies: { x: number; y: number }[] = [], seed = 3, load?: Uint8Array): Sim {
  return createSim({
    seed,
    map: buildMap({ width: 64, height: 64 }),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
    ...(zombies.length ? { spawnZombies: zombies } : {}),
    ...(load ? { load } : {}),
  });
}

const give = (s: Sim, itemId: string, count = 1) =>
  send(s, { type: 'debugGiveItem', itemId, count });

function arm(s: Sim, gun: string, extra: [string, number][]): void {
  give(s, gun);
  for (const [id, n] of extra) give(s, id, n);
  s.step();
  send(s, { type: 'equip', item: findItem(s, gun)!.id, slot: 'hand_primary' });
  send(s, { type: 'aim', x: 20, y: 10.5 });
  s.step();
  s.drainEvents();
}

function reload(s: Sim): number {
  s.drainEvents();
  send(s, { type: 'reload' });
  s.step();
  const started = eventsOf(s.drainEvents(), 'reload')[0]!;
  expect(started.phase).toBe('started');
  runTicks(s, started.untilTick - s.tick + 1);
  return started.untilTick - started.tick;
}

const roundsLeft = (s: Sim, id: string) => {
  let n = 0;
  for (const c of s.getInventory()!.containers ?? [])
    for (const i of c.items) if (i.def === id) n += i.count;
  return n;
};

describe('firearms: pump shotgun (internal feed)', () => {
  const r = ranged('base:pump-shotgun');

  it('empty gun: attack rejected no-ammo; reload takes reloadSec and loads from carried shells', () => {
    const s = sim();
    arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 8]]);
    send(s, { type: 'attack' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['no-ammo']);
    expect(s.drainView()?.combat).toMatchObject({
      weapon: 'base:pump-shotgun',
      ammo: 0,
      capacity: 5,
      jammed: false,
    });
    send(s, { type: 'reload' });
    s.step();
    const ev = s.drainEvents();
    const started = eventsOf(ev, 'reload')[0]!;
    expect(started.untilTick - started.tick).toBe(Math.round(r.reloadSec * 20));
    // Busy while reloading.
    send(s, { type: 'attack' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['busy']);
    runTicks(s, started.untilTick - s.tick + 1);
    expect(eventsOf(s.drainEvents(), 'reload')).toEqual([
      expect.objectContaining({ phase: 'done', ammo: 5 }),
    ]);
    expect(roundsLeft(s, 'base:shotgun-shell')).toBe(3);
    expect(s.drainView()?.combat?.ammo).toBe(5);
    // Full: reload is rejected.
    send(s, { type: 'reload' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['invalid-state']);
  });

  it('a shot makes loud noise, uses one shell and fires `projectiles` rays', () => {
    const s = sim();
    arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 5]]);
    reload(s);
    s.drainEvents();
    send(s, { type: 'attack' });
    s.step();
    const ev = s.drainEvents();
    const shot = eventsOf(ev, 'shot')[0]!;
    expect(shot).toMatchObject({ weapon: 'base:pump-shotgun', ammo: 4 });
    expect(shot.rays).toHaveLength(r.projectiles);
    expect(shot.rays.every((x) => x.hit === 0 && x.toX > 10.5)).toBe(true);
    expect(eventsOf(ev, 'noise').filter((n) => n.source === 'shot')).toEqual([
      expect.objectContaining({ radiusTiles: r.shotNoise.radiusTiles }),
    ]);
    // Rate of fire: the next attack right away is busy.
    send(s, { type: 'attack' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['busy']);
  });

  it('hits land more often up close than near max range', () => {
    const hitsAt = (dist: number): number => {
      let hits = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const s = sim([{ x: 10.5 + dist, y: 10.5 }], seed);
        arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 5]]);
        reload(s);
        s.drainEvents();
        send(s, { type: 'aim', x: 30, y: 10.5 });
        send(s, { type: 'attack' });
        s.step();
        hits += eventsOf(s.drainEvents(), 'shot')[0]!.rays.filter((x) => x.hit !== 0).length;
      }
      return hits;
    };
    const near = hitsAt(2);
    const far = hitsAt(r.rangeTiles - 1);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0);
  });

  it('a hit gives aiming XP; aiming raises the hit chance; reloading gives reloading XP', () => {
    const xpOf = (s: Sim, id: string) => s.drainView()?.skills?.find((k) => k.id === id)?.xp ?? 0;
    const s = sim([{ x: 12.5, y: 10.5 }], 2);
    arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 5]]);
    reload(s);
    s.drainView();
    send(s, { type: 'aim', x: 30, y: 10.5 });
    send(s, { type: 'attack' });
    s.step();
    const hit = eventsOf(s.drainEvents(), 'shot')[0]!.rays.some((x) => x.hit !== 0);
    const view = s.drainView();
    expect(view?.skills?.find((k) => k.id === 'base:reloading')?.xp).toBe(1);
    expect(view?.skills?.find((k) => k.id === 'base:aiming')?.xp ?? 0).toBe(hit ? 2 : 0);
    expect(xpOf(s, 'base:aiming')).toBe(0); // no change → nothing sent
    // Same seed, aiming 10: at least as many pellets hit at range.
    const hitsWith = (level: number): number => {
      let n = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const t = sim([{ x: 18.5, y: 10.5 }], seed);
        send(t, { type: 'debugSkill', skill: 'base:aiming', level });
        arm(t, 'base:pump-shotgun', [['base:shotgun-shell', 5]]);
        reload(t);
        t.drainEvents();
        send(t, { type: 'aim', x: 30, y: 10.5 });
        send(t, { type: 'attack' });
        t.step();
        n += eventsOf(t.drainEvents(), 'shot')[0]!.rays.filter((x) => x.hit !== 0).length;
      }
      return n;
    };
    expect(hitsWith(10)).toBeGreaterThanOrEqual(hitsWith(0));
  });

  it('save/load keeps loaded rounds', () => {
    const s = sim();
    arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 5]]);
    reload(s);
    const b = sim([], 3, s.save());
    b.step();
    expect(b.drainView()?.combat).toMatchObject({ weapon: 'base:pump-shotgun', ammo: 5 });
    s.step();
    expect(b.hash()).toBe(s.hash());
  });
});

describe('firearms: pistol with magazines', () => {
  it('loadMagazine fills it from carried rounds; reload inserts it, swapping out the old one', () => {
    const s = sim();
    arm(s, 'base:pistol', [
      ['base:pistol-magazine', 1],
      ['base:ammo-9mm', 20],
    ]);
    send(s, { type: 'reload' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['no-ammo']); // magazine empty
    const mag = findItem(s, 'base:pistol-magazine')!.id;
    send(s, { type: 'loadMagazine', item: mag });
    s.step();
    const st = eventsOf(s.drainEvents(), 'reload')[0]!;
    expect(st.untilTick - st.tick).toBe(Math.round(13 * 0.4 * 20));
    runTicks(s, st.untilTick - s.tick + 1);
    expect(findItem(s, 'base:pistol-magazine')!.uses).toBe(13);
    expect(roundsLeft(s, 'base:ammo-9mm')).toBe(7);
    const t = reload(s);
    expect(t).toBe(Math.round(ranged('base:pistol').reloadSec * 20));
    expect(findItem(s, 'base:pistol-magazine')).toBeUndefined();
    expect(s.drainView()?.combat).toMatchObject({ ammo: 13, capacity: 13 });
    send(s, { type: 'attack' });
    s.step();
    expect(eventsOf(s.drainEvents(), 'shot')[0]!.ammo).toBe(12);
    // Second magazine: reload ejects the inserted one with its 12 rounds.
    give(s, 'base:pistol-magazine');
    s.step();
    send(s, { type: 'loadMagazine', item: findItem(s, 'base:pistol-magazine')!.id });
    s.step();
    runTicks(s, 200);
    expect(findItem(s, 'base:pistol-magazine')!.uses).toBe(7);
    s.drainEvents();
    // Fullest magazine wins: the carried one has 7 < 12 inserted, still swaps (reload = swap).
    reload(s);
    expect(s.drainView()?.combat?.ammo).toBe(7);
    expect(findItem(s, 'base:pistol-magazine')!.uses).toBe(12);
    // Save/load keeps the inserted magazine.
    const b = sim([], 3, s.save());
    b.step();
    s.step();
    expect(b.hash()).toBe(s.hash());
    expect(b.drainView()?.combat).toMatchObject({ ammo: 7, capacity: 13 });
  });
});
