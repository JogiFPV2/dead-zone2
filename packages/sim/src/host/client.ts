import type {
  SaveReason,
  BodyPart,
  Command,
  ContainerId,
  EquipSlot,
  ItemId,
  DebugStat,
  Gait,
  SimContentSource,
  SimZombieSpawn,
  SimEvent,
  SimViewPatch,
  EdgeSide,
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

/** A save game from the worker (store `buf`, pass it back as `init(..., { save })`). */
export interface SavedGame {
  reason: SaveReason;
  tick: number;
  day: number;
  buf: ArrayBuffer;
}

export interface SimWorkerClient {
  /** `spawn` places player 0 (e.g. `?spawn=inside`); omitted = the sim's default tile. */
  init(
    seed: number,
    map: SimMapData,
    opts?: {
      spawn?: SimSpawn;
      content?: SimContentSource;
      dev?: boolean;
      zombies?: readonly SimZombieSpawn[];
      floorLoot?: boolean;
      /** Restores a save (`SavedGame.buf`). */
      save?: ArrayBuffer;
    },
  ): void;
  /** Requests a save (`exit` on quit); resolves with the blob. */
  save(reason?: 'manual' | 'exit'): Promise<SavedGame>;
  /** Every save the worker posts (requested, daily autosave, after sleep). */
  onSaved(cb: (save: SavedGame) => void): () => void;
  /** Sends a fully formed command (tick, playerId, seq chosen by the caller). */
  send(cmd: Command): void;
  /** Held movement for the local player; fills tick/playerId/seq. */
  /** `gait` default walk (sneak / run change speed, footstep noise and needs). */
  move(dx: number, dy: number, gait?: Gait): void;
  /** Aim at a world point (tiles) for the local player. */
  aim(x: number, y: number): void;
  sleep(): void;
  wake(): void;
  /** Timed action with a bandage from the inventory (`itemId` = content id filter). */
  bandage(part: BodyPart, itemId?: string): void;
  pickUp(item: ItemId, count?: number): void;
  drop(item: ItemId, count?: number): void;
  moveItem(item: ItemId, to: ContainerId, count?: number): void;
  /** Takes an item (or `count`) out of a container into the main inventory. */
  takeItem(container: ContainerId, item: ItemId, count?: number): void;
  /** Takes everything that fits out of a container. */
  takeAll(container: ContainerId): void;
  /** Puts a carried item (or `count`) into a container. */
  putItem(container: ContainerId, item: ItemId, count?: number): void;
  equip(item: ItemId, slot: EquipSlot): void;
  unequip(slot: EquipSlot): void;
  /** Opens a container (first time for world storage: timed search). */
  openContainer(container: ContainerId): void;
  closeContainer(): void;
  /** Eat / drink / unpack; medical items need `part`. */
  useItem(item: ItemId, part?: BodyPart): void;
  cancelAction(): void;
  /** Melee swing towards the aim point (weapon in hand_primary, bare hands otherwise). */
  attack(): void;
  /** Shove zombies in front (stagger, no damage). */
  shove(): void;
  /** Reload the firearm in hand_primary (also clears a jam). */
  reload(): void;
  /** Fill a carried magazine with carried rounds. */
  loadMagazine(item: ItemId): void;
  /** Craft a recipe `count` times (timed `craft` actions; parts within the crafting radius). */
  craft(recipe: string, count?: number): void;
  /** Combine 1–4 selected items (`combine` recipe; `recipe` picks one when several match). */
  combine(items: ItemId[], recipe?: string): void;
  /** Upgrade the station item lying on tile (x, y) to its next level. */
  upgradeStation(x: number, y: number): void;
  placeStorage(item: ItemId, x: number, y: number): void;
  /** Open / close the door or window on edge (tx, ty, side); `lock` locks / unlocks a door. */
  toggleDoor(tx: number, ty: number, side: EdgeSide, lock?: boolean): void;
  /** Lay a lure at the player (timer lures: delay and run direction). */
  placeLure(item: ItemId, opts?: { delaySec?: number; dirX?: number; dirY?: number }): void;
  /** Fire a placed remote lure (nearest in range without `item`); needs the remote. */
  triggerLure(item?: ItemId): void;
  /** Throw a carried item towards (x, y); lures land placed (timer lures armed). */
  throwItem(
    item: ItemId,
    x: number,
    y: number,
    opts?: { delaySec?: number; dirX?: number; dirY?: number },
  ): void;
  /** Smash the window on edge (tx, ty, side) — loud. */
  breakWindow(tx: number, ty: number, side: EdgeSide): void;
  pickUpStorage(container: ContainerId): void;
  /** Dev only (init `dev: true`). */
  debugGiveItem(itemId: string, count?: number): void;
  /** Dev: spawns zombies around a point (free tiles). */
  debugSpawnZombie(x: number, y: number, count?: number, zombieType?: string): void;
  /** Dev: a noise at a point (radius in tiles, volume 0..1). */
  debugNoise(x: number, y: number, radiusTiles: number, volume?: number): void;
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

  const savedCbs = new Set<(save: SavedGame) => void>();
  const saveWaiters = new Map<number, (save: SavedGame) => void>();
  let nextSaveId = 1;
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
    } else if (msg.kind === 'saved') {
      const save: SavedGame = { reason: msg.reason, tick: msg.tick, day: msg.day, buf: msg.buf };
      const waiter = saveWaiters.get(msg.requestId);
      if (waiter) {
        saveWaiters.delete(msg.requestId);
        waiter(save);
      }
      for (const cb of savedCbs) cb(save);
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
        ...(opts?.zombies ? { zombies: opts.zombies } : {}),
        ...(opts?.floorLoot !== undefined ? { floorLoot: opts.floorLoot } : {}),
        ...(opts?.save ? { save: opts.save } : {}),
      }),
    save(reason = 'manual') {
      const requestId = nextSaveId++;
      return new Promise<SavedGame>((resolve) => {
        saveWaiters.set(requestId, resolve);
        post({ kind: 'save', requestId, reason });
      });
    },
    onSaved(cb) {
      savedCbs.add(cb);
      return () => savedCbs.delete(cb);
    },
    send: (cmd) => post({ kind: 'cmd', cmd }),
    move: (dx, dy, gait) =>
      post({
        kind: 'cmd',
        cmd: {
          ...nextHeader(),
          type: 'move',
          dx,
          dy,
          ...(gait && gait !== 'walk' ? { gait } : {}),
        },
      }),
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
    takeItem: (container, item, count) =>
      cmd({ type: 'takeItem', container, item, ...(count ? { count } : {}) }),
    takeAll: (container) => cmd({ type: 'takeAll', container }),
    putItem: (container, item, count) =>
      cmd({ type: 'putItem', container, item, ...(count ? { count } : {}) }),
    equip: (item, slot) => cmd({ type: 'equip', item, slot }),
    unequip: (slot) => cmd({ type: 'unequip', slot }),
    openContainer: (container) => cmd({ type: 'openContainer', container }),
    closeContainer: () => cmd({ type: 'closeContainer' }),
    useItem: (item, part) => cmd({ type: 'useItem', item, ...(part ? { part } : {}) }),
    cancelAction: () => cmd({ type: 'cancelAction' }),
    attack: () => cmd({ type: 'attack' }),
    shove: () => cmd({ type: 'shove' }),
    reload: () => cmd({ type: 'reload' }),
    loadMagazine: (item) => cmd({ type: 'loadMagazine', item }),
    craft: (recipe, count) => cmd({ type: 'craft', recipe, ...(count ? { count } : {}) }),
    combine: (items, recipe) => cmd({ type: 'combine', items, ...(recipe ? { recipe } : {}) }),
    upgradeStation: (x, y) => cmd({ type: 'upgradeStation', x, y }),
    placeStorage: (item, x, y) => cmd({ type: 'placeStorage', item, x, y }),
    toggleDoor: (tx, ty, side, lock) =>
      cmd({ type: 'toggleDoor', tx, ty, side, ...(lock ? { lock } : {}) }),
    breakWindow: (tx, ty, side) => cmd({ type: 'breakWindow', tx, ty, side }),
    placeLure: (item, opts) => cmd({ type: 'placeLure', item, ...opts }),
    triggerLure: (item) => cmd({ type: 'triggerLure', ...(item ? { item } : {}) }),
    throwItem: (item, x, y, opts) => cmd({ type: 'throw', item, x, y, ...opts }),
    pickUpStorage: (container) => cmd({ type: 'pickUpStorage', container }),
    debugGiveItem: (itemId, count) =>
      cmd({ type: 'debugGiveItem', itemId, ...(count ? { count } : {}) }),
    debugSpawnZombie: (x, y, count, zombieType) =>
      cmd({
        type: 'debugSpawnZombie',
        x,
        y,
        ...(count ? { count } : {}),
        ...(zombieType ? { zombieType } : {}),
      }),
    debugNoise: (x, y, radiusTiles, volume) =>
      cmd({ type: 'debugNoise', x, y, radiusTiles, ...(volume !== undefined ? { volume } : {}) }),
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

export {
  createSaveStore,
  type IdbFactoryLike,
  type SaveStore,
  type StoredSave,
} from './save-store.js';
