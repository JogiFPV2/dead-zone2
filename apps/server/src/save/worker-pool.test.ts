import { SAVE_VERSION } from '@deadzone/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../errors.js';
import { envelope } from '../test/fixtures.js';
import { createWorkerPool, type SaveValidator } from './worker-pool.js';

const ID = '33333333-3333-4333-8333-333333333333';
const OPTS = { saveFormatVersion: SAVE_VERSION, maxStateBytes: 8 * 1024 * 1024 };
const HANG = new URL('../test/hang-worker.mjs', import.meta.url);

let pool: SaveValidator | undefined;
afterEach(async () => {
  await pool?.close();
  pool = undefined;
});

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe('createWorkerPool', () => {
  it('validates an envelope in a worker thread and reuses the worker', async () => {
    pool = createWorkerPool({ size: 1, timeoutMs: 10_000, maxHeapMb: 64 });
    const body = envelope(ID, 5);
    const r = await pool.validate(body, OPTS);
    expect(r.header.characterId).toBe(ID);
    expect(r.sizeBytes).toBe(body.length);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    const again = await Promise.all([pool.validate(body, OPTS), pool.validate(body, OPTS)]);
    expect(again.map((x) => x.header.world_seed)).toEqual([5, 5]);
  });

  it('turns validation errors into the same HttpError', async () => {
    pool = createWorkerPool({ size: 1, timeoutMs: 10_000, maxHeapMb: 64 });
    const err = await failure(pool.validate(envelope(ID, 5, { magic: 'NOPE' }), OPTS));
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ statusCode: 400, code: 'invalid_envelope' });
    const state = await failure(pool.validate(envelope(ID, 5, { state: { hello: 1 } }), OPTS));
    expect(state).toMatchObject({ statusCode: 422, code: 'invalid_state' });
  });

  it('kills a worker over the time budget (422) and starts a fresh one', async () => {
    pool = createWorkerPool({ size: 1, timeoutMs: 300, maxHeapMb: 64, workerUrl: HANG });
    const t0 = Date.now();
    const err = await failure(pool.validate(envelope(ID, 5), OPTS));
    expect(err).toMatchObject({ statusCode: 422, code: 'invalid_state' });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await failure(pool.validate(envelope(ID, 5), OPTS))).toMatchObject({ statusCode: 422 });
  });

  it('caps worker memory: a worker over its heap gets 413, the pool keeps working', async () => {
    // Test-only worker (src/test/oom-worker.mjs): a save over `maxStateBytes` fills the heap in
    // 1 MiB chunks, so the 32 MiB cap is hit in a few dozen allocations instead of a long GC crawl
    // over tiny objects; smaller saves get a cheap success reply. Pool budget and test timeout are
    // generous so a loaded CI box cannot turn the expected 413 into a 422 timeout.
    pool = createWorkerPool({
      size: 1,
      timeoutMs: 60_000,
      maxHeapMb: 32,
      workerUrl: new URL('../test/oom-worker.mjs', import.meta.url),
    });
    const normal = envelope(ID, 5);
    const opts = { ...OPTS, maxStateBytes: 1024 * 1024 };
    const oversized = envelope(ID, 5, { padding: 1024 * 1024 });
    expect(oversized.length).toBeGreaterThan(opts.maxStateBytes);

    const err = await failure(pool.validate(oversized, opts));
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ statusCode: 413, code: 'payload_too_large' });

    // The OOM-killed worker is replaced: a normal save validates, then another oversized one is 413.
    const ok = await pool.validate(normal, opts);
    expect(ok.header.characterId).toBe(ID);
    expect(ok.sizeBytes).toBe(normal.length);
    expect(ok.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await failure(pool.validate(oversized, opts))).toMatchObject({ statusCode: 413 });
    expect((await pool.validate(normal, opts)).header.world_seed).toBe(5);
  }, 90_000);

  it('refuses a heap cap too small for the state limit (one big string would crash Node)', async () => {
    pool = createWorkerPool({ size: 1, timeoutMs: 10_000, maxHeapMb: 64 });
    const err = await failure(
      pool.validate(envelope(ID, 5), { ...OPTS, maxStateBytes: 64 * 1024 * 1024 }),
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(HttpError);
    expect(String(err)).toMatch(/heap/);
  });

  it('rejects with 503 when the queue is full and fails pending jobs on close', async () => {
    pool = createWorkerPool({
      size: 1,
      timeoutMs: 60_000,
      maxHeapMb: 64,
      maxQueue: 1,
      workerUrl: HANG,
    });
    const running = failure(pool.validate(envelope(ID, 5), OPTS));
    const queued = failure(pool.validate(envelope(ID, 5), OPTS));
    expect(await failure(pool.validate(envelope(ID, 5), OPTS))).toMatchObject({
      statusCode: 503,
      code: 'unavailable',
    });
    await pool.close();
    pool = undefined;
    expect(await running).toBeInstanceOf(Error);
    expect(await queued).toBeInstanceOf(Error);
  });
});
