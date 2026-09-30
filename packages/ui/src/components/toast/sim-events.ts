/**
 * Default mapping of sim events (`@deadzone/protocol` `SimEvent`) to toasts. Silnik calls it for
 * every event of the `events` message and pushes non-null results. The spec lists toast kinds
 * but not which events raise them; this is the package's proposal (see README).
 */
import type { BodyPart, SimEvent, WoundKind } from '@deadzone/protocol';
import type { ToastInput } from './model.js';

const WOUND: Record<WoundKind, string> = {
  scratch: 'Zadrapanie',
  laceration: 'Rana cięta',
  bite: 'Ugryzienie',
  deep: 'Głęboka rana',
};

const PART: Record<BodyPart, string> = {
  head: 'głowa',
  neck: 'szyja',
  torso_upper: 'klatka piersiowa',
  torso_lower: 'brzuch',
  groin: 'pachwina',
  upper_arm_l: 'lewe ramię',
  upper_arm_r: 'prawe ramię',
  forearm_l: 'lewe przedramię',
  forearm_r: 'prawe przedramię',
  hand_l: 'lewa dłoń',
  hand_r: 'prawa dłoń',
  thigh_l: 'lewe udo',
  thigh_r: 'prawe udo',
  shin_l: 'lewa goleń',
  shin_r: 'prawa goleń',
  foot_l: 'lewa stopa',
  foot_r: 'prawa stopa',
};

export interface SimToastContext {
  /** Local player; events of other players are ignored. */
  playerId: number;
  /** Moodle label and polarity from content (`base:pain` → `Ból`, neg). Unknown → no toast. */
  moodle?: (id: string) => { label: string; polarity: 'neg' | 'pos' } | undefined;
}

type Rejected = Extract<SimEvent, { type: 'commandRejected' }>['reason'];
/** Rejections the player caused and can understand; the rest are protocol noise. */
const REJECT_TEXT: Partial<Record<Rejected, string>> = {
  'invalid-state': 'Nie możesz tego teraz zrobić',
  'invalid-target': 'Nie ma na czym tego użyć',
  'unknown-item': 'Nie masz tego przedmiotu',
};

export function toastFromSimEvent(e: SimEvent, ctx: SimToastContext): ToastInput | null {
  if ('playerId' in e && e.playerId !== ctx.playerId) return null;
  switch (e.type) {
    case 'wounded':
      return { kind: 'damage', text: `${WOUND[e.wound]}: ${PART[e.part]}` };
    case 'moodleChanged': {
      // Only a rise is news; falling levels are visible on the chip itself.
      const m = ctx.moodle?.(e.moodle);
      if (!m || e.to <= e.from) return null;
      const text = e.to >= 2 ? `${m.label} ${e.to}` : m.label;
      return m.polarity === 'neg' ? { kind: 'warning', text } : { kind: 'gain', text };
    }
    case 'fellAsleep':
      return { kind: 'info', text: 'Zasypiasz' };
    case 'wokeUp':
      return e.reason === 'died' ? null : { kind: 'info', text: 'Budzisz się' };
    case 'dayPassed':
      return { kind: 'info', text: `Dzień ${e.day}` };
    case 'commandRejected': {
      const text = REJECT_TEXT[e.reason];
      return text ? { kind: 'warning', text } : null;
    }
    case 'died':
    case 'timeScaleHint':
      return null;
  }
  // Events added to the protocol later: no toast until mapped here.
  return null;
}
