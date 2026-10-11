import { describe, expect, it } from 'vitest';
import type { AccountApi, CloudCharacter } from './account-api.js';
import { characterRecordOf, openCloudSession } from './cloud-session.js';
import { encodeEnvelope, sha256Hex } from './dzsv.js';
import { createMockAccountApi } from './mock-api.js';
import { menuUrlOf, takeCloudReturn, CLOUD_RETURN_KEY } from './cloud-play.js';

const character: CloudCharacter = {
  id: 'c1',
  name: 'Marta Nowak',
  appearance: { portrait: { skin: '#a', hair: '#b', shirt: '#c' } },
  worldSeed: 42,
  worldgenVersion: 1,
  worldSettings: { map: 'test-town', mode: 'rescue' },
  status: 'alive',
  daysSurvived: 3,
  createdAt: '2026-10-01T10:00:00Z',
  lastPlayedAt: null,
  diedAt: null,
  save: { version: 4, sizeBytes: 100, gameDay: 12, updatedAt: '2026-10-10T10:00:00Z' },
  lastLocation: { place: 'Stalowa Wola', x: 1, y: 2, z: 0, day: 12 },
};

function api(over: Partial<AccountApi>): AccountApi {
  return { ...createMockAccountApi({ latencyMs: 0, signedInAs: 'google' }), ...over };
}

describe('openCloudSession', () => {
  it('maps the summary to the record the game boots with', () => {
    expect(characterRecordOf(character, 'x')).toMatchObject({
      id: 'c1',
      worldSeed: 42,
      generatorVersion: 1,
      worldSettings: { map: 'test-town', mode: 'rescue' },
      createdAt: Date.parse('2026-10-01T10:00:00Z'),
    });
    expect(characterRecordOf({ ...character, worldSettings: {} }, 'def').worldSettings).toEqual({
      map: 'def',
      mode: 'survive',
    });
  });

  it('downloads, checks and unpacks the save; version is the next If-Match', async () => {
    const raw = new TextEncoder().encode('{"format":"deadzone-save"}');
    const bytes = await encodeEnvelope(raw, {
      characterId: 'c1',
      worldSeed: 42,
      worldgenVersion: 1,
      gameDay: 12,
      reason: 'exit',
      formatVersion: 3,
    });
    const sum = await sha256Hex(bytes);
    const a = api({
      openSave: () =>
        Promise.resolve({
          ok: true,
          save: { version: 4, url: 'https://x/s', checksum: sum, sizeBytes: 1 },
        }),
      downloadSave: () => Promise.resolve({ ok: true, bytes }),
    });
    const r = await openCloudSession(a, character, 'test-town');
    if (!r.ok) throw new Error(r.message);
    expect(r.session.cloud?.version).toBe(4);
    expect(r.session.save?.day).toBe(12);
    expect(new TextDecoder().decode(r.session.save!.data)).toBe('{"format":"deadzone-save"}');

    const bad = await openCloudSession(
      api({
        openSave: () =>
          Promise.resolve({
            ok: true,
            save: { version: 4, url: 'https://x/s', checksum: '00', sizeBytes: 1 },
          }),
        downloadSave: () => Promise.resolve({ ok: true, bytes }),
      }),
      character,
      'test-town',
    );
    expect(bad).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('no save yet → fresh world; 401 → unauthorized; dead → gone; new character skips open', async () => {
    const none = await openCloudSession(
      api({
        openSave: () =>
          Promise.resolve({
            ok: true,
            save: { version: 0, url: null, checksum: null, sizeBytes: 0 },
          }),
      }),
      character,
      'm',
    );
    expect(none).toMatchObject({ ok: true, session: { cloud: { version: 0 } } });
    if (none.ok) expect(none.session.save).toBeUndefined();
    expect(
      await openCloudSession(
        api({ openSave: () => Promise.resolve({ ok: false, reason: 'unauthorized' }) }),
        character,
        'm',
      ),
    ).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(
      await openCloudSession(
        api({
          openSave: () =>
            Promise.resolve({ ok: false, reason: 'error', status: 410, code: 'character_dead' }),
        }),
        character,
        'm',
      ),
    ).toMatchObject({ ok: false, reason: 'gone' });
    const created = { spec: {} as never, look: {} as never };
    const fresh = await openCloudSession(
      api({ openSave: () => Promise.reject(new Error('not called')) }),
      character,
      'm',
      created,
    );
    expect(fresh).toMatchObject({ ok: true, session: { created, cloud: { version: 0 } } });
  });
});

describe('back to the menu', () => {
  it('keeps the account mode in the URL and reads the return target once', () => {
    expect(menuUrlOf('/deadzone-play/', '?online=1&spawn=x')).toBe('/deadzone-play/?online=1');
    expect(menuUrlOf('/', '?online=mock&as=google&save=conflict')).toBe('/?online=mock&as=google');
    expect(menuUrlOf('/', '')).toBe('/');
    const m = new Map<string, string>();
    const st = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    st.setItem(CLOUD_RETURN_KEY, JSON.stringify({ play: 'c1' }));
    expect(takeCloudReturn(st)).toEqual({ play: 'c1' });
    expect(takeCloudReturn(st)).toBeUndefined();
    st.setItem(CLOUD_RETURN_KEY, '{"view":"characters"}');
    expect(takeCloudReturn(st)).toEqual({ view: 'characters' });
  });
});
