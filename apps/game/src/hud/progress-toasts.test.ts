import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@deadzone/protocol';
import { progressToasts } from './progress-toasts.js';

const ev = (e: object) => ({ tick: 1, ...e }) as SimEvent;

describe('progress toasts', () => {
  it('shows skill level ups and trait changes of the local player only', () => {
    const t = progressToasts(
      [
        ev({ type: 'skillLevelUp', playerId: 1, skill: 'base:carpentry', level: 3 }),
        ev({ type: 'fished', playerId: 1, caught: true, defId: 'base:raw-fish' }),
        ev({ type: 'fished', playerId: 1, caught: false }),
        ev({ type: 'skillLevelUp', playerId: 2, skill: 'base:carpentry', level: 3 }),
        ev({
          type: 'traitChanged',
          playerId: 1,
          trait: 'base:hardened',
          gained: true,
          polarity: 'positive',
        }),
        ev({
          type: 'traitChanged',
          playerId: 1,
          trait: 'base:overweight',
          gained: true,
          polarity: 'negative',
        }),
        ev({
          type: 'traitChanged',
          playerId: 1,
          trait: 'base:overweight',
          gained: false,
          polarity: 'negative',
        }),
      ],
      1,
    );
    expect(t).toEqual([
      { kind: 'gain', value: '+1', text: 'Stolarka: poziom 3' },
      { kind: 'gain', value: '+1', text: 'Złowiona ryba' },
      { kind: 'info', text: 'Nic nie wzięło' },
      { kind: 'gain', text: 'Nowa cecha: Zahartowany' },
      { kind: 'warning', text: 'Nowa cecha: Otyły' },
      { kind: 'gain', text: 'Cecha minęła: Otyły' },
    ]);
  });
});
