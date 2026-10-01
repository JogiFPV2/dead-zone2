import {
  CHUNK_TILES,
  decodeSnapshot,
  SnapshotEntityKind,
  type MainToWorker,
  type SimEvent,
  type SimMapData,
  type SimViewPatch,
  type WorkerToMain,
} from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { fixturePack } from '../test/content-fixtures.js';
import { createSimWorkerClient, type SimWorkerLike } from './client.js';
import { startSimWorkerHost, type HostClock, type WorkerPortLike } from './worker-host.js';

const openMap = (): SimMapData => {
  const floor = new Uint16Array(CHUNK_TILES).fill(1);
  return {
    chunks: [
      {
        cx: 0,
        cy: 0,
        z: 0,
        floor,
        edgeN: new Uint16Array(CHUNK_TILES),
        edgeW: new Uint16Array(CHUNK_TILES),
      },
    ],
  };
};

/** In-memory worker: synchronous message passing plus a manual clock. */
function harness() {
  let now = 0;
  const clock: HostClock = { now: () => now, schedule: () => {} };
  const toMain: { msg: WorkerToMain; transfer: ArrayBuffer[] }[] = [];
  const mainListeners = new Set<(e: { data: unknown }) => void>();
  let workerListener: ((e: { data: unknown }) => void) | undefined;
  const port: WorkerPortLike = {
    postMessage(msg, transfer) {
      toMain.push({ msg, transfer });
      for (const l of mainListeners) l({ data: msg });
    },
    addEventListener: (_t, l) => {
      workerListener = l;
    },
  };
  const host = startSimWorkerHost(port, clock);
  const toWorker: { msg: MainToWorker; transfer: ArrayBuffer[] }[] = [];
  const worker: SimWorkerLike = {
    postMessage(msg, transfer) {
      toWorker.push({ msg, transfer });
      workerListener?.({ data: msg });
    },
    addEventListener: (_t, l) => mainListeners.add(l),
    removeEventListener: (_t, l) => mainListeners.delete(l),
  };
  const advance = (ms: number, frame = 16) => {
    for (let t = 0; t < ms; t += frame) {
      now += frame;
      host.pump();
    }
  };
  const send = (msg: unknown) => workerListener?.({ data: msg });
  return { host, worker, toMain, toWorker, advance, send };
}

const snapshots = (log: { msg: WorkerToMain }[]) =>
  log.flatMap((m) => (m.msg.kind === 'snapshot' ? [m.msg] : []));

describe('sim worker host', () => {
  it('answers init with ready and a first snapshot', () => {
    const h = harness();
    h.send({ kind: 'init', seed: 1, map: openMap() });
    expect(h.toMain[0]?.msg).toEqual({ kind: 'ready', tick: 0 });
    const [first] = snapshots(h.toMain);
    expect(first?.tick).toBe(0);
    expect(h.toMain[1]?.transfer).toEqual([first?.buf]);
  });

  it('runs 20 ticks per real second and sends the last snapshot of each batch', () => {
    const h = harness();
    h.send({ kind: 'init', seed: 1, map: openMap() });
    h.advance(1000);
    const snaps = snapshots(h.toMain);
    expect(snaps.at(-1)?.tick).toBeGreaterThanOrEqual(19);
    expect(snaps.at(-1)?.tick).toBeLessThanOrEqual(20);
    expect(snaps.length).toBeLessThanOrEqual(21);
  });

  it('pauses, resumes and speeds up', () => {
    const h = harness();
    h.send({ kind: 'init', seed: 1, map: openMap() });
    h.send({ kind: 'pause' });
    h.advance(1000);
    expect(h.host.sim?.tick).toBe(0);
    h.send({ kind: 'resume' });
    h.send({ kind: 'speed', x: 4 });
    h.advance(1000);
    expect(h.host.sim?.tick).toBeGreaterThanOrEqual(79);
  });

  it('drops invalid messages and commands before init', () => {
    const h = harness();
    h.send({ kind: 'cmd', cmd: { type: 'move', dx: 1, dy: 0, tick: 0, playerId: 0, seq: 0 } });
    h.send({ kind: 'speed', x: 3 });
    h.send('garbage');
    expect(h.host.droppedMessages).toBe(3);
    expect(h.toMain).toHaveLength(0);
  });

  it('reuses released buffers (pool)', () => {
    const h = harness();
    h.send({ kind: 'init', seed: 1, map: openMap() });
    const first = snapshots(h.toMain)[0]!.buf;
    h.send({ kind: 'release', buf: first });
    expect(h.host.pooledBuffers).toBe(1);
    h.advance(50, 50);
    expect(snapshots(h.toMain).at(-1)?.buf).toBe(first);
    expect(h.host.pooledBuffers).toBe(0);
  });
});

describe('createSimWorkerClient', () => {
  it('drives the worker and receives moving snapshots', () => {
    const h = harness();
    const client = createSimWorkerClient(h.worker);
    const ready: number[] = [];
    const seen: { tick: number; x: number }[] = [];
    client.onReady((t) => ready.push(t));
    client.onSnapshot(({ tick, buf }) => {
      seen.push({ tick, x: decodeSnapshot(buf)[0]!.x });
      client.release(buf);
    });
    client.init(1, openMap());
    expect(ready).toEqual([0]);
    const x0 = seen[0]!.x;
    client.move(1, 0);
    client.aim(20, 0.5);
    h.advance(1000);
    expect(client.tick).toBe(seen.at(-1)!.tick);
    expect(seen.at(-1)!.x - x0).toBeCloseTo((client.tick * 3) / 20, 3);
    // Every snapshot buffer was handed back with a transfer list.
    const releases = h.toWorker.filter((m) => m.msg.kind === 'release');
    expect(releases.length).toBe(seen.length);
    expect(releases.every((m) => m.transfer.length === 1)).toBe(true);
    expect(h.host.droppedMessages).toBe(0);
  });

  it('save over the worker: saved blob restores the same game in a new worker', async () => {
    const h = harness();
    const client = createSimWorkerClient(h.worker);
    client.init(3, openMap(), {
      content: { packs: [fixturePack()] },
      spawn: { x: 5.5, y: 5.5, z: 0 },
    });
    client.move(1, 0);
    h.advance(500);
    const save = await client.save('exit');
    expect(save.reason).toBe('exit');
    expect(save.tick).toBe(h.host.sim!.tick);
    const hash = h.host.sim!.hash();
    const h2 = harness();
    const c2 = createSimWorkerClient(h2.worker);
    c2.init(3, openMap(), { content: { packs: [fixturePack()] }, save: save.buf });
    expect(h2.host.sim!.tick).toBe(save.tick);
    expect(h2.host.sim!.hash()).toBe(hash);
    expect(h2.host.droppedMessages).toBe(0);
  });

  it('passes the init spawn to the sim', () => {
    const h = harness();
    const client = createSimWorkerClient(h.worker);
    let first: { x: number; y: number; z: number } | undefined;
    client.onSnapshot(({ buf }) => (first ??= decodeSnapshot(buf)[0]));
    client.init(1, openMap(), { spawn: { x: 7.5, y: 9.5, z: 0 } });
    expect(first).toMatchObject({ x: 7.5, y: 9.5, z: 0 });
    expect(h.host.sim?.getPlayer()).toMatchObject({ x: 7.5, y: 9.5 });
    expect(h.host.droppedMessages).toBe(0);
  });

  it('spawns init zombies and tells players and zombies apart in the snapshot', () => {
    const h = harness();
    const client = createSimWorkerClient(h.worker);
    let last: ReturnType<typeof decodeSnapshot> | undefined;
    client.onSnapshot(({ buf }) => (last = decodeSnapshot(buf)));
    client.init(1, openMap(), {
      spawn: { x: 5.5, y: 5.5, z: 0 },
      content: { packs: [fixturePack()] },
      zombies: [{ x: 20.5, y: 20.5 }],
      dev: true,
    });
    client.debugSpawnZombie(25.5, 25.5, 2);
    h.advance(200);
    expect(last?.map((e) => e.kind)).toEqual([
      SnapshotEntityKind.player,
      SnapshotEntityKind.zombie,
      SnapshotEntityKind.zombie,
      SnapshotEntityKind.zombie,
    ]);
    expect(h.host.sim?.getZombies()).toHaveLength(3);
  });

  it('stops listening after dispose', () => {
    const h = harness();
    const client = createSimWorkerClient(h.worker);
    let n = 0;
    client.onSnapshot(() => n++);
    client.dispose();
    client.init(1, openMap());
    expect(n).toBe(0);
  });
});

describe('survival over the worker protocol', () => {
  const init = (content: unknown, dev = true) => ({
    kind: 'init',
    seed: 1,
    map: openMap(),
    spawn: { x: 5.5, y: 5.5, z: 0 },
    content,
    dev,
  });

  it('builds the content bundle from raw packs and sends the first full view', () => {
    const h = harness();
    const client = createSimWorkerClient(h.worker);
    const views: SimViewPatch[] = [];
    client.onView((v) => views.push(v));
    client.init(1, openMap(), { content: { packs: [fixturePack()] } });
    expect(h.host.sim?.getSurvival()).toBeDefined();
    expect(views[0]?.clock).toEqual({
      day: 1,
      minuteOfDay: 540,
      ticksPerGameMinute: 50,
      minuteStartTick: 0,
      fastForwardBlocked: false,
    });
    expect(views[0]?.player).toMatchObject({
      alive: true,
      sleeping: false,
      stats: { health: 100, hunger: 0, 'body-temperature-c': 37 },
      wounds: [],
    });
    // Nothing changed → no new view until the next game minute.
    h.advance(1000);
    expect(views).toHaveLength(1);
    h.advance(2000);
    expect(views.at(-1)?.clock?.minuteOfDay).toBe(541);
    expect(views.at(-1)?.player?.stats).toBeDefined();
    expect(views.at(-1)?.player?.alive).toBeUndefined();
  });

  it('forwards events and wound / moodle deltas (dev commands)', () => {
    const h = harness();
    const client = createSimWorkerClient(h.worker);
    const views: SimViewPatch[] = [];
    const events: SimEvent[] = [];
    client.onView((v) => views.push(v));
    client.onEvents((e) => events.push(...e));
    client.init(1, openMap(), { content: { packs: [fixturePack()] }, dev: true });
    client.debugWound('hand_r', 'laceration');
    h.advance(100);
    client.debugGiveItem('fixture:bandage');
    client.bandage('hand_r', 'fixture:bandage');
    // Bandaging is a timed action: 3 game minutes = 7.5 s at ×1.
    h.advance(8000);
    expect(events.map((e) => e.type)).toContain('wounded');
    const woundViews = views.flatMap((v) => (v.player?.wounds ? [v.player.wounds] : []));
    expect(woundViews.at(-1)).toEqual([
      expect.objectContaining({ part: 'hand_r', wound: 'laceration', bandaged: true, bleeding: 0 }),
    ]);
    const moodles = views.flatMap((v) => v.player?.moodles ?? []);
    expect(moodles).toContainEqual({ id: 'fixture:bleeding', level: 1 });
    expect(moodles.at(-1)).toEqual({ id: 'fixture:bleeding', level: 0 });
    expect(h.host.droppedMessages).toBe(0);
  });

  it('item views: nearby storage, search progress, loot panel and inventory deltas', () => {
    const h = harness();
    const client = createSimWorkerClient(h.worker);
    const views: SimViewPatch[] = [];
    client.onView((v) => views.push(v));
    const map = openMap();
    const chunk = { ...map.chunks[0]!, objects: [{ contentId: 'fixture:cabinet', x: 3, y: 2 }] };
    client.init(
      1,
      { chunks: [chunk] },
      {
        content: { packs: [fixturePack()] },
        dev: true,
        spawn: { x: 2.5, y: 2.5, z: 0 },
        floorLoot: false,
      },
    );
    h.advance(100);
    const nearby = views.flatMap((v) => v.nearby ?? []);
    expect(nearby).toEqual([
      { id: 1, kind: 'world', type: 'fixture:cabinet', x: 3, y: 2, z: 0, searched: false },
    ]);
    const inv = views.find((v) => v.inventory)!.inventory!;
    expect(inv).toMatchObject({ container: 2, loadKg: 0, equipped: {} });
    expect(inv.containers).toEqual([
      { id: 2, kind: 'inventory', capacityKg: null, weightKg: 0, items: [] },
    ]);
    client.openContainer(1);
    h.advance(200);
    expect(views.at(-1)?.action).toMatchObject({ kind: 'search', container: 1, queued: 0 });
    // searchMin 2 → 5 s at ×1.
    h.advance(5200);
    const opened = views.find((v) => v.container)!.container!;
    expect(opened).toMatchObject({ id: 1, kind: 'world', type: 'fixture:cabinet' });
    expect(views.some((v) => v.action === null)).toBe(true);
    const n = views.length;
    client.debugGiveItem('fixture:brick', 2);
    h.advance(200);
    const delta = views.slice(n).find((v) => v.inventory)!.inventory!;
    expect(delta.containers).toEqual([
      expect.objectContaining({
        id: 2,
        items: [expect.objectContaining({ def: 'fixture:brick' })],
      }),
    ]);
    expect(delta.loadKg).toBe(4);
  });

  it('without dev, debug commands are rejected by the sim', () => {
    const h = harness();
    const client = createSimWorkerClient(h.worker);
    const events: SimEvent[] = [];
    client.onEvents((e) => events.push(...e));
    client.init(1, openMap(), { content: { packs: [fixturePack()] } });
    client.debugStat('health', 0);
    h.advance(100);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'commandRejected', reason: 'dev-only' }),
    );
  });

  it('reports invalid content with an error message and does not start', () => {
    const h = harness();
    const errors: string[] = [];
    const client = createSimWorkerClient(h.worker);
    client.onError((m) => errors.push(m));
    h.send(
      init({
        packs: [
          { dir: 'bad', files: [{ path: 'world-settings.json', json: { dayLengthMinutes: -1 } }] },
        ],
      }),
    );
    expect(errors).toHaveLength(1);
    expect(h.host.sim).toBeUndefined();
    h.send(init({ packs: [{ dir: 'x', files: [{ path: 'a.json' }] }] }));
    expect(h.host.droppedMessages).toBe(1);
  });
});
