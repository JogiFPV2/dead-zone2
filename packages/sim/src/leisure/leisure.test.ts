import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem, rejectedReasons } from '../test/item-fixtures.js';

const content = await baseContent();
const leisure = content.worldSettings.survival.leisure;
const TV = { contentId: 'base:tv', x: 11, y: 10 };

function sim(opts: { tv?: boolean; load?: Uint8Array } = {}): Sim {
  return createSim({
    seed: 9,
    map: buildMap({ width: 32, height: 32, objects: opts.tv === false ? [] : [TV] }),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
    ...(opts.load ? { load: opts.load } : {}),
  });
}

const stats = (s: Sim) => s.getSurvival()!.stats;
const setStats = (s: Sim, v: { fatigue: number; boredom: number; stress: number }) => {
  for (const [stat, value] of Object.entries(v))
    send(s, { type: 'debugStat', stat: stat as 'fatigue', value });
};

/** Steps until the current action completes or is interrupted; returns all events. */
function untilDone(s: Sim, limit = 20000): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < limit; i++) {
    s.step();
    const ev = s.drainEvents();
    all.push(...ev);
    if (
      ev.some((e) => ['actionCompleted', 'actionInterrupted', 'commandRejected'].includes(e.type))
    )
      return all;
  }
  return all;
}

const skillXp = (s: Sim, id: string) => {
  const p = s.world.items!.progress.get(s.world.c.StableId.value[s.world.players.get(0)!]!)!;
  const i = s.world.items!.content.skillIndex.get(id)!;
  return { level: p.level[i]!, xp: p.xp[i]! };
};

describe('leisure: data', () => {
  it('every session rests 5–8 fatigue (worldSettings.survival.leisure)', () => {
    for (const a of [leisure.read, leisure.tv, leisure.vhs]) {
      expect(a.fatigueRest).toBeGreaterThanOrEqual(5);
      expect(a.fatigueRest).toBeLessThanOrEqual(8);
      expect(a.boredomReduction).toBeGreaterThan(0);
      expect(a.stressReduction).toBeGreaterThan(0);
    }
  });
});

describe('leisure: reading', () => {
  it('a finished read rests fatigue and removes more boredom / stress (leisure.read + item)', () => {
    const s = sim({ tv: false });
    setStats(s, { fatigue: 50, boredom: 60, stress: 40 });
    send(s, { type: 'debugGiveItem', itemId: 'base:mag-backyard-survival' });
    s.step();
    const lit = content.items['base:mag-backyard-survival']!;
    if (lit.kind !== 'literature') throw new Error('fixture');
    const before = stats(s);
    send(s, { type: 'useItem', item: findItem(s, 'base:mag-backyard-survival')!.id });
    const ev = untilDone(s);
    const done = eventsOf(ev, 'leisureCompleted')[0]!;
    expect(done).toMatchObject({ activity: 'read', fatigue: leisure.read.fatigueRest });
    expect(done.boredom).toBeCloseTo(
      leisure.read.boredomReduction + lit.literature.boredomReduction,
      1,
    );
    expect(done.stress).toBeCloseTo(
      leisure.read.stressReduction + lit.literature.stressReduction,
      1,
    );
    // Net over the 30 game minutes (needs keep ticking a little).
    expect(before.fatigue - stats(s).fatigue).toBeGreaterThan(leisure.read.fatigueRest - 2);
    expect(before.boredom - stats(s).boredom).toBeGreaterThan(leisure.read.boredomReduction);
  });
});

describe('leisure: TV', () => {
  it('watchTv: no TV → no-station; no power → no-power', () => {
    const none = sim({ tv: false });
    send(none, { type: 'watchTv' });
    none.step();
    expect(rejectedReasons(none)).toEqual(['no-station']);
    const off = sim();
    off.world.items!.powered = false;
    send(off, { type: 'watchTv' });
    off.step();
    expect(rejectedReasons(off)).toEqual(['no-power']);
  });

  it('a TV session (leisure.tv.sessionMin) rests fatigue, boredom and stress', () => {
    const s = sim();
    setStats(s, { fatigue: 50, boredom: 60, stress: 40 });
    s.step();
    send(s, { type: 'watchTv' });
    const t0 = s.tick;
    const ev = untilDone(s);
    expect(eventsOf(ev, 'actionStarted')[0]).toMatchObject({ action: 'watch' });
    expect(s.tick - t0).toBeGreaterThanOrEqual(leisure.tv.sessionMin * 50);
    expect(eventsOf(ev, 'leisureCompleted')).toEqual([
      expect.objectContaining({
        activity: 'tv',
        fatigue: leisure.tv.fatigueRest,
        boredom: leisure.tv.boredomReduction,
        stress: leisure.tv.stressReduction,
      }),
    ]);
  });

  it('moving away interrupts the session (no effect)', () => {
    const s = sim();
    send(s, { type: 'watchTv' });
    for (let i = 0; i < 10; i++) s.step();
    send(s, { type: 'move', dx: 1, dy: 0 });
    const ev = untilDone(s);
    expect(eventsOf(ev, 'actionInterrupted').map((e) => e.reason)).toEqual(['moved']);
    expect(eventsOf(ev, 'leisureCompleted')).toEqual([]);
  });
});

describe('leisure: VHS', () => {
  const TAPE = 'base:vhs-strength-training';
  const tape = content.items[TAPE]!;
  if (tape.kind !== 'vhs') throw new Error('fixture');

  it('30 s on a powered TV: XP in the tape skills once per character, remembered in saves', () => {
    const s = sim();
    setStats(s, { fatigue: 50, boredom: 60, stress: 40 });
    send(s, { type: 'debugGiveItem', itemId: TAPE });
    s.step();
    const before = tape.vhs.skills.map((k) => skillXp(s, k.skill));
    const id = findItem(s, TAPE)!.id;
    send(s, { type: 'useItem', item: id });
    const t0 = s.tick;
    const ev = untilDone(s);
    // 30 real seconds at ×1 = 600 ticks.
    expect(s.tick - t0).toBeGreaterThanOrEqual(tape.vhs.watchSec * 20);
    expect(s.tick - t0).toBeLessThan(tape.vhs.watchSec * 20 * 2);
    expect(eventsOf(ev, 'vhsWatched')).toEqual([
      expect.objectContaining({
        vhs: TAPE,
        repeat: false,
        xp: tape.vhs.skills.map((k) => ({ skill: k.skill, xp: k.xp })),
      }),
    ]);
    expect(eventsOf(ev, 'leisureCompleted')[0]).toMatchObject({
      activity: 'vhs',
      fatigue: leisure.vhs.fatigueRest,
    });
    const after = tape.vhs.skills.map((k) => skillXp(s, k.skill));
    after.forEach((a, i) =>
      expect(a.level * 10000 + a.xp).toBeGreaterThan(before[i]!.level * 10000 + before[i]!.xp),
    );

    // Second time (also after save / load): leisure only, no XP.
    const copy = sim({ load: s.save() });
    expect(copy.hash()).toBe(s.hash());
    send(copy, { type: 'watchTv', vhs: id });
    const ev2 = untilDone(copy);
    expect(eventsOf(ev2, 'vhsWatched')).toEqual([
      expect.objectContaining({ vhs: TAPE, repeat: true, xp: [] }),
    ]);
    expect(eventsOf(ev2, 'leisureCompleted')).toHaveLength(1);
    expect(tape.vhs.skills.map((k) => skillXp(copy, k.skill))).toEqual(after);
  });

  it('a tape needs a TV; a non-tape item is rejected', () => {
    const s = sim({ tv: false });
    send(s, { type: 'debugGiveItem', itemId: TAPE });
    send(s, { type: 'debugGiveItem', itemId: 'base:mag-backyard-survival' });
    s.step();
    send(s, { type: 'useItem', item: findItem(s, TAPE)!.id });
    send(s, { type: 'watchTv', vhs: findItem(s, 'base:mag-backyard-survival')!.id });
    s.step();
    expect(rejectedReasons(s)).toEqual(['no-station', 'no-item']);
  });

  it('deterministic: same commands → same hash; watching changes the hash', () => {
    const run = (watch: boolean) => {
      const s = sim();
      // Own seq numbers (the shared `send` counter is part of the queue state).
      s.enqueue({ type: 'debugGiveItem', itemId: TAPE, tick: 0, playerId: 0, seq: 1 });
      s.step();
      const item = findItem(s, TAPE)!.id;
      if (watch) s.enqueue({ type: 'useItem', item, tick: s.tick, playerId: 0, seq: 2 });
      for (let i = 0; i < 1500; i++) s.step();
      return s.hash();
    };
    expect(run(true)).toBe(run(true));
    expect(run(true)).not.toBe(run(false));
  });
});
