import type { SimEvent } from '@deadzone/protocol';
import type { ToastInput } from '@deadzone/ui';
import { skillName, traitName } from '../creator/creator-labels.js';

/**
 * Progress toasts of the local player: a fishing result, a skill level up (`+1 Stolarka 3`) and a trait gained or
 * lost during the game (`Nowa cecha: Zahartowany`, `Cecha minęła: Otyły`).
 */
export function progressToasts(events: readonly SimEvent[], playerId: number): ToastInput[] {
  const out: ToastInput[] = [];
  for (const e of events) {
    if (e.type === 'fished' && e.playerId === playerId)
      out.push(
        e.caught
          ? { kind: 'gain', value: '+1', text: 'Złowiona ryba' }
          : { kind: 'info', text: 'Nic nie wzięło' },
      );
    else if (e.type === 'skillLevelUp' && e.playerId === playerId)
      out.push({ kind: 'gain', value: '+1', text: `${skillName(e.skill)}: poziom ${e.level}` });
    else if (e.type === 'traitChanged' && e.playerId === playerId) {
      const good = (e.polarity !== 'negative') === e.gained;
      out.push({
        kind: good ? 'gain' : 'warning',
        text: `${e.gained ? 'Nowa cecha' : 'Cecha minęła'}: ${traitName(e.trait)}`,
      });
    }
  }
  return out;
}
