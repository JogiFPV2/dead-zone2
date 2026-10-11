import type { GameSession, NewCharacter } from '../session.js';
import type { CharacterAppearance, CharacterRecord, SaveRecord } from '../characters/schema.js';
import type { AccountApi, CloudCharacter } from './account-api.js';
import { decodeEnvelope, sha256Hex } from './dzsv.js';

/** Map preset of a character's world (`worldSettings.map`), the page default when missing. */
const mapOf = (w: Record<string, unknown>, fallback: string): string =>
  typeof w.map === 'string' && /^[\w-]{1,40}$/.test(w.map) ? w.map : fallback;

const isoMs = (v: string | null | undefined): number | null => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Account character (`CharacterSummary`) → the record the game boots with. */
export function characterRecordOf(c: CloudCharacter, defaultMap: string): CharacterRecord {
  const w = c.worldSettings ?? {};
  const created = isoMs(c.createdAt) ?? Date.now();
  return {
    id: c.id,
    name: c.name,
    appearance: (c.appearance ?? {}) as unknown as CharacterAppearance,
    worldSeed: c.worldSeed,
    worldSettings: { map: mapOf(w, defaultMap), mode: w.mode === 'rescue' ? 'rescue' : 'survive' },
    generatorVersion: c.worldgenVersion,
    status: c.status,
    daysSurvived: c.daysSurvived,
    deathCause: null,
    createdAt: created,
    lastPlayedAt: isoMs(c.lastPlayedAt) ?? created,
    diedAt: isoMs(c.diedAt),
  };
}

export type CloudSessionResult =
  | { ok: true; session: GameSession }
  | { ok: false; reason: 'unauthorized' | 'gone' | 'failed'; message: string };

const FAILED = 'Nie udało się wczytać zapisu z chmury. Spróbuj ponownie.';

/**
 * Graj on an account character: `POST …/open`, download and check the DZSV save (SHA-256 against
 * the server's checksum), then the session the game boots with. No save yet = a fresh world;
 * `created` = the creator's choice of a character just made on the account (Nowa postać).
 */
export async function openCloudSession(
  api: AccountApi,
  c: CloudCharacter,
  defaultMap: string,
  created?: NewCharacter,
): Promise<CloudSessionResult> {
  const character = characterRecordOf(c, defaultMap);
  const cloud = { api, version: 0, worldgenVersion: c.worldgenVersion };
  if (created) return { ok: true, session: { character, created, cloud } };
  const open = await api.openSave(c.id);
  if (!open.ok) {
    if (open.reason === 'unauthorized') return { ok: false, reason: 'unauthorized', message: '' };
    if (open.reason === 'error' && (open.status === 410 || open.code === 'character_dead')) {
      return { ok: false, reason: 'gone', message: 'Ta postać nie żyje.' };
    }
    return { ok: false, reason: 'failed', message: FAILED };
  }
  const s = open.save;
  const at = { ...cloud, version: s.version, ...(s.etag ? { etag: s.etag } : {}) };
  if (!s.url) return { ok: true, session: { character, cloud: at } };
  const dl = await api.downloadSave(s.url);
  if (!dl.ok) return { ok: false, reason: 'failed', message: FAILED };
  if (s.checksum && (await sha256Hex(dl.bytes)) !== s.checksum.toLowerCase()) {
    return { ok: false, reason: 'failed', message: FAILED };
  }
  let decoded: Awaited<ReturnType<typeof decodeEnvelope>>;
  try {
    decoded = await decodeEnvelope(dl.bytes);
  } catch {
    return { ok: false, reason: 'failed', message: FAILED };
  }
  const h = decoded.header;
  const savedAt = isoMs(h.createdAt) ?? Date.now();
  const save: SaveRecord = {
    characterId: c.id,
    version: s.version,
    savedAt,
    tick: 0,
    day: h.gameDay,
    minuteOfDay: null,
    reason: h.reason,
    data: decoded.state.buffer.slice(
      decoded.state.byteOffset,
      decoded.state.byteOffset + decoded.state.byteLength,
    ) as ArrayBuffer,
  };
  return { ok: true, session: { character, save, cloud: at } };
}
