import type { SimWorld } from '../core/world.js';
import type { AiWorld, CompiledAnimalType } from '../ai/state.js';

/**
 * Animal FSM (`Animal.state`, hashed): graze (stands, eats; a pause) ↔ wander (walks to a goal
 * around home), flee (runs from a player / zombie / noise / hit), dead (corpse with loot), gone
 * (a bird flew off: no Position, not rendered, never comes back).
 */
export const AnimalState = { graze: 0, wander: 1, flee: 2, dead: 3, gone: 4 } as const;
export type AnimalStateValue = (typeof AnimalState)[keyof typeof AnimalState];
export const ANIMAL_STATE_NAMES = ['graze', 'wander', 'flee', 'dead', 'gone'] as const;
export type AnimalStateName = (typeof ANIMAL_STATE_NAMES)[number];

/**
 * Tuning without data fields (one place, like `ai/config.ts`). Thinking is spread over ticks by
 * StableId; far from every player animals think rarely and only graze / wander.
 */
export const ANIMAL_CONFIG = {
  thinkEveryTicks: 4,
  farThinkEveryTicks: 20,
  /** Farther than this from every player (same floor): far mode. */
  farTiles: 48,
  /** A player this close is noticed regardless of light / sneaking (touch, smell). */
  nearSenseTiles: 1.5,
  /** Flee goal distance ahead (tiles) checked with a walkable line. */
  fleeLookTiles: 5,
  /** Arrive radius of a wander goal. */
  arriveTiles: 0.4,
  /** A wander leg times out after `distance / speed × legSlack + legExtraTicks` ticks. */
  legSlack: 2,
  legExtraTicks: 40,
} as const;

/** Content ids of the animal types in index order (= snapshot `variant`, `Animal.type`). */
export const animalTypeIds = (w: SimWorld): string[] =>
  (w.ai?.animalTypes ?? []).map((t) => t.def.id);

export const animalTypeOf = (ai: AiWorld, w: SimWorld, eid: number): CompiledAnimalType =>
  ai.animalTypes[w.c.Animal.type[eid] ?? 0]!;

/** Living animal (not dead, not gone). */
export const isLiveAnimal = (w: SimWorld, eid: number): boolean => {
  const s = w.c.Animal.state[eid] ?? 0;
  return w.c.Animal.is[eid] === 1 && s !== AnimalState.dead && s !== AnimalState.gone;
};
