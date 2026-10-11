import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterSummary, ListCharactersResponse } from '@deadzone/protocol';
import { loadPlaces } from '@deadzone/content/node';
import { nearestPlace } from '@deadzone/content/places';
import { USER_A, checksum, envelope, setup, token } from '../test/fixtures.js';
import { validateEnvelope } from '../save/validate.js';
import { summarizeLocation, type SaveSummaryFn } from '../save/location.js';
import type { SaveValidator } from '../save/worker-pool.js';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;
afterEach(() => ctx?.app.close());

const STW = await loadPlaces('osm-stw');

function validatorWith(fn: SaveSummaryFn): SaveValidator {
  return {
    validate: (bytes, opts) => Promise.resolve(validateEnvelope(bytes, opts, fn)),
    close: () => Promise.resolve(),
  };
}

async function auth() {
  return { authorization: `Bearer ${await token(USER_A)}` };
}

async function create(c: Ctx, worldSettings?: Record<string, unknown>) {
  const res = await c.app.inject({
    method: 'POST',
    url: '/v1/characters',
    headers: await auth(),
    payload: { name: 'Ala', ...(worldSettings ? { world_settings: worldSettings } : {}) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<CharacterSummary>();
}

async function save(c: Ctx, ch: CharacterSummary, version = 0) {
  const body = envelope(ch.id, ch.worldSeed);
  const res = await c.app.inject({
    method: 'PUT',
    url: `/v1/characters/${ch.id}/save`,
    headers: {
      ...(await auth()),
      'content-type': 'application/octet-stream',
      'x-dzsv-sha256': checksum(body),
      'if-match': String(version),
    },
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function location(c: Ctx) {
  const res = await c.app.inject({ method: 'GET', url: '/v1/characters', headers: await auth() });
  return res.json<ListCharactersResponse>().characters[0]!.lastLocation;
}

describe('place of the last location (places file of world_settings.map)', () => {
  it('the content package has places for osm-stw and none for test-town / plan-4', async () => {
    expect(STW?.length).toBeGreaterThan(10);
    expect(await loadPlaces('test-town')).toBeNull();
    expect(await loadPlaces('plan-4')).toBeNull();
  });

  it('osm-stw: the nearest place at the save x, y', async () => {
    const first = STW![0]!;
    ctx = setup(
      {},
      { validator: validatorWith(() => ({ x: first.x + 3, y: first.y - 2, z: 0, day: 2 })) },
    );
    const ch = await create(ctx, { map: 'osm-stw' });
    await save(ctx, ch);
    const loc = await location(ctx);
    expect(loc?.place).toBe(nearestPlace(STW, loc!.x, loc!.y));
    expect(loc?.place).toBe(first.name);
  });

  it('a map without a places file (or no map) keeps place null', async () => {
    const fn: SaveSummaryFn = () => ({ x: 3000, y: 4400, z: 0, place: null, day: 1 });
    for (const ws of [{ map: 'test-town' }, { map: 'plan-4' }, undefined, { map: 7 }]) {
      ctx = setup({}, { validator: validatorWith(fn) });
      const ch = await create(ctx, ws);
      await save(ctx, ch);
      expect((await location(ctx))?.place, JSON.stringify(ws)).toBeNull();
      await ctx.app.close();
    }
  });

  it('looks up the places of the character map once per map (cache) and survives a broken file', async () => {
    const calls: (string | null)[] = [];
    const fn: SaveSummaryFn = () => ({ x: 10, y: 10, z: 0, day: 1 });
    ctx = setup(
      {},
      {
        validator: validatorWith(fn),
        places: (map) => {
          calls.push(map);
          if (map === 'broken') return Promise.reject(new Error('bad places file'));
          return Promise.resolve([{ name: 'Tu', x: 0, y: 0 }]);
        },
      },
    );
    const ok = await create(ctx, { map: 'custom' });
    await save(ctx, ok);
    expect((await location(ctx))?.place).toBe('Tu');
    const broken = await create(ctx, { map: 'broken' });
    await save(ctx, broken);
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/v1/characters',
      headers: await auth(),
    });
    const byId = new Map(
      list.json<ListCharactersResponse>().characters.map((c) => [c.id, c.lastLocation]),
    );
    expect(byId.get(broken.id)).toMatchObject({ place: null, x: 10 });
    expect(calls).toEqual(['custom', 'broken']);
  });

  it('the default worker pool and places cache fill place from the real sim save', async () => {
    ctx = setup();
    const ch = await create(ctx, { map: 'osm-stw' });
    await save(ctx, ch);
    const loc = await location(ctx);
    expect(loc).not.toBeNull();
    expect(loc!.place).toBe(nearestPlace(STW, loc!.x, loc!.y));
    expect(loc!.place).not.toBeNull();
  });
});

describe('summarizeLocation with places', () => {
  const fn: SaveSummaryFn = () => ({ x: 100, y: 100, z: 0, place: null, day: 1 });
  const places = [
    { name: 'Daleko', x: 5000, y: 5000 },
    { name: ' Blisko\u202e ', x: 120, y: 90 },
  ];

  it('nearest name, sanitized; no or empty places → the summary place (null from the sim)', () => {
    expect(summarizeLocation({}, fn, {}, places).location?.place).toBe('Blisko');
    expect(summarizeLocation({}, fn, {}, null).location?.place).toBeNull();
    expect(summarizeLocation({}, fn, {}, []).location?.place).toBeNull();
  });
});
