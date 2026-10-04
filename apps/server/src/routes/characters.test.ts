import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterSummary } from '@deadzone/protocol';
import { USER_A, USER_B, checksum, envelope, setup, token } from '../test/fixtures.js';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;
afterEach(() => ctx?.app.close());

async function auth(user = USER_A) {
  return { authorization: `Bearer ${await token(user)}` };
}

async function create(c: Ctx, name = 'Ala', user = USER_A) {
  return c.app.inject({
    method: 'POST',
    url: '/v1/characters',
    headers: await auth(user),
    payload: { name, appearance: { hair: 2 }, world_settings: { zombies: 'normal' } },
  });
}

async function put(
  c: Ctx,
  ch: CharacterSummary,
  ifMatch: string | undefined,
  body: Buffer,
  user = USER_A,
) {
  return c.app.inject({
    method: 'PUT',
    url: `/v1/characters/${ch.id}/save`,
    headers: {
      ...(await auth(user)),
      'content-type': 'application/octet-stream',
      'x-dzsv-sha256': checksum(body),
      ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
    },
    payload: body,
  });
}

describe('auth', () => {
  it('rejects missing, malformed, foreign-signed, expired and wrong-audience tokens', async () => {
    ctx = setup();
    const { generateKeyPair } = await import('jose');
    const other = await generateKeyPair('ES256');
    const bad = [
      undefined,
      'Basic abc',
      'Bearer not-a-jwt',
      `Bearer ${await token(USER_A, { key: other.privateKey })}`,
      `Bearer ${await token(USER_A, { exp: '-1m' })}`,
      `Bearer ${await token(USER_A, { aud: 'other' })}`,
      `Bearer ${await token(USER_A, { iss: 'https://evil.test/auth/v1' })}`,
      `Bearer ${await token(USER_A, { role: 'anon' })}`,
      `Bearer ${await token('not-a-uuid')}`,
    ];
    for (const authorization of bad) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/v1/characters',
        headers: authorization ? { authorization } : {},
      });
      expect(res.statusCode, authorization).toBe(401);
      expect(res.json()).toMatchObject({ error: 'unauthorized' });
    }
  });

  it('health stays public', async () => {
    ctx = setup();
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('characters', () => {
  it('creates a character with a server seed and lists only own characters', async () => {
    ctx = setup();
    const res = await create(ctx);
    expect(res.statusCode).toBe(201);
    const ch = res.json<CharacterSummary>();
    expect(ch).toMatchObject({
      name: 'Ala',
      status: 'alive',
      worldSeed: 1000,
      worldgenVersion: 1,
      save: null,
    });
    await create(ctx, 'Bob', USER_B);
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/v1/characters',
      headers: await auth(),
    });
    expect(list.json()).toMatchObject({
      characters: [{ id: ch.id }],
      limits: { maxAlive: 20, alive: 1, usedSaveBytes: 0 },
    });
    expect(list.json<{ characters: unknown[] }>().characters).toHaveLength(1);
  });

  it('validates the body (name length, control chars, user_id never from body)', async () => {
    ctx = setup();
    for (const payload of [
      { name: '' },
      { name: 'x'.repeat(41) },
      { name: 'a\u0000b' },
      { name: 'Ala', user_id: USER_B },
      { name: 'Ala', appearance: { blob: 'x'.repeat(5000) } },
      { name: 'Ala', appearance: [] },
    ]) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/characters',
        headers: await auth(),
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload).slice(0, 40)).toBe(400);
    }
  });

  it('allows 20 alive characters; tombstones do not count', async () => {
    ctx = setup({ maxNewCharactersPerDay: 100 });
    const made: CharacterSummary[] = [];
    for (let i = 0; i < 20; i++) made.push((await create(ctx, `P${i}`)).json<CharacterSummary>());
    const full = await create(ctx, 'P20');
    expect(full.statusCode).toBe(409);
    expect(full.json()).toMatchObject({ error: 'alive_character_limit' });

    const first = made[0]!;
    const death = envelope(first.id, first.worldSeed, { header: { reason: 'death', gameDay: 4 } });
    const died = await ctx.app.inject({
      method: 'POST',
      url: `/v1/characters/${first.id}/death`,
      headers: {
        ...(await auth()),
        'content-type': 'application/octet-stream',
        'x-dzsv-sha256': checksum(death),
      },
      payload: death,
    });
    expect(died.statusCode).toBe(200);
    expect((await create(ctx, 'P21')).statusCode).toBe(201);
  });

  it('limits new characters per day', async () => {
    ctx = setup({ maxNewCharactersPerDay: 2 });
    await create(ctx);
    await create(ctx);
    const res = await create(ctx);
    expect(res.statusCode).toBe(429);
  });
});

describe('saves', () => {
  it('first save, overwrite with version, 409 on stale version; old blob removed', async () => {
    ctx = setup();
    const ch = (await create(ctx)).json<CharacterSummary>();
    const body = envelope(ch.id, ch.worldSeed);

    const missing = await put(ctx, ch, undefined, body);
    expect(missing.statusCode).toBe(400);

    const v1 = await put(ctx, ch, '0', body);
    expect(v1.statusCode, v1.body).toBe(200);
    expect(v1.json()).toMatchObject({ version: 1, gameDay: 3, checksum: checksum(body) });
    expect(ctx.blobs.objects.size).toBe(1);

    const stale = await put(ctx, ch, '0', body);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'save_version_conflict' });

    const next = envelope(ch.id, ch.worldSeed, { header: { gameDay: 5 } });
    const v2 = await put(ctx, ch, '"1"', next);
    expect(v2.json()).toMatchObject({ version: 2, gameDay: 5 });
    expect(ctx.blobs.objects.size).toBe(1);
    expect(ctx.store.characters.get(ch.id)?.days_survived).toBe(5);

    const open = await ctx.app.inject({
      method: 'POST',
      url: `/v1/characters/${ch.id}/open`,
      headers: await auth(),
    });
    expect(open.json()).toMatchObject({
      version: 2,
      checksum: checksum(next),
      expiresInSeconds: 60,
    });
    expect(open.json<{ url: string }>().url).toContain(`${USER_A}/${ch.id}/v2-`);
  });

  it('conflict detected at commit time (race) removes the uploaded blob', async () => {
    ctx = setup();
    const ch = (await create(ctx)).json<CharacterSummary>();
    const body = envelope(ch.id, ch.worldSeed);
    const commit = ctx.store.commitSave.bind(ctx.store);
    // Another device commits between our pre-check and our commit.
    ctx.store.commitSave = async (c) => {
      await commit({ ...c, storagePath: 'other/device.dzsv' });
      return commit(c);
    };
    const res = await put(ctx, ch, '0', body);
    expect(res.statusCode).toBe(409);
    expect([...ctx.blobs.objects.keys()]).toEqual([]);
  });

  it('open without a cloud save returns version 0', async () => {
    ctx = setup();
    const ch = (await create(ctx)).json<CharacterSummary>();
    const open = await ctx.app.inject({
      method: 'POST',
      url: `/v1/characters/${ch.id}/open`,
      headers: await auth(),
    });
    expect(open.json()).toMatchObject({ version: 0, url: null });
  });

  it('someone else’s character is 404', async () => {
    ctx = setup();
    const ch = (await create(ctx)).json<CharacterSummary>();
    const res = await put(ctx, ch, '0', envelope(ch.id, ch.worldSeed), USER_B);
    expect(res.statusCode).toBe(404);
    const open = await ctx.app.inject({
      method: 'POST',
      url: `/v1/characters/${ch.id}/open`,
      headers: await auth(USER_B),
    });
    expect(open.statusCode).toBe(404);
  });

  it('enforces the account quota across characters', async () => {
    ctx = setup({ maxAccountSaveBytes: 6000 });
    const a = (await create(ctx, 'A')).json<CharacterSummary>();
    const b = (await create(ctx, 'B')).json<CharacterSummary>();
    expect(
      (await put(ctx, a, '0', envelope(a.id, a.worldSeed, { padding: 3000 }))).statusCode,
    ).toBe(200);
    const over = await put(ctx, b, '0', envelope(b.id, b.worldSeed, { padding: 3000 }));
    expect(over.statusCode).toBe(413);
    expect(over.json()).toMatchObject({ error: 'save_quota_exceeded' });
    // Overwriting your own save counts only the new size.
    expect(
      (await put(ctx, a, '1', envelope(a.id, a.worldSeed, { padding: 3500 }))).statusCode,
    ).toBe(200);
  });

  it('rejects bodies over the envelope limit', async () => {
    ctx = setup({ maxEnvelopeBytes: 2048 });
    const ch = (await create(ctx)).json<CharacterSummary>();
    const res = await put(ctx, ch, '0', envelope(ch.id, ch.worldSeed, { padding: 4000 }));
    expect(res.statusCode).toBe(413);
  });

  describe('validation', () => {
    const marker = (over: Partial<Record<number, unknown>> = {}) => {
      const m: unknown[] = [1, 100, 200, 'base:marker-food', 'red', 'Sklep'];
      for (const [k, v] of Object.entries(over)) m[Number(k)] = v;
      return m;
    };
    const withMap = (map: Record<string, unknown>) => ({
      format: 'deadzone-save',
      version: 1,
      seed: 7,
      tick: 1,
      playerMaps: [{ sid: 1, discovered: '', trail: '', markers: [], nextId: 1, ...map }],
    });

    const cases: [string, (id: string, seed: number) => Buffer, number, string][] = [
      ['bad magic', (id, s) => envelope(id, s, { magic: 'NOPE' }), 400, 'invalid_envelope'],
      ['not gzip flag', (id, s) => envelope(id, s, { flags: 0 }), 400, 'invalid_envelope'],
      [
        'newer envelope',
        (id, s) => envelope(id, s, { envelopeVersion: 2 }),
        426,
        'unsupported_format_version',
      ],
      [
        'newer format',
        (id, s) => envelope(id, s, { header: { formatVersion: 2 } }),
        426,
        'unsupported_format_version',
      ],
      [
        'other character',
        (id, s) => envelope(id.replace(/^./, id[0] === 'a' ? 'b' : 'a'), s),
        422,
        'invalid_state',
      ],
      ['other world seed', (id, s) => envelope(id, s + 1), 422, 'invalid_state'],
      [
        'wrong rawSize',
        (id, s) => envelope(id, s, { header: { rawSize: 3 } }),
        422,
        'invalid_state',
      ],
      ['foreign state', (id, s) => envelope(id, s, { state: { hello: 1 } }), 422, 'invalid_state'],
      [
        'death via save',
        (id, s) => envelope(id, s, { header: { reason: 'death' } }),
        422,
        'invalid_state',
      ],
      [
        '201 markers',
        (id, s) =>
          envelope(id, s, {
            state: withMap({ markers: Array.from({ length: 201 }, () => marker()) }),
          }),
        422,
        'invalid_state',
      ],
      [
        '41-char marker text',
        (id, s) =>
          envelope(id, s, { state: withMap({ markers: [marker({ 5: 'x'.repeat(41) })] }) }),
        422,
        'invalid_state',
      ],
      [
        'unknown marker colour',
        (id, s) => envelope(id, s, { state: withMap({ markers: [marker({ 4: 'pink' })] }) }),
        422,
        'invalid_state',
      ],
      [
        'marker off map',
        (id, s) => envelope(id, s, { state: withMap({ markers: [marker({ 1: 9000 })] }) }),
        422,
        'invalid_state',
      ],
      [
        'explored bitmap too big',
        (id, s) => envelope(id, s, { state: withMap({ discovered: 'A'.repeat(30_000) }) }),
        422,
        'invalid_state',
      ],
    ];

    it.each(cases)('%s', async (_name, make, status, code) => {
      ctx = setup();
      const ch = (await create(ctx)).json<CharacterSummary>();
      const res = await put(ctx, ch, '0', make(ch.id, ch.worldSeed));
      expect(res.statusCode, res.body).toBe(status);
      expect(res.json()).toMatchObject({ error: code });
      expect(ctx.store.saves.size).toBe(0);
      expect(ctx.blobs.objects.size).toBe(0);
    });

    it('200 markers with 40-char text and every colour are fine', async () => {
      ctx = setup();
      const ch = (await create(ctx)).json<CharacterSummary>();
      const colours = ['red', 'yellow', 'green', 'blue', 'white'];
      const markers = Array.from({ length: 200 }, (_, i) =>
        marker({ 0: i, 4: colours[i % 5], 5: 'x'.repeat(40) }),
      );
      const res = await put(
        ctx,
        ch,
        '0',
        envelope(ch.id, ch.worldSeed, { state: withMap({ markers }) }),
      );
      expect(res.statusCode, res.body).toBe(200);
    });

    it('checksum mismatch and missing checksum', async () => {
      ctx = setup();
      const ch = (await create(ctx)).json<CharacterSummary>();
      const body = envelope(ch.id, ch.worldSeed);
      const headers = {
        ...(await auth()),
        'content-type': 'application/octet-stream',
        'if-match': '0',
      };
      const url = `/v1/characters/${ch.id}/save`;
      const wrong = await ctx.app.inject({
        method: 'PUT',
        url,
        headers: { ...headers, 'x-dzsv-sha256': 'a'.repeat(64) },
        payload: body,
      });
      expect(wrong.json()).toMatchObject({ error: 'checksum_mismatch' });
      const none = await ctx.app.inject({ method: 'PUT', url, headers, payload: body });
      expect(none.statusCode).toBe(400);
      const json = await ctx.app.inject({
        method: 'PUT',
        url,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { a: 1 },
      });
      expect(json.statusCode).toBe(400);
    });
  });
});

describe('permadeath', () => {
  async function die(
    c: Ctx,
    ch: CharacterSummary,
    gameDay = 9,
    reason: 'death' | 'autosave' = 'death',
  ) {
    const body = envelope(ch.id, ch.worldSeed, { header: { reason, gameDay } });
    return c.app.inject({
      method: 'POST',
      url: `/v1/characters/${ch.id}/death`,
      headers: {
        ...(await auth()),
        'content-type': 'application/octet-stream',
        'x-dzsv-sha256': checksum(body),
      },
      payload: body,
    });
  }

  it('death makes a tombstone, deletes the save row and blob, blocks further saves', async () => {
    ctx = setup();
    const ch = (await create(ctx)).json<CharacterSummary>();
    expect((await put(ctx, ch, '0', envelope(ch.id, ch.worldSeed))).statusCode).toBe(200);
    expect(ctx.blobs.objects.size).toBe(1);

    expect((await die(ctx, ch, 9, 'autosave')).statusCode).toBe(422);

    const res = await die(ctx, ch);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'dead', daysSurvived: 9, save: null });
    expect(res.json<CharacterSummary>().diedAt).toBeTruthy();
    expect(ctx.store.saves.size).toBe(0);
    expect(ctx.blobs.objects.size).toBe(0);
    expect(ctx.store.characters.get(ch.id)?.status).toBe('dead');

    // Retry after a lost response is idempotent.
    expect((await die(ctx, ch)).json()).toMatchObject({ status: 'dead' });

    const save = await put(ctx, ch, '0', envelope(ch.id, ch.worldSeed));
    expect(save.statusCode).toBe(409);
    expect(save.json()).toMatchObject({ error: 'character_dead' });
    const open = await ctx.app.inject({
      method: 'POST',
      url: `/v1/characters/${ch.id}/open`,
      headers: await auth(),
    });
    expect(open.statusCode).toBe(409);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/v1/characters',
      headers: await auth(),
    });
    expect(list.json()).toMatchObject({
      characters: [{ id: ch.id, status: 'dead' }],
      limits: { alive: 0 },
    });
  });

  it('death without a cloud save still makes a tombstone', async () => {
    ctx = setup();
    const ch = (await create(ctx)).json<CharacterSummary>();
    expect((await die(ctx, ch, 0)).json()).toMatchObject({ status: 'dead', daysSurvived: 0 });
  });
});
