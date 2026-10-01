import type { HitSource } from '@deadzone/protocol';
import type { AiWorld } from '../ai/state.js';
import { floorOf } from '../ai/floors.js';
import { gameMinuteAt } from '../core/clock.js';
import { detach, type SimWorld } from '../core/world.js';
import { createItem, groundPile, stackLimit } from '../items/store.js';
import type { TileGrid } from '../world/grid.js';
import { AnimalState } from './state.js';
import { startFlee } from './system.js';

/**
 * Hunting (docs 9.19): a player's melee swing or shot hits an animal like a zombie (`hit` event,
 * same damage rolls). A survivor flees from the attacker (`animalFled {reason:'hit'}`); at 0 HP
 * it dies: corpse stays in the snapshot (anim `dead`), loot goes to the ground pile of its tile.
 * Returns true when it died.
 */
export function damageAnimal(
  w: SimWorld,
  ai: AiWorld,
  grid: TileGrid,
  aid: number,
  attacker: number,
  dmg: number,
  source: HitSource,
): boolean {
  const { Animal, Position, StableId } = w.c;
  const hp = Math.fround((Animal.hp[aid] ?? 0) - dmg);
  Animal.hp[aid] = hp > 0 ? hp : 0;
  const killed = hp <= 0;
  w.events.push({
    type: 'hit',
    tick: w.tick,
    source,
    attacker: StableId.value[attacker] ?? 0,
    target: StableId.value[aid] ?? 0,
    damage: dmg,
    x: Position.x[aid] ?? 0,
    y: Position.y[aid] ?? 0,
    killed,
  });
  const t = ai.animalTypes[Animal.type[aid] ?? 0]!;
  if (!killed) {
    startFlee(w, grid, aid, t, 'hit', Position.x[attacker] ?? 0, Position.y[attacker] ?? 0);
    return false;
  }
  killAnimal(w, ai, aid, attacker);
  return true;
}

/**
 * Death: leaves movement (`MoveIntent` removed, `Animal.state` dead), rolls `animalType.loot`
 * (RNG `animals`: chance, then count) into the ground pile of its tile (`pickUp`, `takeItem`,
 * `takeAll`) and emits `animalKilled`.
 */
export function killAnimal(w: SimWorld, ai: AiWorld, aid: number, killer: number): void {
  const { Animal, Position, Velocity, StableId } = w.c;
  const t = ai.animalTypes[Animal.type[aid] ?? 0]!;
  Animal.state[aid] = AnimalState.dead;
  Animal.stateTick[aid] = w.tick;
  Velocity.x[aid] = 0;
  Velocity.y[aid] = 0;
  w.c.MoveIntent.dx[aid] = 0;
  w.c.MoveIntent.dy[aid] = 0;
  detach(w, aid, w.c.MoveIntent);
  ai.animalCount--;
  const x = Position.x[aid] ?? 0;
  const y = Position.y[aid] ?? 0;
  const z = floorOf(Position.z[aid] ?? 0);
  const loot: { def: string; count: number }[] = [];
  let container = 0;
  const st = w.items;
  if (st) {
    const rng = w.rng.animals;
    const now = gameMinuteAt(w.clock, w.tick);
    for (const l of t.def.loot) {
      if (l.chance < 1 && !rng.chance(l.chance)) continue;
      const count = l.count.min === l.count.max ? l.count.min : rng.int(l.count.min, l.count.max);
      const def = st.content.itemIndex.get(l.item);
      if (def === undefined || count <= 0) continue;
      const pile = groundPile(st, Math.floor(x), Math.floor(y), z);
      container = pile.id;
      const max = Math.max(1, stackLimit(st, st.content.items[def]!));
      for (let left = count; left > 0; left -= max) {
        createItem(st, def, pile.id, Math.min(left, max), now);
      }
      loot.push({ def: l.item, count });
    }
  }
  w.events.push({
    type: 'animalKilled',
    tick: w.tick,
    animal: StableId.value[aid] ?? 0,
    animalType: t.def.id,
    playerId: w.c.Player.id[killer] ?? 0,
    x,
    y,
    z,
    container,
    loot,
  });
}
