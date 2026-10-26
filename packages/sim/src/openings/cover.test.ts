import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@deadzone/protocol';
import { createSim, type Sim } from '../sim.js';
import { baseContent } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { eventsOf, zombie } from '../test/ai-fixtures.js';
import { TileGrid } from '../world/grid.js';
import { lineOfSight } from '../world/los.js';
import { litWindows, setLight } from '../furniture/lighting.js';
import { switchKeyOf } from '../ai/state.js';
import { EF, openingKey } from './state.js';

/**
 * Window covers (protocol 47, docs 9.78). Room x 8..13, y 16..21 with a window in the north wall
 * at (10, 16) and a lamp + switch inside (as `furniture/lighting.test.ts`).
 */
const content = await (async () => {
  const base = await baseContent();
  return {
    ...base,
    items: {
      ...base.items,
      'test:light-switch': {
        id: 'test:light-switch',
        name: 'item.test.light-switch.name',
        kind: 'placeable',
        weightKg: 0.1,
        tags: ['base:light-switch'],
        placeable: {},
      },
    },
  } as unknown as typeof base;
})();
const inRoom = (x: number, y: number) => x >= 8 && x <= 13 && y >= 16 && y <= 21;
const WIN = { tx: 10, ty: 16, side: 'n' } as const;
const KEY = openingKey(0, 10, 16, 0);
const SWITCH = switchKeyOf(13, 21, 0);
const mapOf = (window = true) =>
  buildMap({
    width: 32,
    height: 32,
    wallN: (x, y) => x >= 8 && x <= 13 && (y === 16 || y === 22),
    wallW: (x, y) => y >= 16 && y <= 21 && (x === 8 || x === 14),
    edgeId: (x, y) => (window && x === 10 && y === 16 ? 2 : 1),
    edgeKinds: [null, 'wall', 'window'],
    room: (x, y) => (inRoom(x, y) ? 1 : 0),
    rooms: { '1': 'base:room-living' },
    roomBuildings: { '1': 1 },
    objects: [
      { contentId: 'base:ceiling-lamp', x: 10, y: 18 },
      { contentId: 'test:light-switch', x: 13, y: 21 },
    ],
  });

function sim(o: { hour?: number; zombies?: boolean; load?: Uint8Array; window?: boolean } = {}) {
  return createSim({
    seed: 7,
    map: mapOf(o.window ?? true),
    spawn: { x: 10.5, y: 16.8 },
    content,
    dev: true,
    clockStart: { day: 1, hour: o.hour ?? 12, minute: 0 },
    ...(o.zombies ? { spawnZombies: [{ x: 10.5, y: 3.5 }] } : {}),
    ...(o.load ? { load: o.load } : {}),
  });
}

function driver(s: Sim) {
  let seq = 0;
  const events: SimEvent[] = [];
  const cmd = (c: Record<string, unknown>) => {
    const r = s.enqueue({ ...c, tick: s.tick, playerId: 0, seq: seq++ } as never);
    if (!r.ok) throw new Error(`rejected ${r.reason}`);
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      s.step();
      events.push(...s.drainEvents());
    }
  };
  const take = () => events.splice(0);
  return { cmd, step, take };
}
const rejected = (ev: readonly SimEvent[]) => eventsOf(ev, 'commandRejected').map((e) => e.reason);
const itemsOf = (s: Sim, id: string) =>
  [...s.world.items!.items.values()].filter((i) => s.world.items!.content.items[i.def]!.id === id);
/** Gives `id` and returns its instance id. */
function give(s: Sim, d: ReturnType<typeof driver>, id: string): number {
  d.cmd({ type: 'debugGiveItem', itemId: id });
  d.step();
  d.take();
  return itemsOf(s, id)[0]!.id;
}
const CURTAIN_TICKS = 5 * 20;

describe('window covers (docs 9.78)', () => {
  it('coverWindow: timed, item leaves the inventory, view shows cover, sight blocked, movement not', () => {
    const s = sim();
    const d = driver(s);
    const item = give(s, d, 'base:curtain');
    const grid = new TileGrid(s.world.map, s.world.openings);
    d.cmd({ type: 'debugOpening', ...WIN, state: 'open' });
    d.step();
    expect(lineOfSight(grid, 0, 10.5, 17.5, 10.5, 13.5)).toBe(true);
    d.cmd({ type: 'coverWindow', ...WIN, item });
    d.step(CURTAIN_TICKS - 5);
    expect(s.world.openings.covers.size).toBe(0);
    d.step(10);
    const ev = d.take();
    expect(rejected(ev)).toEqual([]);
    expect(eventsOf(ev, 'actionCompleted')).toMatchObject([{ action: 'coverWindow' }]);
    expect(itemsOf(s, 'base:curtain')).toEqual([]);
    expect(s.world.openings.covers.get(KEY)).toEqual({
      item: 'base:curtain',
      lightPass: 0.15,
      blocksSight: true,
    });
    expect(s.drainView()?.openings).toContainEqual(
      expect.objectContaining({
        ...WIN,
        state: 'open',
        cover: { item: 'base:curtain', lightPass: 0.15, blocksSight: true },
      }),
    );
    expect(lineOfSight(grid, 0, 10.5, 17.5, 10.5, 13.5)).toBe(false);
    const f = grid.flagsN(10, 16, 0);
    expect(f & EF.blocksMove).toBe(0);
    expect(f & EF.blocksSight).toBe(0);
    // Closed: blocks movement as before, cover or not.
    d.cmd({ type: 'debugOpening', ...WIN, state: 'closed' });
    d.step();
    expect(grid.flagsN(10, 16, 0) & EF.blocksMove).not.toBe(0);
    expect(s.world.openings.covers.has(KEY)).toBe(true);
  });

  it('uncoverWindow puts the item back; second uncover rejected', () => {
    const s = sim();
    const d = driver(s);
    const item = give(s, d, 'base:curtain');
    d.cmd({ type: 'coverWindow', ...WIN, item });
    d.step(CURTAIN_TICKS + 5);
    d.cmd({ type: 'uncoverWindow', ...WIN });
    d.step(CURTAIN_TICKS + 5);
    let ev = d.take();
    expect(eventsOf(ev, 'actionCompleted').map((e) => e.action)).toEqual([
      'coverWindow',
      'uncoverWindow',
    ]);
    expect(s.world.openings.covers.size).toBe(0);
    expect(itemsOf(s, 'base:curtain')).toHaveLength(1);
    const grid = new TileGrid(s.world.map, s.world.openings);
    d.cmd({ type: 'uncoverWindow', ...WIN });
    d.step();
    ev = d.take();
    expect(rejected(ev)).toEqual(['invalid-state']);
    expect(grid.flagsN(10, 16, 0) & EF.covered).toBe(0);
  });

  it('rejects: not a cover item, a wall, already covered, out of reach', () => {
    const s = sim();
    const d = driver(s);
    const nails = give(s, d, 'base:nails');
    const tarp = give(s, d, 'base:tarp');
    const curtain = give(s, d, 'base:curtain');
    d.cmd({ type: 'coverWindow', ...WIN, item: nails });
    d.cmd({ type: 'coverWindow', tx: 11, ty: 16, side: 'n', item: tarp });
    d.step();
    expect(rejected(d.take())).toEqual(['invalid-target', 'invalid-target']);
    d.cmd({ type: 'coverWindow', ...WIN, item: tarp });
    d.step(20 * 20 + 5);
    d.cmd({ type: 'coverWindow', ...WIN, item: curtain });
    d.step();
    expect(rejected(d.take())).toEqual(['invalid-state']);
    expect(itemsOf(s, 'base:curtain')).toHaveLength(1);
    // Far away.
    const far = sim();
    const fd = driver(far);
    const c2 = give(far, fd, 'base:curtain');
    far.world.c.Position.y[far.world.players.get(0)!] = 20.5;
    fd.cmd({ type: 'coverWindow', ...WIN, item: c2 });
    fd.step();
    expect(rejected(fd.take())).toEqual(['out-of-range']);
  });

  it('a broken window can be covered too (sight blocked, still passable)', () => {
    const s = sim();
    const d = driver(s);
    const item = give(s, d, 'base:curtain');
    d.cmd({ type: 'debugOpening', ...WIN, state: 'broken' });
    d.cmd({ type: 'coverWindow', ...WIN, item });
    d.step(CURTAIN_TICKS + 5);
    expect(rejected(d.take())).toEqual([]);
    const grid = new TileGrid(s.world.map, s.world.openings);
    expect(grid.flagsN(10, 16, 0) & EF.blocksMove).toBe(0);
    expect(lineOfSight(grid, 0, 10.5, 17.5, 10.5, 13.5)).toBe(false);
  });

  it('save / load keeps the cover; a window gone from the rebuilt map is dropped', () => {
    const s = sim();
    const d = driver(s);
    const item = give(s, d, 'base:curtain');
    d.cmd({ type: 'debugOpening', ...WIN, state: 'open' });
    d.cmd({ type: 'coverWindow', ...WIN, item });
    d.step(CURTAIN_TICKS + 5);
    const bytes = s.save();
    const back = sim({ load: bytes });
    expect(back.world.openings.covers.get(KEY)).toMatchObject({ item: 'base:curtain' });
    expect(back.hash()).toBe(s.hash());
    const rebuilt = sim({ load: bytes, window: false });
    expect(rebuilt.world.openings.covers.size).toBe(0);
    expect(rebuilt.world.openings.states.has(KEY)).toBe(false);
  });

  it('at night a covered window with lightPass 0 does not lure; a partial one lures weaker', () => {
    const lit = sim({ hour: 23, zombies: true });
    setLight(lit.world, SWITCH, true);
    lit.world.openings.covers.set(KEY, { item: 'base:tarp', lightPass: 0, blocksSight: true });
    expect(litWindows(lit.world)).toEqual([]);
    for (let i = 0; i < 100; i++) lit.step();
    expect(zombie(lit).state).not.toBe('investigate');

    const half = sim({ hour: 23 });
    setLight(half.world, SWITCH, true);
    half.world.openings.covers.set(KEY, {
      item: 'base:curtain',
      lightPass: 0.5,
      blocksSight: true,
    });
    expect(litWindows(half.world)).toMatchObject([{ key: KEY, pass: 0.5 }]);
  });
});
