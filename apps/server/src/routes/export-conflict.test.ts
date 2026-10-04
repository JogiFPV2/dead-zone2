import { afterEach, describe, expect, it } from 'vitest';
import type { AccountExport, CharacterSummary } from '@deadzone/protocol';
import { USER_A, USER_B, checksum, envelope, setup, token } from '../test/fixtures.js';
import type { EnvelopeOpts } from '../test/fixtures.js';
import { realSave } from '../test/sim-save.js';
import { stateMinuteOfDay } from '../save/location.js';
import { EXPORT_URL_TTL_SECONDS } from './export.js';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;
afterEach(() => ctx?.app.close());

async function auth(user = USER_A) {
  return { authorization: `Bearer ${await token(user)}` };
}

async function create(c: Ctx, name = 'Ala', user = USER_A, world_settings = {}) {
  const res = await c.app.inject({
    method: 'POST',
    url: '/v1/characters',
    headers: await auth(user),
    payload: { name, world_settings },
  });
  return res.json<CharacterSummary>();
}

async function put(c: Ctx, ch: CharacterSummary, ifMatch: number, o: EnvelopeOpts = {}) {
  const body = envelope(ch.id, ch.worldSeed, o);
  return c.app.inject({
    method: 'PUT',
    url: `/v1/characters/${ch.id}/save`,
    headers: {
      ...(await auth()),
      'content-type': 'application/octet-stream',
      'x-dzsv-sha256': checksum(body),
      'if-match': String(ifMatch),
    },
    payload: body,
  });
}

const exportReq = async (c: Ctx, user = USER_A) =>
  c.app.inject({ method: 'GET', url: '/v1/me/export', headers: await auth(user) });

describe('409 save_version_conflict names the server save', () => {
  it('keeps error/message and adds server {version, gameDay, minuteOfDay, updatedAt}', async () => {
    ctx = setup();
    const ch = await create(ctx);
    expect((await put(ctx, ch, 0)).statusCode).toBe(200);
    expect((await put(ctx, ch, 1, { header: { gameDay: 5 } })).statusCode).toBe(200);
    const stale = await put(ctx, ch, 1, { header: { gameDay: 5 } });
    expect(stale.statusCode).toBe(409);
    const tick = (realSave(ch.worldSeed) as { tick: number }).tick;
    const saved = ctx.store.saves.get(ch.id)!;
    const body = stale.json<Record<string, unknown>>();
    expect(typeof body.message).toBe('string');
    expect({ ...body, message: undefined }).toEqual({
      error: 'save_version_conflict',
      message: undefined,
      server: {
        version: 2,
        gameDay: 5,
        minuteOfDay: stateMinuteOfDay(tick),
        updatedAt: saved.updated_at,
      },
    });
  });

  it('server is null when nothing is stored; old rows give minuteOfDay null', async () => {
    ctx = setup();
    const ch = await create(ctx);
    const none = await put(ctx, ch, 3);
    expect(none.statusCode).toBe(409);
    expect(none.json()).toMatchObject({ error: 'save_version_conflict', server: null });
    await put(ctx, ch, 0);
    ctx.store.saves.get(ch.id)!.minute_of_day = null; // row from before the column
    expect((await put(ctx, ch, 0)).json()).toMatchObject({
      server: { version: 1, minuteOfDay: null },
    });
  });

  it('a lost commit race also names the winning save', async () => {
    ctx = setup();
    const ch = await create(ctx);
    await put(ctx, ch, 0);
    // Another session commits between the pre-check and commit_save.
    const orig = ctx.store.commitSave.bind(ctx.store);
    ctx.store.commitSave = async (c) => {
      ctx.store.commitSave = orig;
      await orig({ ...c, storagePath: 'other', gameDay: 9 });
      return orig(c);
    };
    const res = await put(ctx, ch, 1);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ server: { version: 2, gameDay: 9 } });
  });

  it('minuteOfDay follows the sim clock and the character day length', async () => {
    ctx = setup();
    const ch = await create(ctx, 'Wolna', USER_A, { dayLengthMinutes: 120 });
    const base = realSave(ch.worldSeed);
    await put(ctx, ch, 0, { state: { ...base, tick: 36_000 } });
    // 120 real minutes per day: 36 000 ticks = 30 real min = 6 game hours after 09:00.
    expect(ctx.store.saves.get(ch.id)!.minute_of_day).toBe(15 * 60);
    expect(stateMinuteOfDay(36_000)).toBe(21 * 60);
    expect(stateMinuteOfDay(72_000)).toBe(9 * 60);
  });
});

describe('GET /v1/me/export', () => {
  it('exports profile, settings, all characters and signed save URLs', async () => {
    ctx = setup();
    const a = await create(ctx, 'Ala');
    const dead = await create(ctx, 'Bob');
    await create(ctx, 'Bez zapisu');
    await create(ctx, 'Obcy', USER_B);
    await put(ctx, a, 0);
    await put(ctx, dead, 0);
    const settings = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/settings',
      headers: { ...(await auth()), 'content-type': 'application/json', 'if-match': '"0"' },
      payload: { audio: { muted: true } },
    });
    expect(settings.statusCode).toBe(200);
    const death = envelope(dead.id, dead.worldSeed, { header: { reason: 'death', gameDay: 4 } });
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/characters/${dead.id}/death`,
      headers: {
        ...(await auth()),
        'content-type': 'application/octet-stream',
        'x-dzsv-sha256': checksum(death),
      },
      payload: death,
    });

    const res = await exportReq(ctx);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename=deadzone-export-2026-10-04.json',
    );
    const body = res.json<AccountExport>();
    expect(body).toMatchObject({
      format: 'deadzone-account-export',
      formatVersion: 1,
      profile: { id: USER_A, displayName: null },
      settings: { version: 1, settings: { audio: { muted: true } } },
      usage: { alive: 2, aliveLimit: 20, limitBytes: 50 * 1024 * 1024 },
    });
    expect(body.characters.map((c) => c.name).sort()).toEqual(['Ala', 'Bez zapisu', 'Bob']);
    const ala = body.characters.find((c) => c.name === 'Ala')!;
    const saveRow = ctx.store.saves.get(a.id)!;
    expect(ala.save).toEqual({
      version: 1,
      sizeBytes: saveRow.size_bytes,
      sha256: saveRow.checksum,
      gameDay: 3,
      minuteOfDay: saveRow.minute_of_day,
      updatedAt: saveRow.updated_at,
      downloadUrl: `https://storage.test/${saveRow.storage_path}?ttl=${EXPORT_URL_TTL_SECONDS}`,
      expiresInSeconds: 600,
    });
    expect(ala.lastLocation).toMatchObject({ z: 0 });
    expect(body.usage.usedBytes).toBe(saveRow.size_bytes);
    // Tombstone: metadata and its last location, no save.
    const bob = body.characters.find((c) => c.name === 'Bob')!;
    expect(bob).toMatchObject({ status: 'dead', daysSurvived: 4, save: null });
    expect(bob.diedAt).toEqual(expect.any(String));
    expect(bob.lastLocation).not.toBeNull();
    expect(body.characters.find((c) => c.name === 'Bez zapisu')).toMatchObject({
      save: null,
      lastLocation: null,
    });
    // Nothing of the other account, no internal paths or ids beyond the own user id.
    expect(JSON.stringify(body)).not.toContain(USER_B);
    expect(JSON.stringify(body)).not.toContain('storage_path');
    expect(body.characters[0]).not.toHaveProperty('user_id');
  });

  it('5 exports per hour per account, then 429 with Retry-After', async () => {
    ctx = setup();
    for (let i = 0; i < 5; i++) expect((await exportReq(ctx)).statusCode).toBe(200);
    const limited = await exportReq(ctx);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect((await exportReq(ctx, USER_B)).statusCode).toBe(200);
  });

  it('needs an existing account', async () => {
    ctx = setup();
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me/export' })).statusCode).toBe(401);
    ctx.store.profiles.delete(USER_A);
    expect((await exportReq(ctx)).statusCode).toBe(401);
  });

  it('counts against the per-IP limit', async () => {
    ctx = setup({ maxIpRequestsPer5Min: 2 });
    await exportReq(ctx);
    await exportReq(ctx, USER_B);
    expect((await exportReq(ctx)).statusCode).toBe(429);
  });
});
