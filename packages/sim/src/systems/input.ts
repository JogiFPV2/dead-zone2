import { GAITS, type Command, type CommandRejectReason } from '@deadzone/protocol';
import { applyAiCommand, isAiCommand } from '../ai/commands.js';
import { queueAttack } from '../combat/commands.js';
import type { SimWorld } from '../core/world.js';
import { applyItemCommand, isItemCommand } from '../items/commands.js';
import { applyLureCommand, isLureCommand } from '../lures/lures.js';
import { applyOpeningCommand, isOpeningCommand } from '../openings/actions.js';
import { applySurvivalCommand } from '../survival/commands.js';
import type { TileGrid } from '../world/grid.js';

/**
 * Pipeline step 1: applies this tick's commands in (playerId, seq) order. `move` and `aim` are
 * held intents, so only the last one per player in a tick matters. Survival commands (sleep,
 * wake, dev debug) and item commands take effect immediately; item uses start timed actions.
 */
export function inputSystem(w: SimWorld, grid: TileGrid): void {
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
      MoveIntent.gait[eid] = GAITS.indexOf(cmd.gait ?? 'walk');
    } else if (cmd.type === 'attack' || cmd.type === 'shove') {
      const reason = queueAttack(w, eid, cmd.type === 'shove');
      if (reason) reject(w, cmd, reason);
    } else if (isAiCommand(cmd)) {
      const reason = applyAiCommand(w, eid, cmd);
      if (reason) reject(w, cmd, reason);
    } else if (cmd.type === 'aim') {
      AimIntent.x[eid] = Math.fround(cmd.x);
      AimIntent.y[eid] = Math.fround(cmd.y);
      AimIntent.active[eid] = 1;
    } else if (isLureCommand(cmd)) {
      const reason = applyLureCommand(w, grid, eid, cmd);
      if (reason) reject(w, cmd, reason);
    } else if (isOpeningCommand(cmd)) {
      const reason = applyOpeningCommand(w, grid, eid, cmd);
      if (reason) reject(w, cmd, reason);
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
