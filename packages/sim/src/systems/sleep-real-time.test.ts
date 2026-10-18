import type { SimEvent, SimViewPatch } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { aiSim, eventsOf, runTicks } from '../test/ai-fixtures.js';
import { fixtureContent, runMinutes, send, survivalSim } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';

const content = fixtureContent();
const cfg = content.worldSettings.survival.sleep;
/** 2 real minutes at ×1 = 2400 ticks (20 Hz), independent of the day length. */
const saveTicksX1 = cfg.saveAfterRealSec * 20;

const asleep = (sim: Sim, fatigue = 90) => {
  send(sim, { type: 'debugStat', stat: 'fatigue', value: fatigue });
  send(sim, { type: 'sleep' });
};

/** Steps `n` ticks and returns the ticks of `sleepSaved` events. */
function savedTicks(sim: Sim, n: number, all: SimEvent[] = []): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    const ev = sim.drainEvents();
    all.push(...ev);
    for (const e of eventsOf(ev, 'sleepSaved')) out.push(e.tick);
  }
  return out;
}

describe('sleep: commands and waking', () => {
  it('a zombie within wakeOnZombieTiles blocks falling asleep', () => {
    const sim = aiSim({ zombies: [{ x: 10.5 + cfg.wakeOnZombieTiles - 1, y: 10.5 }] });
    runTicks(sim, 2);
    sim.drainEvents();
    asleep(sim);
    runTicks(sim, 1);
    const ev = sim.drainEvents();
    expect(eventsOf(ev, 'commandRejected').map((e) => e.reason)).toEqual(['threat']);
    expect(eventsOf(ev, 'fellAsleep')).toEqual([]);
    expect(sim.getSurvival()!.sleeping).toBe(false);
  });

  it('pain ≥ wakeOnPainAbove wakes up (reason pain), partial rest is kept', () => {
    const sim = survivalSim(content);
    asleep(sim);
    runMinutes(sim, 20);
    // Pain is derived from wounds; set it directly for the test.
    sim.world.survival!.vitals.pain[sim.world.players.get(0)!] = cfg.wakeOnPainAbove + 5;
    runTicks(sim, 2);
    const woke = eventsOf(sim.drainEvents(), 'wokeUp');
    expect(woke).toHaveLength(1);
    expect(woke[0]).toMatchObject({ reason: 'pain', saved: false });
    expect(woke[0]!.restGained).toBeCloseTo(20 * cfg.surfaces.floor.fatigueRecoveryPerMin, 1);
  });
});

describe('sleep: save after 2 real minutes (timeScale)', () => {
  it('×1: sleepSaved once after saveAfterRealSec × 20 ticks, with realSec', () => {
    const sim = survivalSim(content);
    asleep(sim);
    const all: SimEvent[] = [];
    expect(savedTicks(sim, saveTicksX1 + 100, all)).toEqual([saveTicksX1 - 1]);
    expect(eventsOf(all, 'sleepSaved')[0]).toMatchObject({ realSec: cfg.saveAfterRealSec });
  });

  it('×2 / ×4: the same real time needs 2× / 4× more ticks', () => {
    for (const speed of [2, 4] as const) {
      const sim = survivalSim(content);
      send(sim, { type: 'setTimeScale', speed });
      asleep(sim);
      const n = saveTicksX1 * speed;
      expect(savedTicks(sim, n - 1)).toEqual([]);
      expect(savedTicks(sim, 2)).toEqual([n - 1]);
      expect(sim.timeScale()).toBe(speed);
    }
  });

  it('speed changes during sleep are summed in real time (60 s at ×1 + 60 s at ×4)', () => {
    const sim = survivalSim(content);
    asleep(sim);
    expect(savedTicks(sim, saveTicksX1 / 2)).toEqual([]);
    send(sim, { type: 'setTimeScale', speed: 4 });
    expect(savedTicks(sim, saveTicksX1 * 2 - 1)).toEqual([]);
    expect(savedTicks(sim, 1)).toHaveLength(1);
  });

  it('interrupted sleep: no save, rest proportional to the minutes slept', () => {
    const sim = survivalSim(content);
    asleep(sim);
    const all: SimEvent[] = [];
    expect(savedTicks(sim, saveTicksX1 - 50, all)).toEqual([]);
    send(sim, { type: 'wake' });
    savedTicks(sim, 1, all);
    const woke = eventsOf(all, 'wokeUp')[0]!;
    const minutes = Math.floor((saveTicksX1 - 50) / 50);
    expect(woke.saved).toBe(false);
    const rate = cfg.surfaces.floor.fatigueRecoveryPerMin;
    expect(Math.abs(woke.restGained! - minutes * rate)).toBeLessThanOrEqual(rate + 0.05);
    // A new sleep starts counting from zero.
    asleep(sim);
    expect(savedTicks(sim, saveTicksX1 - 1)).toEqual([]);
  });

  it('a threat resets the time scale to ×1 (like the worker speed lock)', () => {
    const sim = aiSim({});
    send(sim, { type: 'setTimeScale', speed: 4 });
    runTicks(sim, 1);
    expect(sim.timeScale()).toBe(4);
    send(sim, { type: 'debugSpawnZombie', x: 12.5, y: 10.5 });
    runTicks(sim, 3);
    expect(sim.fastForwardBlocked()).toBe(true);
    expect(sim.timeScale()).toBe(1);
    expect(sim.drainView()?.clock?.timeScale).toBe(1);
  });

  it('real sleep time and time scale survive save / load (same hash)', () => {
    const sim = survivalSim(content);
    send(sim, { type: 'setTimeScale', speed: 2 });
    asleep(sim);
    runTicks(sim, 1000);
    const copy = createSim({
      seed: 7,
      map: buildMap(),
      spawn: { x: 10.5, y: 10.5 },
      content,
      dev: true,
      load: sim.save(),
    });
    expect(copy.hash()).toBe(sim.hash());
    expect(copy.timeScale()).toBe(2);
    const n = saveTicksX1 * 2 - 1000;
    expect(savedTicks(copy, n)).toEqual(savedTicks(sim, n));
    expect(copy.hash()).toBe(sim.hash());
  });
});

describe('sleep: view', () => {
  const patches = (sim: Sim, n: number): SimViewPatch[] => {
    const out: SimViewPatch[] = [];
    for (let i = 0; i < n; i++) {
      sim.step();
      const v = sim.drainView();
      if (v) out.push(v);
    }
    return out;
  };

  it('player.sleep: sleepStartTick, surface, restCap, restGained, realSec, saveReady; null on wake', () => {
    const sim = survivalSim(content, {
      map: buildMap({ objects: [{ contentId: 'fixture:bed', x: 11, y: 10 }] }),
    });
    patches(sim, 5);
    const start = sim.tick;
    asleep(sim);
    const first = patches(sim, 1)[0]!.player!;
    expect(first.sleeping).toBe(true);
    expect(first.sleep).toEqual({
      sleeping: true,
      sleepStartTick: start,
      surface: 'bed',
      restCap: cfg.surfaces.bed.maxRecoveryPerSleep,
      restGained: 0,
      realSec: 0,
      saveAfterRealSec: cfg.saveAfterRealSec,
      saveReady: false,
    });
    const later = patches(sim, saveTicksX1).flatMap((p) =>
      p.player?.sleep ? [p.player.sleep] : [],
    );
    const last = later.at(-1)!;
    expect(last.sleepStartTick).toBe(start);
    expect(last.saveReady).toBe(true);
    expect(last.realSec).toBe(cfg.saveAfterRealSec);
    expect(last.restGained).toBeCloseTo(48 * cfg.surfaces.bed.fatigueRecoveryPerMin, 1);
    send(sim, { type: 'wake' });
    const woke = patches(sim, 1)[0]!.player!;
    expect(woke.sleeping).toBe(false);
    expect(woke.sleep).toBeNull();
    const ev = eventsOf(sim.drainEvents(), 'wokeUp')[0]!;
    expect(ev).toMatchObject({ reason: 'command', restCap: 50, saved: true });
  });

  it('a fresh view while awake sends no sleep field', () => {
    const sim = survivalSim(content);
    sim.step();
    expect(sim.drainView()!.player!.sleep).toBeUndefined();
  });
});

describe('setTimeScale is seq-exempt (worker client seq behind the game stamper)', () => {
  /** Game-stamped commands (seq 500+), then the worker client's setTimeScale with seq 0. */
  const scripted = (sim: Sim) => {
    const at = { tick: sim.tick, playerId: 0 } as const;
    const ok = (r: { ok: boolean }) => expect(r.ok).toBe(true);
    ok(sim.enqueue({ ...at, seq: 500, type: 'debugStat', stat: 'fatigue', value: 90 }));
    ok(sim.enqueue({ ...at, seq: 501, type: 'sleep' }));
    ok(sim.enqueue({ ...at, seq: 0, type: 'setTimeScale', speed: 4 }));
    ok(sim.enqueue({ ...at, seq: 502, type: 'debugStat', stat: 'hunger', value: 10 }));
  };

  it('applies, replays to the same hash and survives save / load', () => {
    const a = survivalSim(content);
    const b = survivalSim(content);
    scripted(a);
    scripted(b);
    for (let i = 0; i < 50; i++) {
      a.step();
      b.step();
    }
    expect(a.timeScale()).toBe(4);
    expect(eventsOf(a.drainEvents(), 'commandRejected')).toEqual([]);
    expect(a.hash()).toBe(b.hash());
    const loaded = createSim({ seed: 7, map: buildMap(), content, dev: true, load: a.save() });
    expect(loaded.hash()).toBe(a.hash());
    expect(loaded.timeScale()).toBe(4);
    // 2 real minutes at ×4 = 9600 ticks asleep (the bug saved after 2400 like ×1).
    expect(savedTicks(a, cfg.saveAfterRealSec * 20 * 4 - 52)).toEqual([]);
    expect(savedTicks(a, 4)).toHaveLength(1);
  });
});
