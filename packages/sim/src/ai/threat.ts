import { sortedQuery, type SimWorld } from '../core/world.js';
import { wake } from '../systems/sleep.js';
import type { TileGrid } from '../world/grid.js';
import { heard } from './noise.js';
import { ZombieState } from './state.js';

/**
 * Pipeline `ai.threat` (after movement): per player, zombies chasing them and zombies within the
 * threat radius (`survival.sleep.wakeOnZombieTiles`). This drives `threatNearby` (speed-up lock,
 * sleep, timed actions) and the HUD threat level. Sleeping players wake up from a zombie in the
 * radius or a noise of this tick with volume ≥ `sleep.wakeOnNoiseVolume` that reaches them.
 */
export function threatSystem(w: SimWorld, grid: TileGrid): void {
  const ai = w.ai;
  const s = w.survival;
  if (!ai || !s) return;
  const sleep = s.content.survival.sleep;
  const r = sleep.wakeOnZombieTiles;
  const { Position, StableId, Zombie } = w.c;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    const sid = StableId.value[eid] ?? 0;
    const x = Position.x[eid] ?? 0;
    const y = Position.y[eid] ?? 0;
    const z = Position.z[eid] ?? 0;
    let chasing = 0;
    let near = 0;
    if (ai.zombieCount > 0 && !s.dead[eid]) {
      for (const zid of sortedQuery(w, 'zombies', [Zombie])) {
        if ((Position.z[zid] ?? 0) !== z) continue;
        const isChasing = Zombie.state[zid] === ZombieState.chase && Zombie.targetId[zid] === sid;
        if (isChasing) chasing++;
        const dx = (Position.x[zid] ?? 0) - x;
        const dy = (Position.y[zid] ?? 0) - y;
        if (!isChasing && dx * dx + dy * dy <= r * r) near++;
      }
    }
    ai.threat.set(eid, { chasing, near });
    if (!s.asleep[eid]) continue;
    if (chasing > 0 || near > 0) {
      wake(w, s, eid, 'zombie');
      continue;
    }
    for (const n of ai.noises) {
      if (n.tick !== w.tick || n.volume < sleep.wakeOnNoiseVolume) continue;
      if (heard(ai, grid, n, x, y, z, ai.cfg.noise.referenceHearingTiles)) {
        wake(w, s, eid, 'noise');
        break;
      }
    }
  }
}

/** HUD threat level 0–100: 25 per chasing zombie, 10 per other zombie in the threat radius. */
export function threatLevel(w: SimWorld, eid: number): number {
  const t = w.ai?.threat.get(eid);
  if (!t) return 0;
  return Math.min(100, t.chasing * 25 + t.near * 10);
}
