import { furnitureActionPl, furnitureTypePl } from '@deadzone/content';
import type { ActionVM } from '@deadzone/ui';
import type { GameState } from '../state/game-state.js';
import { actionProgress } from './hud-model.js';
import { sleepSurfaceAt, tvNearby, type LeisureSpot } from './leisure-spots.js';
import type { HudSleepSettings } from './sleep-settings.js';

/** Contextual buttons next to `interact`: sleep here (bed / sofa / floor) and watch TV. */

export const SLEEP_ACTION = 'sleep';
export const TV_ACTION = 'watchTv';

/** „Śpij · łóżko” from content labels (`FURNITURE_ACTIONS_PL`, `FURNITURE_TYPES_PL`). */
const sleepLabel = (surface: 'bed' | 'sofa' | 'floor'): string =>
  surface === 'floor'
    ? `${furnitureActionPl('sleep')} na podłodze`
    : `${furnitureActionPl('sleep')} · ${furnitureTypePl(surface).toLowerCase()}`;

/**
 * Timed furniture actions shown as a progress button (the TV key / button stops them), labelled
 * with the content text of the furniture action that started them (`FURNITURE_ACTIONS_PL`).
 */
export const BUSY_ACTION_IDS: Readonly<Partial<Record<string, string>>> = {
  rest: 'rest',
  listen: 'listen-radio',
  drinkTap: 'drink-tap',
  wash: 'wash',
  shower: 'shower',
  bath: 'bath',
};

/** Watching or one of the timed furniture actions above: the TV key cancels it. */
export const isStoppableLeisure = (kind: string | undefined): boolean =>
  kind === 'watch' || (kind !== undefined && BUSY_ACTION_IDS[kind] !== undefined);

export interface LeisureKeys {
  sleep: string;
  tv: string;
}

/**
 * Sleep shows once the player is tired enough (`minFatigueToSleep`), disabled under threat
 * (the sim refuses); TV shows next to a TV. Nothing while asleep, dead or busy.
 */
export function leisureActionVMs(
  s: GameState,
  spots: readonly LeisureSpot[],
  px: number,
  py: number,
  keys: LeisureKeys,
  cfg: HudSleepSettings,
  tick = s.tick,
): ActionVM[] {
  if (!s.player.alive || s.player.sleeping || s.death || s.container) return [];
  // Watching (TV session / VHS tape): progress; the button / key stops it.
  if (s.action?.kind === 'watch') {
    return [
      {
        id: TV_ACTION,
        label: 'Oglądanie',
        icon: 'info',
        key: keys.tv,
        variant: 'primary',
        enabled: true,
        progress: Math.round((actionProgress(s, tick) ?? 0) * 50) / 50,
      },
    ];
  }
  const busy = s.action ? BUSY_ACTION_IDS[s.action.kind] : undefined;
  if (busy) {
    return [
      {
        id: TV_ACTION,
        label: furnitureActionPl(busy),
        icon: 'info',
        key: keys.tv,
        variant: 'primary',
        enabled: true,
        progress: Math.round((actionProgress(s, tick) ?? 0) * 50) / 50,
      },
    ];
  }
  const out: ActionVM[] = [];
  const idle = s.action === undefined;
  if (tvNearby(spots, px, py, cfg.tvRadiusTiles)) {
    out.push({
      id: TV_ACTION,
      label: 'Oglądaj TV',
      icon: 'info',
      key: keys.tv,
      variant: 'secondary',
      enabled: idle,
    });
  }
  const fatigue = s.player.stats.fatigue ?? 0;
  if (fatigue >= cfg.minFatigueToSleep) {
    out.push({
      id: SLEEP_ACTION,
      label: sleepLabel(sleepSurfaceAt(spots, px, py)),
      icon: 'bolt',
      key: keys.sleep,
      variant: 'secondary',
      enabled: idle && s.threat <= 0,
    });
  }
  return out;
}
