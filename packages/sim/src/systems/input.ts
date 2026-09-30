import type { SimWorld } from '../core/world.js';

/**
 * Pipeline step 1: applies this tick's commands in (playerId, seq) order. `move` and `aim` are
 * held intents, so only the last one per player in a tick matters.
 */
export function inputSystem(w: SimWorld): void {
  const { MoveIntent, AimIntent } = w.c;
  for (const cmd of w.queue.take(w.tick)) {
    const eid = w.players.get(cmd.playerId);
    if (eid === undefined) {
      w.events.push({
        type: 'commandRejected',
        tick: w.tick,
        playerId: cmd.playerId,
        seq: cmd.seq,
        reason: 'unknown-player',
      });
      continue;
    }
    if (cmd.type === 'move') {
      let { dx, dy } = cmd;
      const len2 = dx * dx + dy * dy;
      if (len2 > 1) {
        const inv = 1 / Math.sqrt(len2);
        dx *= inv;
        dy *= inv;
      }
      MoveIntent.dx[eid] = Math.fround(dx);
      MoveIntent.dy[eid] = Math.fround(dy);
    } else {
      AimIntent.x[eid] = Math.fround(cmd.x);
      AimIntent.y[eid] = Math.fround(cmd.y);
      AimIntent.active[eid] = 1;
    }
  }
}
