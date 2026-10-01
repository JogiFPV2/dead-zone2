/**
 * Render snapshot: a flat `Float32Array` over an `ArrayBuffer` (transferable), no header.
 *
 * Layout, SNAPSHOT_ENTITY_STRIDE 32-bit words per entity:
 * ```
 *   stableId, x, y, z, facingRad, kind, anim, hpPct,
 *   state, stateStartTick*, stateDuration, knockbackDirX, knockbackDirY, knockbackStrength,
 *   hitFromDir, gaitSeed*
 * ```
 * All words are f32 except the ones marked `*` (SNAPSHOT_U32_FIELDS): those are u32 bit patterns,
 * read them through a `Uint32Array` over the same buffer (`readSnapshotEntity` does this).
 * The first record is always the local player; the other players and the zombies (NPCs) follow
 * in StableId order. `kind` tells them apart (SnapshotEntityKind; 0 = unknown, e.g. mock data),
 * `anim` is a locomotion hint for the renderer (SnapshotAnim). The entity count is
 * `byteLength / (SNAPSHOT_ENTITY_STRIDE * 4)`, so pooled buffers are only reused when their size
 * matches exactly. `stableId` is exact up to 2^24 (f32 mantissa).
 * x/y are in tiles (+x east, +y south), z is the floor level, facingRad is in [0, 2π) measured
 * from +x towards +y (i.e. clockwise on screen when +y points down).
 * PROTOCOL_VERSION 5 added `kind` and `anim` (stride 5 → 7); 6 added `hpPct` (stride 7 → 8):
 * health 0–1 (player: health / 100, zombie: hp / max hp of its type, dead: 0).
 * 7 added the physics body (stride 8 → 16): `state` = index in ENTITY_PHYS_STATES,
 * `stateStartTick` / `stateDuration` in ticks (duration 0 = open-ended), knockback of the last
 * hit (unit direction + strength 0..1, zeroed when the entity is back in control), `hitFromDir`
 * (rad, like facingRad: where the last hit came from), `gaitSeed` (u32, fixed per zombie, 0 for
 * players).
 */
export const SNAPSHOT_ENTITY_STRIDE = 16;
export const SnapshotField = {
  stableId: 0,
  x: 1,
  y: 2,
  z: 3,
  facingRad: 4,
  kind: 5,
  anim: 6,
  hpPct: 7,
  state: 8,
  stateStartTick: 9,
  stateDuration: 10,
  knockbackDirX: 11,
  knockbackDirY: 12,
  knockbackStrength: 13,
  hitFromDir: 14,
  gaitSeed: 15,
} as const;

/** Fields stored as u32 bit patterns (not f32). */
export const SNAPSHOT_U32_FIELDS = [SnapshotField.stateStartTick, SnapshotField.gaitSeed] as const;

/** `kind` field values. */
export const SnapshotEntityKind = { unknown: 0, player: 1, zombie: 2 } as const;
export type SnapshotEntityKindValue = (typeof SnapshotEntityKind)[keyof typeof SnapshotEntityKind];

/**
 * `anim` field values: idle, walk (wander / investigate), run (chase), attack (reserved for
 * combat), dead (reserved: corpses).
 */
export const SnapshotAnim = { idle: 0, walk: 1, run: 2, attack: 3, dead: 4 } as const;
export type SnapshotAnimValue = (typeof SnapshotAnim)[keyof typeof SnapshotAnim];

/**
 * Body state of the physics module (`packages/sim/src/physics`), shared by players and zombies.
 * Agreed with the client for animations; `knockdown` = lying on the ground, `getup` = standing up.
 */
export const ENTITY_PHYS_STATES = [
  'idle',
  'walk',
  'run',
  'attack',
  'push',
  'hit',
  'stagger',
  'knockdown',
  'getup',
  'dead',
  /** On a flight of stairs (moving or standing; z fractional). */
  'climb',
  /** Falling down one or more levels (z drops to the landing level, then `knockdown`). */
  'fall',
] as const;
export type EntityPhysState = (typeof ENTITY_PHYS_STATES)[number];

/** Knock-back of the last hit: unit direction (tiles) and strength 0..1. */
export interface EntityKnockback {
  dirX: number;
  dirY: number;
  strength: number;
}

export interface SnapshotEntity {
  stableId: number;
  x: number;
  y: number;
  z: number;
  facingRad: number;
  /** SnapshotEntityKind (0 when omitted). */
  kind?: number;
  /** SnapshotAnim (0 when omitted). */
  anim?: number;
  /** Health 0–1 (1 when omitted). */
  hpPct?: number;
  /*
   * Physics fields (PROTOCOL_VERSION 7). Facing is `facingRad`. `vel`, `maxSpeed` and
   * `lastHitTick` are not in the binary layout (object snapshots and tests only).
   */
  /** Velocity in tiles per tick. */
  vel?: { x: number; y: number };
  /** Current max speed in tiles per tick (after load and endurance). */
  maxSpeed?: number;
  state?: EntityPhysState;
  /** Tick the current `state` started; `stateDuration` in ticks (0 = open-ended). */
  stateStartTick?: number;
  stateDuration?: number;
  knockback?: EntityKnockback;
  /** Tick of the last hit taken (0 = never) and direction it came from (rad, like facingRad). */
  lastHitTick?: number;
  hitFromDir?: number;
  /** u32 per zombie from the seeded RNG, fixed for life (gait / animation variation). */
  gaitSeed?: number;
}

export const snapshotFloatLength = (entityCount: number): number =>
  entityCount * SNAPSHOT_ENTITY_STRIDE;

export const snapshotByteLength = (entityCount: number): number =>
  snapshotFloatLength(entityCount) * Float32Array.BYTES_PER_ELEMENT;

/** Returns a buffer of exactly `entityCount` records: `reuse` if its size matches, else a new one. */
export function ensureSnapshotBuffer(entityCount: number, reuse?: ArrayBuffer): ArrayBuffer {
  const bytes = snapshotByteLength(entityCount);
  return reuse?.byteLength === bytes ? reuse : new ArrayBuffer(bytes);
}

const ZERO_KNOCKBACK: EntityKnockback = { dirX: 0, dirY: 0, strength: 0 };

/** Index of `state` in ENTITY_PHYS_STATES (0 = idle when omitted or unknown). */
export const physStateIndex = (state: EntityPhysState | undefined): number =>
  state ? Math.max(0, ENTITY_PHYS_STATES.indexOf(state)) : 0;

/** Writes entities into `buf` if its size matches, otherwise into a new buffer. */
export function encodeSnapshot(
  entities: readonly SnapshotEntity[],
  buf?: ArrayBuffer,
): ArrayBuffer {
  const out = ensureSnapshotBuffer(entities.length, buf);
  const f = new Float32Array(out);
  const u = new Uint32Array(out);
  let o = 0;
  for (const e of entities) {
    f[o] = e.stableId;
    f[o + 1] = e.x;
    f[o + 2] = e.y;
    f[o + 3] = e.z;
    f[o + 4] = e.facingRad;
    f[o + 5] = e.kind ?? 0;
    f[o + 6] = e.anim ?? 0;
    f[o + 7] = e.hpPct ?? 1;
    const kb = e.knockback ?? ZERO_KNOCKBACK;
    f[o + 8] = physStateIndex(e.state);
    u[o + 9] = (e.stateStartTick ?? 0) >>> 0;
    f[o + 10] = e.stateDuration ?? 0;
    f[o + 11] = kb.dirX;
    f[o + 12] = kb.dirY;
    f[o + 13] = kb.strength;
    f[o + 14] = e.hitFromDir ?? 0;
    u[o + 15] = (e.gaitSeed ?? 0) >>> 0;
    o += SNAPSHOT_ENTITY_STRIDE;
  }
  return out;
}

export const snapshotEntityCount = (buf: ArrayBuffer | Float32Array): number =>
  Math.floor(buf.byteLength / (SNAPSHOT_ENTITY_STRIDE * Float32Array.BYTES_PER_ELEMENT));

/**
 * Reads record `index` into `out` (no allocation when `out` and `u32` are reused). `u32` is a
 * `Uint32Array` over the same buffer as `view` (created when omitted).
 */
export function readSnapshotEntity(
  view: Float32Array,
  index: number,
  out: SnapshotEntity = { stableId: 0, x: 0, y: 0, z: 0, facingRad: 0, kind: 0, anim: 0, hpPct: 1 },
  u32: Uint32Array = new Uint32Array(view.buffer, view.byteOffset, view.length),
): SnapshotEntity {
  const o = index * SNAPSHOT_ENTITY_STRIDE;
  out.stableId = view[o] ?? 0;
  out.x = view[o + 1] ?? 0;
  out.y = view[o + 2] ?? 0;
  out.z = view[o + 3] ?? 0;
  out.facingRad = view[o + 4] ?? 0;
  out.kind = view[o + 5] ?? 0;
  out.anim = view[o + 6] ?? 0;
  out.hpPct = view[o + 7] ?? 0;
  out.state = ENTITY_PHYS_STATES[view[o + 8] ?? 0] ?? 'idle';
  out.stateStartTick = u32[o + 9] ?? 0;
  out.stateDuration = view[o + 10] ?? 0;
  const kb = out.knockback ?? { dirX: 0, dirY: 0, strength: 0 };
  kb.dirX = view[o + 11] ?? 0;
  kb.dirY = view[o + 12] ?? 0;
  kb.strength = view[o + 13] ?? 0;
  out.knockback = kb;
  out.hitFromDir = view[o + 14] ?? 0;
  out.gaitSeed = u32[o + 15] ?? 0;
  return out;
}

/** Convenience decoder (allocates; for tests and tools, not the render hot path). */
export function decodeSnapshot(buf: ArrayBuffer): SnapshotEntity[] {
  const view = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  const n = snapshotEntityCount(buf);
  const out: SnapshotEntity[] = [];
  for (let i = 0; i < n; i++) out.push(readSnapshotEntity(view, i, undefined, u32));
  return out;
}
