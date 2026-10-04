import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterSummary } from '@deadzone/protocol';
import { USER_A, USER_B, checksum, envelope, setup, token } from '../test/fixtures.js';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;
afterEach(() => ctx?.app.close());

const HOUR = 60 * 60 * 1000;

async function auth(user = USER_A) {
  return { authorization: `Bearer ${await token(user)}` };
}

async function create(c: Ctx, user = USER_A, name = 'Ala'): Promise<CharacterSummary> {
  const res = await c.app.inject({
    method: 'POST',
    url: '/v1/characters',
    headers: await auth(user),
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return res.json<CharacterSummary>();
}

async function upload(
  c: Ctx,
  ch: CharacterSummary,
  version: number,
  o: { user?: string; reason?: 'autosave' | 'death'; body?: Buffer } = {},
) {
  const body =
    o.body ?? envelope(ch.id, ch.worldSeed, { header: { reason: o.reason ?? 'autosave' } });
  return c.app.inject({
    method: o.reason === 'death' ? 'POST' : 'PUT',
    url: `/v1/characters/${ch.id}/${o.reason === 'death' ? 'death' : 'save'}`,
    headers: {
      ...(await auth(o.user)),
      'content-type': 'application/octet-stream',
      'x-dzsv-sha256': checksum(body),
      'if-match': String(version),
    },
    payload: body,
  });
}

describe('rate limits', () => {
  it('limits saves per account per hour with 429 + Retry-After, then frees up', async () => {
    ctx = setup({ maxSavesPerHour: 2 });
    const ch = await create(ctx);
    expect((await upload(ctx, ch, 0)).statusCode).toBe(200);
    expect((await upload(ctx, ch, 1)).statusCode).toBe(200);
    const res = await upload(ctx, ch, 2);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'rate_limited' });
    const retry = Number(res.headers['retry-after']);
    expect(retry).toBeGreaterThan(3000);
    expect(retry).toBeLessThanOrEqual(3600);
    // Another account has its own budget.
    const other = await create(ctx, USER_B);
    expect((await upload(ctx, other, 0, { user: USER_B })).statusCode).toBe(200);
    ctx.store.clock += HOUR;
    expect((await upload(ctx, ch, 2)).statusCode).toBe(200);
  });

  it('rejects an over-limit save before looking at the body; death counts too', async () => {
    ctx = setup({ maxSavesPerHour: 1 });
    const ch = await create(ctx);
    expect((await upload(ctx, ch, 0)).statusCode).toBe(200);
    expect((await upload(ctx, ch, 1, { body: Buffer.from('garbage') })).statusCode).toBe(429);
    expect((await upload(ctx, ch, 1, { reason: 'death' })).statusCode).toBe(429);
    expect(ctx.store.characters.get(ch.id)?.status).toBe('alive');
  });

  it('limits uploaded bytes per account per day', async () => {
    const one = envelope('00000000-0000-4000-8000-000000000000', 1).length;
    ctx = setup({ maxUploadBytesPerDay: Math.floor(one * 1.5) });
    const ch = await create(ctx);
    expect((await upload(ctx, ch, 0)).statusCode).toBe(200);
    const res = await upload(ctx, ch, 1);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(23 * 3600);
    expect(ctx.store.saves.get(ch.id)?.version).toBe(1);
  });

  it('limits /v1 requests per IP before auth; /health is not limited', async () => {
    ctx = setup({ maxIpRequestsPer5Min: 3 });
    const h = await auth();
    for (let i = 0; i < 2; i++) {
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/v1/characters', headers: h })).statusCode,
      ).toBe(200);
    }
    // Unauthenticated requests count as well.
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/characters' })).statusCode).toBe(401);
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/characters', headers: h });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const fromElsewhere = await ctx.app.inject({
      method: 'GET',
      url: '/v1/characters',
      headers: h,
      remoteAddress: '10.0.0.9',
    });
    expect(fromElsewhere.statusCode).toBe(200);
    ctx.store.clock += 5 * 60 * 1000;
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/characters', headers: h })).statusCode,
    ).toBe(200);
  });

  it('uses X-Forwarded-For only behind a configured proxy', async () => {
    ctx = setup({ maxIpRequestsPer5Min: 1 }, { trustProxyHops: 1 });
    const h = await auth();
    const get = (ip: string) =>
      ctx.app.inject({
        method: 'GET',
        url: '/v1/characters',
        headers: { ...h, 'x-forwarded-for': ip },
      });
    expect((await get('203.0.113.1')).statusCode).toBe(200);
    expect((await get('203.0.113.2')).statusCode).toBe(200);
    expect((await get('203.0.113.1')).statusCode).toBe(429);

    await ctx.app.close();
    ctx = setup({ maxIpRequestsPer5Min: 1 });
    const direct = (ip: string) =>
      ctx.app.inject({
        method: 'GET',
        url: '/v1/characters',
        headers: { ...h, 'x-forwarded-for': ip },
      });
    expect((await direct('203.0.113.1')).statusCode).toBe(200);
    expect((await direct('203.0.113.2')).statusCode).toBe(429);
  });
});

describe('DELETE /v1/characters/:id', () => {
  it('deletes the save blob first, then the rows; frees the alive slot', async () => {
    ctx = setup({ maxAliveCharacters: 1 });
    const ch = await create(ctx);
    expect((await upload(ctx, ch, 0)).statusCode).toBe(200);
    // An orphan from an interrupted upload is swept as well.
    await ctx.blobs.put(`${USER_A}/${ch.id}/v9-orphan.dzsv`, new Uint8Array([1]));
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/characters/${ch.id}`,
      headers: await auth(),
    });
    expect(res.statusCode).toBe(204);
    expect(ctx.blobs.objects.size).toBe(0);
    expect(ctx.store.characters.has(ch.id)).toBe(false);
    expect(ctx.store.saves.has(ch.id)).toBe(false);
    await create(ctx);
  });

  it('deletes a tombstone; 404 for foreign, unknown and already deleted characters', async () => {
    ctx = setup();
    const ch = await create(ctx);
    expect((await upload(ctx, ch, 0, { reason: 'death' })).statusCode).toBe(200);
    const del = async (id: string, user = USER_A) =>
      ctx.app.inject({ method: 'DELETE', url: `/v1/characters/${id}`, headers: await auth(user) });
    expect((await del(ch.id, USER_B)).statusCode).toBe(404);
    expect((await del('not-a-uuid')).statusCode).toBe(404);
    expect((await del(ch.id)).statusCode).toBe(204);
    expect((await del(ch.id)).statusCode).toBe(404);
  });

  it('keeps the character when the blobs cannot be removed (retry is safe)', async () => {
    ctx = setup();
    const ch = await create(ctx);
    expect((await upload(ctx, ch, 0)).statusCode).toBe(200);
    ctx.blobs.failRemovePrefix = true;
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/characters/${ch.id}`,
      headers: await auth(),
    });
    expect(res.statusCode).toBe(500);
    expect(ctx.store.characters.has(ch.id)).toBe(true);
    expect(ctx.store.saves.has(ch.id)).toBe(true);
  });

  it('requires auth', async () => {
    ctx = setup();
    const ch = await create(ctx);
    const res = await ctx.app.inject({ method: 'DELETE', url: `/v1/characters/${ch.id}` });
    expect(res.statusCode).toBe(401);
    expect(ctx.store.characters.has(ch.id)).toBe(true);
  });
});

describe('DELETE /v1/me', () => {
  it('removes all blobs, rows and then the auth user; other accounts stay', async () => {
    ctx = setup();
    const a1 = await create(ctx);
    const a2 = await create(ctx, USER_A, 'Ola');
    const b = await create(ctx, USER_B);
    expect((await upload(ctx, a1, 0)).statusCode).toBe(200);
    expect((await upload(ctx, a2, 0, { reason: 'death' })).statusCode).toBe(200);
    expect((await upload(ctx, b, 0, { user: USER_B })).statusCode).toBe(200);

    const res = await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: await auth() });
    expect(res.statusCode).toBe(204);
    expect(ctx.accounts.deleted).toEqual([USER_A]);
    expect([...ctx.store.characters.values()].map((c) => c.user_id)).toEqual([USER_B]);
    expect([...ctx.blobs.objects.keys()].every((k) => k.startsWith(`${USER_B}/`))).toBe(true);
    expect(ctx.blobs.objects.size).toBe(1);
  });

  it('can be retried when the auth admin call fails', async () => {
    ctx = setup();
    const ch = await create(ctx);
    expect((await upload(ctx, ch, 0)).statusCode).toBe(200);
    ctx.accounts.fail = true;
    const h = await auth();
    expect((await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: h })).statusCode).toBe(
      500,
    );
    expect(ctx.store.characters.size).toBe(0);
    expect(ctx.blobs.objects.size).toBe(0);
    ctx.accounts.fail = false;
    expect((await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: h })).statusCode).toBe(
      204,
    );
    expect(ctx.accounts.deleted).toEqual([USER_A]);
  });

  it('touches nothing when the blobs cannot be removed', async () => {
    ctx = setup();
    const ch = await create(ctx);
    expect((await upload(ctx, ch, 0)).statusCode).toBe(200);
    ctx.blobs.failRemovePrefix = true;
    const res = await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: await auth() });
    expect(res.statusCode).toBe(500);
    expect(ctx.store.characters.size).toBe(1);
    expect(ctx.accounts.deleted).toEqual([]);
  });

  it('requires auth', async () => {
    ctx = setup();
    expect((await ctx.app.inject({ method: 'DELETE', url: '/v1/me' })).statusCode).toBe(401);
    expect(ctx.accounts.deleted).toEqual([]);
  });
});
