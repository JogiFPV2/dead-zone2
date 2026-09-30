import type { Command, CommandRejectReason } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { applyItemCommand, isItemCommand } from '../items/commands.js';
import { applySurvivalCommand } from '../survival/commands.js';

/**
 * Pipeline step 1: applies this tick's commands in (playerId, seq) order. `move` and `aim` are
 * held intents, so only the last one per player in a tick matters. Survival commands (sleep,
 * wake, dev debug) and item commands take effect immediately; item uses start timed actions.
 */
export function inputSystem(w: SimWorld): void {
  const { MoveIntent, AimIntent } = w.c;
  for (const cmd of w.queue.take(w.tick)) {
    const eid = w.players.get(cmd.playerId);
    if (eid === undefined) {
      reject(w, cmd, 'unknown-player');
      continue;
    }
    if (w.survival?.dead[eid]) {
      reject(w, cmd, 'dead');
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
    } else if (cmd.type === 'aim') {
      AimIntent.x[eid] = Math.fround(cmd.x);
      AimIntent.y[eid] = Math.fround(cmd.y);
      AimIntent.active[eid] = 1;
    } else if (isItemCommand(cmd)) {
      const reason = applyItemCommand(w, eid, cmd);
      if (reason) reject(w, cmd, reason);
    } else {
      const reason = applySurvivalCommand(w, eid, cmd);
      if (reason) reject(w, cmd, reason);
    }
  }
}

function reject(w: SimWorld, cmd: Command, reason: CommandRejectReason): void {
  w.events.push({
    type: 'commandRejected',
    tick: w.tick,
    playerId: cmd.playerId,
    seq: cmd.seq,
    reason,
  });
}
