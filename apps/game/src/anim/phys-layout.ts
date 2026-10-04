/**
 * Physics fields of the render snapshot and the `physics` events (sim #62, PROTOCOL_VERSION 7),
 * re-exported from `@deadzone/protocol` for the adapter. Stride 16; fields 8-15 are the body.
 */
import { SNAPSHOT_U32_FIELDS, SnapshotField, type SimEvent } from '@deadzone/protocol';

export { ENTITY_PHYS_STATES, PHYS_EVENT_KINDS, type PhysEventKind } from '@deadzone/protocol';

/** Entity stride that carries the physics body. */
export const PHYS_SNAPSHOT_STRIDE = 16;

export const PhysField = {
  state: SnapshotField.state,
  stateStartTick: SnapshotField.stateStartTick,
  stateDuration: SnapshotField.stateDuration,
  knockbackDirX: SnapshotField.knockbackDirX,
  knockbackDirY: SnapshotField.knockbackDirY,
  knockbackStrength: SnapshotField.knockbackStrength,
  hitFromDir: SnapshotField.hitFromDir,
  gaitSeed: SnapshotField.gaitSeed,
  speed: SnapshotField.speed,
  accel: SnapshotField.accel,
  gait: SnapshotField.gait,
} as const;

/** Entity stride that carries the locomotion fields `speed`, `accel`, `gait` (v13). */
export const LOCO_SNAPSHOT_STRIDE = 20;

/** Fields stored as uint32 bits in the float32 record (read through a Uint32Array view). */
export const PHYS_U32_FIELDS: readonly number[] = SNAPSHOT_U32_FIELDS;

export type SimPhysicsEvent = Extract<SimEvent, { type: 'physics' }>;

export const isPhysicsEvent = (e: { type: string }): e is SimPhysicsEvent => e.type === 'physics';
