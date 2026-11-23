import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { registerAction } from '../actions/queue.js';
import { addPieces, carriedItems } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import { defOf } from '../items/store.js';
import { addXp, skillLevel } from '../progress/skills.js';
import { floorZ } from '../world/levels.js';
import { CHUNK_SIZE, tileIndex } from '@deadzone/protocol';

/** Item tag of a fishing rod (`useItem` on it starts `fish`). */
export const FISHING_ROD_TAG = 'base:fishing-rod';
/** Floor tile id of open water (`SimMap.floorTiles`). */
export const WATER_TILE = 'base:water';
/** The player must stand within this many tiles of a water tile. */
export const FISH_REACH_TILES = 2;
/** One session, in game minutes. */
export const FISH_MINUTES = 20;
/** Catch chance: base + per fishing level, capped. */
export const FISH_CHANCE = { base: 0.3, perLevel: 0.06, max: 0.85 } as const;
/** XP for a catch / an empty session. */
export const FISH_XP = { caught: 6, empty: 2 } as const;
const FISH_ITEM = 'base:raw-fish';
const SKILL = 'base:fishing';

/** A water floor tile within FISH_REACH_TILES of the player on their level. */
export function nearWater(w: SimWorld, eid: number): boolean {
  const palette = w.map.floorTiles;
  if (!palette) return false;
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const r = FISH_REACH_TILES;
  for (let ty = Math.floor(py - r); ty <= Math.floor(py + r); ty++) {
    for (let tx = Math.floor(px - r); tx <= Math.floor(px + r); tx++) {
      const cx = Math.floor(tx / CHUNK_SIZE);
      const cy = Math.floor(ty / CHUNK_SIZE);
      const ch = w.map.getChunk(cx, cy, z);
      if (!ch) continue;
      const v = ch.floor[tileIndex(tx - cx * CHUNK_SIZE, ty - cy * CHUNK_SIZE)] ?? 0;
      if (v && palette[v] === WATER_TILE) return true;
    }
  }
  return false;
}

/** The player carries this item and it is a fishing rod. */
function carriedRod(w: SimWorld, eid: number, itemId: number): boolean {
  const st = w.items;
  const p = playerItems(w, eid);
  const item = st?.items.get(itemId);
  if (!st || !p || !item || !defOf(st, item).tags.includes(FISHING_ROD_TAG)) return false;
  return carriedItems(st, p.inventory).some((i) => i.id === itemId);
}

/** Catch chance for a fishing level. */
export const catchChance = (level: number): number =>
  Math.min(FISH_CHANCE.max, FISH_CHANCE.base + FISH_CHANCE.perLevel * level);

/**
 * Fishing (docs 9.84): `useItem` on a rod near water starts a FISH_MINUTES session; at the end
 * one roll (`rng.actions`) by the fishing level gives a raw fish into the inventory, XP either
 * way, and a `fished` event. Moving, a threat or sleep interrupt it like other actions.
 */
export function registerFishingActions(): void {
  registerAction('fish', {
    validate(w, eid, a) {
      if (!carriedRod(w, eid, a.item)) return 'no-item';
      return nearWater(w, eid) ? undefined : 'invalid-target';
    },
    durationMin: () => FISH_MINUTES,
    complete(w, eid) {
      const st = w.items!;
      const p = playerItems(w, eid);
      const def = st.content.itemIndex.get(FISH_ITEM);
      const level = skillLevel(w, eid, SKILL);
      const caught = def !== undefined && !!p && w.rng.actions.chance(catchChance(level));
      if (caught) addPieces(st, def, p.inventory, 1, gameMinuteAt(w.clock, w.tick));
      addXp(w, eid, SKILL, caught ? FISH_XP.caught : FISH_XP.empty);
      st.version++;
      w.events.push({
        type: 'fished',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        caught,
        ...(caught ? { defId: FISH_ITEM } : {}),
      });
    },
  });
}
