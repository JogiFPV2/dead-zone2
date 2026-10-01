import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { CharacterStore, SlotsFullError, type LegacyWorldSource } from './character-store.js';
import { createIdbBackend, openCharactersDb } from './idb-backend.js';
import { createMemoryBackend } from './memory-backend.js';
import { CharacterSaver } from './session-saver.js';
import type { CharacterBackend } from './schema.js';
import { CHARACTER_SLOTS } from './schema.js';

const blob = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const text = (b: ArrayBuffer | undefined): string | undefined =>
  b ? new TextDecoder().decode(b) : undefined;
const look = { portrait: { skin: '#a', hair: '#b', shirt: '#c' } };
const world = { map: 'test-town', mode: 'survive' } as const;

const backends: [string, () => Promise<CharacterBackend>][] = [
  ['memory', () => Promise.resolve(createMemoryBackend())],
  ['indexeddb', async () => createIdbBackend(await openCharactersDb(new IDBFactory()))],
];

describe.each(backends)('CharacterStore (%s)', (_name, make) => {
  let clock = 1000;
  const deps = () => {
    let n = 0;
    return { now: () => (clock += 10), newId: () => `id${++n}`, randomSeed: () => 42 };
  };
  const setup = async () => {
    const b = await make();
    return { b, store: new CharacterStore(b, deps()) };
  };

  it('creates a character with its own world and no save', async () => {
    const { store } = await setup();
    const c = await store.create({ name: '  Ewa  ', appearance: look, worldSettings: world });
    expect(c).toMatchObject({ name: 'Ewa', status: 'alive', worldSeed: 42, daysSurvived: 0 });
    expect(await store.loadSave(c.id)).toBeUndefined();
    expect((await store.mostRecentAlive())?.id).toBe(c.id);
  });

  it('keeps exactly one save per character: each write overwrites it and bumps the version', async () => {
    const { store, b } = await setup();
    const c = await store.create({ name: 'Ewa', appearance: look, worldSettings: world });
    const r1 = await store.writeSave(c.id, 0, {
      tick: 10,
      day: 1,
      reason: 'autosave',
      data: blob('a'),
    });
    expect(r1).toEqual({ ok: true, version: 1 });
    const r2 = await store.writeSave(c.id, 1, {
      tick: 20,
      day: 4,
      reason: 'exit',
      data: blob('b'),
    });
    expect(r2).toEqual({ ok: true, version: 2 });
    const s = await store.loadSave(c.id);
    expect(s).toMatchObject({ characterId: c.id, version: 2, tick: 20, day: 4, reason: 'exit' });
    expect(text(s?.data)).toBe('b');
    expect(await b.getSaveVersion(c.id)).toBe(2);
    expect((await store.get(c.id))?.daysSurvived).toBe(3);
  });

  it('refuses a stale tab: an older version never overwrites newer state', async () => {
    const { store, b } = await setup();
    const other = new CharacterStore(b, deps());
    const c = await store.create({ name: 'Ewa', appearance: look, worldSettings: world });
    await store.writeSave(c.id, 0, { tick: 1, day: 1, reason: 'exit', data: blob('v1') });
    // Two tabs load v1; tab B saves first.
    const tabA = new CharacterSaver(store, c.id, 1);
    const tabB = new CharacterSaver(other, c.id, 1);
    expect(await tabB.write({ tick: 5, day: 2, reason: 'autosave', data: blob('B') })).toEqual({
      ok: true,
      version: 2,
    });
    const stale = await tabA.write({ tick: 3, day: 1, reason: 'exit', data: blob('A') });
    expect(stale).toEqual({ ok: false, reason: 'stale', currentVersion: 2 });
    expect(tabA.blocked).toBe('stale');
    // Later writes from the stale tab are refused too, even with a now-matching count.
    await tabA.write({ tick: 4, day: 1, reason: 'sleep', data: blob('A2') });
    expect(text((await store.loadSave(c.id))?.data)).toBe('B');
    // A stale tab's death does not bury the newer progress either.
    const stale2 = new CharacterSaver(store, c.id, 1);
    expect((await stale2.die('zombie', 0)).ok).toBe(false);
    expect((await store.get(c.id))?.status).toBe('alive');
  });

  it('serialises overlapping writes of one tab', async () => {
    const { store } = await setup();
    const c = await store.create({ name: 'Ewa', appearance: look, worldSettings: world });
    const saver = new CharacterSaver(store, c.id, 0);
    const rs = await Promise.all([
      saver.write({ tick: 1, day: 1, reason: 'autosave', data: blob('1') }),
      saver.write({ tick: 2, day: 1, reason: 'sleep', data: blob('2') }),
      saver.write({ tick: 3, day: 2, reason: 'exit', data: blob('3') }),
    ]);
    expect(rs.map((r) => r.ok)).toEqual([true, true, true]);
    expect(saver.currentVersion).toBe(3);
    expect(text((await store.loadSave(c.id))?.data)).toBe('3');
  });

  it('permadeath: marks dead, deletes the save, keeps a tombstone that cannot be played', async () => {
    const { store } = await setup();
    const c = await store.create({ name: 'Ewa', appearance: look, worldSettings: world });
    await store.writeSave(c.id, 0, { tick: 1, day: 9, reason: 'sleep', data: blob('x') });
    const saver = new CharacterSaver(store, c.id, 1);
    expect((await saver.die('bleeding', 8)).ok).toBe(true);
    const dead = await store.get(c.id);
    expect(dead).toMatchObject({
      name: 'Ewa',
      status: 'dead',
      daysSurvived: 8,
      deathCause: 'bleeding',
    });
    expect(dead?.diedAt).toBeTypeOf('number');
    expect(await store.loadSave(c.id)).toBeUndefined();
    expect(await store.mostRecentAlive()).toBeUndefined();
    // No resurrection through a save write.
    expect(
      await store.writeSave(c.id, 0, { tick: 2, day: 9, reason: 'exit', data: blob('y') }),
    ).toMatchObject({
      ok: false,
      reason: 'dead',
    });
    expect((await saver.write({ tick: 3, day: 9, reason: 'exit', data: blob('z') })).ok).toBe(
      false,
    );
    expect(await store.loadSave(c.id)).toBeUndefined();
    // The tombstone takes a slot until Usuń.
    expect(await store.freeSlots()).toBe(CHARACTER_SLOTS - 1);
    await store.remove(c.id);
    expect(await store.list()).toEqual([]);
  });

  it('Usuń deletes the character with its save', async () => {
    const { store } = await setup();
    const c = await store.create({ name: 'Ewa', appearance: look, worldSettings: world });
    await store.writeSave(c.id, 0, { tick: 1, day: 1, reason: 'exit', data: blob('x') });
    await store.remove(c.id);
    expect(await store.get(c.id)).toBeUndefined();
    expect(await store.loadSave(c.id)).toBeUndefined();
  });

  it('lists most recently played first and caps the slots', async () => {
    const { store } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < CHARACTER_SLOTS; i++) {
      ids.push((await store.create({ name: `P${i}`, appearance: look, worldSettings: world })).id);
    }
    await expect(
      store.create({ name: 'X', appearance: look, worldSettings: world }),
    ).rejects.toBeInstanceOf(SlotsFullError);
    await store.touch(ids[0]!);
    expect((await store.list())[0]?.id).toBe(ids[0]);
    expect((await store.mostRecentAlive())?.id).toBe(ids[0]);
  });

  it('migrates the old single world save into one character, once', async () => {
    const { store } = await setup();
    let cleared = 0;
    let present = true;
    const legacy: LegacyWorldSource = {
      read: () =>
        present
          ? Promise.resolve({
              data: blob('{"format":"deadzone-save","seed":1}'),
              tick: 900,
              day: 5,
              minuteOfDay: 600,
              reason: 'exit',
              savedAt: 777,
              seed: 1,
              map: 'test-town',
            })
          : Promise.reject(new Error('none')),
      clear: () => {
        cleared++;
        present = false;
        return Promise.resolve();
      },
    };
    const c = await store.migrateLegacyWorld(legacy);
    expect(c).toMatchObject({ name: 'Ocalały', worldSeed: 1, status: 'alive', daysSurvived: 4 });
    expect(c?.lastPlayedAt).toBe(777);
    expect(c?.worldSettings.map).toBe('test-town');
    const s = await store.loadSave(c!.id);
    expect(s).toMatchObject({
      version: 1,
      tick: 900,
      day: 5,
      minuteOfDay: 600,
      reason: 'migrated',
    });
    expect(text(s?.data)).toContain('"seed":1');
    expect(cleared).toBe(1);
    expect(await store.migrateLegacyWorld(legacy)).toBeUndefined();
    expect(await store.list()).toHaveLength(1);
  });

  it('keeps the legacy save when there is no free slot', async () => {
    const { store } = await setup();
    for (let i = 0; i < CHARACTER_SLOTS; i++) {
      await store.create({ name: `P${i}`, appearance: look, worldSettings: world });
    }
    let cleared = false;
    const legacy: LegacyWorldSource = {
      read: () =>
        Promise.resolve({
          data: blob('x'),
          tick: 1,
          day: 1,
          reason: 'exit',
          savedAt: 1,
          seed: 1,
          map: 'test-town',
        }),
      clear: () => {
        cleared = true;
        return Promise.resolve();
      },
    };
    expect(await store.migrateLegacyWorld(legacy)).toBeUndefined();
    expect(cleared).toBe(false);
  });
});
