import type { SimEdgeKind } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { runMinutes, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { OBJECTS, itemsSim, rejectedReasons, worldContainer } from '../test/item-fixtures.js';
import { OpeningKind, OS, openingKey, setOpening, sideIndex } from '../openings/state.js';
import { createCorpse } from './search.js';
import { canReachTarget, reachTarget } from './inventory.js';

/**
 * Looting never through walls (docs 9.69): the cabinet at (11, 10) next to the spawn
 * (10.5, 10.5); a wall / opening on the west edge of tile (11, 10) stands between them.
 */
const sim = (edge?: Record<string, unknown>) =>
  itemsSim(undefined, {
    map: buildMap({
      objects: OBJECTS,
      room: (x, y) => (x >= 5 && x <= 15 && y >= 5 && y <= 15 ? 1 : 0),
      rooms: { '1': 'fixture:room-kitchen' },
      ...edge,
    }),
  });
const wall = { wallW: (x: number, y: number) => x === 11 && y === 10 };
const edge = (kind: SimEdgeKind) => ({
  wallW: (x: number, y: number) => x === 11 && y === 10,
  edgeId: () => 2,
  edgeKinds: [null, 'wall', kind] as (SimEdgeKind | null)[],
});
const open = (s: ReturnType<typeof sim>, kind: number) =>
  setOpening(s.world.openings, openingKey(sideIndex('w'), 11, 10, 0), kind, OS.open);
const pe = (s: ReturnType<typeof sim>) => s.world.players.get(0)!;

function tryOpen(s: ReturnType<typeof sim>): string[] {
  const cab = worldContainer(s, 11, 10).id;
  s.drainEvents();
  send(s, { type: 'openContainer', container: cab });
  s.step();
  return rejectedReasons(s);
}

describe('looting: range and a clear line', () => {
  it('same room, in range: opens; the client check says reachable', () => {
    const s = sim();
    expect(canReachTarget(s.world, pe(s), { container: worldContainer(s, 11, 10).id })).toBe(true);
    expect(tryOpen(s)).toEqual([]);
  });

  it('through a wall: rejected with `wall`, the client check says so', () => {
    const s = sim(wall);
    const id = worldContainer(s, 11, 10).id;
    expect(reachTarget(s.world, pe(s), { container: id })).toBe('wall');
    expect(tryOpen(s)).toEqual(['wall']);
    // Far away stays `out-of-range`.
    expect(reachTarget(s.world, pe(s), { container: worldContainer(s, 40, 40).id })).toBe(
      'out-of-range',
    );
  });

  it('closed door blocks, open door lets through; windows block in any state', () => {
    const d = sim(edge('door'));
    expect(tryOpen(d)).toEqual(['wall']);
    open(d, OpeningKind.door);
    expect(tryOpen(d)).toEqual([]);
    const w = sim(edge('window'));
    expect(tryOpen(w)).toEqual(['wall']);
    open(w, OpeningKind.window);
    expect(tryOpen(w)).toEqual(['wall']);
  });

  it('a searched container behind a new wall closes and refuses takeAll', () => {
    const s = sim(edge('door'));
    open(s, OpeningKind.door);
    const cab = worldContainer(s, 11, 10).id;
    send(s, { type: 'openContainer', container: cab });
    runMinutes(s, 3);
    setOpening(
      s.world.openings,
      openingKey(sideIndex('w'), 11, 10, 0),
      OpeningKind.door,
      OS.closed,
    );
    s.drainEvents();
    send(s, { type: 'takeAll', container: cab });
    s.step();
    expect(rejectedReasons(s)).toEqual(['wall']);
  });

  it('corpse behind a wall: rejected; corpse in the same room: search starts', () => {
    const s = sim(wall);
    const here = createCorpse(s.world, 901, 10, 11, 0, undefined)!;
    s.drainEvents();
    send(s, { type: 'openContainer', container: here.id });
    s.step();
    expect(rejectedReasons(s)).toEqual([]);
    expect(reachTarget(s.world, pe(s), { container: here.id })).toBeUndefined();
    // Corpse at (11, 11) behind a wall along x = 11:
    const s2 = sim({ wallW: (x: number, y: number) => x === 11 && (y === 10 || y === 11) });
    const c2 = createCorpse(s2.world, 902, 11, 11, 0, undefined)!;
    s2.drainEvents();
    send(s2, { type: 'openContainer', container: c2.id });
    s2.step();
    expect(rejectedReasons(s2)).toEqual(['wall']);
  });

  it('a ground tile behind a wall: spot search refused with `wall`', () => {
    const s = sim(wall);
    expect(reachTarget(s.world, pe(s), { x: 11, y: 10, z: 0 })).toBe('wall');
    expect(reachTarget(s.world, pe(s), { x: 10, y: 11, z: 0 })).toBeUndefined();
    s.drainEvents();
    send(s, { type: 'search', x: 11, y: 10 });
    s.step();
    expect(rejectedReasons(s)).toEqual(['wall']);
  });
});
