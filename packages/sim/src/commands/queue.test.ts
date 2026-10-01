import { describe, expect, it } from 'vitest';
import { createSim } from '../sim.js';
import { buildMap } from '../test/fixtures.js';
import { run } from '../test/helpers.js';
import { CommandQueue } from './queue.js';

const mv = (seq: number, tick: number, dx = 1, playerId = 0) =>
  ({ type: 'move', dx, dy: 0, tick, playerId, seq }) as const;

describe('CommandQueue', () => {
  it('rejects structurally invalid commands', () => {
    const q = new CommandQueue(40);
    expect(
      q.enqueue({ type: 'move', dx: 5, dy: 0, tick: 0, playerId: 0, seq: 0 }, 0),
    ).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(q.enqueue({ type: 'teleport', tick: 0, playerId: 0, seq: 0 }, 0).ok).toBe(false);
    expect(q.enqueue(null, 0).ok).toBe(false);
    expect(q.pendingCount).toBe(0);
  });

  it('rejects duplicate and stale seq per player', () => {
    const q = new CommandQueue(40);
    expect(q.enqueue(mv(5, 0), 0).ok).toBe(true);
    expect(q.enqueue(mv(5, 0), 0)).toMatchObject({ ok: false, reason: 'stale-seq' });
    expect(q.enqueue(mv(4, 0), 0)).toMatchObject({ ok: false, reason: 'stale-seq' });
    expect(q.enqueue(mv(0, 0, 1, 1), 0).ok).toBe(true); // other player has its own seq
  });

  it('setTimeScale is seq-exempt: accepted with an old seq and does not advance lastSeq', () => {
    const q = new CommandQueue(40);
    const ts = (seq: number, speed: 1 | 2 | 4) =>
      ({ type: 'setTimeScale', speed, tick: 0, playerId: 0, seq }) as const;
    expect(q.enqueue(mv(100, 0), 0).ok).toBe(true);
    expect(q.enqueue(ts(0, 4), 0).ok).toBe(true); // worker client seq, far behind the game's
    expect(q.enqueue(ts(101, 4), 0).ok).toBe(true); // game-stamped duplicate (PR #81 path)
    expect(q.seqState()).toEqual([[0, 100]]);
    expect(q.enqueue(mv(101, 0), 0).ok).toBe(true); // the game's next seq still passes
    expect(q.enqueue(mv(100, 0), 0)).toMatchObject({ ok: false, reason: 'stale-seq' });
    expect(q.take(0).map((c) => [c.type, c.seq])).toEqual([
      ['setTimeScale', 0],
      ['move', 100],
      ['setTimeScale', 101],
      ['move', 101],
    ]);
  });

  it('moves late commands to the current tick and rejects far-future ones', () => {
    const q = new CommandQueue(40);
    expect(q.enqueue(mv(0, 3), 10)).toEqual({ ok: true, tick: 10 });
    expect(q.enqueue(mv(1, 50), 10)).toEqual({ ok: true, tick: 50 });
    expect(q.enqueue(mv(2, 51), 10)).toMatchObject({ ok: false, reason: 'too-far-in-future' });
    expect(q.take(10)).toHaveLength(1);
    expect(q.take(10)).toHaveLength(0);
  });

  it('returns commands of a tick sorted by (playerId, seq)', () => {
    const q = new CommandQueue(40);
    q.enqueue(mv(3, 0, 1, 2), 0);
    q.enqueue(mv(1, 0, 1, 1), 0);
    q.enqueue(mv(2, 0, 1, 1), 0);
    q.enqueue(mv(0, 0, 1, 0), 0);
    expect(q.take(0).map((c) => [c.playerId, c.seq])).toEqual([
      [0, 0],
      [1, 1],
      [1, 2],
      [2, 3],
    ]);
  });
});

describe('commands in the sim', () => {
  const sim = () => createSim({ seed: 1, map: buildMap(), spawn: { x: 10.5, y: 10.5 } });

  it('applies the last move of a tick', () => {
    const s = sim();
    s.enqueue(mv(0, 0, 1));
    s.enqueue(mv(1, 0, -1));
    run(s, 1);
    expect(s.getPlayer()!.x).toBeCloseTo(10.5 - 0.01875, 5);
  });

  it('applies future commands at their tick', () => {
    const s = sim();
    s.enqueue(mv(0, 5, 1));
    run(s, 5);
    expect(s.getPlayer()!.x).toBe(10.5);
    run(s, 1);
    expect(s.getPlayer()!.x).toBeCloseTo(10.5 + 0.01875, 5);
  });

  it('rejects commands for unknown players with an event (gameplay validation)', () => {
    const s = sim();
    expect(s.enqueue(mv(0, 0, 1, 7)).ok).toBe(true);
    run(s, 1);
    expect(s.drainEvents()).toEqual([
      { type: 'commandRejected', tick: 0, playerId: 7, seq: 0, reason: 'unknown-player' },
    ]);
    expect(s.drainEvents()).toEqual([]);
    expect(s.getPlayer()!.x).toBe(10.5);
  });
});
