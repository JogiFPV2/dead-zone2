import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterSummary } from '@deadzone/protocol';
import { DataRuleError } from '../data/types.js';
import { createWorkerPool } from '../save/worker-pool.js';
import { USER_A, checksum, envelope, setup, token } from '../test/fixtures.js';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;
afterEach(() => ctx?.app.close());

async function auth(user = USER_A) {
  return { authorization: `Bearer ${await token(user)}` };
}

async function create(c: Ctx): Promise<CharacterSummary> {
  const res = await c.app.inject({
    method: 'POST',
    url: '/v1/characters',
    headers: await auth(),
    payload: { name: 'Ala' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<CharacterSummary>();
}

function every(ch: CharacterSummary, h: Record<string, string>) {
  const body = envelope(ch.id, ch.worldSeed);
  const bin = {
    ...h,
    'content-type': 'application/octet-stream',
    'x-dzsv-sha256': checksum(body),
    'if-match': '0',
  };
  return [
    { method: 'GET', url: '/v1/characters', headers: h },
    { method: 'POST', url: '/v1/characters', headers: h, payload: { name: 'Ola' } },
    { method: 'POST', url: `/v1/characters/${ch.id}/open`, headers: h },
    { method: 'PUT', url: `/v1/characters/${ch.id}/save`, headers: bin, payload: body },
    { method: 'POST', url: `/v1/characters/${ch.id}/death`, headers: bin, payload: body },
    { method: 'DELETE', url: `/v1/characters/${ch.id}`, headers: h },
    { method: 'DELETE', url: '/v1/me', headers: h },
  ] as const;
}

describe('token of a deleted account', () => {
  it('gets 401 on every endpoint after DELETE /v1/me', async () => {
    ctx = setup();
    const ch = await create(ctx);
    const h = await auth();
    expect((await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: h })).statusCode).toBe(
      204,
    );
    for (const r of every(ch, h)) {
      const res = await ctx.app.inject(r);
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
      expect(res.json()).toMatchObject({ error: 'unauthorized' });
    }
  });

  it('gets 401 when only the profile row is missing (account deleted elsewhere)', async () => {
    ctx = setup();
    const ch = await create(ctx);
    ctx.store.profiles.delete(USER_A);
    ctx.accounts.users.delete(USER_A);
    for (const r of every(ch, await auth())) {
      expect((await ctx.app.inject(r)).statusCode, `${r.method} ${r.url}`).toBe(401);
    }
    expect(ctx.store.characters.has(ch.id)).toBe(true);
  });

  it('maps a foreign key failure on insert (user gone mid-request) to 401', async () => {
    ctx = setup();
    ctx.store.insertCharacter = () => Promise.reject(new DataRuleError('account_not_found'));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/characters',
      headers: await auth(),
      payload: { name: 'Ala' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('a half-deleted account (rows gone, auth user left) can still finish DELETE /v1/me', async () => {
    ctx = setup();
    await create(ctx);
    ctx.accounts.fail = true;
    const h = await auth();
    expect((await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: h })).statusCode).toBe(
      500,
    );
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/characters', headers: h })).statusCode,
    ).toBe(401);
    ctx.accounts.fail = false;
    expect((await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: h })).statusCode).toBe(
      204,
    );
  });
});

describe('save validation in the route', () => {
  it('returns 422 when validation times out and stores nothing', async () => {
    ctx = setup(
      {},
      {
        validator: createWorkerPool({
          size: 1,
          timeoutMs: 200,
          maxHeapMb: 256,
          workerUrl: new URL('../test/hang-worker.mjs', import.meta.url),
        }),
      },
    );
    const ch = await create(ctx);
    const body = envelope(ch.id, ch.worldSeed);
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/characters/${ch.id}/save`,
      headers: {
        ...(await auth()),
        'content-type': 'application/octet-stream',
        'x-dzsv-sha256': checksum(body),
        'if-match': '0',
      },
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'invalid_state' });
    expect(ctx.store.saves.size).toBe(0);
    expect(ctx.blobs.objects.size).toBe(0);
  });
});
