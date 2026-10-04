import type { GenColumn } from '@deadzone/map/world-source';
import type { GeneratedMapSpec } from './maps.js';

/** What the main thread knows about a generated world (from the chunk worker's `ready`). */
export interface GenWorldInfo {
  id: string;
  version: string;
  generatorVersion: number;
  seed: number;
  bounds: { cx0: number; cy0: number; cx1: number; cy1: number };
  maxLevel: number;
  start: { x: number; y: number; heading: number };
  /** Zombies framed around the start (new game). */
  zombies: { x: number; y: number; heading: number }[];
  /** Named places (saveSummary.place, big map). */
  places: { name: string; kind: string; x: number; y: number }[];
  attribution?: string | undefined;
  /** Plan load + index time (ms). */
  loadMs: number;
}

export type ToChunkWorker =
  { t: 'init'; spec: GeneratedMapSpec } | { t: 'chunk'; id: number; cx: number; cy: number };

export type FromChunkWorker =
  | { t: 'ready'; info: GenWorldInfo }
  | { t: 'error'; message: string }
  | { t: 'chunk'; id: number; col: GenColumn | null; ms: number };

/** First message to the game's sim worker (`sim-world-worker.ts`), before `init`. */
export interface SimWorldMessage {
  kind: 'dz-world';
  spec: GeneratedMapSpec;
}
