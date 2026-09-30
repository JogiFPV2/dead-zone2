import type { Command } from './commands.js';
import type { SimMapData } from './map.js';

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
    }
  | { kind: 'cmd'; cmd: Command }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'speed'; x: SimSpeed }
  /** Gives a snapshot buffer back to the worker pool once render no longer needs it. */
  | { kind: 'release'; buf: ArrayBuffer };

/** Sim worker → main thread. `buf` is transferred (zero-copy), see snapshot.ts for the layout. */
export type WorkerToMain =
  { kind: 'ready'; tick: number } | { kind: 'snapshot'; tick: number; buf: ArrayBuffer };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
