import type { ClockView, SimEvent, SleepView, WakeReason } from '@deadzone/protocol';
import type { ToastInput } from '@deadzone/ui';
import { absMinute, formatClock, formatRealSec } from './sleep-model.js';

/**
 * Feedback for sleep and leisure events (mockup sleep.png, states A–C, plus toasts): which sim
 * events become a notice card (bottom centre) or a toast. Pure; the HUD renders the result.
 */

/** Commands the game sent and still waits on (by `seq`), so rejections get a precise text. */
export type PendingKind = 'sleep' | 'tv' | 'vhs';

export type NoticeTone = 'danger' | 'warn' | 'ok';
export type NoticeIcon = 'block' | 'alarm' | 'save' | 'moon';

export interface NoticeVM {
  tone: NoticeTone;
  icon: NoticeIcon;
  title: string;
  detail: string;
  /** `OK` button (success after a save). */
  dismissable?: boolean;
}

export interface FeedbackCtx {
  playerId: number;
  pending: ReadonlyMap<number, PendingKind>;
  threat: number;
  fatigue: number;
  minFatigueToSleep: number;
  wakeOnZombieTiles: number;
  clock?: ClockView | undefined;
  /** The sleep view before the wake-up (real seconds, save target). */
  lastSleep?: SleepView | undefined;
  itemName: (def: string) => string;
  skillName: (id: string) => string;
}

export interface Feedback {
  toast?: ToastInput;
  notice?: NoticeVM;
}

const WAKE_TITLE: Record<Exclude<WakeReason, 'died'>, string> = {
  zombie: 'Obudziło cię zombie',
  noise: 'Obudził cię hałas',
  pain: 'Obudził cię ból',
  fever: 'Obudziła cię gorączka',
  rested: 'Wyspałeś się',
  'max-duration': 'Koniec snu',
  command: 'Wstajesz',
  alarm: 'Budzik — pobudka',
};

const LEISURE_TEXT = {
  read: 'Lektura',
  tv: 'Telewizja',
  vhs: 'Kaseta VHS',
  rest: 'Odpoczynek',
  radio: 'Radio',
} as const;

const TV_REJECT: Partial<Record<string, string>> = {
  'no-power': 'Telewizor nie ma prądu',
  'no-station': 'Brak telewizora w pobliżu',
  'out-of-range': 'Podejdź bliżej telewizora',
  'no-item': 'To nie jest kaseta VHS',
  busy: 'Najpierw skończ to, co robisz',
};

/** `zmęczenie −6 · nuda −25 · stres −12` (only what was actually applied). */
function leisureSummary(e: { fatigue: number; boredom: number; stress: number }): string {
  const parts: string[] = [];
  if (e.fatigue > 0) parts.push(`zmęczenie −${Math.round(e.fatigue)}`);
  if (e.boredom > 0) parts.push(`nuda −${Math.round(e.boredom)}`);
  if (e.stress > 0) parts.push(`stres −${Math.round(e.stress)}`);
  return parts.join(' · ');
}

function rejected(
  e: Extract<SimEvent, { type: 'commandRejected' }>,
  ctx: FeedbackCtx,
): Feedback | undefined {
  const kind = ctx.pending.get(e.seq);
  if (kind === 'sleep') {
    if (ctx.threat > 0) {
      return {
        notice: {
          tone: 'danger',
          icon: 'block',
          title: 'Nie możesz spać — zombie w pobliżu',
          detail: `zagrożenie w promieniu ${ctx.wakeOnZombieTiles} m · zabarykaduj drzwi lub odejdź`,
        },
      };
    }
    if (ctx.fatigue < ctx.minFatigueToSleep) {
      return {
        toast: {
          kind: 'warning',
          text: `Nie jesteś zmęczony (zmęczenie ${Math.round(ctx.fatigue)} / ${ctx.minFatigueToSleep})`,
        },
      };
    }
    return { toast: { kind: 'warning', text: 'Nie możesz teraz zasnąć' } };
  }
  // `no-power` is new with leisure: map it for any command (useItem on a tape too).
  if (kind === 'tv' || kind === 'vhs' || e.reason === 'no-power') {
    const text = TV_REJECT[e.reason];
    return text ? { toast: { kind: 'warning', text } } : undefined;
  }
  return undefined;
}

function wokeUp(e: Extract<SimEvent, { type: 'wokeUp' }>, ctx: FeedbackCtx): Feedback {
  if (e.reason === 'died') return {};
  const rest = Math.round(e.restGained ?? ctx.lastSleep?.restGained ?? 0);
  const cap = e.restCap ?? ctx.lastSleep?.restCap ?? 0;
  const saved = e.saved ?? ctx.lastSleep?.saveReady ?? false;
  const s = ctx.lastSleep;
  const time = s ? ` · ${formatRealSec(s.realSec)} / ${formatRealSec(s.saveAfterRealSec)}` : '';
  const full = e.reason === 'rested' || (cap > 0 && rest >= cap);
  const restText = full
    ? `Odpocząłeś (−${rest} zmęczenia)`
    : `Odpocząłeś częściowo (−${rest} zmęczenia)`;
  const interrupted =
    e.reason !== 'rested' && e.reason !== 'command' && e.reason !== 'max-duration';
  return {
    notice: {
      tone: interrupted && !saved ? 'warn' : saved || full ? 'ok' : 'warn',
      icon: interrupted ? 'alarm' : 'moon',
      title: WAKE_TITLE[e.reason],
      detail: `${restText} · ${saved ? 'gra zapisana' : 'gra niezapisana'}${saved ? '' : time}`,
    },
  };
}

/** Feedback for one event, or undefined when this module does not handle it. */
export function sleepFeedback(e: SimEvent, ctx: FeedbackCtx): Feedback | undefined {
  if ('playerId' in e && e.playerId !== ctx.playerId) return undefined;
  switch (e.type) {
    case 'commandRejected':
      return rejected(e, ctx);
    case 'fellAsleep':
      // The sleep screen itself is the feedback.
      return {};
    case 'wokeUp':
      return wokeUp(e, ctx);
    case 'sleepSaved': {
      const c = ctx.clock;
      const when = c ? ` · Dzień ${c.day}, ${formatClock(absMinute(c))}` : '';
      const sec = e.realSec ?? ctx.lastSleep?.realSec;
      return {
        notice: {
          tone: 'ok',
          icon: 'save',
          title: `Gra zapisana${when}`,
          detail: `Zmęczenie ${Math.round(ctx.fatigue)}${sec !== undefined ? ` · ${formatRealSec(sec)} snu` : ''}`,
          dismissable: true,
        },
      };
    }
    case 'leisureCompleted': {
      const sum = leisureSummary(e);
      return {
        toast: {
          kind: 'gain',
          text: sum ? `${LEISURE_TEXT[e.activity]}: ${sum}` : LEISURE_TEXT[e.activity],
        },
      };
    }
    case 'vhsWatched': {
      if (e.repeat || e.xp.length === 0) {
        return { toast: { kind: 'info', text: `${ctx.itemName(e.vhs)}: już obejrzana, bez XP` } };
      }
      const xp = e.xp.map((x) => `${ctx.skillName(x.skill)} +${Math.round(x.xp)} XP`).join(', ');
      return { toast: { kind: 'gain', text: `${ctx.itemName(e.vhs)}: ${xp}` } };
    }
    default:
      return undefined;
  }
}
