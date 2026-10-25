import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@deadzone/protocol';
import { swallowSamples } from './synth.js';
import {
  DOOR_CLOSE,
  DOOR_OPEN,
  SWALLOW,
  Footsteps,
  HEARING_TILES,
  STEP_TILES,
  eventCues,
  falloff,
} from './world-sfx.js';

const hit = (x: number, source: 'melee' | 'shove' | 'shot' = 'melee'): SimEvent => ({
  type: 'hit',
  tick: 1,
  source,
  attacker: 1,
  target: 2,
  damage: 5,
  x,
  y: 0,
  killed: false,
});

describe('world sfx', () => {
  it('fades with distance', () => {
    expect(falloff(0, 0)).toBe(1);
    expect(falloff(HEARING_TILES / 2, 0)).toBeCloseTo(0.5);
    expect(falloff(HEARING_TILES, 0)).toBe(0);
  });

  it('plays melee hits and door changes, skips shots and far events', () => {
    const door = (state: 'open' | 'closed' | 'broken'): SimEvent => ({
      type: 'openingChanged',
      tick: 1,
      tx: 1,
      ty: 0,
      z: 0,
      side: 'n',
      kind: 'door',
      state,
      hp: 1,
      maxHp: 1,
      barricade: 0,
      glass: false,
      by: 'player',
    });
    const cues = eventCues(
      [hit(1), hit(1, 'shot'), hit(100), door('open'), door('closed'), door('broken')],
      0,
      0,
      () => 0,
    );
    expect(cues.map((c) => c.id)).toEqual(['sfx-hit0', DOOR_OPEN, DOOR_CLOSE]);
    expect(eventCues([hit(0, 'shove')], 0, 0)[0]!.volume).toBeLessThan(1);
  });

  it('steps once per stride, wood indoors, ignores teleports', () => {
    const f = new Footsteps();
    expect(f.update(0, 0, false)).toBeUndefined();
    const cues = [];
    for (let i = 1; i <= 30; i++) cues.push(f.update(i * 0.1, 0, false));
    expect(cues.filter(Boolean)).toHaveLength(Math.floor(3 / STEP_TILES));
    expect(f.update(50, 0, true)).toBeUndefined();
    let c;
    for (let i = 1; i <= 10 && !c; i++) c = f.update(50 + i * 0.1, 0, true);
    expect(c?.id).toMatch(/^sfx-step-wood/);
  });
});

describe('pill swallow cue (itemUsed, protocol 40)', () => {
  const pill = (playerId: number, action: 'pill' | 'eat' = 'pill') =>
    ({ type: 'itemUsed', tick: 1, playerId, action, itemId: 'base:antibiotics' }) as SimEvent;
  it('plays only for the local player and only for a pill', () => {
    expect(eventCues([pill(0)], 0, 0, () => 0, 0)).toEqual([{ id: SWALLOW, volume: 0.8 }]);
    expect(eventCues([pill(1)], 0, 0, () => 0, 0)).toEqual([]);
    expect(eventCues([pill(0, 'eat')], 0, 0, () => 0, 0)).toEqual([]);
    expect(eventCues([pill(0)], 0, 0)).toEqual([]);
  });
  it('synth swallow: short, audible, no clipping', () => {
    const s = swallowSamples(48000);
    expect(s.length).toBe(21600);
    const peak = s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(1);
  });
});
