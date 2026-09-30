import type { GameMode } from '../../schemas/game-mode/game-mode.js';
import type { RefList } from './ref-collector.js';

export function collectGameModeRefs(m: GameMode, r: RefList): void {
  r.many('profession', m.player.professions, 'player', 'professions');
  m.player.startingKit.forEach((s, i) => r.add('item', s.item, 'player', 'startingKit', i, 'item'));
  m.npcs.forEach((n, i) => r.add('profession', n.profession, 'npcs', i, 'profession'));
}
