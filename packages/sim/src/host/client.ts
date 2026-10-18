import type {
  CharacterSpec,
  SaveReason,
  BodyPart,
  WoundTreatment,
  Command,
  ContainerId,
  EquipSlot,
  ItemId,
  DebugStat,
  Gait,
  SimContentSource,
  SimZombieSpawn,
  SimAnimalSpawn,
  SimVehicleSpawn,
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
  MarkerColor,
  WaterUse,
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
  /** Vehicle block (protocol `decodeVehicleSnapshot`); absent when the world has no cars. */
  vehicles?: ArrayBuffer;
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
      /** Animals at given points (`type` omitted = weighted). */
      animals?: readonly SimAnimalSpawn[];
      /** Populate the map with this many animals (habitat by chunk, deterministic). */
      populateAnimals?: number;
      /** Parked vehicles at given points (`type` omitted = the first type). */
      vehicles?: readonly SimVehicleSpawn[];
      floorLoot?: boolean;
      /** Restores a save (`SavedGame.buf`). */
      save?: ArrayBuffer;
      /** New game: character from the creator (validated by the sim). */
      character?: CharacterSpec;
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
  /** Sneak toggle (key `C`): walking becomes sneaking until off or a run (`CharacterView.sneaking`). */
  setSneak(on: boolean): void;
  /** Aim at a world point (tiles) for the local player. */
  aim(x: number, y: number): void;
  /** Sleep; `until` = alarm (`'morning'` or hours, protocol 29). */
  sleep(until?: 'morning' | number): void;
  /** Rest sitting (`rest`, protocol 29). */
  rest(): void;
  /** Listen to a radio set in reach (`listenRadio`, protocol 30). */
  listenRadio(): void;
  /** Mains water at a fixture in reach (`useWater`, protocol 33): drink, wash, shower, bath. */
  useWater(use: WaterUse): void;
  wake(): void;
  /** Watch the powered TV nearby (`watch` action); `vhs` = a carried VHS tape. */
  watchTv(vhs?: ItemId): void;
  /** Timed action with a bandage from the inventory (`itemId` = content id filter). */
  bandage(part: BodyPart, itemId?: string): void;
  /** Disinfect / stitch the wounds of `part` (protocol 27); `item` = disinfectant or thread. */
  treatWound(part: BodyPart, treatment: WoundTreatment, item?: ItemId): void;
  pickUp(item: ItemId, count?: number): void;
  drop(item: ItemId, count?: number): void;
  moveItem(item: ItemId, to: ContainerId, count?: number): void;
  /** Takes an item (or `count`) out of a container into the main inventory. */
  takeItem(container: ContainerId, item: ItemId, count?: number): void;
  /** Takes everything that fits out of a container. */
  takeAll(container: ContainerId): void;
  /**
   * Timed search (3.5 s): `{ container }` = world storage or a zombie corpse, `{ x, y }` = a tile
   * (hidden items around it become ground piles). Progress: `view.action.progress`.
   */
  search(target: { container: ContainerId } | { x: number; y: number }): void;
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
  /** Vault over the nearest standing fence / through the nearest open or broken window. */
  vault(): void;
  /** Get into `seat` of a vehicle (timed action; near its door, car nearly stopped, unlocked). */
  enterVehicle(vehicleId: number, seat: number): void;
  /** Get out at the seat's door (timed action; needs a free spot). */
  exitVehicle(): void;
  /** Lock / unlock a car (from inside, or at a door with its key). */
  lockVehicle(vehicleId: number, locked: boolean): void;
  /** Hotwire the car the player drives (timed action, Electrical/Mechanics, noise). */
  hotwire(): void;
  /** Take the key out of the ignition of the car the player drives. */
  takeVehicleKey(): void;
  /** Start / stop the engine of the car the player drives (needs a key or hotwire). */
  vehicleEngine(on: boolean): void;
  /** Sound the horn of the car the player sits in. */
  horn(): void;
  /** Lock the HUD target card on an entity / vehicle id, or clear the lock (`null`). */
  setTarget(id: number | null): void;
  /** Run a furniture / door / window menu entry (`SimViewPatch.furnitureActions`, protocol 26). */
  useFurniture(furnitureId: number, actionId: string): void;
  /** Driver controls (held until the next call): throttle / brake 0..1, steer −1..1 (+ = right). */
  drive(
    throttle: number,
    brake: number,
    steer: number,
    handbrake?: boolean,
    headlights?: boolean,
  ): void;
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
  /** Create the character (once; usually via `init({ character })`). */
  newCharacter(character: CharacterSpec): void;
  placeStorage(item: ItemId, x: number, y: number): void;
  /**
   * Area of interest (docs 9.24): also simulate chunks within `radiusChunks` of chunk (cx, cy)
   * in detail (e.g. the streamer's near ring around the camera target); 0 clears it.
   */
  setInterest(cx: number, cy: number, radiusChunks: number): void;
  /**
   * Map marker (docs 9.29): applied at once, also in pause; answered by `markersChanged`.
   * `showOnMinimap` defaults to true.
   */
  addMarker(
    x: number,
    y: number,
    icon: string,
    color: MarkerColor,
    text?: string,
    showOnMinimap?: boolean,
    /** Floor; default the player's current floor. */
    z?: number,
  ): void;
  editMarker(
    id: number,
    patch: {
      x?: number;
      y?: number;
      z?: number;
      icon?: string;
      color?: MarkerColor;
      text?: string;
      showOnMinimap?: boolean;
    },
  ): void;
  removeMarker(id: number): void;
  /** Open / close the door, window or gate on edge (tx, ty, side); `lock` locks / unlocks. */
  toggleDoor(tx: number, ty: number, side: EdgeSide, lock?: boolean): void;
  /** Timed: smash the window (loud; bare hands may cut the hand). */
  smashWindow(tx: number, ty: number, side: EdgeSide): void;
  /** Timed: climb through the open / broken window (shards may cut). */
  climbThrough(tx: number, ty: number, side: EdgeSide): void;
  /** Timed: clear the shards from a broken window. */
  removeGlass(tx: number, ty: number, side: EdgeSide): void;
  /** Timed: nail one plank (hammer + plank + nails) over a door / window / gate. */
  barricade(tx: number, ty: number, side: EdgeSide): void;
  /** Timed: pull the top plank off (hammer or crowbar). */
  removeBarricade(tx: number, ty: number, side: EdgeSide): void;
  /** Timed: force a locked door / gate (crowbar if carried, else a kick). */
  forceDoor(tx: number, ty: number, side: EdgeSide): void;
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
  /** Same as `smashWindow` (older name). */
  breakWindow(tx: number, ty: number, side: EdgeSide): void;
  pickUpStorage(container: ContainerId): void;
  /** Dev only (init `dev: true`). */
  debugGiveItem(itemId: string, count?: number): void;
  /** Dev: spawns zombies around a point (free tiles). */
  debugSpawnZombie(x: number, y: number, count?: number, zombieType?: string): void;
  /** Dev: spawns animals around a point (free tiles); `animalType` = content id. */
  debugSpawnAnimal(x: number, y: number, count?: number, animalType?: string): void;
  /** Dev: a noise at a point (radius in tiles, volume 0..1). */
  debugNoise(x: number, y: number, radiusTiles: number, volume?: number): void;
  /** Dev only (init `dev: true`). */
  debugWound(part: BodyPart, wound: WoundKind, zombie?: boolean): void;
  /** Dev only (init `dev: true`). */
  debugStat(stat: DebugStat, value: number): void;
  pause(): void;
  resume(): void;
  /** Speed-up ×1/×2/×4: worker loop `speed` + `setTimeScale` command (sleep save real time). */
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
      const snap: SimSnapshotMessage = { tick: msg.tick, buf: msg.buf };
      if (msg.vehicles) snap.vehicles = msg.vehicles;
      for (const cb of snapCbs) cb(snap);
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
        ...(opts?.animals ? { animals: opts.animals } : {}),
        ...(opts?.vehicles ? { vehicles: opts.vehicles } : {}),
        ...(opts?.populateAnimals ? { populateAnimals: opts.populateAnimals } : {}),
        ...(opts?.floorLoot !== undefined ? { floorLoot: opts.floorLoot } : {}),
        ...(opts?.save ? { save: opts.save } : {}),
        ...(opts?.character ? { character: opts.character } : {}),
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
    sleep: (until) =>
      post({
        kind: 'cmd',
        cmd: { ...nextHeader(), type: 'sleep', ...(until !== undefined ? { until } : {}) },
      }),
    rest: () => cmd({ type: 'rest' }),
    listenRadio: () => cmd({ type: 'listenRadio' }),
    useWater: (use) => cmd({ type: 'useWater', use }),
    wake: () => post({ kind: 'cmd', cmd: { ...nextHeader(), type: 'wake' } }),
    watchTv: (vhs) => cmd({ type: 'watchTv', ...(vhs !== undefined ? { vhs } : {}) }),
    search: (target) => cmd({ type: 'search', ...target }),
    bandage: (part, itemId) =>
      post({
        kind: 'cmd',
        cmd: { ...nextHeader(), type: 'bandage', part, ...(itemId ? { itemId } : {}) },
      }),
    treatWound: (part, treatment, item) =>
      cmd({ type: 'treatWound', part, treatment, ...(item !== undefined ? { item } : {}) }),
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
    vault: () => cmd({ type: 'vault' }),
    enterVehicle: (vehicleId, seat) => cmd({ type: 'enterVehicle', vehicleId, seat }),
    exitVehicle: () => cmd({ type: 'exitVehicle' }),
    lockVehicle: (vehicleId, locked) => cmd({ type: 'lockVehicle', vehicleId, locked }),
    hotwire: () => cmd({ type: 'hotwire' }),
    takeVehicleKey: () => cmd({ type: 'takeVehicleKey' }),
    vehicleEngine: (on) => cmd({ type: 'vehicleEngine', on }),
    horn: () => cmd({ type: 'horn' }),
    setTarget: (id) => cmd({ type: 'setTarget', id }),
    useFurniture: (furnitureId, actionId) => cmd({ type: 'useFurniture', furnitureId, actionId }),
    setSneak: (on) => cmd({ type: 'setSneak', on }),
    drive: (throttle, brake, steer, handbrake = false, headlights) =>
      cmd({
        type: 'drive',
        throttle,
        brake,
        steer,
        handbrake,
        ...(headlights !== undefined ? { headlights } : {}),
      }),
    reload: () => cmd({ type: 'reload' }),
    loadMagazine: (item) => cmd({ type: 'loadMagazine', item }),
    craft: (recipe, count) => cmd({ type: 'craft', recipe, ...(count ? { count } : {}) }),
    combine: (items, recipe) => cmd({ type: 'combine', items, ...(recipe ? { recipe } : {}) }),
    upgradeStation: (x, y) => cmd({ type: 'upgradeStation', x, y }),
    newCharacter: (character) => cmd({ type: 'newCharacter', character }),
    placeStorage: (item, x, y) => cmd({ type: 'placeStorage', item, x, y }),
    toggleDoor: (tx, ty, side, lock) =>
      cmd({ type: 'toggleDoor', tx, ty, side, ...(lock ? { lock } : {}) }),
    breakWindow: (tx, ty, side) => cmd({ type: 'smashWindow', tx, ty, side }),
    smashWindow: (tx, ty, side) => cmd({ type: 'smashWindow', tx, ty, side }),
    climbThrough: (tx, ty, side) => cmd({ type: 'climbThrough', tx, ty, side }),
    removeGlass: (tx, ty, side) => cmd({ type: 'removeGlass', tx, ty, side }),
    barricade: (tx, ty, side) => cmd({ type: 'barricade', tx, ty, side }),
    removeBarricade: (tx, ty, side) => cmd({ type: 'removeBarricade', tx, ty, side }),
    forceDoor: (tx, ty, side) => cmd({ type: 'forceDoor', tx, ty, side }),
    placeLure: (item, opts) => cmd({ type: 'placeLure', item, ...opts }),
    triggerLure: (item) => cmd({ type: 'triggerLure', ...(item ? { item } : {}) }),
    throwItem: (item, x, y, opts) => cmd({ type: 'throw', item, x, y, ...opts }),
    pickUpStorage: (container) => cmd({ type: 'pickUpStorage', container }),
    setInterest: (cx, cy, radiusChunks) => cmd({ type: 'setInterest', cx, cy, radiusChunks }),
    addMarker: (x, y, icon, color, text, showOnMinimap, z) =>
      cmd({
        type: 'addMarker',
        x,
        y,
        icon,
        color,
        ...(text !== undefined ? { text } : {}),
        ...(showOnMinimap !== undefined ? { showOnMinimap } : {}),
        ...(z !== undefined ? { z } : {}),
      }),
    editMarker: (id, patch) => cmd({ type: 'editMarker', id, ...patch }),
    removeMarker: (id) => cmd({ type: 'removeMarker', id }),
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
    debugSpawnAnimal: (x, y, count, animalType) =>
      cmd({
        type: 'debugSpawnAnimal',
        x,
        y,
        ...(count ? { count } : {}),
        ...(animalType ? { animalType } : {}),
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
    setSpeed: (x) => {
      // The loop speed (worker) and the sim's real-time measure (sleep save) move together.
      // `setTimeScale` is seq-exempt in the sim queue, so this client's own seq counter (separate
      // from a game-side stamper) cannot get it dropped as `stale-seq`.
      post({ kind: 'speed', x });
      cmd({ type: 'setTimeScale', speed: x });
    },
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
