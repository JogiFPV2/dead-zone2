import { describe, expect, it } from 'vitest';
import { createSim } from '../sim.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { damageOpening } from './actions.js';
import { openingKey, OpeningKind, openingView, OS, setOpening } from './state.js';

const roomSpec = {
  wallW: (x: number, y: number) => (x === 20 || x === 30) && y >= 20 && y < 30,
  wallN: (x: number, y: number) => (y === 20 || y === 30) && x >= 20 && x < 30,
  edgeId: (x: number, y: number) => (x === 20 && y === 25 ? 2 : 1),
  edgeKinds: [null, 'wall', 'door'] as const,
};
const KEY = openingKey(1, 20, 25, 0);

function sim() {
  const s = createSim({
    seed: 3,
    map: buildMap(roomSpec),
    spawn: { x: 27.5, y: 27.5 },
    content: fixtureContent({ openings: { doorHp: 60 } }),
  });
  s.step();
  s.drainEvents();
  return s;
}

describe('openings: cracked door (protocol 42)', () => {
  it('cracks once at half hp; openingChanged and the view carry cracked', () => {
    const s = sim();
    const w = s.world;
    damageOpening(w, KEY, OpeningKind.door, 20, 'zombie');
    expect(openingView(w.openings, KEY, OpeningKind.door).cracked).toBeUndefined();
    expect(s.drainEvents().filter((e) => e.type === 'doorCracked')).toHaveLength(0);
    damageOpening(w, KEY, OpeningKind.door, 10, 'crowd');
    const ev = s.drainEvents();
    const cracked = ev.filter((e) => e.type === 'doorCracked');
    expect(cracked).toEqual([
      expect.objectContaining({ tx: 20, ty: 25, z: 0, kind: 'door', by: 'crowd' }),
    ]);
    const ch = ev.find((e) => e.type === 'openingChanged');
    expect(ch && 'cracked' in ch && ch.cracked).toBe(true);
    damageOpening(w, KEY, OpeningKind.door, 10, 'zombie');
    expect(s.drainEvents().filter((e) => e.type === 'doorCracked')).toHaveLength(0);
    expect(openingView(w.openings, KEY, OpeningKind.door).cracked).toBe(true);
  });

  it('open / broken doors and planks do not count as cracked', () => {
    const s = sim();
    const o = s.world.openings;
    setOpening(o, KEY, OpeningKind.door, OS.closed, 10, { planks: 2, bhp: 80 });
    expect(openingView(o, KEY, OpeningKind.door).cracked).toBe(true);
    setOpening(o, KEY, OpeningKind.door, OS.closed, 60, { planks: 2, bhp: 10 });
    expect(openingView(o, KEY, OpeningKind.door).cracked).toBeUndefined();
    setOpening(o, KEY, OpeningKind.door, OS.broken, 0);
    expect(openingView(o, KEY, OpeningKind.door).cracked).toBeUndefined();
  });
});
