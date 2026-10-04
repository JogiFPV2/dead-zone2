import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterSummary, ListCharactersResponse } from '@deadzone/protocol';
import { USER_A, USER_B, checksum, envelope, setup, token } from '../test/fixtures.js';
import type { EnvelopeOpts } from '../test/fixtures.js';
import { realSave } from '../test/sim-save.js';
import { validateEnvelope } from '../save/validate.js';
import type { SaveSummaryFn } from '../save/location.js';
import type { SaveValidator } from '../save/worker-pool.js';
import { SaveError } from '@deadzone/sim/save-summary';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;
afterEach(() => ctx?.app.close());

/** In-process validator with a stand-in for the sim `saveSummary`. */
function validatorWith(summary: { fn: SaveSummaryFn | undefined }): SaveValidator {
  return {
    validate: (bytes, opts) => Promise.resolve(validateEnvelope(bytes, opts, summary.fn)),
    close: () => Promise.resolve(),
  };
}

async function auth(user = USER_A) {
  return { authorization: `Bearer ${await token(user)}` };
}

async function create(c: Ctx, name = 'Ala', user = USER_A) {
  const res = await c.app.inject({
    method: 'POST',
    url: '/v1/characters',
    headers: await auth(user),
    payload: { name },
  });
  return res.json<CharacterSummary>();
}

async function save(c: Ctx, ch: CharacterSummary, version: number, o: EnvelopeOpts = {}) {
  const body = envelope(ch.id, ch.worldSeed, o);
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
  return body.length;
}

async function list(c: Ctx, user = USER_A) {
  const res = await c.app.inject({
    method: 'GET',
    url: '/v1/characters',
    headers: await auth(user),
  });
  return res.json<ListCharactersResponse>();
}

describe('last location', () => {
  it('stores the server-side summary of the save and lists it', async () => {
    const summary: { fn: SaveSummaryFn | undefined } = {
      fn: () => ({ x: 200.5, y: 230, z: 1, place: '  Lipowiec ', day: 3 }),
    };
    ctx = setup({}, { validator: validatorWith(summary) });
    const ch = await create(ctx);
    expect(ch.lastLocation).toBeNull();
    await save(ctx, ch, 0);
    expect((await list(ctx)).characters[0]!.lastLocation).toEqual({
      place: 'Lipowiec',
      x: 200.5,
      y: 230,
      z: 1,
      day: 3,
    });

    // A SaveError, another throw or broken values: the valid save succeeds, location is kept.
    summary.fn = () => {
      throw new SaveError('corrupt', 'no player');
    };
    await save(ctx, ch, 1);
    summary.fn = () => ({ x: Number.NaN, y: 1, z: 0, place: 'X', day: 1 });
    await save(ctx, ch, 2);
    summary.fn = () => {
      throw new Error('summary bug');
    };
    await save(ctx, ch, 3);
    expect((await list(ctx)).characters[0]!.lastLocation).toMatchObject({ place: 'Lipowiec' });

    // Out-of-range values are clamped.
    summary.fn = () => ({ x: -10, y: 1e9, z: 4000, place: 'p'.repeat(100), day: 5 });
    await save(ctx, ch, 4);
    expect((await list(ctx)).characters[0]!.lastLocation).toEqual({
      place: 'p'.repeat(64),
      x: 0,
      y: 16384,
      z: 127,
      day: 5,
    });
  });

  it('ignores location fields a client adds to the state', async () => {
    ctx = setup();
    const ch = await create(ctx);
    const hack = { x: 1, y: 1, z: 0, place: 'Hack', day: 1 };
    await save(ctx, ch, 0, {
      state: { ...realSave(ch.worldSeed), lastLocation: hack, summary: hack },
    });
    expect((await list(ctx)).characters[0]!.lastLocation).toMatchObject({ place: null });
    expect((await list(ctx)).characters[0]!.lastLocation!.x).toBeGreaterThan(200);
  });

  it('the default worker pool uses the real sim saveSummary (#155)', async () => {
    ctx = setup();
    const ch = await create(ctx);
    await save(ctx, ch, 0);
    const loc = (await list(ctx)).characters[0]!.lastLocation;
    // The test save spawns at (200.5, 200.5) and walks east/south-east on floor 0.
    expect(loc).toMatchObject({ place: null, z: 0 });
    expect(loc!.x).toBeGreaterThan(200);
    expect(loc!.y).toBeGreaterThanOrEqual(200);
    expect(loc!.day).toBeGreaterThanOrEqual(0);
  });

  it('tombstones show no location', async () => {
    ctx = setup({}, { validator: validatorWith({ fn: () => ({ x: 1, y: 2, z: 0, day: 1 }) }) });
    const ch = await create(ctx);
    await save(ctx, ch, 0);
    expect((await list(ctx)).characters[0]!.lastLocation).toEqual({
      place: null,
      x: 1,
      y: 2,
      z: 0,
      day: 1,
    });
    const body = envelope(ch.id, ch.worldSeed, { header: { reason: 'death', gameDay: 4 } });
    const died = await ctx.app.inject({
      method: 'POST',
      url: `/v1/characters/${ch.id}/death`,
      headers: {
        ...(await auth()),
        'content-type': 'application/octet-stream',
        'x-dzsv-sha256': checksum(body),
      },
      payload: body,
    });
    expect(died.json<CharacterSummary>().lastLocation).toBeNull();
    expect((await list(ctx)).characters[0]!.lastLocation).toBeNull();
  });
});

describe('account usage', () => {
  it('reports used bytes of current saves, the quota and the alive counter', async () => {
    ctx = setup({}, { validator: validatorWith({ fn: undefined }) });
    expect((await list(ctx)).usage).toEqual({
      usedBytes: 0,
      limitBytes: 50 * 1024 * 1024,
      alive: 0,
      aliveLimit: 20,
    });
    const a = await create(ctx, 'A');
    const b = await create(ctx, 'B');
    await create(ctx, 'Bez zapisu');
    await create(ctx, 'Obcy', USER_B);
    const sa = await save(ctx, a, 0);
    const sb = await save(ctx, b, 0, { padding: 4000 });
    const sb2 = await save(ctx, b, 1);
    const r = await list(ctx);
    expect(r.usage).toEqual({
      usedBytes: sa + sb2,
      limitBytes: 50 * 1024 * 1024,
      alive: 3,
      aliveLimit: 20,
    });
    expect(sb).toBeGreaterThan(sb2);
    // The older `limits` block stays for compatibility.
    expect(r.limits).toEqual({
      maxAlive: 20,
      alive: 3,
      maxSaveBytes: 50 * 1024 * 1024,
      usedSaveBytes: sa + sb2,
    });
    expect((await list(ctx, USER_B)).usage).toMatchObject({ usedBytes: 0, alive: 1 });
  });

  it('uses the configured (lowered) limits', async () => {
    ctx = setup(
      { maxAliveCharacters: 5, maxAccountSaveBytes: 10 * 1024 * 1024 },
      { validator: validatorWith({ fn: undefined }) },
    );
    expect((await list(ctx)).usage).toMatchObject({ limitBytes: 10 * 1024 * 1024, aliveLimit: 5 });
  });
});
