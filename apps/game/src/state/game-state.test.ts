import type { ContainerView, SimEvent, SimViewPatch } from '@deadzone/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  GameStateStore,
  INITIAL_GAME_STATE,
  MAX_RECENT_EVENTS,
  connectSimState,
  reduceGameState,
  type GameAction,
  type SimStateSource,
} from './game-state.js';
import { describeEvent, devItemsLine, devStateLine, formatClock } from './format.js';

const clock = {
  day: 1,
  minuteOfDay: 540,
  ticksPerGameMinute: 50,
  minuteStartTick: 0,
  fastForwardBlocked: false,
};
const view = (v: SimViewPatch, tick = 1): GameAction => ({ type: 'view', view: v, tick });
const events = (e: SimEvent[], tick = 1): GameAction => ({ type: 'events', events: e, tick });
const run = (...actions: GameAction[]) => actions.reduce(reduceGameState, INITIAL_GAME_STATE);

describe('reduceGameState: view', () => {
  it('first full view sets clock, stats and running status', () => {
    const s = run(
      view({
        clock,
        player: {
          alive: true,
          sleeping: false,
          stats: { health: 100, hunger: 5 },
          moodles: [],
          wounds: [],
        },
      }),
    );
    expect(s.status).toBe('running');
    expect(s.clock).toEqual(clock);
    expect(s.player.stats).toEqual({ health: 100, hunger: 5 });
  });

  it('merges stat deltas and keeps missing fields unchanged', () => {
    const s = run(
      view({ clock, player: { stats: { health: 100, hunger: 5 } } }),
      view({ player: { stats: { hunger: 6.1 } } }, 5),
    );
    expect(s.player.stats).toEqual({ health: 100, hunger: 6.1 });
    expect(s.clock).toEqual(clock);
    expect(s.tick).toBe(5);
  });

  it('adds, updates and removes moodles (level 0 = hidden)', () => {
    const s1 = run(
      view({
        player: {
          moodles: [
            { id: 'base:hungry', level: 1 },
            { id: 'base:tired', level: 2 },
          ],
        },
      }),
    );
    const s2 = reduceGameState(
      s1,
      view({
        player: {
          moodles: [
            { id: 'base:hungry', level: 2 },
            { id: 'base:tired', level: 0 },
          ],
        },
      }),
    );
    expect(s2.player.moodles).toEqual({ 'base:hungry': 2 });
    expect(s1.player.moodles).toEqual({ 'base:hungry': 1, 'base:tired': 2 }); // immutable
  });

  it('replaces the wound list when sent', () => {
    const wound = {
      part: 'hand_l',
      wound: 'scratch',
      bleeding: 3,
      healed: 0,
      bandaged: false,
      bandageDirty: false,
      infected: false,
    } as const;
    const s = run(view({ player: { wounds: [wound] } }), view({ player: { stats: { pain: 4 } } }));
    expect(s.player.wounds).toEqual([wound]);
    expect(
      run(view({ player: { wounds: [wound] } }), view({ player: { wounds: [] } })).player.wounds,
    ).toEqual([]);
  });
});

describe('reduceGameState: items (v4 view)', () => {
  const inv = (c: ContainerView[] = [], removed: number[] = []) => ({
    container: 2,
    loadKg: 1,
    capacityKg: 12,
    hardLimitKg: 18,
    carryLoad: 8.3,
    equipped: {},
    containers: c,
    ...(removed.length ? { removed } : {}),
  });
  const box = (id: number, kind: ContainerView['kind'], n = 0): ContainerView => ({
    id,
    kind,
    capacityKg: null,
    weightKg: n,
    items: Array.from({ length: n }, (_, i) => ({
      id: 100 + i,
      def: 'base:brick',
      count: 1,
      weightKg: 1,
    })),
  });

  it('merges inventory containers by id and drops removed ones', () => {
    let s = run(view({ inventory: inv([box(2, 'inventory', 1), box(5, 'bag', 2)]) }));
    expect(Object.keys(s.inventory!.containers)).toEqual(['2', '5']);
    const bag = s.inventory!.containers[5];
    s = reduceGameState(s, view({ inventory: { ...inv([box(2, 'inventory', 3)]), loadKg: 4 } }));
    expect(s.inventory!.loadKg).toBe(4);
    expect(s.inventory!.containers[2]!.items).toHaveLength(3);
    expect(s.inventory!.containers[5]).toBe(bag);
    s = reduceGameState(s, view({ inventory: inv([], [5]) }));
    expect(Object.keys(s.inventory!.containers)).toEqual(['2']);
    // Missing inventory keeps the previous state.
    expect(reduceGameState(s, view({ clock })).inventory).toBe(s.inventory);
  });

  it('replaces nearby, opens/closes the container and sets/clears the action', () => {
    const near = {
      id: 1,
      kind: 'world' as const,
      type: 'base:crate',
      x: -62,
      y: 1,
      z: 0,
      searched: false,
    };
    let s = run(view({ nearby: [near] }));
    expect(s.nearby).toEqual([near]);
    s = reduceGameState(s, view({ clock }));
    expect(s.nearby).toEqual([near]);
    s = reduceGameState(
      s,
      view({ action: { kind: 'search', startTick: 10, endTick: 110, container: 1, queued: 0 } }),
    );
    expect(s.action?.kind).toBe('search');
    s = reduceGameState(s, view({ action: null, container: box(1, 'world', 2), nearby: [] }));
    expect(s.action).toBeUndefined();
    expect('action' in s).toBe(false);
    expect(s.container?.items).toHaveLength(2);
    expect(s.nearby).toEqual([]);
    s = reduceGameState(s, view({ container: null }));
    expect(s.container).toBeUndefined();
  });

  it('formats a compact items line', () => {
    expect(devItemsLine(INITIAL_GAME_STATE)).toBe('inv – · near 0');
    const s = run(
      view(
        {
          inventory: inv([box(2, 'inventory', 1)]),
          nearby: [
            { id: 1, kind: 'world', type: 'base:crate', x: 0, y: 0, z: 0, searched: true },
            { id: 3, kind: 'ground', x: 0, y: 0, z: 0, searched: false },
          ],
          container: { ...box(1, 'world', 2), type: 'base:crate' },
          action: { kind: 'search', startTick: 0, endTick: 100, queued: 1 },
        },
        40,
      ),
    );
    expect(devItemsLine(s)).toBe(
      'inv 1.0/12kg 1it · near 2 crate* ground · open crate 2it · search 40% +1',
    );
  });
});

describe('reduceGameState: events and errors', () => {
  it('tracks death, sleep and time scale hints', () => {
    const s = run(
      events([
        { type: 'fellAsleep', tick: 1, playerId: 0 },
        { type: 'timeScaleHint', tick: 1, speed: 4 },
      ]),
    );
    expect(s.player.sleeping).toBe(true);
    expect(s.timeScaleHint).toBe(4);
    const d = reduceGameState(
      s,
      events(
        [{ type: 'died', tick: 9, playerId: 0, cause: 'dehydration', day: 3, minuteOfDay: 75 }],
        9,
      ),
    );
    expect(d.player).toMatchObject({ alive: false, sleeping: false });
    expect(d.death).toEqual({ cause: 'dehydration', day: 3, minuteOfDay: 75, tick: 9 });
    const w = reduceGameState(
      s,
      events([{ type: 'wokeUp', tick: 2, playerId: 0, reason: 'rested' }]),
    );
    expect(w.player.sleeping).toBe(false);
  });

  it('keeps a bounded list of recent events and ignores empty batches', () => {
    const many = Array.from({ length: MAX_RECENT_EVENTS + 5 }, (_, i): SimEvent => ({
      type: 'dayPassed',
      tick: i,
      day: i,
    }));
    const s = run(events(many));
    expect(s.recentEvents).toHaveLength(MAX_RECENT_EVENTS);
    expect(s.recentEvents.at(-1)).toMatchObject({ day: MAX_RECENT_EVENTS + 4 });
    expect(reduceGameState(s, events([]))).toBe(s);
  });

  it('error is sticky', () => {
    const s = run({ type: 'error', message: 'content invalid' }, view({ clock }));
    expect(s.status).toBe('error');
    expect(s.error).toBe('content invalid');
  });
});

describe('GameStateStore', () => {
  it('notifies subscribers only on change and unsubscribes', () => {
    const store = new GameStateStore();
    const l = vi.fn();
    const off = store.subscribe(l);
    store.dispatch(events([]));
    expect(l).not.toHaveBeenCalled();
    store.dispatch(view({ clock }));
    expect(l).toHaveBeenCalledTimes(1);
    expect(store.get().clock).toEqual(clock);
    off();
    store.dispatch(view({ player: { stats: { health: 50 } } }));
    expect(l).toHaveBeenCalledTimes(1);
  });

  it('connectSimState forwards view, events and error', () => {
    type Cb = (...a: never[]) => void;
    const cbs: Record<string, Cb> = {};
    const reg = (k: string) => (cb: Cb) => {
      cbs[k] = cb;
      return () => delete cbs[k];
    };
    const src = {
      onView: reg('view'),
      onEvents: reg('events'),
      onError: reg('error'),
    } as unknown as SimStateSource;
    const store = new GameStateStore();
    const off = connectSimState(store, src);
    (cbs.view as (v: SimViewPatch, t: number) => void)({ clock }, 3);
    (cbs.events as (e: SimEvent[], t: number) => void)([{ type: 'dayPassed', tick: 4, day: 2 }], 4);
    (cbs.error as (m: string) => void)('boom');
    expect(store.get()).toMatchObject({ status: 'error', error: 'boom', tick: 4, clock });
    off();
    expect(Object.keys(cbs)).toEqual([]);
  });
});

describe('format', () => {
  it('formats clock, events and the dev line', () => {
    expect(formatClock(2, 65)).toBe('D2 01:05');
    expect(
      describeEvent({
        type: 'moodleChanged',
        tick: 1,
        playerId: 0,
        moodle: 'base:hungry',
        from: 0,
        to: 1,
      }),
    ).toBe('moodle base:hungry 0→1');
    expect(devStateLine(INITIAL_GAME_STATE)).toMatch(/survival: off/);
    const s = run(
      view({
        clock,
        player: { stats: { health: 99.6 }, moodles: [{ id: 'base:hungry', level: 1 }] },
      }),
    );
    expect(devStateLine(s)).toMatch(/D1 09:00 · hp 100/);
    expect(devStateLine(s)).toMatch(/hungry1/);
    expect(devStateLine(run({ type: 'error', message: 'x' }))).toBe('sim error: x');
  });
});

describe('sleep view', () => {
  const sleep = {
    sleeping: true as const,
    sleepStartTick: 10,
    surface: 'bed' as const,
    restCap: 50,
    restGained: 1,
    realSec: 3,
    saveAfterRealSec: 120,
    saveReady: false,
  };
  it('keeps player.sleep until null or wokeUp / died', () => {
    const asleep = run(view({ player: { sleeping: true, sleep } }));
    expect(asleep.player.sleep).toEqual(sleep);
    expect(
      run(view({ player: { sleeping: true, sleep } }), view({ player: { stats: { fatigue: 40 } } }))
        .player.sleep,
    ).toEqual(sleep);
    expect(
      run(view({ player: { sleep } }), view({ player: { sleep: null } })).player.sleep,
    ).toBeUndefined();
    const woke = run(view({ player: { sleeping: true, sleep } }), {
      type: 'events',
      tick: 2,
      events: [{ type: 'wokeUp', tick: 2, playerId: 0, reason: 'noise' }],
    });
    expect(woke.player).toMatchObject({ sleeping: false });
    expect(woke.player.sleep).toBeUndefined();
  });
});
