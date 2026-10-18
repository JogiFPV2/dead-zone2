import type { Command, CommandRejectReason } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { fallAsleep, wake } from '../systems/sleep.js';
import { bodyPartIndex, clampStat, deathCauseIndex, woundKindIndex } from './state.js';
import { inflictWound } from './wounds.js';

type SurvivalCommand = Extract<
  Command,
  { type: 'sleep' | 'wake' | 'setTimeScale' | 'debugWound' | 'debugStat' }
>;

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
    case 'sleep': {
      const r = fallAsleep(w, eid, cmd.until);
      return r === 'ok' ? undefined : r;
    }
    case 'wake':
      return wake(w, s, eid, 'command') ? undefined : 'invalid-state';
    case 'setTimeScale':
      // World-wide (singleplayer host speed); `sleepSystem` resets it to 1 under threat.
      s.timeScale = cmd.speed;
      return undefined;
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
