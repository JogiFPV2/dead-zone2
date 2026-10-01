import {
  MAX_LIVING_CHARACTERS,
  WORLD_GENERATOR_VERSION,
  type CharacterAppearance,
  type CharacterBackend,
  type CharacterRecord,
  type SaveRecord,
  type WorldSettings,
} from './schema.js';

export interface NewCharacterInput {
  readonly name: string;
  readonly appearance: CharacterAppearance;
  readonly worldSettings: WorldSettings;
  /** Default: a fresh random seed (each character has its own world). */
  readonly worldSeed?: number | undefined;
}

/** What the sim hands over for a save (`saved` message) plus the game clock. */
export interface SaveInput {
  readonly tick: number;
  readonly day: number;
  readonly minuteOfDay?: number | undefined;
  readonly reason: string;
  readonly data: ArrayBuffer;
}

export type WriteResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'stale' | 'dead' | 'missing'; currentVersion: number };

/** The single save of the old build (#85, IndexedDB `deadzone`/`saves`, slot `world`). */
export interface LegacyWorldSource {
  read(): Promise<SaveInput & { savedAt: number; seed: number; map: string }>;
  /** Removes the legacy save (after a successful migration). */
  clear(): Promise<void>;
}

export interface StoreDeps {
  now?: () => number;
  newId?: () => string;
  randomSeed?: () => number;
}

export class SlotsFullError extends Error {
  constructor() {
    super(`Masz już ${MAX_LIVING_CHARACTERS} żywych postaci`);
  }
}

const defaultId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const defaultSeed = (): number => (Math.random() * 0x7fffffff) >>> 0 || 1;

/** Alive days for a save on `day` (the clock starts on day 1). */
export const daysFromDay = (day: number): number => Math.max(0, day - 1);

/**
 * Characters and their single save slot (schema.ts). Writes are optimistic: the caller passes
 * the save version it loaded / last wrote; an older version (another tab saved meanwhile) or a
 * dead character is refused, so stale state never overwrites newer state.
 */
export class CharacterStore {
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly randomSeed: () => number;

  constructor(
    readonly backend: CharacterBackend,
    deps: StoreDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? defaultId;
    this.randomSeed = deps.randomSeed ?? defaultSeed;
  }

  /** All characters, most recently played first. */
  async list(): Promise<CharacterRecord[]> {
    const all = await this.backend.listCharacters();
    return all.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt || a.id.localeCompare(b.id));
  }

  get(id: string): Promise<CharacterRecord | undefined> {
    return this.backend.getCharacter(id);
  }

  async mostRecentAlive(): Promise<CharacterRecord | undefined> {
    return (await this.list()).find((c) => c.status === 'alive');
  }

  /** How many more living characters fit under the limit (tombstones are free). */
  async freeSlots(): Promise<number> {
    const alive = (await this.backend.listCharacters()).filter((c) => c.status === 'alive');
    return MAX_LIVING_CHARACTERS - alive.length;
  }

  async create(input: NewCharacterInput): Promise<CharacterRecord> {
    if ((await this.freeSlots()) <= 0) throw new SlotsFullError();
    const t = this.now();
    const c: CharacterRecord = {
      id: this.newId(),
      name: input.name.trim() || 'Ocalały',
      appearance: input.appearance,
      worldSeed: input.worldSeed ?? this.randomSeed(),
      worldSettings: input.worldSettings,
      generatorVersion: WORLD_GENERATOR_VERSION,
      status: 'alive',
      daysSurvived: 0,
      deathCause: null,
      createdAt: t,
      lastPlayedAt: t,
      diedAt: null,
    };
    await this.backend.putCharacter(c);
    return c;
  }

  /** Marks the character as just played (Kontynuuj picks it). */
  async touch(id: string): Promise<void> {
    const c = await this.backend.getCharacter(id);
    if (c && c.status === 'alive')
      await this.backend.putCharacter({ ...c, lastPlayedAt: this.now() });
  }

  /** The character's save (undefined: new world, or dead). */
  loadSave(id: string): Promise<SaveRecord | undefined> {
    return this.backend.getSave(id);
  }

  /** Overwrites the character's slot when it is still at `expectedVersion`. */
  async writeSave(id: string, expectedVersion: number, s: SaveInput): Promise<WriteResult> {
    const t = this.now();
    const save: SaveRecord = {
      characterId: id,
      version: expectedVersion + 1,
      savedAt: t,
      tick: s.tick,
      day: s.day,
      minuteOfDay: s.minuteOfDay ?? null,
      reason: s.reason,
      data: s.data,
    };
    const r = await this.backend.putSaveIfVersion(save, expectedVersion, {
      lastPlayedAt: t,
      daysSurvived: daysFromDay(s.day),
    });
    return r.ok ? r : this.refusal(id, r.currentVersion);
  }

  /**
   * Permadeath: the character becomes a tombstone (name, days, cause) and its save is deleted.
   * Refused like a write when another tab has saved newer progress meanwhile.
   */
  async markDead(
    id: string,
    expectedVersion: number,
    death: { cause: string; daysSurvived: number },
  ): Promise<WriteResult> {
    const c = await this.backend.getCharacter(id);
    if (!c) return { ok: false, reason: 'missing', currentVersion: 0 };
    const t = this.now();
    const r = await this.backend.buryIfVersion(
      {
        ...c,
        status: 'dead',
        daysSurvived: death.daysSurvived,
        deathCause: death.cause,
        diedAt: t,
        lastPlayedAt: t,
      },
      expectedVersion,
    );
    return r.ok ? r : this.refusal(id, r.currentVersion);
  }

  /**
   * Fills in name and look of a migrated character (no creator record) once its save is loaded
   * and the sim reports the character's profile.
   */
  async adoptProfile(id: string, name: string, appearance: CharacterAppearance): Promise<void> {
    const c = await this.backend.getCharacter(id);
    if (!c || c.appearance.look) return;
    await this.backend.putCharacter({ ...c, name: name.trim() || c.name, appearance });
  }

  /** Usuń: the character, its world and save (or its tombstone). */
  remove(id: string): Promise<void> {
    return this.backend.deleteCharacter(id);
  }

  /**
   * Moves the old single save into one character (once). Returns the new character, or
   * undefined when there was nothing to migrate. The legacy save is removed only after the new
   * slot holds it.
   */
  async migrateLegacyWorld(legacy: LegacyWorldSource): Promise<CharacterRecord | undefined> {
    let old: Awaited<ReturnType<LegacyWorldSource['read']>> | undefined;
    try {
      old = await legacy.read();
    } catch {
      return undefined;
    }
    if ((await this.freeSlots()) <= 0) return undefined;
    const c = await this.create({
      name: 'Ocalały',
      appearance: { portrait: DEFAULT_PORTRAIT },
      worldSeed: old.seed,
      worldSettings: { map: old.map, mode: 'survive' },
    });
    const r = await this.writeSave(c.id, 0, { ...old, reason: 'migrated' });
    if (!r.ok) {
      await this.remove(c.id);
      return undefined;
    }
    // The old save's time, not the migration's.
    const saved = await this.backend.getCharacter(c.id);
    if (saved) {
      await this.backend.putCharacter({
        ...saved,
        createdAt: old.savedAt,
        lastPlayedAt: old.savedAt,
      });
    }
    await legacy.clear();
    return this.backend.getCharacter(c.id);
  }

  private async refusal(id: string, currentVersion: number): Promise<WriteResult> {
    const c = await this.backend.getCharacter(id);
    const reason = !c ? 'missing' : c.status === 'dead' ? 'dead' : 'stale';
    return { ok: false, reason, currentVersion };
  }
}

export const DEFAULT_PORTRAIT = { skin: '#C99A78', hair: '#3A2A20', shirt: '#4A5A48' } as const;
