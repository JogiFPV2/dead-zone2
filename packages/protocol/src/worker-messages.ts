import type { WeatherKind } from './weather.js';
import type { CharacterSpec, Command } from './commands.js';
import type { SimEvent } from './events.js';
import type { SimMapData } from './map.js';
import type { SimViewPatch } from './views.js';

export type SimSpeed = 1 | 2 | 4;

export type SaveReason = 'manual' | 'exit' | 'autosave' | 'sleep';

/** Spawn point of the local player: tiles (+x east, +y south) and floor level. */
export interface SimSpawn {
  x: number;
  y: number;
  z: number;
}

/** A zombie to spawn at init (`createSim({ spawnZombies })`); `type` = zombie type content id. */
export interface SimZombieSpawn {
  x: number;
  y: number;
  z?: number | undefined;
  type?: string | undefined;
}

/** An animal to spawn at init (`createSim({ spawnAnimals })`); `type` = animal type content id. */
export interface SimAnimalSpawn {
  x: number;
  y: number;
  z?: number | undefined;
  type?: string | undefined;
}

/**
 * A vehicle to place at init (`createSim({ spawnVehicles })`): centre in tiles, `heading` in rad
 * (like facingRad), `type` = vehicle type content id (omitted = the first by id), `fuel` in litres
 * (omitted = full).
 */
export interface SimVehicleSpawn {
  x: number;
  y: number;
  z?: number | undefined;
  heading?: number | undefined;
  type?: string | undefined;
  fuel?: number | undefined;
  /** Locked (default false: open). */
  locked?: boolean | undefined;
  /**
   * Where its key is (default `ignition`: the car starts when a driver gets in): `glovebox` = a
   * key item in the glovebox, `none` = no key (hotwire it).
   */
  key?: 'ignition' | 'glovebox' | 'none' | undefined;
}

/** Main thread → sim worker. */
export type MainToWorker =
  | {
      kind: 'init';
      seed: number;
      map: SimMapData;
      /** Player 0 spawn (tile centre in tiles, z = floor); omitted = the sim's default tile. */
      spawn?: SimSpawn | undefined;
      /** Content packs (raw JSON files, base first); the worker validates and builds the bundle. */
      content?: SimContentSource | undefined;
      /** Zombies at start (game modes, tests); needs content with `zombieTypes`. */
      zombies?: readonly SimZombieSpawn[] | undefined;
      /** Animals at start at given points (`type` omitted = weighted by `spawnWeight`). */
      animals?: readonly SimAnimalSpawn[] | undefined;
      /**
       * Populate the map with this many animals at init (outdoor tiles, habitat: chunks with
       * buildings = town, without = wild; deterministic, RNG stream `animals`). Default 0.
       */
      populateAnimals?: number | undefined;
      /** Vehicles at start (needs content with `vehicleTypes`). */
      vehicles?: readonly SimVehicleSpawn[] | undefined;
      /** Single loot items on floors at init (default true). */
      floorLoot?: boolean | undefined;
      /** Weather (protocol 50): a kind pins it (dev `?weather=`), `off` disables; default content. */
      weather?: WeatherKind | 'auto' | 'off' | undefined;
      /** Save from a `saved` message: restores the game (spawn, zombies, floorLoot are ignored). */
      save?: ArrayBuffer | undefined;
      /** Enables debug commands (`debugWound`, `debugStat`, `debugGiveItem`, `debugSpawnZombie`, `debugSpawnAnimal`, `debugNoise`). */
      dev?: boolean | undefined;
      /** Allows only `debugRevealMap` outside dev (single-player client sets it; servers/multiplayer never). Default false. */
      allowRevealMap?: boolean | undefined;
      /** New game: the creator's character, sent as `newCharacter` for player 0 (ignored with `save`). */
      character?: CharacterSpec | undefined;
    }
  | { kind: 'cmd'; cmd: Command }
  /** Asks for a save; the worker answers with `saved` (same `requestId`). `exit` = on quit. */
  | { kind: 'save'; requestId: number; reason?: 'manual' | 'exit' | undefined }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'speed'; x: SimSpeed }
  /** Gives a snapshot buffer back to the worker pool once render no longer needs it. */
  | { kind: 'release'; buf: ArrayBuffer };

/** One file of a content pack, path relative to the pack root (same as `PackFile` in content). */
export type SimContentFile = { path: string; json: unknown } | { path: string; text: string };

export interface SimContentPack {
  /** Pack label in errors (e.g. `base`). */
  dir: string;
  files: readonly SimContentFile[];
}

/** Raw packs in load order; built into a `ContentBundle` inside the worker (zod stays there). */
export interface SimContentSource {
  packs: readonly SimContentPack[];
}

/** Sim worker → main thread. `buf` is transferred (zero-copy), see snapshot.ts for the layout. */
export type WorkerToMain =
  | { kind: 'ready'; tick: number }
  /** `vehicles`: vehicle block (vehicles.ts), transferred too; absent without vehicles. */
  | { kind: 'snapshot'; tick: number; buf: ArrayBuffer; vehicles?: ArrayBuffer | undefined }
  /** UI view delta (HUD: moodles, stats, wounds, clock), only when something changed. */
  | { kind: 'view'; tick: number; view: SimViewPatch }
  /** Sim events of the last batch of ticks (died, wounded, moodleChanged, timeScaleHint…). */
  | { kind: 'events'; tick: number; events: SimEvent[] }
  /**
   * A save game (versioned blob for `init.save`, store it e.g. in IndexedDB). `reason`: answer to
   * `save` (`manual` / `exit`, with its `requestId`), `autosave` every game day, `sleep` after
   * an uninterrupted sleep (`sleepSaved`); `requestId` 0 when not requested.
   */
  | {
      kind: 'saved';
      requestId: number;
      reason: SaveReason;
      tick: number;
      day: number;
      buf: ArrayBuffer;
    }
  /** Fatal init error (e.g. content failed validation); the sim does not start. */
  /**
   * Init failed. `code` (PROTOCOL_VERSION 10) is set for save errors (sim `SaveErrorCode`:
   * `not-a-save`, `unsupported-version`, `content`, `capacity`, `generator-version`,
   * `world-seed`, `corrupt`) so the client can show a readable message or offer a migration.
   */
  | { kind: 'error'; message: string; code?: string };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
