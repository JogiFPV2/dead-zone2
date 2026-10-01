import { describe, expect, it } from 'vitest';
import {
  ITEM_LOG_LIFE_MS,
  NOTHING_FOUND,
  itemLogChanges,
  itemLogOpacity,
  itemLogRemaining,
  itemLogText,
  pruneItemLog,
  pushItemLog,
  type ItemLogEntry,
} from './item-log-model.js';

describe('item log model', () => {
  it('reads pick-up / drop / spot search events of the local player only', () => {
    const changes = itemLogChanges(
      [
        { type: 'itemPicked', playerId: 1, defId: 'base:bandage', count: 1 },
        { type: 'itemPicked', playerId: 2, defId: 'base:bandage', count: 1 },
        { type: 'itemDropped', playerId: 1, defId: 'base:canned-beans', count: 2 },
        { type: 'spotSearched', playerId: 1, found: [] },
        { type: 'spotSearched', playerId: 1, found: [{ defId: 'base:nails', count: 5 }] },
        { type: 'shot', playerId: 1 },
      ],
      1,
    );
    expect(changes).toEqual([
      { def: 'base:bandage', delta: 1 },
      { def: 'base:canned-beans', delta: -2 },
      { def: '', delta: 1, kind: 'note' },
      { def: 'base:nails', delta: 5, kind: 'found' },
    ]);
    const note = pushItemLog([], changes[2]!, 0, 1)[0]!;
    expect(itemLogText(note, '')).toBe(NOTHING_FOUND);
    const found = pushItemLog([], changes[3]!, 0, 2)[0]!;
    expect(itemLogText(found, 'Gwoździe')).toBe('Znaleziono: Gwoździe ×5');
  });

  it('puts new entries on top, merges identical ones within 1 s, keeps 4', () => {
    let log: ItemLogEntry[] = [];
    log = pushItemLog(log, { def: 'ammo', delta: 6 }, 0, 1);
    log = pushItemLog(log, { def: 'ammo', delta: 6 }, 900, 2);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ count: 12, updatedAt: 900, kind: 'gain' });
    log = pushItemLog(log, { def: 'ammo', delta: -1 }, 950, 3);
    expect(log.map((e) => e.kind)).toEqual(['loss', 'gain']);
    for (let i = 0; i < 4; i++) log = pushItemLog(log, { def: `x${i}`, delta: 1 }, 1000, 10 + i);
    expect(log).toHaveLength(4);
    expect(log[0]!.def).toBe('x3');
    // Older than 1 s: a new row instead of a merge.
    log = pushItemLog(log, { def: 'x3', delta: 1 }, 2500, 20);
    expect(log.filter((e) => e.def === 'x3')).toHaveLength(2);
  });

  it('expires after ~4 s and formats rows', () => {
    const e: ItemLogEntry = { id: 1, kind: 'gain', def: 'b', count: 1, updatedAt: 0 };
    expect(pruneItemLog([e], ITEM_LOG_LIFE_MS - 1)).toHaveLength(1);
    expect(pruneItemLog([e], ITEM_LOG_LIFE_MS)).toHaveLength(0);
    expect(itemLogText(e, 'Bandaż')).toBe('+ Bandaż');
    expect(itemLogText({ ...e, kind: 'loss' }, 'Puszka fasoli')).toBe('− Puszka fasoli');
    expect(itemLogText({ ...e, count: 12 }, '9 mm')).toBe('+ 9 mm ×12');
    expect(itemLogRemaining(e, 200)).toBe('3,8 s');
  });

  it('fades older rows 0.30 / 0.52 / 0.82 / 1.00', () => {
    expect([0, 1, 2, 3].map((i) => itemLogOpacity(i, 4))).toEqual([1, 0.82, 0.52, 0.3]);
    expect(itemLogOpacity(0, 1)).toBe(1);
    expect([0, 1].map((i) => itemLogOpacity(i, 2))).toEqual([1, 0.82]);
  });
});
