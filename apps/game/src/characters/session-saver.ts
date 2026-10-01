import type { CharacterStore, SaveInput, WriteResult } from './character-store.js';

/** Last save line for the pause menu (pause-model `WorldSaveMeta`). */
export interface SlotMeta {
  day: number;
  minuteOfDay?: number | undefined;
  savedAt: number;
}

/**
 * The playing character's slot in one tab: writes go through one queue (exit, daily autosave
 * and after-sleep saves may overlap) and carry the version this tab last saw. Once another tab
 * has saved newer state, this tab is stale and stops writing.
 */
export class CharacterSaver {
  private queue: Promise<unknown> = Promise.resolve();
  private last: SlotMeta | undefined;
  private refused: WriteResult | undefined;

  constructor(
    private readonly store: CharacterStore,
    readonly characterId: string,
    private version: number,
    last?: SlotMeta,
  ) {
    this.last = last;
  }

  /** Save version this tab holds (0 = nothing saved yet). */
  get currentVersion(): number {
    return this.version;
  }

  /** Why writes stopped: another tab saved newer state (`stale`) or the character died. */
  get blocked(): 'stale' | 'dead' | 'missing' | undefined {
    return this.refused && !this.refused.ok ? this.refused.reason : undefined;
  }

  get lastSave(): SlotMeta | undefined {
    return this.last;
  }

  write(s: SaveInput): Promise<WriteResult> {
    return this.enqueue(async () => {
      if (this.refused) return this.refused;
      const r = await this.store.writeSave(this.characterId, this.version, s);
      if (r.ok) {
        this.version = r.version;
        this.last = { day: s.day, minuteOfDay: s.minuteOfDay, savedAt: Date.now() };
      } else this.refused = r;
      return r;
    });
  }

  /** Permadeath: tombstone + save deleted (after any queued write). */
  die(cause: string, daysSurvived: number): Promise<WriteResult> {
    return this.enqueue(async () => {
      if (this.refused) return this.refused;
      const r = await this.store.markDead(this.characterId, this.version, { cause, daysSurvived });
      this.refused = r.ok ? { ok: false, reason: 'dead', currentVersion: 0 } : r;
      return r;
    });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** Polish message for a refused write (pause menu / console). */
export function refusalText(reason: 'stale' | 'dead' | 'missing'): string {
  if (reason === 'stale') return 'Nowszy zapis tej postaci istnieje (inna karta). Nie nadpisano.';
  if (reason === 'dead') return 'Postać nie żyje: zapis usunięty.';
  return 'Postać została usunięta.';
}
