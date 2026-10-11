import { describe, expect, it } from 'vitest';
import { CloudSaver, cloudReasonOf } from './cloud-save.js';
import { decodeEnvelope, sha256Hex } from './dzsv.js';
import { createMockAccountApi } from './mock-api.js';
import type { AccountApi, IfMatch, SaveResult, SaveUpload } from './account-api.js';

const state = (day: number) => ({
  tick: day * 100,
  day,
  minuteOfDay: 360,
  reason: 'autosave',
  data: new TextEncoder().encode(JSON.stringify({ format: 'deadzone-save', day })).buffer,
});
const slot = { id: 'c1', worldSeed: 42, worldgenVersion: 1 };

/** putSave answers in order; records If-Match and uploads. */
function scripted(answers: SaveResult[]) {
  const calls: { ifMatch: IfMatch; upload: SaveUpload }[] = [];
  const api: Pick<AccountApi, 'putSave' | 'reportDeath'> = {
    putSave: (_id, ifMatch, upload) => {
      calls.push({ ifMatch, upload });
      return Promise.resolve(answers.shift() ?? { ok: false, reason: 'network' });
    },
    reportDeath: () => Promise.resolve({ ok: true }),
  };
  return { api, calls };
}

describe('CloudSaver (PUT /v1/characters/:id/save)', () => {
  it('sends a DZSV envelope with its SHA-256 and If-Match, then the new version', async () => {
    const { api, calls } = scripted([
      { ok: true, version: 8, sizeBytes: 10 },
      { ok: true, version: 9, sizeBytes: 10 },
    ]);
    const s = new CloudSaver({ api, character: slot, version: 7, formatVersion: 3, now: () => 5 });
    expect(await s.write(state(12))).toEqual({ ok: true, version: 8 });
    expect(await s.write(state(13))).toEqual({ ok: true, version: 9 });
    expect(calls.map((c) => c.ifMatch)).toEqual([7, 8]);
    const up = calls[0]!.upload;
    expect(up.sha256).toBe(await sha256Hex(up.bytes));
    expect(up.reason).toBe('autosave');
    const { header, state: raw } = await decodeEnvelope(up.bytes);
    expect(header).toMatchObject({
      characterId: 'c1',
      world_seed: 42,
      worldgen_version: 1,
      gameDay: 12,
      formatVersion: 3,
      reason: 'autosave',
    });
    expect(JSON.parse(new TextDecoder().decode(raw))).toEqual({ format: 'deadzone-save', day: 12 });
    expect(s.lastSave).toEqual({ day: 13, minuteOfDay: 360, savedAt: 5 });
  });

  it('409 blocks writes; NADPISZ SERWER re-sends the refused save with the server version', async () => {
    const server = {
      version: 15,
      gameDay: 14,
      minuteOfDay: 664,
      updatedAt: '2026-10-11T09:04:00Z',
    };
    const { api, calls } = scripted([
      { ok: false, reason: 'conflict', server },
      { ok: true, version: 16, sizeBytes: 10 },
      { ok: true, version: 17, sizeBytes: 10 },
    ]);
    const s = new CloudSaver({ api, character: slot, version: 7, formatVersion: 3 });
    expect(await s.write(state(12))).toMatchObject({ ok: false, reason: 'conflict', server });
    expect(s.blocked).toBe('conflict');
    // Another autosave while the window is open: not sent.
    expect(await s.write(state(13))).toMatchObject({ ok: false, reason: 'conflict' });
    expect(calls).toHaveLength(1);
    expect(await s.overwrite()).toEqual({ ok: true, version: 16 });
    expect(calls[1]!.ifMatch).toBe(15);
    expect(calls[1]!.upload).toBe(calls[0]!.upload);
    expect(s.blocked).toBeUndefined();
    expect(await s.write(state(13))).toEqual({ ok: true, version: 17 });
    expect(calls[2]!.ifMatch).toBe(16);
  });

  it('409 with server: null overwrites with If-Match 0; 410 cannot be overwritten', async () => {
    const { api, calls } = scripted([
      { ok: false, reason: 'conflict', server: null },
      { ok: true, version: 1, sizeBytes: 10 },
      { ok: false, reason: 'gone' },
    ]);
    const s = new CloudSaver({ api, character: slot, version: 3, formatVersion: 3 });
    await s.write(state(1));
    expect(await s.overwrite()).toEqual({ ok: true, version: 1 });
    expect(calls[1]!.ifMatch).toBe(0);
    expect(await s.write(state(2))).toMatchObject({ ok: false, reason: 'gone' });
    expect(await s.overwrite()).toMatchObject({ ok: false, reason: 'gone' });
    expect(calls).toHaveLength(3);
  });

  it('network failure keeps the version (the next save retries)', async () => {
    const { api, calls } = scripted([
      { ok: false, reason: 'network' },
      { ok: true, version: 5, sizeBytes: 1 },
    ]);
    const s = new CloudSaver({ api, character: slot, version: 4, formatVersion: 3 });
    expect(await s.write(state(1))).toMatchObject({ ok: false, reason: 'failed' });
    expect(s.blocked).toBeUndefined();
    expect(await s.write(state(2))).toEqual({ ok: true, version: 5 });
    expect(calls.map((c) => c.ifMatch)).toEqual([4, 4]);
  });

  it('works against the mock: conflict mode, then NADPISZ SERWER wins', async () => {
    const api = createMockAccountApi({ latencyMs: 0, signedInAs: 'google', save: 'conflict' });
    const list = await api.listCharacters();
    if (!list.ok) throw new Error('list');
    const marta = list.characters[0]!;
    const v = marta.save!.version;
    const s = new CloudSaver({ api, character: { ...marta }, version: v, formatVersion: 3 });
    expect(await s.write(state(12))).toMatchObject({
      reason: 'conflict',
      server: { version: v + 1 },
    });
    expect(await s.overwrite()).toEqual({ ok: true, version: v + 2 });
    expect(await s.write(state(13))).toEqual({ ok: true, version: v + 3 });
    const open = await api.openSave(marta.id);
    expect(open).toMatchObject({
      ok: true,
      save: { version: v + 3, url: `mock://saves/${marta.id}` },
    });
  });

  it('sends back the weak ETag of open / the last save; NADPISZ uses the 409 version', async () => {
    const server = { version: 15, gameDay: 14, minuteOfDay: null, updatedAt: 'T' };
    const { api, calls } = scripted([
      { ok: true, version: 8, sizeBytes: 1, etag: 'W/"8"' },
      { ok: false, reason: 'conflict', server },
      { ok: true, version: 16, sizeBytes: 1, etag: 'W/"16"' },
      { ok: true, version: 17, sizeBytes: 1 },
    ]);
    const s = new CloudSaver({ api, character: slot, version: 7, etag: 'W/"7"', formatVersion: 3 });
    await s.write(state(1));
    await s.write(state(2));
    await s.overwrite();
    await s.write(state(3));
    expect(calls.map((c) => c.ifMatch)).toEqual(['W/"7"', 'W/"8"', 15, 'W/"16"']);
  });

  it('maps sim reasons to cloud reasons (never death on PUT)', () => {
    expect(cloudReasonOf('sleep')).toBe('sleep');
    expect(cloudReasonOf('exit')).toBe('exit');
    expect(cloudReasonOf('death')).toBe('manual');
    expect(cloudReasonOf('migrated')).toBe('manual');
  });
});
