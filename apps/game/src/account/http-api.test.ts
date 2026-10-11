import { describe, expect, it, vi } from 'vitest';
import {
  accountExportOf,
  attachmentName,
  cloudSaveOf,
  conflictInfo,
  createHttpAccountApi,
  etagVersion,
  ifMatchHeader,
  retryAfterSec,
  saveResultOf,
  settingsResultOf,
  versionOf,
  type AuthProvider,
} from './http-api.js';

const auth = (token: string | null = 'tok'): AuthProvider => ({
  session: () => Promise.resolve(undefined),
  accessToken: () => Promise.resolve(token ?? undefined),
  signInWithGoogle: () => Promise.resolve({ ok: false, code: 'not-configured' }),
  signInWithPassword: () => Promise.resolve({ ok: false, code: 'not-configured' }),
  signUp: () => Promise.resolve({ ok: true }),
  sendMagicLink: () => Promise.resolve({ ok: true }),
  sendPasswordReset: () => Promise.resolve({ ok: true }),
  resendConfirmation: () => Promise.resolve({ ok: true }),
  signOut: () => Promise.resolve(),
});
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

describe('save answers (409 / 410)', () => {
  it('409 save_version_conflict → conflict with SaveConflictError.server (null = no save)', () => {
    expect(saveResultOf(409, { error: 'save_version_conflict' })).toEqual({
      ok: false,
      reason: 'conflict',
      server: undefined,
    });
    const body = {
      error: 'save_version_conflict',
      server: { version: 15, gameDay: 14, minuteOfDay: 664, updatedAt: '2026-10-04T18:04:00Z' },
    };
    expect(saveResultOf(409, body)).toEqual({
      ok: false,
      reason: 'conflict',
      server: { version: 15, gameDay: 14, minuteOfDay: 664, updatedAt: '2026-10-04T18:04:00Z' },
    });
    expect(
      saveResultOf(409, { error: 'save_version_conflict', message: 'x', server: null }),
    ).toEqual({ ok: false, reason: 'conflict', server: null });
    expect(
      conflictInfo({ server: { version: 2, gameDay: 3, minuteOfDay: null, updatedAt: 'T' } }),
    ).toEqual({ version: 2, gameDay: 3, minuteOfDay: null, updatedAt: 'T' });
    expect(conflictInfo({ server: { gameDay: 3 } })).toBeUndefined();
    expect(conflictInfo({ server: 'x' })).toBeUndefined();
  });

  it('dead elsewhere (410, 409 character_dead, 404) → gone; quota, rate limit, 401', () => {
    expect(saveResultOf(410, undefined)).toEqual({ ok: false, reason: 'gone' });
    expect(saveResultOf(409, { error: 'character_dead' })).toEqual({ ok: false, reason: 'gone' });
    expect(saveResultOf(404, { error: 'character_not_found' })).toEqual({
      ok: false,
      reason: 'gone',
    });
    expect(saveResultOf(413, { error: 'save_quota_exceeded' })).toEqual({
      ok: false,
      reason: 'quota',
    });
    expect(saveResultOf(429, { error: 'rate_limited' }, '30')).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterSec: 30,
    });
    expect(saveResultOf(401, undefined)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(saveResultOf(200, { version: 4, sizeBytes: 9 })).toEqual({
      ok: true,
      version: 4,
      sizeBytes: 9,
    });
  });

  it('settings (#164): 412 conflict, 413, 422 with issues, 428; stored copy and ETag', () => {
    expect(settingsResultOf(412, { error: 'settings_version_conflict' }, null)).toEqual({
      ok: false,
      reason: 'conflict',
    });
    expect(settingsResultOf(413, { error: 'payload_too_large' }, null)).toEqual({
      ok: false,
      reason: 'too-large',
    });
    const issue = { path: ['audio', 'master'], code: 'too_big', message: 'Too big' };
    expect(settingsResultOf(422, { error: 'invalid_settings', issues: [issue] }, null)).toEqual({
      ok: false,
      reason: 'invalid',
      issues: [issue],
    });
    expect(settingsResultOf(428, { error: 'precondition_required' }, null)).toEqual({
      ok: false,
      reason: 'precondition',
    });
    expect(settingsResultOf(401, undefined, null)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(settingsResultOf(200, {}, '"7"')).toEqual({
      ok: true,
      version: 7,
      settings: null,
      updatedAt: null,
      etag: '"7"',
    });
    expect(
      settingsResultOf(200, { settings: { version: 1 }, version: 3, updatedAt: 'T' }, '"3"'),
    ).toEqual({ ok: true, version: 3, settings: { version: 1 }, updatedAt: 'T', etag: '"3"' });
    expect(versionOf('W/"12"')).toBe(12);
    expect(versionOf(null)).toBe(0);
  });
});

describe('createHttpAccountApi', () => {
  it('GET /v1/characters with the bearer token; usage falls back to the older limits block', async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(
        json(200, {
          characters: [{ id: 'a', name: 'Ewa', status: 'alive' }],
          limits: { maxAlive: 20, alive: 1, maxSaveBytes: 50, usedSaveBytes: 5 },
        }),
      ),
    );
    const api = createHttpAccountApi({ baseUrl: 'https://api.test/', auth: auth(), fetch });
    const r = await api.listCharacters();
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.test/v1/characters');
    expect((fetch.mock.calls[0]?.[1].headers as Record<string, string>).authorization).toBe(
      'Bearer tok',
    );
    expect(r).toMatchObject({
      ok: true,
      usage: { usedBytes: 5, limitBytes: 50, alive: 1, aliveLimit: 20 },
    });
    if (r.ok) expect(r.characters[0]?.lastLocation).toBeNull();
  });

  it('PUT save sends If-Match and the checksum; network errors and missing tokens are typed', async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(json(409, { error: 'save_version_conflict' })),
    );
    const api = createHttpAccountApi({ baseUrl: 'https://api.test', auth: auth(), fetch });
    const r = await api.putSave('id-1', 3, {
      bytes: new Uint8Array([1, 2]),
      sha256: 'ab',
      reason: 'autosave',
    });
    const h = fetch.mock.calls[0]?.[1].headers as Record<string, string>;
    expect(h['if-match']).toBe('"3"');
    expect(h['x-dzsv-sha256']).toBe('ab');
    expect(r).toMatchObject({ ok: false, reason: 'conflict' });

    const down = createHttpAccountApi({
      baseUrl: 'https://api.test',
      auth: auth(),
      fetch: () => Promise.reject(new TypeError('offline')),
    });
    expect(await down.getSettings()).toEqual({ ok: false, reason: 'network' });
    const anon = createHttpAccountApi({ baseUrl: 'https://api.test', auth: auth(null), fetch });
    expect(await anon.deleteAccount()).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('GET /v1/me/export: AccountExport, file name from Content-Disposition, 429 Retry-After', async () => {
    const body = {
      format: 'deadzone-account-export',
      formatVersion: 1,
      exportedAt: '2026-10-04T20:00:00Z',
      characters: [],
    };
    const fetch = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(
        json(200, body, {
          'content-disposition': 'attachment; filename=deadzone-export-2026-10-04.json',
        }),
      ),
    );
    const api = createHttpAccountApi({ baseUrl: 'https://api.test', auth: auth(), fetch });
    expect(await api.exportData()).toEqual({
      ok: true,
      data: body,
      fileName: 'deadzone-export-2026-10-04.json',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.test/v1/me/export');
    const limited = createHttpAccountApi({
      baseUrl: 'https://api.test',
      auth: auth(),
      fetch: () => Promise.resolve(json(429, { error: 'rate_limited' }, { 'retry-after': '1500' })),
    });
    expect(await limited.exportData()).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterSec: 1500,
    });
    expect(accountExportOf({ format: 'other' })).toBeUndefined();
    expect(attachmentName('attachment; filename="a-b.json"')).toBe('a-b.json');
    expect(attachmentName('attachment; filename="../x"')).toBeUndefined();
    expect(attachmentName(null)).toBeUndefined();
    const t = Date.parse('2026-10-04T20:00:00Z');
    expect(retryAfterSec('Sun, 04 Oct 2026 20:10:00 GMT', t)).toBe(600);
    expect(retryAfterSec('0')).toBeUndefined();
  });

  it('PUT /v1/me/settings sends the whole object with If-Match', async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(json(200, { settings: { a: 1 }, version: 2, updatedAt: 'T' })),
    );
    const api = createHttpAccountApi({ baseUrl: 'https://api.test', auth: auth(), fetch });
    expect(await api.putSettings({ a: 1 }, 1)).toEqual({
      ok: true,
      version: 2,
      settings: { a: 1 },
      updatedAt: 'T',
    });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe('PUT');
    expect((init?.headers as Record<string, string>)['if-match']).toBe('"1"');
    // The body is the settings object itself (Serwer validates `req.body`).
    expect(JSON.parse(init?.body as string)).toEqual({ a: 1 });
  });

  it('POST …/open, signed download without bearer, POST …/death with the checksum', async () => {
    const fetch = vi.fn((url: string, _init: RequestInit) =>
      Promise.resolve(
        url.endsWith('/open')
          ? json(200, {
              characterId: 'c',
              version: 4,
              url: 'https://s/x',
              checksum: 'ab',
              sizeBytes: 9,
              expiresInSeconds: 600,
            })
          : url.startsWith('https://s/')
            ? new Response(new Uint8Array([1, 2, 3]), { status: 200 })
            : json(200, { id: 'c', status: 'dead' }),
      ),
    );
    const api = createHttpAccountApi({ baseUrl: 'https://api.test/', auth: auth(), fetch });
    expect(await api.openSave('c')).toEqual({
      ok: true,
      save: { version: 4, url: 'https://s/x', checksum: 'ab', sizeBytes: 9 },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.test/v1/characters/c/open');
    expect(fetch.mock.calls[0]?.[1].method).toBe('POST');
    const dl = await api.downloadSave('https://s/x');
    expect(dl.ok && [...dl.bytes]).toEqual([1, 2, 3]);
    expect(fetch.mock.calls[1]?.[1].headers).toBeUndefined();
    expect((await api.downloadSave('http://insecure/x')).ok).toBe(false);
    const up = { bytes: new Uint8Array([9]), sha256: 'f'.repeat(64), reason: 'death' as const };
    expect(await api.reportDeath('c', up)).toEqual({ ok: true });
    const init = fetch.mock.calls[2]?.[1];
    expect(fetch.mock.calls[2]?.[0]).toBe('https://api.test/v1/characters/c/death');
    expect((init?.headers as Record<string, string>)['x-dzsv-sha256']).toBe('f'.repeat(64));
    expect(cloudSaveOf({ version: 0, url: null })).toEqual({
      version: 0,
      url: null,
      checksum: null,
      sizeBytes: 0,
    });
  });

  it('weak ETag from the Supabase gateway goes back in If-Match exactly as received', async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) =>
      Promise.resolve(
        init.method === 'GET'
          ? json(200, { settings: { a: 1 }, version: 3, updatedAt: 'T' }, { etag: 'W/"3"' })
          : json(200, { settings: { a: 2 }, version: 4, updatedAt: 'T' }, { etag: 'W/"4"' }),
      ),
    );
    const api = createHttpAccountApi({ baseUrl: 'https://api.test', auth: auth(), fetch });
    const got = await api.getSettings();
    expect(got).toMatchObject({ ok: true, version: 3, etag: 'W/"3"' });
    if (!got.ok) throw new Error('get');
    const put = await api.putSettings({ a: 2 }, got.etag!);
    expect(put).toMatchObject({ ok: true, version: 4, etag: 'W/"4"' });
    expect((fetch.mock.calls[1]?.[1].headers as Record<string, string>)['if-match']).toBe('W/"3"');
    // A bare version is sent strong and quoted.
    await api.putSettings({ a: 2 }, 4);
    expect((fetch.mock.calls[2]?.[1].headers as Record<string, string>)['if-match']).toBe('"4"');
  });

  it('save: ETag of the answer kept, If-Match unchanged; versions parse from both formats', async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(json(200, { sizeBytes: 3 }, { etag: 'W/"8"' })),
    );
    const api = createHttpAccountApi({ baseUrl: 'https://api.test', auth: auth(), fetch });
    const up = { bytes: new Uint8Array([1]), sha256: 'a'.repeat(64), reason: 'autosave' as const };
    expect(await api.putSave('c', 'W/"7"', up)).toEqual({
      ok: true,
      version: 8,
      sizeBytes: 3,
      etag: 'W/"8"',
    });
    expect((fetch.mock.calls[0]?.[1].headers as Record<string, string>)['if-match']).toBe('W/"7"');
    expect(ifMatchHeader(7)).toBe('"7"');
    // No save on the server (409 `server: null`): ZAPISZ NA SERWERZE sends If-Match "0".
    expect(ifMatchHeader(0)).toBe('"0"');
    expect(ifMatchHeader('W/"7"')).toBe('W/"7"');
    expect(ifMatchHeader('"7"')).toBe('"7"');
    expect(versionOf('W/"15"')).toBe(15);
    expect(versionOf('w/"15"')).toBe(15);
    expect(versionOf('"15"')).toBe(15);
    expect(versionOf('15')).toBe(15);
    expect(versionOf('W/"x"')).toBe(0);
    expect(etagVersion(null)).toBeUndefined();
    // 409 `server.version` as a number or an ETag-like string.
    expect(
      conflictInfo({
        server: { version: 'W/"15"', gameDay: 14, minuteOfDay: 664, updatedAt: 'T' },
      }),
    ).toMatchObject({ version: 15 });
    expect(
      conflictInfo({ server: { version: '"15"', gameDay: 14, minuteOfDay: 664, updatedAt: 'T' } }),
    ).toMatchObject({ version: 15 });
    expect(cloudSaveOf({ url: null }, 'W/"5"')).toEqual({
      version: 5,
      url: null,
      checksum: null,
      sizeBytes: 0,
      etag: 'W/"5"',
    });
  });
});
