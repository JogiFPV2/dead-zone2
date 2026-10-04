import { afterEach, describe, expect, it } from 'vitest';
import {
  CORS_ALLOW_HEADERS,
  CORS_ALLOW_METHODS,
  CORS_EXPOSE_HEADERS,
  DEFAULT_CORS_ORIGINS,
  corsFor,
  parseCorsOrigins,
} from './cors.js';
import { loadConfig } from './config.js';
import { USER_A, setup, token } from './test/fixtures.js';

const PAGES = 'https://jogifpv2.github.io';
const EVIL = 'https://evil.example';

describe('parseCorsOrigins', () => {
  it('defaults, trims, dedupes and accepts bare origins only', () => {
    expect(parseCorsOrigins(undefined)).toEqual(DEFAULT_CORS_ORIGINS);
    expect(parseCorsOrigins(' , ')).toEqual(DEFAULT_CORS_ORIGINS);
    expect(
      parseCorsOrigins(' https://a.example , http://localhost:5173,https://a.example'),
    ).toEqual(['https://a.example', 'http://localhost:5173']);
    // Host case is normalized (browsers send lower case).
    expect(parseCorsOrigins('https://A.example')).toEqual(['https://a.example']);
    for (const bad of [
      '*',
      'https://*.example',
      'https://a.example/',
      'https://a.example/path',
      'https://a.example?x=1',
      'a.example',
      'ftp://a.example',
    ]) {
      expect(() => parseCorsOrigins(bad), bad).toThrow(/CORS_ORIGINS/);
    }
  });

  it('is read from CORS_ORIGINS by loadConfig', () => {
    const base = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    expect(loadConfig(base).corsOrigins).toEqual([PAGES, 'http://localhost:5173']);
    expect(loadConfig({ ...base, CORS_ORIGINS: 'https://b.example' }).corsOrigins).toEqual([
      'https://b.example',
    ]);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: '*' })).toThrow();
  });
});

describe('corsFor', () => {
  const allowed = [PAGES];
  it('echoes an allowed origin; preflight gets methods, headers, max-age', () => {
    expect(corsFor(allowed, { method: 'GET', origin: PAGES, requestMethod: undefined })).toEqual({
      preflight: false,
      headers: {
        vary: 'Origin',
        'access-control-allow-origin': PAGES,
        'access-control-expose-headers': CORS_EXPOSE_HEADERS,
      },
    });
    expect(corsFor(allowed, { method: 'OPTIONS', origin: PAGES, requestMethod: 'PUT' })).toEqual({
      preflight: true,
      headers: {
        vary: 'Origin',
        'access-control-allow-origin': PAGES,
        'access-control-allow-methods': CORS_ALLOW_METHODS,
        'access-control-allow-headers': CORS_ALLOW_HEADERS,
        'access-control-max-age': '600',
      },
    });
  });

  it('no CORS headers without an allowed Origin; never credentials or *', () => {
    for (const origin of [undefined, EVIL, `${PAGES}.evil.example`, 'null']) {
      const r = corsFor(allowed, { method: 'OPTIONS', origin, requestMethod: 'GET' });
      expect(r.headers).toEqual({ vary: 'Origin' });
    }
    const ok = corsFor(allowed, { method: 'GET', origin: PAGES, requestMethod: undefined });
    expect(ok.headers).not.toHaveProperty('access-control-allow-credentials');
    // OPTIONS without Access-Control-Request-Method is not a preflight.
    expect(
      corsFor(allowed, { method: 'OPTIONS', origin: PAGES, requestMethod: undefined }),
    ).toMatchObject({
      preflight: false,
    });
  });
});

describe('CORS on the app', () => {
  type Ctx = ReturnType<typeof setup>;
  let ctx: Ctx;
  afterEach(() => ctx?.app.close());

  const preflight = (c: Ctx, origin: string, url = '/v1/characters/x/save') =>
    c.app.inject({
      method: 'OPTIONS',
      url,
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization, content-type, if-match, x-dzsv-sha256',
      },
    });

  it('answers a preflight with 204 and the allowlisted headers', async () => {
    ctx = setup();
    const res = await preflight(ctx, PAGES);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers).toMatchObject({
      'access-control-allow-origin': PAGES,
      'access-control-allow-methods': CORS_ALLOW_METHODS,
      'access-control-allow-headers': CORS_ALLOW_HEADERS,
      'access-control-max-age': '600',
      vary: 'Origin',
    });
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    const evil = await preflight(ctx, EVIL);
    expect(evil.statusCode).toBe(204);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    expect(evil.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('preflights do not count against the IP limit', async () => {
    ctx = setup({ maxIpRequestsPer5Min: 1 });
    for (let i = 0; i < 5; i++) expect((await preflight(ctx, PAGES)).statusCode).toBe(204);
    const get = await ctx.app.inject({
      method: 'GET',
      url: '/v1/characters',
      headers: { origin: PAGES, authorization: `Bearer ${await token(USER_A)}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers['access-control-allow-origin']).toBe(PAGES);
    expect(get.headers['access-control-expose-headers']).toBe(CORS_EXPOSE_HEADERS);
    // The next real request hits the limit; the 429 still carries CORS (Retry-After readable).
    const limited = await ctx.app.inject({
      method: 'GET',
      url: '/v1/characters',
      headers: { origin: PAGES },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['access-control-allow-origin']).toBe(PAGES);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('error responses carry CORS headers (401/409/412/413/422/428)', async () => {
    ctx = setup();
    const auth = { origin: PAGES, authorization: `Bearer ${await token(USER_A)}` };
    const json = { ...auth, 'content-type': 'application/json' };
    const cases = [
      // 401
      await ctx.app.inject({ method: 'GET', url: '/v1/characters', headers: { origin: PAGES } }),
      // 428, then 412 (stale If-Match), 422 (invalid), 413 (body limit)
      await ctx.app.inject({ method: 'PUT', url: '/v1/me/settings', headers: json, payload: {} }),
      await ctx.app.inject({
        method: 'PUT',
        url: '/v1/me/settings',
        headers: { ...json, 'if-match': '"7"' },
        payload: {},
      }),
      await ctx.app.inject({
        method: 'PUT',
        url: '/v1/me/settings',
        headers: { ...json, 'if-match': '"0"' },
        payload: { graphics: { style: 'neon' } },
      }),
      await ctx.app.inject({
        method: 'PUT',
        url: '/v1/me/settings',
        headers: { ...json, 'if-match': '"0"' },
        payload: { pad: 'x'.repeat(20_000) },
      }),
    ];
    expect(cases.map((r) => r.statusCode)).toEqual([401, 428, 412, 422, 413]);
    for (const r of cases) {
      expect(r.headers['access-control-allow-origin'], String(r.statusCode)).toBe(PAGES);
      expect(r.headers.vary).toContain('Origin');
    }
    // 409: save with a stale If-Match.
    const ch = await ctx.app.inject({
      method: 'POST',
      url: '/v1/characters',
      headers: json,
      payload: { name: 'Ala' },
    });
    const { envelope, checksum } = await import('./test/fixtures.js');
    const { id, worldSeed } = ch.json<{ id: string; worldSeed: number }>();
    const body = envelope(id, worldSeed);
    const conflict = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/characters/${id}/save`,
      headers: {
        ...auth,
        'content-type': 'application/octet-stream',
        'x-dzsv-sha256': checksum(body),
        'if-match': '3',
      },
      payload: body,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.headers['access-control-allow-origin']).toBe(PAGES);
  });

  it('requests without Origin work and get no CORS headers; foreign origins too', async () => {
    ctx = setup();
    const plain = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['access-control-allow-origin']).toBeUndefined();
    const evil = await ctx.app.inject({ method: 'GET', url: '/health', headers: { origin: EVIL } });
    expect(evil.statusCode).toBe(200);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    expect(evil.headers.vary).toContain('Origin');
  });

  it('uses a custom allowlist', async () => {
    ctx = setup({}, { corsOrigins: ['https://b.example'] });
    expect((await preflight(ctx, PAGES)).headers['access-control-allow-origin']).toBeUndefined();
    expect((await preflight(ctx, 'https://b.example')).headers['access-control-allow-origin']).toBe(
      'https://b.example',
    );
  });
});
