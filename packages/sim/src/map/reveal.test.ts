import { CHUNK_SIZE } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { NOON } from '../test/ai-fixtures.js';
import { send, survivalSim } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { rejectedReasons } from '../test/item-fixtures.js';
import { isDiscovered, playerMapOf } from './player-map.js';

/** `debugRevealMap` (dev or init `allowRevealMap`, protocol 46, docs 9.77) on a 16 × 16 chunk world. */
const N = 16;
const sim = (dev: boolean, allowRevealMap = false) =>
  survivalSim(undefined, {
    map: buildMap({ width: N * CHUNK_SIZE, height: N * CHUNK_SIZE }),
    spawn: { x: 8 * CHUNK_SIZE + 16.5, y: 8 * CHUNK_SIZE + 16.5 },
    clockStart: NOON,
    dev,
    allowRevealMap,
  });
const count = (s: Sim): number => {
  const pm = s.world.playerMap!;
  const m = playerMapOf(pm, s.world.c.StableId.value[s.world.players.get(0)!] ?? 0);
  let n = 0;
  for (let cy = 0; cy < N; cy++)
    for (let cx = 0; cx < N; cx++) if (isDiscovered(pm, m, cx, cy)) n++;
  return n;
};

describe('debugRevealMap', () => {
  it('without a radius reveals the whole world and resends the map view', () => {
    const s = sim(true);
    s.step();
    s.drainView();
    expect(count(s)).toBeLessThan(N * N);
    send(s, { type: 'debugRevealMap' });
    s.step();
    expect(rejectedReasons(s)).toEqual([]);
    expect(count(s)).toBe(N * N);
    const v = s.drainView()!.worldMap!;
    expect(v.discovered).toBeDefined();
    expect(v.bounds).toEqual({ cx0: 0, cy0: 0, cx1: N - 1, cy1: N - 1 });
  });

  it('with radiusChunks reveals the square around the player only', () => {
    const s = sim(true);
    send(s, { type: 'debugRevealMap', radiusChunks: 5 });
    s.step();
    expect(rejectedReasons(s)).toEqual([]);
    expect(count(s)).toBe(11 * 11);
    const pm = s.world.playerMap!;
    const m = playerMapOf(pm, s.world.c.StableId.value[s.world.players.get(0)!] ?? 0);
    expect(isDiscovered(pm, m, 3, 3)).toBe(true);
    expect(isDiscovered(pm, m, 2, 8)).toBe(false);
    expect(isDiscovered(pm, m, 14, 14)).toBe(false);
  });

  it('rejected with dev-only when neither dev nor allowRevealMap; nothing revealed', () => {
    const s = sim(false);
    s.step();
    const before = count(s);
    send(s, { type: 'debugRevealMap' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['dev-only']);
    expect(count(s)).toBe(before);
  });

  it('allowRevealMap works outside dev; other debug* stay dev-only', () => {
    const s = sim(false, true);
    send(s, { type: 'debugRevealMap' });
    s.step();
    expect(rejectedReasons(s)).toEqual([]);
    expect(count(s)).toBe(N * N);
    send(s, { type: 'debugGiveItem', itemId: 'food:apple' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['dev-only']);
  });
});
