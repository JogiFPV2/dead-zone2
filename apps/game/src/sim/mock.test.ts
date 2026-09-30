import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_TICK_MS, stepMockPlayer } from './mock-step.js';
import { MockSimClient } from './mock-sim-client.js';
import { ENTITY_STRIDE, PLAYER_RADIUS } from './protocol.js';
import { CommandStamper, type SnapshotMessage } from './sim-client.js';
import { readEntity, writeEntities } from './snapshot.js';

const bounds = { minX: -10, minY: -10, maxX: 10, maxY: 10 };
const p0 = { id: 1, x: 0, y: 0, z: 0, facing: 0 };

describe('mock sim (temporary stub)', () => {
  afterEach(() => vi.useRealTimers());

  it('moves 4 units/s and clamps to bounds minus radius', () => {
    const p = stepMockPlayer(p0, { dx: 1, dy: 0, aim: undefined }, 0.5, bounds);
    expect(p.x).toBeCloseTo(2);
    const edge = stepMockPlayer(p0, { dx: 0, dy: -1, aim: undefined }, 10, bounds);
    expect(edge.y).toBeCloseTo(-10 + PLAYER_RADIUS);
  });

  it('faces the aim point', () => {
    const p = stepMockPlayer(p0, { dx: 0, dy: 0, aim: { x: 0, y: 5 } }, 0.05, bounds);
    expect(p.facing).toBeCloseTo(Math.PI / 2);
  });

  it('round-trips the snapshot layout', () => {
    const buf = writeEntities([{ ...p0, x: 1.5, facing: 1 }]);
    expect(buf).toHaveLength(ENTITY_STRIDE);
    expect(readEntity(buf, 0)).toEqual({ id: 1, x: 1.5, y: 0, z: 0, facing: 1 });
    expect(readEntity(buf, 1)).toBeUndefined();
  });

  it('emits 20 Hz snapshots with the player first', () => {
    vi.useFakeTimers();
    const sim = new MockSimClient(bounds, { x: 0, y: 0 }, 1);
    const stamper = new CommandStamper(1);
    const got: SnapshotMessage[] = [];
    sim.onSnapshot((s) => got.push(s));
    sim.send(stamper.stamp({ type: 'move', dx: 1, dy: 0 }));
    vi.advanceTimersByTime(MOCK_TICK_MS * 20);
    sim.dispose();
    expect(got).toHaveLength(20);
    expect(got.at(-1)?.tick).toBe(20);
    const last = got.at(-1);
    expect(last && readEntity(last.buf, 0)?.x).toBeCloseTo(4);
  });

  it('stamps commands with tick, player and rising seq', () => {
    const s = new CommandStamper(7);
    s.tick = 3;
    expect(s.stamp({ type: 'aim', x: 1, y: 2 })).toEqual({
      type: 'aim',
      x: 1,
      y: 2,
      tick: 3,
      playerId: 7,
      seq: 1,
    });
    expect(s.stamp({ type: 'move', dx: 0, dy: 0 }).seq).toBe(2);
  });
});
