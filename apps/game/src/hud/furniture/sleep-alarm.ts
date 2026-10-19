import { furnitureActionPl } from '@deadzone/content';
import type { FurnitureView } from './furniture-api.js';

/** Default: sleep until rested (the sim's plain `sleep`). */
export const DEFAULT_ALARM = 'sleep';

export interface AlarmOption {
  /** `useFurniture` action id: `sleep`, `sleep-until:morning`, `sleep-until:<h>`. */
  id: string;
  /** The sim's label („Śpij do rana”, „Śpię 8 godz.”). */
  label: string;
  /** Wake-up: hours after now; `morning`; undefined = when rested. */
  hours?: number;
  morning?: boolean;
}

/** Sleep-until rows are folded into the sleep window (alarm choice), not shown in the menu. */
export const isAlarmAction = (id: string): boolean => id.startsWith('sleep-until:');

/**
 * Alarm choices of a bed / sofa, in the sim's order (protocol 34 lists `sleep`,
 * `sleep-until:morning` and the announced hours); `sleep` always comes first.
 */
export function alarmOptions(view: FurnitureView | undefined): AlarmOption[] {
  const plain = view?.actions.find((a) => a.id === DEFAULT_ALARM);
  const out: AlarmOption[] = [
    { id: DEFAULT_ALARM, label: plain?.labelPl ?? furnitureActionPl(DEFAULT_ALARM) },
  ];
  for (const a of view?.actions ?? []) {
    if (!isAlarmAction(a.id)) continue;
    const tail = a.id.slice('sleep-until:'.length);
    const h = Number(tail);
    out.push({
      id: a.id,
      label: a.labelPl,
      ...(tail === 'morning' ? { morning: true } : Number.isInteger(h) ? { hours: h } : {}),
    });
  }
  return out;
}
