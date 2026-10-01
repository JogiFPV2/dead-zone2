import { PROTOCOL_VERSION } from '@deadzone/protocol';
import { addComponent, addEntity, hasComponent } from 'bitecs';
import { RNG_STREAMS, Rng } from '../core/rng.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import {
  decode,
  encode,
  encodeFields,
  restoreInto,
  type AnyTyped,
  utf8Decode,
  utf8Encode,
} from './codec.js';

/**
 * Save games (docs 2.7 `save`): the whole sim state as versioned JSON in UTF-8 bytes. Derived
 * caches and content are not saved; loading needs the same content and map (checked by seed and
 * a content fingerprint). Round trip: save → load → the same `hash()` after any number of ticks.
 */
export const SAVE_FORMAT = 'deadzone-save';
export const SAVE_VERSION = 1;

/** Fields that are content, config or rebuilt every tick (never saved). */
const SKIP_SURVIVAL = ['content'];
const SKIP_ITEMS = ['content', 'version'];
const SKIP_AI = ['cfg', 'types', 'spawnWeights', 'lights', 'darkZones', 'spatial', 'combat'];
const SKIP_COMBAT = ['cfg'];
const SKIP_PHYSICS = ['cfg', 'rng', 'order', 'orderSize', 'presses', 'stairs', 'multiLevel'];

interface SaveFile {
  format: string;
  version: number;
  protocol: number;
  seed: number;
  capacity: number;
  fingerprint: string;
  tick: number;
  nextStableId: number;
  players: [number, number][];
  /** eid → names of attached components (eid order). */
  entities: [number, string[]][];
  components: unknown;
  rng: Record<string, [number, number, number, number]>;
  queue: unknown;
  survival?: unknown;
  items?: unknown;
  ai?: unknown;
  combat?: unknown;
  openings?: unknown;
  /** Physics bodies (absent in older saves: bodies are recreated on the next tick). */
  physics?: unknown;
}

/** Cheap fingerprint of the compiled content (ids and counts), to refuse foreign saves. */
export function contentFingerprint(w: SimWorld): string {
  const c = w.survival?.content;
  if (!c) return 'none';
  return [
    c.items.length,
    c.moodles.length,
    c.zombieTypes.length,
    c.containerTypes.length,
    c.items.map((i) => i.id).join(',').length,
  ].join(':');
}

export function saveWorld(w: SimWorld): Uint8Array {
  const eids = sortedQuery(w, 'hash', []);
  const maxEid = eids.reduce((m, e) => Math.max(m, e), 0);
  // Per-entity arrays are trimmed to the used entity range (`len = k × capacity`).
  const usedOf = (v: AnyTyped): number =>
    v.length % w.capacity === 0 ? (v.length / w.capacity) * (maxEid + 1) : v.length;
  const names = Object.keys(w.c) as (keyof typeof w.c)[];
  const entities: [number, string[]][] = [...eids]
    .sort((a, b) => a - b)
    .map((eid) => [eid, names.filter((n) => hasComponent(w.ecs, eid, w.c[n]))]);
  const components: Record<string, unknown> = {};
  for (const n of names) components[n] = encodeFields(w.c[n], [], usedOf);
  const rng: SaveFile['rng'] = {};
  for (const name of RNG_STREAMS) rng[name] = w.rng[name].state();
  const file: SaveFile = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    protocol: PROTOCOL_VERSION,
    seed: w.seed,
    capacity: w.capacity,
    fingerprint: contentFingerprint(w),
    tick: w.tick,
    nextStableId: w.nextStableId,
    players: [...w.players.entries()],
    entities,
    components,
    rng,
    queue: encode(w.queue.exportState()),
    ...(w.survival ? { survival: encodeFields(w.survival, SKIP_SURVIVAL, usedOf) } : {}),
    ...(w.items ? { items: encodeFields(w.items, SKIP_ITEMS, usedOf) } : {}),
    ...(w.ai
      ? {
          ai: encodeFields(w.ai, SKIP_AI, usedOf),
          combat: encodeFields(w.ai.combat, SKIP_COMBAT, usedOf),
        }
      : {}),
    openings: encodeFields(w.openings, ['cfg', 'kinds'], usedOf),
    physics: encodeFields(w.physics, SKIP_PHYSICS, usedOf),
  };
  return utf8Encode(JSON.stringify(file));
}

export function readSaveHeader(bytes: Uint8Array): { seed: number; tick: number; version: number } {
  const f = parse(bytes);
  return { seed: f.seed, tick: f.tick, version: f.version };
}

function parse(bytes: Uint8Array): SaveFile {
  const f = JSON.parse(utf8Decode(bytes)) as SaveFile;
  if (f.format !== SAVE_FORMAT) throw new Error('save: not a Deadzone save');
  if (f.version !== SAVE_VERSION) throw new Error(`save: unsupported version ${f.version}`);
  return f;
}

/**
 * Restores a save into a freshly created world without entities (same seed, map, content,
 * capacity). Entities are recreated in eid order, so eids match the saved ones.
 */
export function loadWorld(w: SimWorld, bytes: Uint8Array): void {
  const f = parse(bytes);
  if (f.capacity !== w.capacity) throw new Error('save: different entity capacity');
  if (f.fingerprint !== contentFingerprint(w)) throw new Error('save: different content');
  const names = Object.keys(w.c) as (keyof typeof w.c)[];
  let last = -1;
  for (const [eid, comps] of f.entities) {
    while (last < eid) last = addEntity(w.ecs);
    if (last !== eid) throw new Error('save: entity ids do not match');
    for (const n of comps) if (n in w.c) addComponentByName(w, eid, n as keyof typeof w.c);
  }
  w.structureVersion++;
  for (const n of names) {
    const saved = (f.components as Record<string, unknown>)[n];
    if (saved) restoreInto(w.c[n], decode(saved));
  }
  for (const name of RNG_STREAMS) {
    const st = f.rng[name];
    if (st) w.rng[name] = new Rng(st);
  }
  w.queue.importState(decode(f.queue) as Parameters<typeof w.queue.importState>[0]);
  w.tick = f.tick;
  w.nextStableId = f.nextStableId;
  w.players.clear();
  for (const [p, e] of f.players) w.players.set(p, e);
  if (w.survival && f.survival) {
    restoreInto(w.survival, decode(f.survival));
    // Saves before real sleep time: assume ×1 for the ticks already slept.
    const sv = w.survival;
    const savedSurvival = f.survival as Record<string, unknown>;
    if (savedSurvival.sleepRealQ === undefined)
      for (let e = 0; e < sv.sleepTicks.length; e++) sv.sleepRealQ[e] = (sv.sleepTicks[e] ?? 0) * 4;
  }
  if (w.items && f.items) restoreInto(w.items, decode(f.items));
  if (w.ai && f.ai) {
    restoreInto(w.ai, decode(f.ai));
    if (f.combat) restoreInto(w.ai.combat, decode(f.combat));
  }
  if (f.openings) restoreInto(w.openings, decode(f.openings));
  if (f.physics) restoreInto(w.physics, decode(f.physics), SKIP_PHYSICS);
  w.physics.rng = w.rng.physics;
  w.physics.orderSize = -1;
  if (w.items) w.items.version++;
}

function addComponentByName(w: SimWorld, eid: number, n: keyof SimWorld['c']): void {
  addComponent(w.ecs, eid, w.c[n]);
}
