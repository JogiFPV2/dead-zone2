import type { Command, CommandRejectReason } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { fallAsleep, wake } from '../systems/sleep.js';
import { bodyPartIndex, clampStat, deathCauseIndex, woundKindIndex } from './state.js';
import { bandagePart, inflictWound } from './wounds.js';

type SurvivalCommand = Exclude<Command, { type: 'move' } | { type: 'aim' }>;

/** Gameplay validation + effect of survival commands; returns a reject reason or undefined. */
export function applySurvivalCommand(
  w: SimWorld,
  eid: number,
  cmd: SurvivalCommand,
): CommandRejectReason | undefined {
  const s = w.survival;
  if ((cmd.type === 'debugWound' || cmd.type === 'debugStat') && !w.dev) return 'dev-only';
  if (!s) return 'invalid-state';
  switch (cmd.type) {
    case 'sleep':
      return fallAsleep(w, eid) === 'ok' ? undefined : 'invalid-state';
    case 'wake':
      return wake(w, s, eid, 'command') ? undefined : 'invalid-state';
    case 'bandage': {
      if (cmd.itemId !== undefined && !s.content.bandageItems.has(cmd.itemId))
        return 'unknown-item';
      return bandagePart(w, eid, bodyPartIndex(cmd.part)) > 0 ? undefined : 'invalid-target';
    }
    case 'debugWound':
      inflictWound(w, eid, bodyPartIndex(cmd.part), woundKindIndex(cmd.wound), {
        zombie: cmd.zombie ?? false,
      });
      return undefined;
    case 'debugStat': {
      const arr = s.vitals[cmd.stat];
      arr[eid] =
        cmd.stat === 'body-temperature-c'
          ? Math.fround(Math.min(45, Math.max(20, cmd.value)))
          : clampStat(cmd.value);
      if (cmd.stat === 'health' && (arr[eid] ?? 0) <= 0) s.cause[eid] = deathCauseIndex('debug');
      return undefined;
    }
  }
}
