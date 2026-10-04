import { randomUUID } from 'node:crypto';
import {
  DataRuleError,
  type AccountAdmin,
  type BlobStore,
  type CharacterRow,
  type GameStore,
  type SaveRow,
} from '../data/types.js';

/** In-memory `GameStore` with the same rules as the SQL triggers/functions (tests only). */
export class MemoryStore implements GameStore {
  characters = new Map<string, CharacterRow>();
  saves = new Map<string, SaveRow>();
  /** Accounts with a profile row (signup trigger); tests add users here. */
  profiles = new Set<string>();
  clock = Date.parse('2026-10-04T12:00:00Z');
  constructor(
    private readonly maxAlive = 20,
    private readonly maxBytes = 50 * 1024 * 1024,
  ) {}

  private iso(): string {
    return new Date((this.clock += 1000)).toISOString();
  }

  private owned(userId: string): CharacterRow[] {
    return [...this.characters.values()].filter((c) => c.user_id === userId);
  }

  accountExists(userId: string) {
    return Promise.resolve(this.profiles.has(userId));
  }
  listCharacters(userId: string) {
    return Promise.resolve(this.owned(userId));
  }
  getCharacter(userId: string, id: string) {
    const c = this.characters.get(id);
    return Promise.resolve(c && c.user_id === userId ? { ...c } : undefined);
  }
  countAliveCharacters(userId: string) {
    return Promise.resolve(this.owned(userId).filter((c) => c.status === 'alive').length);
  }
  countCharactersCreatedSince(userId: string, since: string) {
    return Promise.resolve(this.owned(userId).filter((c) => c.created_at >= since).length);
  }
  async insertCharacter(n: Parameters<GameStore['insertCharacter']>[0]) {
    // FK to auth.users (23503 in Postgres).
    if (!this.profiles.has(n.user_id)) throw new DataRuleError('account_not_found');
    if ((await this.countAliveCharacters(n.user_id)) >= this.maxAlive) {
      throw new DataRuleError('alive_character_limit');
    }
    const row: CharacterRow = {
      ...n,
      id: randomUUID(),
      status: 'alive',
      days_survived: 0,
      created_at: this.iso(),
      last_played_at: null,
      died_at: null,
      last_place: null,
      last_x: null,
      last_y: null,
      last_z: null,
      last_day: null,
    };
    this.characters.set(row.id, row);
    return { ...row };
  }
  listSaves(userId: string) {
    const ids = new Set(this.owned(userId).map((c) => c.id));
    return Promise.resolve([...this.saves.values()].filter((s) => ids.has(s.character_id)));
  }
  getSave(id: string) {
    const s = this.saves.get(id);
    return Promise.resolve(s ? { ...s } : undefined);
  }
  async accountSaveBytes(userId: string) {
    return (await this.listSaves(userId)).reduce((n, s) => n + s.size_bytes, 0);
  }
  async commitSave(c: Parameters<GameStore['commitSave']>[0]) {
    const ch = this.characters.get(c.characterId);
    if (!ch || ch.user_id !== c.userId) throw new DataRuleError('character_not_found');
    if (ch.status !== 'alive') throw new DataRuleError('character_dead');
    const old = this.saves.get(c.characterId);
    if ((old?.version ?? 0) !== c.expectedVersion) throw new DataRuleError('save_version_conflict');
    const used = (await this.accountSaveBytes(c.userId)) - (old?.size_bytes ?? 0);
    if (used + c.sizeBytes > this.maxBytes) throw new DataRuleError('save_quota_exceeded');
    const version = c.expectedVersion + 1;
    this.saves.set(c.characterId, {
      character_id: c.characterId,
      storage_path: c.storagePath,
      version,
      size_bytes: c.sizeBytes,
      checksum: c.checksum,
      game_day: c.gameDay,
      updated_at: this.iso(),
    });
    ch.last_played_at = this.iso();
    ch.days_survived = Math.max(ch.days_survived, c.gameDay);
    if (c.location) {
      ch.last_place = c.location.place;
      ch.last_x = c.location.x;
      ch.last_y = c.location.y;
      ch.last_z = c.location.z;
      ch.last_day = c.location.day;
    }
    return { version, previousPath: old?.storage_path ?? null };
  }
  markDead(userId: string, id: string, days: number) {
    const ch = this.characters.get(id);
    if (!ch || ch.user_id !== userId) throw new DataRuleError('character_not_found');
    if (ch.status === 'dead') throw new DataRuleError('character_dead');
    ch.status = 'dead';
    ch.died_at = this.iso();
    ch.days_survived = Math.max(ch.days_survived, days);
    const s = this.saves.get(id);
    this.saves.delete(id);
    return Promise.resolve({ storagePath: s?.storage_path ?? null, diedAt: ch.died_at });
  }
  deleteCharacter(userId: string, id: string) {
    const ch = this.characters.get(id);
    if (!ch || ch.user_id !== userId) throw new DataRuleError('character_not_found');
    const s = this.saves.get(id);
    this.saves.delete(id);
    this.characters.delete(id);
    return Promise.resolve({ storagePath: s?.storage_path ?? null });
  }
  async deleteAccountData(userId: string) {
    const storagePaths = (await this.listSaves(userId)).map((s) => s.storage_path);
    for (const c of this.owned(userId)) {
      this.saves.delete(c.id);
      this.characters.delete(c.id);
    }
    this.profiles.delete(userId);
    return { storagePaths };
  }
}

export class MemoryBlobs implements BlobStore {
  objects = new Map<string, Uint8Array>();
  put(path: string, bytes: Uint8Array) {
    if (this.objects.has(path)) return Promise.reject(new Error('exists'));
    this.objects.set(path, bytes);
    return Promise.resolve();
  }
  remove(path: string) {
    this.objects.delete(path);
    return Promise.resolve();
  }
  failRemovePrefix = false;
  removePrefix(prefix: string) {
    if (!prefix || this.failRemovePrefix) return Promise.reject(new Error('storage down'));
    let n = 0;
    for (const k of [...this.objects.keys()]) {
      if (k.startsWith(`${prefix}/`)) {
        this.objects.delete(k);
        n++;
      }
    }
    return Promise.resolve(n);
  }
  signedUrl(path: string, ttl: number) {
    return Promise.resolve(`https://storage.test/${path}?ttl=${ttl}`);
  }
}

export class MemoryAccounts implements AccountAdmin {
  deleted: string[] = [];
  fail = false;
  deleteUser(userId: string) {
    if (this.fail) return Promise.reject(new Error('auth admin down'));
    this.deleted.push(userId);
    return Promise.resolve();
  }
  /** Auth users that exist (deleteUser removes them). */
  users = new Set<string>();
  userExists(userId: string) {
    return Promise.resolve(this.users.has(userId) && !this.deleted.includes(userId));
  }
}
