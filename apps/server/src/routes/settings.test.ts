import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerSettingsResponse } from '@deadzone/protocol';
import { defaultPlayerSettings, PLAYER_SETTINGS_MAX_BYTES } from '@deadzone/ui/settings';
import { USER_A, USER_B, setup, token } from '../test/fixtures.js';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;
afterEach(() => ctx?.app.close());

async function auth(user = USER_A) {
  return { authorization: `Bearer ${await token(user)}` };
}

async function get(c: Ctx, user = USER_A) {
  return c.app.inject({ method: 'GET', url: '/v1/me/settings', headers: await auth(user) });
}

async function put(c: Ctx, body: unknown, ifMatch?: string, user = USER_A) {
  return c.app.inject({
    method: 'PUT',
    url: '/v1/me/settings',
    headers: {
      ...(await auth(user)),
      'content-type': 'application/json',
      ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
    },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('GET/PUT /v1/me/settings', () => {
  it('starts empty with ETag "0"', async () => {
    ctx = setup();
    const res = await get(ctx);
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe('"0"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ settings: null, version: 0, updatedAt: null });
  });

  it('stores only the validated output and bumps the ETag', async () => {
    ctx = setup();
    const res = await put(
      ctx,
      { graphics: { style: 'pixel', uiScale: 1.1 }, audio: { muted: true }, hacker: { x: 1 } },
      '"0"',
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers.etag).toBe('"1"');
    const want = defaultPlayerSettings();
    want.graphics.style = 'pixel';
    want.graphics.uiScale = 1.1;
    want.audio.muted = true;
    const body = res.json<PlayerSettingsResponse>();
    expect(body).toMatchObject({ settings: want, version: 1 });
    expect(body.settings).not.toHaveProperty('hacker');
    expect(body.updatedAt).toEqual(expect.any(String));

    const again = await get(ctx);
    expect(again.headers.etag).toBe('"1"');
    expect(again.json<PlayerSettingsResponse>().settings).toEqual(want);
    // Unquoted and weak forms of the ETag are accepted.
    expect((await put(ctx, {}, '1')).headers.etag).toBe('"2"');
    expect((await put(ctx, {}, 'W/"2"')).headers.etag).toBe('"3"');
  });

  it('needs If-Match (428) and rejects a stale one (412) without writing', async () => {
    ctx = setup();
    expect((await put(ctx, {})).statusCode).toBe(428);
    expect((await put(ctx, {})).json()).toMatchObject({ error: 'precondition_required' });
    expect((await put(ctx, {}, 'abc')).statusCode).toBe(400);
    await put(ctx, { audio: { muted: true } }, '"0"');
    const stale = await put(ctx, { audio: { muted: false } }, '"0"');
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ error: 'settings_version_conflict' });
    const cur = (await get(ctx)).json<PlayerSettingsResponse>();
    expect(cur).toMatchObject({ version: 1, settings: { audio: { muted: true } } });
  });

  it('invalid settings → 422 with issues', async () => {
    ctx = setup();
    const res = await put(ctx, { graphics: { style: 'neon', uiScale: 9 } }, '"0"');
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: string; issues: { path: unknown[]; message: string }[] }>();
    expect(body.error).toBe('invalid_settings');
    expect(body.issues.length).toBeGreaterThanOrEqual(2);
    expect(body.issues.map((i) => i.path.join('.'))).toEqual(
      expect.arrayContaining(['graphics.style', 'graphics.uiScale']),
    );
    expect((await get(ctx)).json()).toMatchObject({ version: 0 });
  });

  it('not an object → 400; over 16 KB → 413', async () => {
    ctx = setup();
    for (const b of ['[]', '"x"', 'null', '{bad json']) {
      expect((await put(ctx, b, '"0"')).statusCode, b).toBe(400);
    }
    const big = await put(ctx, { pad: 'x'.repeat(PLAYER_SETTINGS_MAX_BYTES) }, '"0"');
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ error: 'payload_too_large' });
  });

  it('each account sees only its own settings; auth required', async () => {
    ctx = setup();
    await put(ctx, { audio: { muted: true } }, '"0"');
    expect((await get(ctx, USER_B)).json()).toMatchObject({ settings: null, version: 0 });
    const anon = await ctx.app.inject({ method: 'GET', url: '/v1/me/settings' });
    expect(anon.statusCode).toBe(401);
  });

  it('a deleted account gets 401 and its settings are gone', async () => {
    ctx = setup();
    await put(ctx, { audio: { muted: true } }, '"0"');
    const del = await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: await auth() });
    expect(del.statusCode).toBe(204);
    expect(ctx.store.settings.has(USER_A)).toBe(false);
    expect((await get(ctx)).statusCode).toBe(401);
    expect((await put(ctx, {}, '"1"')).statusCode).toBe(401);
  });

  it('counts against the per-IP limit', async () => {
    ctx = setup({ maxIpRequestsPer5Min: 3 });
    for (let i = 0; i < 3; i++) expect((await get(ctx)).statusCode).toBe(200);
    const limited = await get(ctx);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
