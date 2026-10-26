import type { ItemView } from '@deadzone/protocol';
import type { InventoryState } from '../state/game-state.js';
import { craftItemName } from './crafting-labels.js';

/** One entry of the „Zasłoń…” picker: a carried item the sim takes for `coverWindow`. */
export interface CoverChoice {
  /** Item instance id (`CoverWindowCommand.item`). */
  id: number;
  label: string;
}

/**
 * Carried items that can cover a window (content `windowCover`: curtain, jacket, hoodie, sheet,
 * blanket, tarp …), one entry per item type (the first instance), in inventory order. The sim
 * accepts any carried item whose definition has `windowCover` (protocol 47).
 */
export function coverChoices(
  inv: InventoryState | undefined,
  isCover: (def: string) => boolean,
  name: (def: string) => string = craftItemName,
): CoverChoice[] {
  if (!inv) return [];
  const seen = new Set<string>();
  const out: CoverChoice[] = [];
  const equipped = new Set(Object.values(inv.equipped));
  const visit = (items: readonly ItemView[]): void => {
    for (const it of items) {
      // Worn clothes stay on (take the jacket off first); bags' contents count.
      if (!seen.has(it.def) && !equipped.has(it.id) && isCover(it.def)) {
        seen.add(it.def);
        out.push({ id: it.id, label: name(it.def) });
      }
    }
  };
  const main = inv.containers[inv.container];
  if (main) visit(main.items);
  for (const [id, c] of Object.entries(inv.containers))
    if (Number(id) !== inv.container) visit(c.items);
  return out;
}
