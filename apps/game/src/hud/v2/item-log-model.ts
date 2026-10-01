/** Item log (deadzone-hud-v2-spec §5): `+ Bandaż`, `− Puszka fasoli`, `+ 9 mm ×12`. */
export interface ItemLogEntry {
  id: number;
  /** `found`: revealed by a spot search (on the ground, not carried); `note`: plain text. */
  kind: 'gain' | 'loss' | 'found' | 'note';
  /** Item content id ('' for notes). */
  def: string;
  count: number;
  /** Last update (ms); the entry lives LIFE_MS from here. */
  updatedAt: number;
}

export const ITEM_LOG_MAX = 4;
export const ITEM_LOG_LIFE_MS = 4000;
/** Identical entries within this window merge (count adds up, timer resets). */
export const ITEM_LOG_MERGE_MS = 1000;
/** Opacity by age rank, oldest → newest (spec: 0.30 / 0.52 / 0.82 / 1.00). */
export const ITEM_LOG_OPACITY = [0.3, 0.52, 0.82, 1] as const;

export interface ItemDelta {
  def: string;
  /** > 0 gained, < 0 lost. */
  delta: number;
  /** Overrides the gain / loss kind (spot search results, notes). */
  kind?: 'found' | 'note';
}

/** Spot search without results (spec / sim §9.20). */
export const NOTHING_FOUND = 'Nic nie znalazłeś';

/** Minimal event shapes the log reads (subset of `SimEvent`). */
export type ItemLogEvent =
  | { type: 'itemPicked'; playerId: number; defId: string; count: number }
  | { type: 'itemDropped'; playerId: number; defId: string; count: number }
  | { type: 'spotSearched'; playerId: number; found: readonly { defId: string; count: number }[] }
  | { type: string; playerId?: number };

/**
 * Sim item events of `playerId` → log changes: `itemPicked` +, `itemDropped` −, a spot search
 * lists what it revealed (or `Nic nie znalazłeś`). Moves inside the inventory emit nothing.
 */
export function itemLogChanges(events: readonly ItemLogEvent[], playerId: number): ItemDelta[] {
  const out: ItemDelta[] = [];
  for (const e of events) {
    if (e.playerId !== playerId) continue;
    if (e.type === 'itemPicked' && 'defId' in e) out.push({ def: e.defId, delta: e.count });
    else if (e.type === 'itemDropped' && 'defId' in e) out.push({ def: e.defId, delta: -e.count });
    else if (e.type === 'spotSearched' && 'found' in e) {
      if (!e.found.length) out.push({ def: '', delta: 1, kind: 'note' });
      for (const f of e.found) out.push({ def: f.defId, delta: f.count, kind: 'found' });
    }
  }
  return out;
}

/**
 * Adds a change to the log (newest first): merges with an identical entry updated within
 * MERGE_MS, keeps at most MAX entries (a fifth drops the oldest at once).
 */
export function pushItemLog(
  log: readonly ItemLogEntry[],
  change: ItemDelta,
  now: number,
  nextId: number,
): ItemLogEntry[] {
  const kind: ItemLogEntry['kind'] = change.kind ?? (change.delta > 0 ? 'gain' : 'loss');
  const count = Math.abs(change.delta);
  const same = log.find(
    (e) => e.def === change.def && e.kind === kind && now - e.updatedAt <= ITEM_LOG_MERGE_MS,
  );
  if (same) {
    const merged = { ...same, count: same.count + count, updatedAt: now };
    return [merged, ...log.filter((e) => e !== same)];
  }
  return [{ id: nextId, kind, def: change.def, count, updatedAt: now }, ...log].slice(
    0,
    ITEM_LOG_MAX,
  );
}

/** Drops expired entries. */
export const pruneItemLog = (log: readonly ItemLogEntry[], now: number): ItemLogEntry[] =>
  log.filter((e) => now - e.updatedAt < ITEM_LOG_LIFE_MS);

/** Row text: the sign once, then the name and `×n` for more than one. */
export function itemLogText(e: ItemLogEntry, name: string): string {
  if (e.kind === 'note') return NOTHING_FOUND;
  const count = e.count > 1 ? ` ×${e.count}` : '';
  if (e.kind === 'found') return `Znaleziono: ${name}${count}`;
  return `${e.kind === 'gain' ? '+' : '−'} ${name}${count}`;
}

/** Opacity of the row at `index` (0 = newest) in a log of `length` rows. */
export function itemLogOpacity(index: number, length: number): number {
  const fromOldest = length - 1 - index;
  const offset = ITEM_LOG_MAX - length;
  return ITEM_LOG_OPACITY[Math.min(ITEM_LOG_MAX - 1, fromOldest + offset)] ?? 1;
}

/** Seconds left, `3,8 s` (Polish decimal comma). */
export const itemLogRemaining = (e: ItemLogEntry, now: number): string =>
  `${(Math.max(0, ITEM_LOG_LIFE_MS - (now - e.updatedAt)) / 1000).toFixed(1).replace('.', ',')} s`;
