import { buildContentBundle, type ContentBundle } from '@deadzone/content';
import {
  CHUNK_SIZE,
  FURNITURE_REASONS,
  tileIndex,
  type FurnitureView,
  type SimEdgeKind,
  type SimEvent,
} from '@deadzone/protocol';
import { FURNITURE_REASONS_PL } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT_CONFIG } from '../combat/config.js';
import { createSim, type Sim, type SimOptions } from '../sim.js';
import { eventsOf, NOON } from '../test/ai-fixtures.js';
import { fixturePack } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { openingKey, OS } from '../openings/state.js';
import { TileGrid } from '../world/grid.js';
import { furnitureActionsView, objectFurnitureId, unpackObjectId } from './menu.js';

/**
 * House x/y ∈ [20, 30) (room 1, building 77) with a door at the west wall (20, 25) and a
 * window at (20, 22); a cabinet (with a building-key loot table) and an icebox inside.
 */
const spec = {
  wallW: (x: number, y: number) => (x === 20 || x === 30) && y >= 20 && y < 30,
  wallN: (x: number, y: number) => (y === 20 || y === 30) && x >= 20 && x < 30,
  edgeId: (x: number, y: number) => (x === 20 && y === 25 ? 2 : x === 20 && y === 22 ? 3 : 1),
  edgeKinds: [null, 'wall', 'door', 'window'] as (SimEdgeKind | null)[],
  room: (x: number, y: number) => (x >= 20 && x < 30 && y >= 20 && y < 30 ? 1 : 0),
  rooms: { '1': 'fixture:room-kitchen' },
  roomBuildings: { '1': 77 },
  objects: [
    { contentId: 'fixture:cabinet', x: 21, y: 26 },
    { contentId: 'fixture:icebox', x: 21, y: 21 },
  ],
};
const DOOR = openingKey(1, 20, 25, 0);
const WINDOW = openingKey(1, 20, 22, 0);
const OUTSIDE = { x: 19.4, y: 25.5 };
const INSIDE = { x: 20.6, y: 25.5 };

function content(openings: Record<string, unknown> = {}): ContentBundle {
  const pack = fixturePack({
    openings: {
      force: { strengthSkill: 'fixture:strength' },
      ...openings,
      locks: {
        lockpick: { skill: 'fixture:strength' },
        ...(openings.locks as object | undefined),
      },
    },
  });
  const xp = [50, 110, 190, 300, 440, 610, 820, 1070, 1360, 1700];
  return buildContentBundle([
    {
      ...pack,
      files: [
        ...pack.files.map((f) =>
          f.path === 'loot-tables/fixture.json' && 'json' in f
            ? {
                ...f,
                json: (f.json as { id: string }[]).map((t) =>
                  t.id === 'fixture:kitchen' ? { ...t, buildingKey: 1 } : t,
                ),
              }
            : f,
        ),
        {
          path: 'items/locks.json',
          json: [
            {
              id: 'fixture:key',
              name: 'item.fixture.key',
              kind: 'misc',
              weightKg: 0.01,
              tags: ['base:building-key'],
            },
            {
              id: 'fixture:hairpin',
              name: 'item.fixture.hairpin',
              kind: 'misc',
              weightKg: 0.01,
              tags: ['base:lockpick'],
            },
            {
              id: 'fixture:gloves',
              name: 'item.fixture.gloves',
              kind: 'misc',
              weightKg: 0.1,
              tags: ['base:gloves'],
            },
          ],
        },
        {
          path: 'skills/strength.json',
          json: [{ id: 'fixture:strength', name: 'skill.s', group: 'movement', xpPerLevel: xp }],
        },
      ],
    },
  ]);
}

function sim(
  spawn: { x: number; y: number },
  openings: Record<string, unknown> = {},
  rest: Partial<SimOptions> = {},
): Sim {
  return createSim({
    seed: 9,
    map: buildMap(spec),
    spawn,
    content: content(openings),
    dev: true,
    clockStart: NOON,
    combatConfig: {
      ...DEFAULT_COMBAT_CONFIG,
      zombie: { ...DEFAULT_COMBAT_CONFIG.zombie, hitChance: 0 },
    },
    ...rest,
  });
}

function driver(s: Sim) {
  let seq = 0;
  const events: SimEvent[] = [];
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      s.step();
      events.push(...s.drainEvents());
    }
  };
  const cmd = (c: Record<string, unknown>) => {
    const r = s.enqueue({ ...c, tick: s.tick, playerId: 0, seq: seq++ } as never);
    if (!r.ok) throw new Error(`rejected ${r.reason}`);
    step();
  };
  const use = (furnitureId: number, actionId: string) =>
    cmd({ type: 'useFurniture', furnitureId, actionId });
  const give = (itemId: string) => cmd({ type: 'debugGiveItem', itemId });
  const grid = new TileGrid(s.world.openings.map, s.world.openings);
  const menu = (): FurnitureView[] => furnitureActionsView(s.world, grid, s.world.players.get(0)!);
  const entry = (id: number) => menu().find((f) => f.furnitureId === id);
  const act = (id: number, action: string) => entry(id)?.actions.find((a) => a.id === action);
  return { step, cmd, use, give, entry, act, events, take: () => events.splice(0) };
}

const item = (s: Sim, def: string) =>
  [...s.world.items!.items.values()].find((i) => s.world.items!.content.items[i.def]!.id === def);
const doorState = (s: Sim) =>
  s.world.openings.states.get(DOOR)?.state ??
  (s.world.openings.lockCache.get(DOOR) ? OS.locked : OS.closed);

describe('furniture menu (useFurniture): doors', () => {
  it('lists the door with stable ids and position; open / close through useFurniture', () => {
    const s = sim(INSIDE);
    const d = driver(s);
    d.step(4);
    expect(s.drainView()?.furnitureActions?.some((f) => f.furnitureId === DOOR)).toBe(true);
    const door = d.entry(DOOR)!;
    expect(door).toMatchObject({ typeId: 'door', x: 20, y: 25.5, z: 0 });
    expect(door.actions.map((a) => a.id)).toEqual(['open', 'lock', 'knock', 'barricade']);
    expect(door.actions[0]).toMatchObject({ labelPl: 'Otwórz', enabled: true });
    expect(door.actions[3]).toMatchObject({
      enabled: false,
      reason: 'missing-tool',
      reasonPl: 'Brak młotka',
    });
    d.use(DOOR, 'open');
    expect(doorState(s)).toBe(OS.open);
    expect(d.entry(DOOR)!.actions[0]!.id).toBe('close');
  });

  it('exterior doors locked at the start (seeded, not stored); outside needs a key / force', () => {
    const s = sim(OUTSIDE, { locks: { exteriorLockedChance: 1 } });
    const d = driver(s);
    expect(s.world.openings.states.size).toBe(0);
    const acts = d.entry(DOOR)!.actions;
    expect(acts.map((a) => a.id)).toEqual([
      'open',
      'unlock-key',
      'lockpick',
      'force-pry',
      'force-kick',
      'knock',
      'barricade',
    ]);
    expect(acts[0]).toMatchObject({
      enabled: false,
      reason: 'locked',
      reasonPl: 'Zamknięte na klucz',
    });
    expect(acts[1]).toMatchObject({ enabled: false, reason: 'no-key' });
    expect(acts[2]).toMatchObject({ enabled: false, reason: 'missing-item', chancePct: 25 });
    expect(acts[3]).toMatchObject({ reason: 'missing-tool', reasonPl: 'Brak łomu', chancePct: 40 });
    expect(acts[4]).toMatchObject({
      enabled: true,
      chancePct: 15,
      noiseTiles: 16,
      durationSec: 4,
    });
    d.use(DOOR, 'open');
    expect(eventsOf(d.take(), 'commandRejected').map((e) => e.reason)).toEqual(['locked']);
  });

  it('SimChunk.lockedDoors overrides the seeded roll (tileIndex * 2 + side)', () => {
    const map = buildMap(spec);
    const cx = Math.floor(20 / CHUNK_SIZE);
    const cy = Math.floor(25 / CHUNK_SIZE);
    const chunk = map.getChunk(cx, cy, 0) as unknown as { lockedDoors?: number[] };
    chunk.lockedDoors = [tileIndex(20 - cx * CHUNK_SIZE, 25 - cy * CHUNK_SIZE) * 2 + 1];
    const s = sim(OUTSIDE, {}, { map });
    expect(driver(s).act(DOOR, 'open')).toMatchObject({ enabled: false, reason: 'locked' });
    chunk.lockedDoors = [];
    const t = sim(OUTSIDE, { locks: { exteriorLockedChance: 1 } }, { map });
    expect(driver(t).act(DOOR, 'open')).toMatchObject({ enabled: true });
  });

  it('inside: the lock turns without a key; the change is saved (load keeps it)', () => {
    const s = sim(INSIDE, { locks: { exteriorLockedChance: 1 } });
    const d = driver(s);
    expect(d.act(DOOR, 'unlock')).toMatchObject({ enabled: true });
    d.use(DOOR, 'unlock');
    expect(s.world.openings.states.get(DOOR)?.state).toBe(OS.closed);
    const back = sim(INSIDE, { locks: { exteriorLockedChance: 1 } }, { load: s.save() });
    expect(back.world.openings.states.get(DOOR)?.state).toBe(OS.closed);
    expect(back.hash()).toBe(s.hash());
    d.use(DOOR, 'lock');
    expect(s.world.openings.states.has(DOOR)).toBe(false);
  });

  it('a key to this building (loot `buildingKey` → buildingId) unlocks from outside', () => {
    const s = sim(OUTSIDE, { locks: { exteriorLockedChance: 1 } });
    const d = driver(s);
    // The cabinet's table has buildingKey 1: its key is for building 77.
    const st = s.world.items!;
    const cab = [...st.containers.values()].find(
      (c) => c.kind === 'world' && c.x === 21 && c.y === 26,
    )!;
    s.world.c.Position.x[s.world.players.get(0)!] = 21.5;
    s.world.c.Position.y[s.world.players.get(0)!] = 25.5;
    d.cmd({ type: 'search', container: cab.id });
    d.step(200);
    const key = item(s, 'fixture:key')!;
    expect(key.buildingId).toBe(77);
    expect(s.getContainer(cab.id)!.items.find((v) => v.id === key.id)?.buildingId).toBe(77);
    d.cmd({ type: 'pickUp', item: key.id });
    s.world.c.Position.x[s.world.players.get(0)!] = OUTSIDE.x;
    s.world.c.Position.y[s.world.players.get(0)!] = OUTSIDE.y;
    expect(d.act(DOOR, 'unlock-key')).toMatchObject({ enabled: true });
    d.use(DOOR, 'unlock-key');
    d.step(80);
    expect(s.world.openings.states.get(DOOR)?.state).toBe(OS.closed);
    expect(d.act(DOOR, 'lock-key')).toMatchObject({ enabled: true });
  });

  it('lockpick:<itemId>: chance, break risk, success unlocks; knock makes noise', () => {
    const s = sim(OUTSIDE, {
      locks: { exteriorLockedChance: 1, lockpick: { chance: 0.95, skill: 'fixture:strength' } },
    });
    const d = driver(s);
    d.give('fixture:hairpin');
    const pin = item(s, 'fixture:hairpin')!;
    const lp = d.act(DOOR, `lockpick:${pin.id}`)!;
    expect(lp).toMatchObject({
      enabled: true,
      chancePct: 95,
      item: { id: pin.id, def: 'fixture:hairpin' },
    });
    expect(lp.breakChancePct).toBe(2);
    expect(lp.durationMin).toBeGreaterThan(0);
    d.use(DOOR, 'knock');
    expect(eventsOf(d.take(), 'knocked')).toHaveLength(1);
    d.use(DOOR, `lockpick:${pin.id}`);
    d.step(400);
    const ev = eventsOf(d.take(), 'lockPicked');
    expect(ev).toHaveLength(1);
    if (ev[0]!.success) expect(s.world.openings.states.get(DOOR)?.state).toBe(OS.closed);
  });
});

describe('furniture menu: windows', () => {
  it('smash (noise, bare-hand injury), clear-glass without gloves cuts, climb-through risk', () => {
    const s = sim({ x: 19.4, y: 22.5 }, { window: { clearGlassCutChance: 1 } });
    const d = driver(s);
    const smash = d.act(WINDOW, 'smash')!;
    expect(smash).toMatchObject({ enabled: true, noiseTiles: 20, injuryChancePct: 50 });
    s.world.rng.actions.nextFloat();
    d.use(WINDOW, 'smash');
    d.step(40);
    const acts = d.entry(WINDOW)!.actions;
    expect(acts.map((a) => a.id)).toEqual([
      'open',
      'clear-glass',
      'climb-through',
      'close-curtains',
      'barricade',
    ]);
    expect(acts[1]).toMatchObject({ enabled: true, injuryChancePct: 100 });
    expect(acts[2]!.injuryChancePct).toBe(50);
    d.take();
    d.use(WINDOW, 'clear-glass');
    d.step(200);
    expect(eventsOf(d.take(), 'wounded').some((e) => e.part === 'hand_r')).toBe(true);
    expect(s.world.openings.states.get(WINDOW)?.cleared).toBe(1);
    const climb = d.act(WINDOW, 'climb-through')!;
    expect(climb.injuryChancePct).toBeUndefined();
  });

  it('durations: real seconds at ×1 (smash 1,5 s, clear glass 6 s), durationMin in game minutes', () => {
    const s = sim({ x: 19.4, y: 22.5 });
    const d = driver(s);
    const smash = d.act(WINDOW, 'smash')!;
    expect(smash.durationSec).toBe(1.5);
    // 60-minute day: 1 game minute = 2,5 real s, so 1,5 s = 0,6 game minute (36 game seconds).
    expect(smash.durationMin).toBeCloseTo(0.6, 3);
    d.cmd({ type: 'debugOpening', tx: 20, ty: 22, side: 'w', state: 'broken' });
    expect(d.act(WINDOW, 'clear-glass')!.durationSec).toBe(6);
    expect(d.act(WINDOW, 'climb-through')!.durationSec).toBe(1.5);
  });

  it('climb-through: greyed out on a closed window, enabled when open or smashed', () => {
    const s = sim({ x: 19.4, y: 22.5 });
    const d = driver(s);
    expect(d.act(WINDOW, 'climb-through')).toMatchObject({
      enabled: false,
      reason: 'invalid-state',
      reasonPl: 'Okno zamknięte',
    });
    d.cmd({ type: 'debugOpening', tx: 20, ty: 22, side: 'w', state: 'open' });
    const open = d.act(WINDOW, 'climb-through')!;
    expect(open.enabled).toBe(true);
    expect(open.injuryChancePct).toBeUndefined();
    d.cmd({ type: 'debugOpening', tx: 20, ty: 22, side: 'w', state: 'broken' });
    const broken = d.act(WINDOW, 'climb-through')!;
    expect(broken.enabled).toBe(true);
    expect(broken.injuryChancePct).toBeGreaterThan(0);
  });

  it('gloves worn on the hands (slot hands): no cut chance when clearing glass', () => {
    const s = sim({ x: 19.4, y: 22.5 }, { window: { clearGlassCutChance: 1 } });
    const d = driver(s);
    d.give('fixture:gloves');
    const g = item(s, 'fixture:gloves')!;
    const slots = s.world.items!.players.get(
      s.world.c.StableId.value[s.world.players.get(0)!]!,
    )!.slots;
    d.cmd({ type: 'debugOpening', tx: 20, ty: 22, side: 'w', state: 'broken' });
    // Held in a hand: no protection.
    slots.set('hand_secondary', g.id);
    expect(d.act(WINDOW, 'clear-glass')!.injuryChancePct).toBe(100);
    slots.delete('hand_secondary');
    slots.set('hands', g.id);
    expect(d.act(WINDOW, 'clear-glass')!.injuryChancePct).toBeUndefined();
  });
});

describe('furniture menu: objects and ids', () => {
  it('storage objects: open-storage, compartments as open-storage:<containerId>', () => {
    const s = sim({ x: 21.5, y: 22.1 });
    const d = driver(s);
    const id = objectFurnitureId(21, 21, 0, 0);
    expect(unpackObjectId(id)).toEqual({ x: 21, y: 21, z: 0, n: 0 });
    const box = d.entry(id)!;
    expect(box).toMatchObject({ typeId: 'fridge', contentId: 'fixture:icebox', x: 21.5, y: 21.5 });
    expect(box.actions.map((a) => a.id.split(':')[0])).toEqual(['open-storage', 'open-storage']);
    expect(box.actions[1]).toMatchObject({ labelPl: 'Przeszukaj: zamrażarka', enabled: true });
    expect(box.actions[1]!.durationMin).toBeGreaterThan(0);
    d.use(id, box.actions[1]!.id);
    d.step(200);
    expect(d.act(id, box.actions[1]!.id)!.labelPl).toBe('Otwórz: zamrażarka');
    d.use(id, box.actions[1]!.id);
    expect(eventsOf(d.take(), 'commandRejected')).toEqual([]);
    expect([...s.world.items!.players.values()][0]!.open).toBe(
      Number(box.actions[1]!.id.split(':')[1]),
    );
  });

  it('every protocol reason code has a Polish default text in content', () => {
    for (const r of FURNITURE_REASONS) expect(FURNITURE_REASONS_PL).toHaveProperty(r);
  });

  it('a disabled entry rejects useFurniture with its reason; unknown ids are rejected', () => {
    const s = sim(INSIDE);
    const d = driver(s);
    d.use(DOOR, 'barricade');
    d.use(DOOR, 'fly');
    d.use(12345, 'open');
    expect(eventsOf(d.take(), 'commandRejected').map((e) => e.reason)).toEqual([
      'missing-tool',
      'invalid-target',
      'out-of-range',
    ]);
  });
});
