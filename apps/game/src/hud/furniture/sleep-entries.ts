import { FURNITURE_REASONS_PL, furnitureActionPl } from '@deadzone/content';
import type { FurnitureReason } from '@deadzone/protocol';
import type { CommandBody } from '../../sim/sim-client.js';
import type { GameState } from '../../state/game-state.js';
import type { HudContentIndex } from '../content-index.js';
import type { MapObjectAt } from '../leisure-spots.js';
import { DEFAULT_SLEEP_SETTINGS } from '../sleep-settings.js';
import type { FurnitureActionView, FurnitureView } from './furniture-api.js';
import type { LocalFurniture } from './sim-source.js';

/** Beds / sofas listed within this distance of the player (tiles), like the sim's reach. */
const LIST_TILES = 3;
/** The sim sleeps on the best surface within 1.5 tiles (`sleep.surfaceRadiusTiles`). */
const SLEEP_REACH_TILES = 2;

/** Client-only entries get negative ids (sim ids are ≥ 0). */
const bedId = (o: MapObjectAt): number =>
  -(1 + ((o.ty + 32768) * 65536 + (o.tx + 32768)) * 8 + (o.z & 7));

const off = (
  reason: FurnitureReason,
): Pick<FurnitureActionView, 'enabled' | 'reason' | 'reasonPl'> => ({
  enabled: false,
  reason,
  reasonPl: FURNITURE_REASONS_PL[reason],
});

export interface SleepEntriesOptions {
  state: () => GameState;
  content: () => HudContentIndex;
  objects: () => readonly MapObjectAt[];
  player: () => { x: number; y: number; z: number } | undefined;
  send: (cmd: CommandBody) => void;
}

/**
 * Sleeping is not in the sim's `furnitureActions` yet: beds and sofas near the player get a
 * client-side entry with the `sleep` action (opens the sleep choice, then the `sleep` command).
 * Same shape and reason codes as the sim's entries; drop this once the sim lists beds.
 */
export function sleepEntries(o: SleepEntriesOptions): LocalFurniture {
  return {
    list: () => {
      const s = o.state();
      const p = o.player();
      if (!p || !s.player.alive || s.death) return [];
      const content = o.content();
      const cfg = content.sleep ?? DEFAULT_SLEEP_SETTINGS;
      const out: FurnitureView[] = [];
      for (const m of o.objects()) {
        if (m.z !== p.z) continue;
        const surface = content.items.get(m.contentId)?.sleepSurface;
        if (!surface) continue;
        const d = Math.hypot(m.tx + 0.5 - p.x, m.ty + 0.5 - p.y);
        if (d > LIST_TILES) continue;
        const fatigue = Math.round(s.player.stats.fatigue ?? 0);
        const sleep: FurnitureActionView = {
          id: 'sleep',
          labelPl: `${furnitureActionPl('sleep')}…`,
          ...(s.player.sleeping
            ? off('invalid-state')
            : s.threat > 0
              ? off('threat')
              : fatigue < cfg.minFatigueToSleep
                ? off('not-tired')
                : d > SLEEP_REACH_TILES
                  ? off('out-of-range')
                  : s.action
                    ? off('busy')
                    : { enabled: true }),
        };
        out.push({
          furnitureId: bedId(m),
          typeId: surface,
          contentId: m.contentId,
          x: m.tx + 0.5,
          y: m.ty + 0.5,
          z: m.z,
          actions: [sleep],
        });
      }
      return out;
    },
    use: (_view, actionId) => {
      if (actionId === 'sleep') o.send({ type: 'sleep' });
    },
  };
}
