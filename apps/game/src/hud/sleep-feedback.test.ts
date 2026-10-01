import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { sleepFeedback, type FeedbackCtx, type PendingKind } from './sleep-feedback.js';

const ctx = (c: Partial<FeedbackCtx> = {}): FeedbackCtx => ({
  playerId: 0,
  pending: new Map<number, PendingKind>([
    [5, 'sleep'],
    [6, 'tv'],
  ]),
  threat: 0,
  fatigue: 50,
  minFatigueToSleep: 30,
  wakeOnZombieTiles: 6,
  clock: {
    day: 13,
    minuteOfDay: 370,
    ticksPerGameMinute: 50,
    minuteStartTick: 0,
    fastForwardBlocked: false,
  },
  lastSleep: {
    sleeping: true,
    sleepStartTick: 0,
    surface: 'bed',
    restCap: 50,
    restGained: 22,
    realSec: 66,
    saveAfterRealSec: 120,
    saveReady: false,
  },
  itemName: (d) => (d === 'base:vhs-fitness-workout' ? 'Fitness' : d),
  skillName: (s) => (s === 'base:fitness' ? 'Sprawność' : s),
  ...c,
});
const reject = (seq: number, reason: string): SimEvent =>
  ({ type: 'commandRejected', tick: 1, playerId: 0, seq, reason }) as SimEvent;

describe('sleep feedback', () => {
  it('sleep refused under threat → blocked notice (state A)', () => {
    const fb = sleepFeedback(reject(5, 'invalid-state'), ctx({ threat: 30 }));
    expect(fb?.notice).toMatchObject({
      tone: 'danger',
      title: 'Nie możesz spać — zombie w pobliżu',
    });
  });

  it('sleep refused when not tired → toast', () => {
    const fb = sleepFeedback(reject(5, 'invalid-state'), ctx({ fatigue: 12 }));
    expect(fb?.toast?.text).toBe('Nie jesteś zmęczony (zmęczenie 12 / 30)');
  });

  it('TV rejections and no-power for any command', () => {
    expect(sleepFeedback(reject(6, 'no-power'), ctx())?.toast?.text).toBe('Telewizor nie ma prądu');
    expect(sleepFeedback(reject(6, 'no-station'), ctx())?.toast?.text).toBe(
      'Brak telewizora w pobliżu',
    );
    expect(sleepFeedback(reject(99, 'no-power'), ctx())?.toast?.kind).toBe('warning');
    expect(sleepFeedback(reject(99, 'invalid-state'), ctx())).toBeUndefined();
  });

  it('interrupted sleep → warning notice with partial rest (state B)', () => {
    const fb = sleepFeedback(
      {
        type: 'wokeUp',
        tick: 1,
        playerId: 0,
        reason: 'noise',
        restGained: 22,
        restCap: 50,
        saved: false,
      },
      ctx(),
    );
    expect(fb?.notice).toEqual({
      tone: 'warn',
      icon: 'alarm',
      title: 'Obudził cię hałas',
      detail: 'Odpocząłeś częściowo (−22 zmęczenia) · gra niezapisana · 1:06 / 2:00',
    });
  });

  it('rested wake-up after a save → ok notice', () => {
    const fb = sleepFeedback(
      {
        type: 'wokeUp',
        tick: 1,
        playerId: 0,
        reason: 'rested',
        restGained: 50,
        restCap: 50,
        saved: true,
      },
      ctx(),
    );
    expect(fb?.notice).toMatchObject({ tone: 'ok', title: 'Wyspałeś się' });
    expect(fb?.notice?.detail).toBe('Odpocząłeś (−50 zmęczenia) · gra zapisana');
  });

  it('death wakes silently; other players are ignored', () => {
    expect(sleepFeedback({ type: 'wokeUp', tick: 1, playerId: 0, reason: 'died' }, ctx())).toEqual(
      {},
    );
    expect(
      sleepFeedback({ type: 'wokeUp', tick: 1, playerId: 1, reason: 'noise' }, ctx()),
    ).toBeUndefined();
    expect(sleepFeedback({ type: 'fellAsleep', tick: 1, playerId: 0 }, ctx())).toEqual({});
  });

  it('sleepSaved → success notice with OK (state C)', () => {
    const fb = sleepFeedback(
      { type: 'sleepSaved', tick: 1, playerId: 0, fatigueRecovered: 20, realSec: 120 },
      ctx({ fatigue: 28 }),
    );
    expect(fb?.notice).toEqual({
      tone: 'ok',
      icon: 'save',
      title: 'Gra zapisana · Dzień 13, 06:10',
      detail: 'Zmęczenie 28 · 2:00 snu',
      dismissable: true,
    });
  });

  it('leisure and VHS toasts', () => {
    expect(
      sleepFeedback(
        {
          type: 'leisureCompleted',
          tick: 1,
          playerId: 0,
          activity: 'tv',
          fatigue: 6,
          boredom: 25,
          stress: 0,
        },
        ctx(),
      )?.toast,
    ).toEqual({ kind: 'gain', text: 'Telewizja: zmęczenie −6 · nuda −25' });
    const vhs = {
      type: 'vhsWatched',
      tick: 1,
      playerId: 0,
      vhs: 'base:vhs-fitness-workout',
    } as const;
    expect(
      sleepFeedback({ ...vhs, xp: [{ skill: 'base:fitness', xp: 60 }], repeat: false }, ctx())
        ?.toast,
    ).toEqual({ kind: 'gain', text: 'Fitness: Sprawność +60 XP' });
    expect(sleepFeedback({ ...vhs, xp: [], repeat: true }, ctx())?.toast?.text).toBe(
      'Fitness: już obejrzana, bez XP',
    );
  });
});
