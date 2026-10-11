import { CLOUD_SAVE_REASONS, type CloudSaveReason } from '@deadzone/protocol';
import type { SaveInput } from '../characters/character-store.js';
import type { SlotMeta } from '../characters/session-saver.js';
import type { AccountApi, IfMatch, SaveResult, SaveUpload, ServerSaveInfo } from './account-api.js';
import { encodeEnvelope, sha256Hex } from './dzsv.js';

/** The account character a session plays (what the DZSV header must match on the server). */
export interface CloudSlot {
  readonly id: string;
  readonly worldSeed: number;
  readonly worldgenVersion: number;
}

export interface CloudSaverOptions {
  readonly api: Pick<AccountApi, 'putSave' | 'reportDeath'>;
  readonly character: CloudSlot;
  /** Cloud save version the session started from (`If-Match`; 0 = none yet). */
  readonly version: number;
  /** `ETag` of `POST …/open` as received (sent back unchanged as `If-Match`). */
  readonly etag?: string | undefined;
  /** Save format of the sim state (sim `SAVE_VERSION`). */
  readonly formatVersion: number;
  readonly last?: SlotMeta | undefined;
  readonly now?: () => number;
}

/**
 * A cloud write: stored, refused because another session saved newer state (409, the server's
 * save in `server`), the character is gone (died / deleted elsewhere), or it failed (network,
 * 401, 429, quota…: the next save tries again with the same version).
 */
export type CloudWriteResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'conflict'; server: ServerSaveInfo | null | undefined; local: SlotMeta }
  | { ok: false; reason: 'gone'; local: SlotMeta }
  | { ok: false; reason: 'failed'; result: SaveResult };

/** Sim save reason → `CloudSaveReason` (`death` goes to `POST …/death`, never to `PUT`). */
export function cloudReasonOf(reason: string): Exclude<CloudSaveReason, 'death'> {
  return (CLOUD_SAVE_REASONS as readonly string[]).includes(reason) && reason !== 'death'
    ? (reason as Exclude<CloudSaveReason, 'death'>)
    : 'manual';
}

/**
 * The playing character's cloud slot (`PUT /v1/characters/:id/save` with `If-Match`), the cloud
 * twin of `CharacterSaver`: one queue, the version this session last saw. A 409 stops further
 * writes until the player picks in the conflict window: WCZYTAJ NOWSZY STAN / WYJDŹ DO MENU drop
 * this session; NADPISZ SERWER ({@link overwrite}) re-sends the refused save with `If-Match` set
 * to the version the 409 named (`server.version`, 0 when the server has none), so the server
 * takes this device's state as the newest. `X-DZSV-SHA256` is the hash of the envelope bytes.
 */
export class CloudSaver {
  private queue: Promise<unknown> = Promise.resolve();
  private version: number;
  /** `If-Match` of the next write: the last ETag exactly as received, else the version. */
  private tag: IfMatch;
  private last: SlotMeta | undefined;
  private refused:
    | {
        reason: 'conflict' | 'gone';
        upload: SaveUpload;
        meta: SlotMeta;
        server: ServerSaveInfo | null | undefined;
      }
    | undefined;
  private dead = false;
  private readonly now: () => number;

  constructor(private readonly o: CloudSaverOptions) {
    this.version = o.version;
    this.tag = o.etag ?? o.version;
    this.last = o.last;
    this.now = o.now ?? Date.now;
  }

  get characterId(): string {
    return this.o.character.id;
  }
  get currentVersion(): number {
    return this.version;
  }
  get lastSave(): SlotMeta | undefined {
    return this.last;
  }
  /** Writes stopped: a 409 waiting for the player's choice, or the character is gone. */
  get blocked(): 'conflict' | 'gone' | 'dead' | undefined {
    return this.dead ? 'dead' : this.refused?.reason;
  }

  /** DZSV envelope + its SHA-256 for one sim save. */
  async upload(s: SaveInput, reason: CloudSaveReason): Promise<SaveUpload> {
    const bytes = await encodeEnvelope(new Uint8Array(s.data), {
      characterId: this.o.character.id,
      worldSeed: this.o.character.worldSeed,
      worldgenVersion: this.o.character.worldgenVersion,
      gameDay: s.day,
      reason,
      formatVersion: this.o.formatVersion,
      createdAt: new Date(this.now()).toISOString(),
    });
    return { bytes, sha256: await sha256Hex(bytes), reason };
  }

  write(s: SaveInput): Promise<CloudWriteResult> {
    return this.enqueue(async () => {
      const meta: SlotMeta = { day: s.day, minuteOfDay: s.minuteOfDay, savedAt: this.now() };
      if (this.dead) return { ok: false, reason: 'gone', local: meta };
      if (this.refused) return this.refusal(meta);
      const upload = await this.upload(s, cloudReasonOf(s.reason));
      return this.put(upload, this.tag, meta);
    });
  }

  /**
   * NADPISZ SERWER: the refused save again, `If-Match` = the server's version from the 409.
   * Another 409 (a third session saved meanwhile) asks again; `gone` cannot be overwritten.
   */
  overwrite(): Promise<CloudWriteResult> {
    return this.enqueue(async () => {
      const r = this.refused;
      if (!r) return { ok: true, version: this.version };
      if (r.reason === 'gone') return { ok: false, reason: 'gone', local: r.meta };
      this.refused = undefined;
      return this.put(r.upload, r.server?.version ?? 0, r.meta);
    });
  }

  /** Permadeath: the death snapshot to `POST …/death` (after any queued write). */
  die(s: SaveInput): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.dead) return true;
      this.dead = true;
      const r = await this.o.api.reportDeath(this.o.character.id, await this.upload(s, 'death'));
      return r.ok;
    });
  }

  private refusal(meta: SlotMeta): CloudWriteResult {
    const r = this.refused!;
    return r.reason === 'gone'
      ? { ok: false, reason: 'gone', local: r.meta }
      : { ok: false, reason: 'conflict', server: r.server, local: r.meta ?? meta };
  }

  private async put(
    upload: SaveUpload,
    ifMatch: IfMatch,
    meta: SlotMeta,
  ): Promise<CloudWriteResult> {
    const r = await this.o.api.putSave(this.o.character.id, ifMatch, upload);
    if (r.ok) {
      this.version = r.version;
      this.tag = r.etag ?? r.version;
      this.last = meta;
      return { ok: true, version: r.version };
    }
    if (r.reason === 'conflict') {
      this.refused = { reason: 'conflict', upload, meta, server: r.server };
      return { ok: false, reason: 'conflict', server: r.server, local: meta };
    }
    if (r.reason === 'gone') {
      this.refused = { reason: 'gone', upload, meta, server: undefined };
      return { ok: false, reason: 'gone', local: meta };
    }
    return { ok: false, reason: 'failed', result: r };
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
