import type {
  BodyPart,
  Command,
  ContainerId,
  EquipSlot,
  ItemId,
  DebugStat,
  SimContentSource,
  SimEvent,
  SimViewPatch,
  WoundKind,
  MainToWorker,
  PlayerId,
  SimMapData,
  SimSpawn,
  SimSpeed,
  WorkerToMain,
} from '@deadzone/protocol';

/** Structural subset of `Worker` (a real DOM Worker is assignable to it). */
export interface SimWorkerLike {
  postMessage(message: MainToWorker, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  terminate?(): void;
}

export interface SimSnapshotMessage {
  tick: number;
  /** Owned by the receiver; give it back with `release()` when no longer rendered. */
  buf: ArrayBuffer;
}

export interface SimWorkerClient {
  /** `spawn` places player 0 (e.g. `?spawn=inside`); omitted = the sim's default tile. */
  init(
    seed: number,
    map: SimMapData,
    opts?: { spawn?: SimSpawn; content?: SimContentSource; dev?: boolean },
  ): void;
  /** Sends a fully formed command (tick, playerId, seq chosen by the caller). */
  send(cmd: Command): void;
  /** Held movement for the local player; fills tick/playerId/seq. */
  move(dx: number, dy: number): void;
  /** Aim at a world point (tiles) for the local player. */
  aim(x: number, y: number): void;
  sleep(): void;
  wake(): void;
  /** Timed action with a bandage from the inventory (`itemId` = content id filter). */
  bandage(part: BodyPart, itemId?: string): void;
  pickUp(item: ItemId, count?: number): void;
  drop(item: ItemId, count?: number): void;
  moveItem(item: ItemId, to: ContainerId, count?: number): void;
  equip(item: ItemId, slot: EquipSlot): void;
  unequip(slot: EquipSlot): void;
  /** Opens a container (first time for world storage: timed search). */
  openContainer(container: ContainerId): void;
  closeContainer(): void;
  /** Eat / drink / unpack; medical items need `part`. */
  useItem(item: ItemId, part?: BodyPart): void;
  cancelAction(): void;
  placeStorage(item: ItemId, x: number, y: number): void;
  pickUpStorage(container: ContainerId): void;
  /** Dev only (init `dev: true`). */
  debugGiveItem(itemId: string, count?: number): void;
  /** Dev only (init `dev: true`). */
  debugWound(part: BodyPart, wound: WoundKind, zombie?: boolean): void;
  /** Dev only (init `dev: true`). */
  debugStat(stat: DebugStat, value: number): void;
  pause(): void;
  resume(): void;
  setSpeed(x: SimSpeed): void;
  onReady(cb: (tick: number) => void): () => void;
  onSnapshot(cb: (snapshot: SimSnapshotMessage) => void): () => void;
  /** HUD view deltas (moodles, stats, wounds, clock); only sent when something changed. */
  onView(cb: (view: SimViewPatch, tick: number) => void): () => void;
  onEvents(cb: (events: SimEvent[], tick: number) => void): () => void;
  /** Fatal init error (e.g. invalid content). */
  onError(cb: (message: string) => void): () => void;
  /** Returns a snapshot buffer to the worker pool (transferred, so it becomes detached here). */
  release(buf: ArrayBuffer): void;
  /** Latest tick seen in a `ready` or `snapshot` message. */
  readonly tick: number;
  dispose(): void;
}

export function createSimWorkerClient(
  worker: SimWorkerLike,
  opts: { playerId?: PlayerId } = {},
): SimWorkerClient {
  const playerId = opts.playerId ?? 0;
  const readyCbs = new Set<(tick: number) => void>();
  const snapCbs = new Set<(s: SimSnapshotMessage) => void>();
  const viewCbs = new Set<(view: SimViewPatch, tick: number) => void>();
  const eventCbs = new Set<(events: SimEvent[], tick: number) => void>();
  const errorCbs = new Set<(message: string) => void>();
  let tick = 0;
  let seq = 0;

  const post = (msg: MainToWorker, transfer: ArrayBuffer[] = []): void =>
    worker.postMessage(msg, transfer);

  const listener = (event: { data: unknown }): void => {
    const msg = event.data as WorkerToMain;
    if (msg.kind === 'ready') {
      tick = msg.tick;
      for (const cb of readyCbs) cb(msg.tick);
    } else if (msg.kind === 'snapshot') {
      tick = msg.tick;
      for (const cb of snapCbs) cb({ tick: msg.tick, buf: msg.buf });
    } else if (msg.kind === 'view') {
      for (const cb of viewCbs) cb(msg.view, msg.tick);
    } else if (msg.kind === 'events') {
      for (const cb of eventCbs) cb(msg.events, msg.tick);
    } else if (msg.kind === 'error') {
      for (const cb of errorCbs) cb(msg.message);
    }
  };
  worker.addEventListener('message', listener);

  // The worker moves commands for past ticks to its current tick, so the last seen tick is safe.
  const nextHeader = () => ({ tick, playerId, seq: seq++ });
  type Payload = Command extends infer C
    ? C extends Command
      ? Omit<C, 'tick' | 'playerId' | 'seq'>
      : never
    : never;
  const cmd = (payload: Payload): void =>
    post({ kind: 'cmd', cmd: { ...nextHeader(), ...payload } });

  return {
    init: (seed, map, opts) =>
      post({
        kind: 'init',
        seed,
        map,
        ...(opts?.spawn ? { spawn: opts.spawn } : {}),
        ...(opts?.content ? { content: opts.content } : {}),
        ...(opts?.dev ? { dev: true } : {}),
      }),
    send: (cmd) => post({ kind: 'cmd', cmd }),
    move: (dx, dy) => post({ kind: 'cmd', cmd: { ...nextHeader(), type: 'move', dx, dy } }),
    aim: (x, y) => post({ kind: 'cmd', cmd: { ...nextHeader(), type: 'aim', x, y } }),
    sleep: () => post({ kind: 'cmd', cmd: { ...nextHeader(), type: 'sleep' } }),
    wake: () => post({ kind: 'cmd', cmd: { ...nextHeader(), type: 'wake' } }),
    bandage: (part, itemId) =>
      post({
        kind: 'cmd',
        cmd: { ...nextHeader(), type: 'bandage', part, ...(itemId ? { itemId } : {}) },
      }),
    pickUp: (item, count) => cmd({ type: 'pickUp', item, ...(count ? { count } : {}) }),
    drop: (item, count) => cmd({ type: 'drop', item, ...(count ? { count } : {}) }),
    moveItem: (item, to, count) => cmd({ type: 'moveItem', item, to, ...(count ? { count } : {}) }),
    equip: (item, slot) => cmd({ type: 'equip', item, slot }),
    unequip: (slot) => cmd({ type: 'unequip', slot }),
    openContainer: (container) => cmd({ type: 'openContainer', container }),
    closeContainer: () => cmd({ type: 'closeContainer' }),
    useItem: (item, part) => cmd({ type: 'useItem', item, ...(part ? { part } : {}) }),
    cancelAction: () => cmd({ type: 'cancelAction' }),
    placeStorage: (item, x, y) => cmd({ type: 'placeStorage', item, x, y }),
    pickUpStorage: (container) => cmd({ type: 'pickUpStorage', container }),
    debugGiveItem: (itemId, count) =>
      cmd({ type: 'debugGiveItem', itemId, ...(count ? { count } : {}) }),
    debugWound: (part, wound, zombie) =>
      post({
        kind: 'cmd',
        cmd: { ...nextHeader(), type: 'debugWound', part, wound, ...(zombie ? { zombie } : {}) },
      }),
    debugStat: (stat, value) =>
      post({ kind: 'cmd', cmd: { ...nextHeader(), type: 'debugStat', stat, value } }),
    pause: () => post({ kind: 'pause' }),
    resume: () => post({ kind: 'resume' }),
    setSpeed: (x) => post({ kind: 'speed', x }),
    onReady(cb) {
      readyCbs.add(cb);
      return () => readyCbs.delete(cb);
    },
    onSnapshot(cb) {
      snapCbs.add(cb);
      return () => snapCbs.delete(cb);
    },
    onView(cb) {
      viewCbs.add(cb);
      return () => viewCbs.delete(cb);
    },
    onEvents(cb) {
      eventCbs.add(cb);
      return () => eventCbs.delete(cb);
    },
    onError(cb) {
      errorCbs.add(cb);
      return () => errorCbs.delete(cb);
    },
    release(buf) {
      if (buf.byteLength > 0) post({ kind: 'release', buf }, [buf]);
    },
    get tick() {
      return tick;
    },
    dispose() {
      worker.removeEventListener('message', listener);
      readyCbs.clear();
      snapCbs.clear();
      viewCbs.clear();
      eventCbs.clear();
      errorCbs.clear();
      worker.terminate?.();
    },
  };
}
