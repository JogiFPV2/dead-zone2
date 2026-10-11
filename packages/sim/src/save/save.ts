import { PROTOCOL_VERSION, type WorldSource } from '@deadzone/protocol';
import { decodePlayerMaps, encodePlayerMaps, type PlayerMapSave } from '../map/player-map.js';
import { decodeLod, encodeLod, type LodSave } from './delta.js';
import { addComponent, addEntity, hasComponent } from 'bitecs';
import { RNG_STREAMS, Rng } from '../core/rng.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { migrateCharacters } from '../character/character.js';
import { ensureVehicleParts } from '../vehicles/damage.js';
import { ensureVehicleGameplay } from '../vehicles/keys.js';
import { createVehicleContainers } from '../vehicles/containers.js';
import { vehicleTypes } from '../vehicles/seats.js';
import {
  SAVE_FORMAT,
  SAVE_READABLE_VERSIONS,
  SAVE_VERSION,
  SaveError,
  type SaveErrorCode,
} from './format.js';
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
export {
  SAVE_FORMAT,
  SAVE_READABLE_VERSIONS,
  SAVE_VERSION,
  SaveError,
  type SaveErrorCode,
} from './format.js';

/** World the save was made on (generator seed and version, content fingerprint). */
export interface SaveWorldHeader {
  seed: number;
  generatorVersion: number;
  contentVersion: string;
}

/** Fields that are content, config or rebuilt every tick (never saved). */
const SKIP_SURVIVAL = ['content'];
const SKIP_ITEMS = ['content', 'version'];
const SKIP_AI = [
  'cfg',
  'types',
  'spawnWeights',
  'animalTypes',
  'animalSpawnWeights',
  'lights',
  'darkZones',
  'coverZones',
  'spatial',
  'combat',
];
const SKIP_COMBAT = ['cfg', 'targets'];
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
  /** Version 2: the world (generator) the delta applies to. */
  world?: SaveWorldHeader;
  /** Version 2: LOD cell counters, chunk flags and signatures (save/delta.ts). */
  lod?: LodSave;
  /** Version 2: eids freed by the LOD (reused LIFO by spawns). */
  freeEids?: number[];
  /** Version 2: characters' world maps (fog bitmap, trail, markers; map/player-map.ts). */
  playerMaps?: PlayerMapSave[];
  /** Version 2: `setInterest` areas `[playerId, cx, cy, radiusChunks]` (absent = none). */
  interest?: [number, number, number, number][];
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
  // Pooled eids keep their old field values; they are saved too so a reuse matches after a load.
  const maxEid = Math.max(
    eids.reduce((m, e) => Math.max(m, e), 0),
    w.freeEids.reduce((m, e) => Math.max(m, e), 0),
  );
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
    world: {
      seed: w.source.seed,
      generatorVersion: w.source.generatorVersion,
      contentVersion: contentFingerprint(w),
    },
    ...(w.lod ? { lod: encodeLod(w.lod) } : {}),
    ...(w.freeEids.length > 0 ? { freeEids: [...w.freeEids] } : {}),
    ...(() => {
      const maps = encodePlayerMaps(w.playerMap);
      return maps ? { playerMaps: maps } : {};
    })(),
    ...(w.interest.size > 0
      ? {
          interest: [...w.interest.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([id, it]): [number, number, number, number] => [id, it.cx, it.cy, it.r]),
        }
      : {}),
  };
  return utf8Encode(JSON.stringify(file));
}

export type SaveCheck =
  | { ok: true; seed: number; tick: number; version: number; world: SaveWorldHeader | undefined }
  | { ok: false; code: SaveErrorCode; message: string };

/**
 * Checks a save without loading it (never throws): format, version and, when `world` is given,
 * the generator seed / version (`WorldSource.acceptsGeneratorVersion` = migration path).
 */
export function checkSave(bytes: Uint8Array, world?: WorldSource): SaveCheck {
  try {
    const f = parse(bytes);
    if (world) checkWorld(f, world);
    return { ok: true, seed: f.seed, tick: f.tick, version: f.version, world: f.world };
  } catch (e) {
    if (e instanceof SaveError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'corrupt', message: e instanceof Error ? e.message : String(e) };
  }
}

function checkWorld(f: SaveFile, src: WorldSource): void {
  const wh = f.world ?? { seed: src.seed, generatorVersion: 0, contentVersion: f.fingerprint };
  if (wh.seed !== src.seed)
    throw new SaveError('world-seed', `save: world seed ${wh.seed}, this world is ${src.seed}`);
  if (
    wh.generatorVersion !== src.generatorVersion &&
    !src.acceptsGeneratorVersion?.(wh.generatorVersion)
  ) {
    throw new SaveError(
      'generator-version',
      `save: made with world generator v${wh.generatorVersion}, this build has v${src.generatorVersion}`,
    );
  }
}

export function readSaveHeader(bytes: Uint8Array): { seed: number; tick: number; version: number } {
  const f = parse(bytes);
  return { seed: f.seed, tick: f.tick, version: f.version };
}

function parse(bytes: Uint8Array): SaveFile {
  let f: SaveFile;
  try {
    f = JSON.parse(utf8Decode(bytes)) as SaveFile;
  } catch {
    throw new SaveError('not-a-save', 'save: not a Deadzone save');
  }
  if (!f || typeof f !== 'object' || f.format !== SAVE_FORMAT)
    throw new SaveError('not-a-save', 'save: not a Deadzone save');
  if (!SAVE_READABLE_VERSIONS.includes(f.version))
    throw new SaveError('unsupported-version', `save: unsupported version ${f.version}`);
  return f;
}

/**
 * Restores a save into a freshly created world without entities (same seed, map, content,
 * capacity). Entities are recreated in eid order, so eids match the saved ones.
 */
export function loadWorld(w: SimWorld, bytes: Uint8Array): void {
  const f = parse(bytes);
  if (f.capacity !== w.capacity) throw new SaveError('capacity', 'save: different entity capacity');
  if (f.fingerprint !== contentFingerprint(w))
    throw new SaveError('content', 'save: different content');
  checkWorld(f, w.source);
  if (!!f.lod !== !!w.lod)
    throw new SaveError('corrupt', 'save: LOD state does not match this world (size or simLod)');
  const names = Object.keys(w.c) as (keyof typeof w.c)[];
  let last = -1;
  for (const [eid, comps] of f.entities) {
    while (last < eid) last = addEntity(w.ecs);
    if (last !== eid) throw new SaveError('corrupt', 'save: entity ids do not match');
    for (const n of comps) if (n in w.c) addComponentByName(w, eid, n as keyof typeof w.c);
  }
  // Pooled eids past the last live entity exist too (no components), as in the saved world.
  const free = f.freeEids ?? [];
  const maxFree = free.reduce((m, e) => Math.max(m, e), -1);
  while (last < maxFree) last = addEntity(w.ecs);
  w.freeEids.length = 0;
  w.freeEids.push(...free);
  decodePlayerMaps(w.playerMap, f.playerMaps);
  w.interest.clear();
  for (const [id, cx, cy, r] of f.interest ?? []) w.interest.set(id, { cx, cy, r });
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
  if (w.items && f.items) {
    restoreInto(w.items, decode(f.items));
    // Saves before one `head` appearance slot (content #38): face / hair → head.
    migrateCharacters(w.items);
  }
  if (w.ai && f.ai) {
    restoreInto(w.ai, decode(f.ai));
    if (f.combat) restoreInto(w.ai.combat, decode(f.combat));
  }
  if (f.openings) restoreInto(w.openings, decode(f.openings));
  if (f.physics) restoreInto(w.physics, decode(f.physics), SKIP_PHYSICS);
  w.physics.rng = w.rng.physics;
  w.physics.orderSize = -1;
  for (const v of w.physics.vehicles.values()) {
    ensureVehicleParts(v);
    ensureVehicleGameplay(v);
    // Cars from saves made before trunks/gloveboxes existed get them now (lazy loot roll).
    const t = vehicleTypes(w)[v.type];
    if (v.containers.length === 0 && t) createVehicleContainers(w, v, t);
  }
  if (w.lod && f.lod) {
    try {
      decodeLod(w.lod, f.lod);
    } catch (e) {
      throw new SaveError('corrupt', e instanceof Error ? e.message : String(e));
    }
  }
  if (w.items) w.items.version++;
}

function addComponentByName(w: SimWorld, eid: number, n: keyof SimWorld['c']): void {
  addComponent(w.ecs, eid, w.c[n]);
}
