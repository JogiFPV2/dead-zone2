import { afterEach, describe, expect, it } from 'vitest';
import type {
  AccountExport,
  CharacterSummary,
  PlayerSettingsResponse,
  PutSaveResponse,
} from '@deadzone/protocol';
import { PLACES_FILES } from '@deadzone/content/places';
import { loadPlaces } from '@deadzone/content/node';
import { USER_A, checksum, envelope, setup, token } from '../test/fixtures.js';
import { createInlineValidator } from '../save/validate.js';
import { BUNDLED_PLACES_FILES, createBundledPlaces } from '../edge-places.js';
import { EDGE_DEFAULTS, loadEdgeConfig } from '../edge.js';
import { createApi } from './api.js';
import { clientIp, fetchHandler, stripBasePath } from './fetch.js';
import type { Logger } from './core.js';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const ORIGIN = 'https://jogifpv2.github.io';
const BASE = 'https://ref.supabase.co/functions/v1/api';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;
afterEach(() => ctx?.app.close());

/** The Edge Function path: Web Request → fetch adapter → API core (inline validation). */
function edge(c: Ctx) {
  const api = createApi({
    characters: { ...c.characters, validator: createInlineValidator() },
  });
  const handle = fetchHandler(api, { log: quiet, basePaths: ['/functions/v1/api', '/api'] });
  return (path: string, init: RequestInit = {}) =>
    handle(new Request(`${BASE}${path}`, init), { remoteAddr: { hostname: '10.0.0.1' } });
}

async function auth(): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await token(USER_A)}`, origin: ORIGIN };
}

describe('fetch adapter helpers', () => {
  it('strips the function base path', () => {
    const bases = ['/functions/v1/api', '/api'];
    expect(stripBasePath('/api/v1/characters', bases)).toBe('/v1/characters');
    expect(stripBasePath('/functions/v1/api/health', bases)).toBe('/health');
    expect(stripBasePath('/api', bases)).toBe('/');
    expect(stripBasePath('/apix/v1', bases)).toBe('/apix/v1');
    expect(stripBasePath('/v1/characters', bases)).toBe('/v1/characters');
  });

  it('takes the client IP through the trusted proxy hops', () => {
    expect(clientIp('1.1.1.1, 2.2.2.2', '9.9.9.9', 0)).toBe('9.9.9.9');
    expect(clientIp('1.1.1.1, 2.2.2.2', '9.9.9.9', 1)).toBe('2.2.2.2');
    expect(clientIp('1.1.1.1, 2.2.2.2', '9.9.9.9', 2)).toBe('1.1.1.1');
    expect(clientIp('1.1.1.1', '9.9.9.9', 5)).toBe('1.1.1.1');
    expect(clientIp(null, '9.9.9.9', 1)).toBe('9.9.9.9');
  });
});

describe('Edge Function API (fetch adapter + inline validation)', () => {
  it('health, CORS preflight and 404', async () => {
    ctx = setup();
    const call = edge(ctx);
    const health = await call('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });

    const pre = await call('/v1/characters', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'PUT' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(pre.headers.get('access-control-allow-headers')).toContain('X-DZSV-SHA256');
    expect(pre.headers.get('access-control-max-age')).toBe('600');

    const evil = await call('/v1/characters', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();

    const missing = await call('/v1/nope', { headers: await auth() });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await call('/v1/characters')).status).toBe(401);
  });

  it('characters, save, 409 conflict, settings and export', async () => {
    ctx = setup();
    const call = edge(ctx);
    const created = await call('/v1/characters', {
      method: 'POST',
      headers: { ...(await auth()), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ala', world_settings: { map: 'osm-stw' } }),
    });
    expect(created.status).toBe(201);
    const ch = (await created.json()) as CharacterSummary;

    const body = envelope(ch.id, ch.worldSeed);
    const put = (version: number) =>
      auth().then((h) =>
        call(`/v1/characters/${ch.id}/save`, {
          method: 'PUT',
          headers: {
            ...h,
            'content-type': 'application/octet-stream',
            'x-dzsv-sha256': checksum(body),
            'if-match': String(version),
          },
          body: new Uint8Array(body),
        }),
      );
    const saved = await put(0);
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(((await saved.json()) as PutSaveResponse).version).toBe(1);
    const stale = await put(0);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: 'save_version_conflict',
      server: { version: 1 },
    });

    const list = await call('/v1/characters', { headers: await auth() });
    const listed = ((await list.json()) as { characters: CharacterSummary[] }).characters[0]!;
    expect(listed.lastLocation?.place).toEqual(expect.any(String));

    const open = await call(`/v1/characters/${ch.id}/open`, {
      method: 'POST',
      headers: await auth(),
    });
    expect(await open.json()).toMatchObject({ version: 1, checksum: checksum(body) });

    const s0 = await call('/v1/me/settings', { headers: await auth() });
    expect(s0.headers.get('etag')).toBe('"0"');
    const s1 = await call('/v1/me/settings', {
      method: 'PUT',
      headers: { ...(await auth()), 'content-type': 'application/json', 'if-match': '"0"' },
      body: JSON.stringify({ audio: { muted: true } }),
    });
    expect(s1.status).toBe(200);
    expect(((await s1.json()) as PlayerSettingsResponse).version).toBe(1);
    const big = await call('/v1/me/settings', {
      method: 'PUT',
      headers: { ...(await auth()), 'content-type': 'application/json', 'if-match': '"1"' },
      body: JSON.stringify({ pad: 'x'.repeat(40_000) }),
    });
    expect(big.status).toBe(413);

    const exp = await call('/v1/me/export', { headers: await auth() });
    expect(exp.status).toBe(200);
    expect(exp.headers.get('content-disposition')).toMatch(/deadzone-export-/);
    expect(exp.headers.get('access-control-expose-headers')).toContain('Content-Disposition');
    const file = (await exp.json()) as AccountExport;
    expect(file.characters[0]?.save?.version).toBe(1);

    const del = await call(`/v1/characters/${ch.id}`, { method: 'DELETE', headers: await auth() });
    expect(del.status).toBe(204);
    expect(await del.text()).toBe('');
  });
});

describe('bundled places (Edge)', () => {
  it('every places file of the content registry is bundled and matches the file on disk', async () => {
    for (const file of Object.values(PLACES_FILES)) {
      expect(Object.hasOwn(BUNDLED_PLACES_FILES, file), file).toBe(true);
    }
    const places = createBundledPlaces();
    expect(await places('osm-stw')).toEqual(await loadPlaces('osm-stw'));
    expect(await places('test-town')).toBeNull();
    expect(await places(null)).toBeNull();
    await expect(createBundledPlaces({ 'stalowa-wola.json': [{}] })('osm-stw')).rejects.toThrow();
  });
});

describe('edge config', () => {
  it('lower state limit by default, env wins, required env checked', () => {
    const env = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const c = loadEdgeConfig(env);
    expect(c.limits.maxStateBytes).toBe(Number(EDGE_DEFAULTS.LIMIT_STATE_BYTES));
    expect(c.trustProxyHops).toBe(1);
    expect(c.jwtIssuer).toBe('https://ref.supabase.co/auth/v1');
    expect(loadEdgeConfig({ ...env, LIMIT_STATE_BYTES: '4096' }).limits.maxStateBytes).toBe(4096);
    expect(loadEdgeConfig({ ...env, JWT_ISSUER: 'http://x/auth/v1' }).jwtIssuer).toBe(
      'http://x/auth/v1',
    );
    expect(() => loadEdgeConfig({ SUPABASE_URL: 'https://ref.supabase.co' })).toThrow();
  });
});
