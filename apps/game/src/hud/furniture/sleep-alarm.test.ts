import { describe, expect, it } from 'vitest';
import type { FurnitureView } from './furniture-api.js';
import { alarmOptions, isAlarmAction } from './sleep-alarm.js';

const bed = (ids: string[]): FurnitureView => ({
  furnitureId: 1,
  typeId: 'bed',
  contentId: 'base:bed',
  x: 0.5,
  y: 0.5,
  z: 0,
  actions: ids.map((id) => ({
    id,
    labelPl:
      id === 'sleep'
        ? 'Śpij'
        : id.endsWith('morning')
          ? 'Śpij do rana'
          : `Śpię ${id.slice(12)} godz.`,
    enabled: true,
  })),
});

describe('sleep alarm (sleep.until, protocol 29)', () => {
  it('takes the alarms from the sim list, in its order', () => {
    const opts = alarmOptions(
      bed(['sleep', 'sleep-until:morning', 'sleep-until:6', 'sleep-until:12']),
    );
    expect(opts.map((a) => [a.id, a.label])).toEqual([
      ['sleep', 'Śpij'],
      ['sleep-until:morning', 'Śpij do rana'],
      ['sleep-until:6', 'Śpię 6 godz.'],
      ['sleep-until:12', 'Śpię 12 godz.'],
    ]);
    expect(opts[2]).toMatchObject({ hours: 6 });
    expect(opts[1]).toMatchObject({ morning: true });
    expect(alarmOptions(bed(['sleep'])).map((a) => a.id)).toEqual(['sleep']);
    expect(isAlarmAction('sleep-until:morning')).toBe(true);
    expect(isAlarmAction('sleep')).toBe(false);
  });
});
