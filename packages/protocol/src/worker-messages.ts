import type { Command } from './commands.js';
import type { SimEvent } from './events.js';
import type { SimMapData } from './map.js';
import type { SimViewPatch } from './views.js';

export type SimSpeed = 1 | 2 | 4;

/** Spawn point of the local player: tiles (+x east, +y south) and floor level. */
export interface SimSpawn {
  x: number;
  y: number;
  z: number;
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
      /** Enables debug commands (`debugWound`, `debugStat`, `debugGiveItem`). */
      dev?: boolean | undefined;
    }
  | { kind: 'cmd'; cmd: Command }
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
  | { kind: 'snapshot'; tick: number; buf: ArrayBuffer }
  /** UI view delta (HUD: moodles, stats, wounds, clock), only when something changed. */
  | { kind: 'view'; tick: number; view: SimViewPatch }
  /** Sim events of the last batch of ticks (died, wounded, moodleChanged, timeScaleHint…). */
  | { kind: 'events'; tick: number; events: SimEvent[] }
  /** Fatal init error (e.g. content failed validation); the sim does not start. */
  | { kind: 'error'; message: string };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
