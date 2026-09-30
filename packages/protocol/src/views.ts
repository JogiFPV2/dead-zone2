import type { BodyPart, WoundKind } from './commands.js';

/**
 * UI views (docs/sim-architecture.md 4.2): sent by the worker as `{ kind: 'view' }` only when
 * something changed, at most once per batch of ticks. Every field is optional: a missing field
 * means "unchanged since the last view".
 */

/** Stats in the player view (content stat ids). 0–100 except `-c` (°C) and `-kg`. */
export const VIEW_STATS = [
  'health',
  'hunger',
  'thirst',
  'fatigue',
  'endurance',
  'boredom',
  'stress',
  'unhappiness',
  'pain',
  'bleeding',
  'sickness',
  'wetness',
  'satiety',
  'body-temperature-c',
  'body-weight-kg',
] as const;
export type ViewStat = (typeof VIEW_STATS)[number];

export interface ClockView {
  /** Day of the game, from 1. */
  day: number;
  /** 0..1439. */
  minuteOfDay: number;
  /** Ticks per game minute (60-minute day: 50), for smooth day/night between views. */
  ticksPerGameMinute: number;
  /** Tick at which `minuteOfDay` started. */
  minuteStartTick: number;
  /** Speed-up (×2/×4) not allowed now (threat nearby; always false until zombies exist). */
  fastForwardBlocked: boolean;
}

export interface MoodleView {
  /** Content id, e.g. `base:hunger` (label, polarity and icon come from content). */
  id: string;
  /** 1..maxLevel, 0 = hidden (removed). */
  level: number;
}

export interface WoundView {
  part: BodyPart;
  wound: WoundKind;
  /** Current bleeding of this wound (0–100 scale, after clotting and bandage). */
  bleeding: number;
  /** Healing progress 0..1. */
  healed: number;
  bandaged: boolean;
  bandageDirty: boolean;
  /** Dirt infection (curable later with disinfectant; the zombie virus is never shown). */
  infected: boolean;
}

export interface PlayerView {
  alive?: boolean;
  sleeping?: boolean;
  /** Changed stats only, rounded to 0.1. */
  stats?: Partial<Record<ViewStat, number>>;
  /** Changed moodles only. */
  moodles?: MoodleView[];
  /** Full list when any wound changed. */
  wounds?: WoundView[];
}

export interface SimViewPatch {
  clock?: ClockView;
  /** Local player (id 0). */
  player?: PlayerView;
}
