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

/** Reloads until `done` (single-round loading takes several steps); returns the ticks taken. */
function reload(s: Sim): number {
  s.drainEvents();
  send(s, { type: 'reload' });
  s.step();
  const started = eventsOf(s.drainEvents(), 'reload')[0]!;
  expect(started.phase).toBe('started');
  for (let i = 0; i < 2000; i++) {
    s.step();
    const done = eventsOf(s.drainEvents(), 'reload').find((e) => e.phase === 'done');
    if (done) return done.tick - started.tick;
  }
  throw new Error('reload never finished');
}

const roundsLeft = (s: Sim, id: string) => {
  let n = 0;
  for (const c of s.getInventory()!.containers ?? [])
    for (const i of c.items) if (i.def === id) n += i.count;
  return n;
};

describe('firearms: pump shotgun (internal feed)', () => {
  const r = ranged('base:pump-shotgun');

  it('empty gun: attack rejected no-ammo; reload loads one shell per loadSecPerRound step', () => {
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
    const step = Math.round(r.loadSecPerRound! * 20);
    send(s, { type: 'reload' });
    s.step();
    const started = eventsOf(s.drainEvents(), 'reload')[0]!;
    expect(started).toMatchObject({ phase: 'started', kind: 'single', ammo: 0 });
    expect(started.untilTick - started.tick).toBe(step);
    expect(s.drainView()?.combat).toMatchObject({
      reloadKind: 'single',
      reloadStartTick: started.tick,
      reloadUntil: started.untilTick,
      // The view is taken after the tick: one tick into the round.
      reloadProgress: Math.round((1 / step) * 1000) / 1000,
    });
    // Each round is its own step: ammo grows by one per `round` event.
    const rounds: number[] = [];
    let done = -1;
    for (let i = 0; i < step * 6 && done < 0; i++) {
      s.step();
      for (const e of eventsOf(s.drainEvents(), 'reload')) {
        if (e.phase === 'round') {
          rounds.push(e.ammo);
          expect(s.drainView()?.combat?.ammo).toBe(e.ammo);
        }
        if (e.phase === 'done') done = e.tick;
      }
    }
    expect(rounds).toEqual([1, 2, 3, 4, 5]);
    expect(done - started.tick).toBe(5 * step);
    expect(roundsLeft(s, 'base:shotgun-shell')).toBe(3);
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
        // A zombie in reach may stagger the player: retry until the shot goes off.
        for (let t = 0; t < 40; t++) {
          send(s, { type: 'attack' });
          s.step();
          const shot = eventsOf(s.drainEvents(), 'shot')[0];
          if (!shot) continue;
          hits += shot.rays.filter((x) => x.hit !== 0).length;
          break;
        }
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

describe('firearms: single-round loading (pump shotgun)', () => {
  const step = Math.round(ranged('base:pump-shotgun').loadSecPerRound! * 20);

  it('reloadProgress is the progress of the round being loaded and resets per round', () => {
    const s = sim();
    arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 5]]);
    send(s, { type: 'reload' });
    s.step();
    s.drainView();
    runTicks(s, step / 2);
    const mid = s.drainView()!.combat!;
    expect(mid.reloadKind).toBe('single');
    expect(mid.reloadProgress).toBeCloseTo((s.tick - mid.reloadStartTick!) / step, 3);
    expect(mid.reloadProgress).toBeGreaterThan(0.3);
    expect(mid.reloadProgress).toBeLessThan(0.7);
    // Past the first round: new step, progress back near 0, ammo 1.
    runTicks(s, step / 2 + 1);
    const next = s.drainView()!.combat!;
    expect(next.ammo).toBe(1);
    expect(next.reloadProgress).toBeLessThan(0.2);
    expect(next.reloadUntil! - next.reloadStartTick!).toBe(step);
  });

  it('attack interrupts the loading: cancelled, shot fires with the rounds loaded so far', () => {
    const s = sim();
    arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 5]]);
    send(s, { type: 'reload' });
    s.step();
    runTicks(s, step * 2 + 2);
    expect(s.drainView()?.combat?.ammo).toBe(2);
    s.drainEvents();
    send(s, { type: 'attack' });
    s.step();
    const ev = s.drainEvents();
    expect(eventsOf(ev, 'reload')).toEqual([
      expect.objectContaining({ phase: 'cancelled', kind: 'single', ammo: 2 }),
    ]);
    expect(eventsOf(ev, 'shot')[0]).toMatchObject({ ammo: 1 });
    const v = s.drainView()!.combat!;
    expect(v.reloadUntil).toBeUndefined();
    expect(v.reloadKind).toBeUndefined();
    expect(v.reloadProgress).toBeUndefined();
    // Nothing else loads afterwards; the 3 shells stay carried.
    runTicks(s, step * 3);
    expect(eventsOf(s.drainEvents(), 'reload')).toEqual([]);
    expect(roundsLeft(s, 'base:shotgun-shell')).toBe(3);
  });

  it('attack on an empty gun mid-load cancels and is rejected no-ammo; stops when out of shells', () => {
    const s = sim();
    arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 2]]);
    send(s, { type: 'reload' });
    s.step();
    s.drainEvents();
    send(s, { type: 'attack' });
    s.step();
    const ev = s.drainEvents();
    expect(ev.flatMap((e) => (e.type === 'commandRejected' ? [e.reason] : []))).toEqual([
      'no-ammo',
    ]);
    expect(eventsOf(ev, 'reload')).toEqual([
      expect.objectContaining({ phase: 'cancelled', ammo: 0 }),
    ]);
    // Only 2 shells carried: two rounds, then done.
    send(s, { type: 'reload' });
    s.step();
    runTicks(s, step * 4);
    expect(
      eventsOf(s.drainEvents(), 'reload').map((e) => [e.phase, e.ammo, e.untilTick > 0]),
    ).toEqual([
      ['started', 0, true],
      ['round', 1, true],
      ['round', 2, false],
      ['done', 2, false],
    ]);
  });

  it('save/load mid-load keeps the step and the hash', () => {
    const s = sim();
    arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 5]]);
    send(s, { type: 'reload' });
    s.step();
    runTicks(s, step + 3);
    const b = sim([], 3, s.save());
    for (let i = 0; i < step * 5; i++) {
      s.step();
      b.step();
    }
    expect(b.hash()).toBe(s.hash());
    expect(b.drainView()?.combat?.ammo).toBe(5);
  });
});

describe('firearms: whole reload and unjam progress', () => {
  it('double-barrel: kind magazine, busy, reloadProgress 0..1 over reloadSec', () => {
    const r = ranged('base:double-barrel-shotgun');
    expect(r.loadSecPerRound).toBeUndefined();
    const s = sim();
    arm(s, 'base:double-barrel-shotgun', [['base:shotgun-shell', 4]]);
    send(s, { type: 'reload' });
    s.step();
    const started = eventsOf(s.drainEvents(), 'reload')[0]!;
    const total = Math.round(r.reloadSec * 20);
    expect(started).toMatchObject({ kind: 'magazine', untilTick: started.tick + total });
    send(s, { type: 'attack' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['busy']);
    runTicks(s, total / 2 - 1);
    const v = s.drainView()!.combat!;
    expect(v.reloadKind).toBe('magazine');
    expect(v.reloadProgress).toBeCloseTo(0.5, 1);
    runTicks(s, total);
    expect(eventsOf(s.drainEvents(), 'reload').at(-1)).toMatchObject({ phase: 'done', ammo: 2 });
  });

  it('jammed pistol: reload is kind unjam with progress, clears the jam', () => {
    const pd = content.items['base:pistol']!;
    if (pd.kind !== 'weapon_ranged') throw new Error('pistol');
    const jc = {
      ...content,
      items: { ...content.items, [pd.id]: { ...pd, ranged: { ...pd.ranged, jamChance: 1 } } },
    };
    const s = createSim({
      seed: 3,
      map: buildMap({ width: 64, height: 64 }),
      spawn: { x: 10.5, y: 10.5 },
      content: jc,
      dev: true,
      clockStart: { day: 1, hour: 12, minute: 0 },
    });
    arm(s, 'base:pistol', [
      ['base:pistol-magazine', 1],
      ['base:ammo-9mm', 13],
    ]);
    send(s, { type: 'loadMagazine', item: findItem(s, 'base:pistol-magazine')!.id });
    s.step();
    expect(eventsOf(s.drainEvents(), 'reload')[0]).toMatchObject({ kind: 'loadMagazine' });
    runTicks(s, 200);
    reload(s);
    send(s, { type: 'attack' });
    s.step();
    expect(eventsOf(s.drainEvents(), 'shot')[0]).toMatchObject({ jammed: true });
    expect(s.drainView()?.combat?.jammed).toBe(true);
    send(s, { type: 'reload' });
    s.step();
    const st = eventsOf(s.drainEvents(), 'reload')[0]!;
    expect(st).toMatchObject({ phase: 'started', kind: 'unjam' });
    runTicks(s, Math.floor((st.untilTick - st.tick) / 4));
    const v = s.drainView()!.combat!;
    expect(v.reloadKind).toBe('unjam');
    expect(v.reloadProgress).toBeGreaterThan(0);
    expect(v.reloadProgress).toBeLessThan(0.5);
    runTicks(s, st.untilTick - s.tick + 1);
    expect(eventsOf(s.drainEvents(), 'reload').at(-1)).toMatchObject({
      phase: 'done',
      kind: 'unjam',
    });
    expect(s.drainView()?.combat?.jammed).toBe(false);
  });
});

describe('firearms: effective spread', () => {
  const fs = content.worldSettings.firearms;

  /**
   * Max |dy/dx| of the pellets from the aim direction (+x) over a few shots: a ray is
   * (1, off) normalized, so this is the largest |off| (≤ spread).
   */
  function maxPelletOffset(s: Sim, shots: number): number {
    let max = 0;
    for (let i = 0; i < shots; i++) {
      runTicks(s, 40);
      s.drainEvents();
      send(s, { type: 'attack' });
      s.step();
      const shot = eventsOf(s.drainEvents(), 'shot')[0]!;
      for (const ray of shot.rays) {
        max = Math.max(max, Math.abs(ray.toY - shot.y) / (ray.toX - shot.x));
      }
    }
    return max;
  }

  it('view spread = base standing; grows walking, more running, with exhaustion and fatigue', () => {
    const s = sim();
    arm(s, 'base:pistol', []);
    const base = fs.spread.pistol;
    expect(s.drainView()?.combat?.spread).toBeCloseTo(base, 4);
    send(s, { type: 'move', dx: 0, dy: 1, gait: 'walk' });
    runTicks(s, 10);
    const walking = s.drainView()!.combat!.spread!;
    expect(walking).toBeCloseTo(base * (1 + fs.spreadModifiers.moving), 3);
    send(s, { type: 'move', dx: 0, dy: 1, gait: 'run' });
    runTicks(s, 10);
    const running = s.drainView()!.combat!.spread!;
    expect(running).toBeGreaterThan(walking);
    expect(running).toBeLessThanOrEqual(base * fs.spreadModifiers.max + 1e-4);
    send(s, { type: 'move', dx: 0, dy: 0 });
    runTicks(s, 10);
    expect(s.drainView()!.combat!.spread).toBeCloseTo(base, 4);
    send(s, { type: 'debugStat', stat: 'endurance', value: 0 });
    send(s, { type: 'debugStat', stat: 'fatigue', value: 100 });
    s.step();
    const tired = s.drainView()!.combat!.spread!;
    expect(tired).toBeGreaterThan(base * (1 + fs.spreadModifiers.exhaustion));
    expect(tired).toBeLessThanOrEqual(
      base * (1 + fs.spreadModifiers.exhaustion + fs.spreadModifiers.fatigue) + 1e-4,
    );
    // Melee weapon / bare hands: no spread field.
    send(s, { type: 'unequip', slot: 'hand_primary' });
    s.step();
    expect(s.drainView()?.combat?.spread).toBeUndefined();
  });

  it('the shot uses the effective spread: pellets stay within it, wider when exhausted', () => {
    const run = (tired: boolean): number => {
      const s = sim([], 5);
      arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 30]]);
      if (tired) {
        send(s, { type: 'debugStat', stat: 'endurance', value: 0 });
        send(s, { type: 'debugStat', stat: 'fatigue', value: 100 });
        s.step();
      }
      reload(s);
      s.drainView();
      if (tired) {
        send(s, { type: 'debugStat', stat: 'endurance', value: 0 });
        s.step();
      }
      const spread = s.drainView()?.combat?.spread ?? fs.spread.shotgun;
      const off = maxPelletOffset(s, 4);
      // Ray ends are rounded to 0.01 tiles over ≥ 10 tiles → small tolerance.
      expect(off).toBeLessThanOrEqual(spread + 2e-3);
      return off;
    };
    const calm = run(false);
    const tired = run(true);
    expect(calm).toBeLessThanOrEqual(fs.spread.shotgun + 2e-3);
    expect(tired).toBeGreaterThan(fs.spread.shotgun + 2e-3);
  });

  it('is deterministic: same seed and inputs → same rays and spread', () => {
    const go = () => {
      const s = sim([{ x: 16.5, y: 11 }], 9);
      arm(s, 'base:pump-shotgun', [['base:shotgun-shell', 5]]);
      reload(s);
      send(s, { type: 'move', dx: 0, dy: 1, gait: 'run' });
      runTicks(s, 6);
      send(s, { type: 'attack' });
      s.step();
      return {
        rays: eventsOf(s.drainEvents(), 'shot')[0]?.rays,
        spread: s.drainView()?.combat?.spread,
      };
    };
    const a = go();
    expect(a.rays).toHaveLength(ranged('base:pump-shotgun').projectiles);
    expect(go()).toEqual(a);
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
