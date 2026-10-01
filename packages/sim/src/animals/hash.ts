import type { HashWriter } from '../core/hash.js';
import { sortedQuery, type SimWorld } from '../core/world.js';

/**
 * Animal section of `hash()` (only once an animal was ever spawned, so older goldens stay):
 * RNG `animals`, counters and every animal (alive, corpse or gone) in StableId order.
 */
export function hashAnimals(w: SimWorld, h: HashWriter): void {
  const ai = w.ai;
  if (!ai || ai.animalsSpawned === 0) return;
  h.u32(0xa21a_0001).u32(ai.animalCount).u32(ai.animalsSpawned);
  for (const word of w.rng.animals.state()) h.u32(word);
  const { Animal, StableId } = w.c;
  const eids = sortedQuery(w, 'animals', [Animal]);
  h.u32(eids.length);
  for (const eid of eids) {
    h.u32(StableId.value[eid] ?? 0)
      .u32(Animal.type[eid] ?? 0)
      .u32(Animal.state[eid] ?? 0)
      .u32(Animal.stateTick[eid] ?? 0)
      .f32(Animal.tx[eid] ?? 0)
      .f32(Animal.ty[eid] ?? 0)
      .f32(Animal.fromX[eid] ?? 0)
      .f32(Animal.fromY[eid] ?? 0)
      .f32(Animal.homeX[eid] ?? 0)
      .f32(Animal.homeY[eid] ?? 0)
      .f32(Animal.hp[eid] ?? 0);
  }
}
