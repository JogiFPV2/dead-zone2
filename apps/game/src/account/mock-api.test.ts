import { describe, expect, it } from 'vitest';
import { defaultPlayerSettings } from '@deadzone/ui/settings';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import { createMockAccountApi, MOCK_EMAIL } from './mock-api.js';
import { createOfflineAccountApi } from './offline-api.js';
import { resolveAccountApi } from './resolve.js';

const save = { bytes: new Uint8Array(10), sha256: 'x', reason: 'autosave' as const };

describe('account API selection', () => {
  it('is offline by default; ?online=mock gives the demo account', async () => {
    const off = resolveAccountApi('');
    expect(off.mode).toBe('offline');
    expect(off.online).toBe(false);
    expect(await off.listCharacters()).toEqual({ ok: false, reason: 'offline' });
    expect(resolveAccountApi('?online=mock').mode).toBe('mock');
    // A server URL without a sign-in provider is not "configured".
    expect(resolveAccountApi('', { apiUrl: 'https://x' }).mode).toBe('offline');
    expect((await createOfflineAccountApi().signInWithGoogle()).ok).toBe(false);
  });
});

describe('mock account', () => {
  it('auth errors on demand and a successful e-mail login', async () => {
    const api = createMockAccountApi({ latencyMs: 0 });
    expect(await api.signInWithPassword(MOCK_EMAIL, 'x', '')).toEqual({
      ok: false,
      code: 'captcha-required',
    });
    expect(await api.signInWithPassword(MOCK_EMAIL, 'zle', 'c')).toEqual({
      ok: false,
      code: 'invalid-credentials',
    });
    expect(await api.signInWithPassword('limit@x.pl', 'x', 'c')).toMatchObject({
      code: 'rate-limited',
      retryAfterMin: 5,
    });
    expect(await api.signUp(MOCK_EMAIL, 'dlugiehaslo', 'c')).toEqual({
      ok: false,
      code: 'email-taken',
    });
    expect(await api.listCharacters()).toEqual({ ok: false, reason: 'unauthorized' });
    const r = await api.signInWithPassword('ewa@x.pl', 'haslo123', 'c');
    expect(r).toMatchObject({ ok: true, user: { email: 'ewa@x.pl', method: 'email' } });
  });

  it('lists the mockup account with usage (tombstones not counted)', async () => {
    const api = createMockAccountApi({ latencyMs: 0, signedInAs: 'google' });
    const r = await api.listCharacters();
    if (!r.ok) throw new Error('list');
    expect(r.characters).toHaveLength(4);
    expect(r.usage).toMatchObject({ alive: 3, aliveLimit: 20, limitBytes: 50 * 1024 * 1024 });
    expect(r.characters.find((c) => c.name === 'Ola Zielińska')?.lastLocation).toBeNull();
  });

  it('saves with If-Match: ok, conflict (with / without the newer save) and gone', async () => {
    const api = createMockAccountApi({ latencyMs: 0, signedInAs: 'google' });
    const list = await api.listCharacters();
    if (!list.ok) throw new Error('list');
    const marta = list.characters[0]!;
    const v = marta.save!.version;
    expect(await api.putSave(marta.id, v, save)).toMatchObject({ ok: true, version: v + 1 });
    expect(await api.putSave(marta.id, v, save)).toMatchObject({
      ok: false,
      reason: 'conflict',
      server: { gameDay: 14, minuteOfDay: 664 },
    });
    api.setSaveMode('conflict-nominute');
    expect(await api.putSave(marta.id, v + 1, save)).toMatchObject({
      server: { gameDay: 14, minuteOfDay: null },
    });
    api.setSaveMode('conflict-bare');
    expect(await api.putSave(marta.id, v + 1, save)).toEqual({
      ok: false,
      reason: 'conflict',
      server: null,
    });
    api.setSaveMode('gone');
    expect(await api.putSave(marta.id, v + 1, save)).toEqual({ ok: false, reason: 'gone' });
  });

  it('export: AccountExport with 600 s save URLs for living characters; 5/h then 429', async () => {
    let t = Date.UTC(2026, 9, 4, 20);
    const api = createMockAccountApi({ latencyMs: 0, signedInAs: 'google', now: () => t });
    const r = await api.exportData();
    if (!r.ok) throw new Error('export');
    expect(r.fileName).toBe('deadzone-export-2026-10-04.json');
    expect(r.data).toMatchObject({ format: 'deadzone-account-export', formatVersion: 1 });
    expect(r.data.usage.alive).toBe(3);
    for (const c of r.data.characters) {
      if (c.status === 'dead') expect(c.save).toBeNull();
      else if (c.save) {
        expect(c.save.expiresInSeconds).toBe(600);
        expect(c.save.downloadUrl).toMatch(/^mock:\/\/saves\//);
      }
    }
    for (let i = 0; i < 4; i++) expect((await api.exportData()).ok).toBe(true);
    t += 10 * 60_000;
    expect(await api.exportData()).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterSec: 50 * 60,
    });
    t += 50 * 60_000;
    expect((await api.exportData()).ok).toBe(true);
  });

  it('settings: version check, validation, 16 KB limit; delete account logs out', async () => {
    const api = createMockAccountApi({ latencyMs: 0, signedInAs: 'email' });
    expect(await api.getSettings()).toEqual({
      ok: true,
      version: 0,
      settings: null,
      updatedAt: null,
    });
    const p = defaultPlayerSettings();
    expect(await api.putSettings(p, 1)).toEqual({ ok: false, reason: 'conflict' });
    // The client's local `Settings` (version 4) is not the cloud object (version 1).
    expect(await api.putSettings(DEFAULT_SETTINGS, 0)).toMatchObject({ reason: 'invalid' });
    expect(await api.putSettings(p, 0)).toMatchObject({ ok: true, version: 1, settings: p });
    expect(await api.putSettings({ big: 'x'.repeat(17_000) }, 1)).toEqual({
      ok: false,
      reason: 'too-large',
    });
    expect(await api.putSettings('nope', 1)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await api.deleteAccount()).toEqual({ ok: true });
    expect(await api.session()).toBeUndefined();
  });
});
