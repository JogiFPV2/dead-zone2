import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@deadzone/protocol';
import { toastFromSimEvent } from './index.js';

const ctx = {
  playerId: 0,
  moodle: (id: string) =>
    ({
      'base:pain': { label: 'Ból', polarity: 'neg' as const },
      'base:fed': { label: 'Najedzony', polarity: 'pos' as const },
    })[id],
};
const at = (e: SimEvent) => toastFromSimEvent(e, ctx);

describe('sim events → toasts', () => {
  it('wounds are damage toasts with the wound and body part', () => {
    expect(at({ type: 'wounded', tick: 1, playerId: 0, part: 'forearm_l', wound: 'bite' })).toEqual(
      {
        kind: 'damage',
        text: 'Ugryzienie: lewe przedramię',
      },
    );
  });

  it('a rising moodle is a warning (neg) or gain (pos); falling ones and unknown ids are silent', () => {
    const m = (moodle: string, from: number, to: number): SimEvent => ({
      type: 'moodleChanged',
      tick: 1,
      playerId: 0,
      moodle,
      from,
      to,
    });
    expect(at(m('base:pain', 1, 2))).toEqual({ kind: 'warning', text: 'Ból 2' });
    expect(at(m('base:fed', 0, 1))).toEqual({ kind: 'gain', text: 'Najedzony' });
    expect(at(m('base:pain', 2, 1))).toBeNull();
    expect(at(m('base:unknown', 0, 1))).toBeNull();
  });

  it('sleep, day and understandable rejections are info / warning; the rest is ignored', () => {
    expect(at({ type: 'fellAsleep', tick: 1, playerId: 0 })).toEqual({
      kind: 'info',
      text: 'Zasypiasz',
    });
    expect(at({ type: 'wokeUp', tick: 1, playerId: 0, reason: 'rested' })?.text).toBe(
      'Budzisz się',
    );
    expect(at({ type: 'wokeUp', tick: 1, playerId: 0, reason: 'died' })).toBeNull();
    expect(at({ type: 'dayPassed', tick: 1, day: 4 })).toEqual({ kind: 'info', text: 'Dzień 4' });
    const rej = (reason: 'invalid-state' | 'stale-seq'): SimEvent => ({
      type: 'commandRejected',
      tick: 1,
      playerId: 0,
      seq: 3,
      command: 'sleep',
      reason,
    });
    expect(at(rej('invalid-state'))?.kind).toBe('warning');
    expect(at(rej('stale-seq'))).toBeNull();
    expect(at({ type: 'timeScaleHint', tick: 1, speed: 4 })).toBeNull();
    expect(
      at({ type: 'died', tick: 1, playerId: 0, cause: 'bleeding', day: 1, minuteOfDay: 0 }),
    ).toBeNull();
  });

  it('ignores other players', () => {
    expect(at({ type: 'fellAsleep', tick: 1, playerId: 1 })).toBeNull();
  });
});
