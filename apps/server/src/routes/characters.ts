import type { Place } from '@deadzone/content/places';
import type {
  CharacterSummary,
  ListCharactersResponse,
  OpenSaveResponse,
  PutSaveResponse,
} from '@deadzone/protocol';
import { createCharacterRequestSchema } from '@deadzone/protocol/schema';
import { authenticate, type AuthUser, type TokenVerifier } from '../auth.js';
import type { RouteContext, Router } from '../http/core.js';
import type { ServerConfig } from '../config.js';
import {
  DataRuleError,
  type AccountAdmin,
  type BlobStore,
  type CharacterRow,
  type GameStore,
  type SaveRow,
} from '../data/types.js';
import {
  HttpError,
  badRequest,
  characterDead,
  invalidState,
  notFound,
  accountGone,
  versionConflict,
} from '../errors.js';
import { enforce, type RateLimitStore } from '../rate-limit.js';
import type { ValidatedEnvelope } from '../save/validate.js';
import type { SaveValidator } from '../save/validate.js';
import { registerSettingsRoutes } from './settings.js';
import { registerExportRoutes } from './export.js';
import { conflictServer, dayLengthMinutes, mapId, toSummary } from './summary.js';

export interface CharacterRouteDeps {
  config: Pick<
    ServerConfig,
    'limits' | 'worldgenVersion' | 'saveFormatVersion' | 'signedUrlTtlSeconds'
  >;
  verifier: TokenVerifier;
  store: GameStore;
  blobs: BlobStore;
  /** Auth admin API for `DELETE /v1/me`. */
  accounts: AccountAdmin;
  /** Counters for the HTTP rate limits (§5.5); in-memory now, Redis later. */
  rateLimits: RateLimitStore;
  /** DZSV validation (worker threads on Node, inline in the Edge Function); closed with the app. */
  validator: SaveValidator;
  /**
   * Named places per map id (`createPlacesCache` of `@deadzone/content/node`: one file read per
   * map and process; the Edge Function bundles the files); null = the map has no places file.
   * Omitted: no places, `place` stays null.
   */
  places?: (mapId: string | null) => Promise<readonly Place[] | null>;
  /** Injectable for tests. */
  now?: () => Date;
  newSeed?: () => number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const IP_WINDOW_MS = 5 * 60 * 1000;

/** 409 `save_version_conflict` with the save currently stored on the server (`server`). */
function saveConflict(current: SaveRow | undefined): HttpError {
  const base = versionConflict();
  return new HttpError(base.statusCode, base.code, base.message, {
    server: conflictServer(current),
  });
}

/** Translates a database rule violation to the API error of docs/backend.md §5.1. */
function ruleToHttp(err: unknown): never {
  if (err instanceof DataRuleError) {
    switch (err.code) {
      case 'alive_character_limit':
        throw new HttpError(409, 'alive_character_limit', 'alive character limit reached');
      case 'save_quota_exceeded':
        throw new HttpError(413, 'save_quota_exceeded', 'account save quota exceeded');
      case 'save_version_conflict':
        throw versionConflict();
      case 'character_dead':
        throw characterDead();
      case 'character_not_found':
        throw notFound();
      case 'account_not_found':
        throw accountGone();
    }
  }
  throw err;
}

function characterId(ctx: RouteContext): string {
  const id = ctx.params.id;
  if (typeof id !== 'string' || !UUID.test(id)) throw notFound();
  return id.toLowerCase();
}

/** Random seed in 0..2^32-1 (Web Crypto: Node and Deno). */
const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0]!;

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

/** `If-Match: <version>` (optionally quoted); 0 = no cloud save yet. */
function expectedVersion(ctx: RouteContext): number {
  const raw = ctx.header('if-match');
  const v = typeof raw === 'string' ? raw.trim().replace(/^"(.*)"$/, '$1') : '';
  if (!/^\d{1,9}$/.test(v)) throw badRequest('If-Match: <save version> is required');
  return Number(v);
}

/** What the API core needs besides the routes: the per-IP limit and shutdown. */
export interface CharacterRoutes {
  /** Per-IP limit on the whole `/v1` API (before routing, auth and the body). */
  ipLimit(ip: string): Promise<void>;
  close(): Promise<void>;
}

export function registerCharacterRoutes(app: Router, deps: CharacterRouteDeps): CharacterRoutes {
  const { config, store, blobs, verifier, accounts } = deps;
  const limits = config.limits;
  const now = deps.now ?? (() => new Date());
  const newSeed = deps.newSeed ?? randomSeed;

  const { rateLimits, validator } = deps;
  const placesFor = deps.places ?? (() => Promise.resolve(null));
  // One JWT verification per request even when a route hook already authenticated.
  const authed = new WeakMap<RouteContext, Promise<AuthUser>>();
  const user = (ctx: RouteContext): Promise<AuthUser> => {
    let u = authed.get(ctx);
    if (!u) {
      u = authenticate(ctx.header('authorization'), verifier).then(requireAccount);
      authed.set(ctx, u);
    }
    return u;
  };

  /**
   * A valid JWT outlives a deleted account until it expires: the profile row (created at signup,
   * removed by account deletion) must still exist, otherwise 401 on every endpoint.
   */
  async function requireAccount(u: AuthUser): Promise<AuthUser> {
    if (!(await store.accountExists(u.userId))) throw accountGone();
    return u;
  }

  const ipLimit = (ip: string): Promise<void> =>
    enforce(
      rateLimits,
      `ip:${ip}`,
      1,
      limits.maxIpRequestsPer5Min,
      IP_WINDOW_MS,
      'too many requests from this address',
    );

  /** Save/death uploads per account per hour; runs before the body is read. */
  const saveRateLimit = async (ctx: RouteContext): Promise<void> => {
    const { userId } = await user(ctx);
    await enforce(
      rateLimits,
      `saves:${userId}`,
      1,
      limits.maxSavesPerHour,
      HOUR_MS,
      'too many saves this hour',
    );
  };

  /** Uploaded bytes per account per day. */
  const uploadRateLimit = (userId: string, bytes: number): Promise<void> =>
    enforce(
      rateLimits,
      `upload:${userId}`,
      bytes,
      limits.maxUploadBytesPerDay,
      DAY_MS,
      'daily upload limit reached',
    );

  // Player settings share the JWT/account check and the per-IP limit above.
  registerSettingsRoutes(app, { store, user });
  registerExportRoutes(app, { store, blobs, user, rateLimits, limits, now });

  async function ownedCharacter(userId: string, id: string): Promise<CharacterRow> {
    const c = await store.getCharacter(userId, id);
    if (!c) throw notFound();
    return c;
  }

  /** Envelope + state checks shared by save and death; values must match the character row. */
  /** Places of the character's map; a broken places file is logged and only costs the name. */
  async function mapPlaces(ctx: RouteContext, c: CharacterRow): Promise<readonly Place[] | null> {
    const map = mapId(c);
    try {
      return await placesFor(map);
    } catch {
      ctx.log.warn('places file unreadable, place not set', { map });
      return null;
    }
  }

  async function checkEnvelope(
    ctx: RouteContext,
    bytes: Uint8Array,
    c: CharacterRow,
  ): Promise<ValidatedEnvelope> {
    const claimed = ctx.header('x-dzsv-sha256');
    if (typeof claimed !== 'string' || !SHA256.test(claimed.toLowerCase())) {
      throw badRequest('X-DZSV-SHA256: <hex sha256 of the envelope> is required');
    }
    // gunzip, JSON and state schema (a worker thread with a timeout and heap cap on Node).
    const env = await validator.validate(bytes, {
      saveFormatVersion: config.saveFormatVersion,
      maxStateBytes: limits.maxStateBytes,
      dayLengthMinutes: dayLengthMinutes(c),
      places: await mapPlaces(ctx, c),
    });
    if (env.sha256 !== claimed.toLowerCase()) {
      throw new HttpError(400, 'checksum_mismatch', 'SHA-256 does not match the envelope');
    }
    const h = env.header;
    if (h.characterId.toLowerCase() !== c.id)
      throw invalidState('envelope is for another character');
    if (h.world_seed !== c.world_seed || h.worldgen_version !== c.worldgen_version) {
      throw invalidState('envelope world does not match the character');
    }
    if (h.gameDay < c.days_survived) throw invalidState('game day went backwards');
    return env;
  }

  app.get('/v1/characters', async (ctx): Promise<ListCharactersResponse> => {
    const { userId } = await user(ctx);
    const [characters, saves, usedBytes] = await Promise.all([
      store.listCharacters(userId),
      store.listSaves(userId),
      store.accountSaveBytes(userId),
    ]);
    const byCharacter = new Map(saves.map((s) => [s.character_id, s]));
    const alive = characters.filter((c) => c.status === 'alive').length;
    return {
      characters: characters.map((c) => toSummary(c, byCharacter.get(c.id))),
      limits: {
        maxAlive: limits.maxAliveCharacters,
        alive,
        maxSaveBytes: limits.maxAccountSaveBytes,
        usedSaveBytes: usedBytes,
      },
      // `account_save_bytes` (the quota the database enforces) for „12 / 50 MB”.
      usage: {
        usedBytes,
        limitBytes: limits.maxAccountSaveBytes,
        alive,
        aliveLimit: limits.maxAliveCharacters,
      },
    };
  });

  app.post('/v1/characters', async (ctx): Promise<CharacterSummary> => {
    const { userId } = await user(ctx);
    const parsed = createCharacterRequestSchema.safeParse(await ctx.json());
    if (!parsed.success) throw badRequest('name (1–40), appearance and world_settings objects');
    if ((await store.countAliveCharacters(userId)) >= limits.maxAliveCharacters) {
      throw new HttpError(409, 'alive_character_limit', 'alive character limit reached');
    }
    const since = new Date(now().getTime() - DAY_MS).toISOString();
    if ((await store.countCharactersCreatedSince(userId, since)) >= limits.maxNewCharactersPerDay) {
      throw new HttpError(429, 'rate_limited', 'too many new characters today');
    }
    const row = await store
      .insertCharacter({
        user_id: userId,
        name: parsed.data.name,
        appearance: parsed.data.appearance ?? {},
        world_seed: newSeed(),
        worldgen_version: config.worldgenVersion,
        world_settings: parsed.data.world_settings ?? {},
      })
      .catch(ruleToHttp);
    ctx.status = 201;
    return toSummary(row, undefined);
  });

  app.post('/v1/characters/:id/open', async (ctx): Promise<OpenSaveResponse> => {
    const { userId } = await user(ctx);
    const c = await ownedCharacter(userId, characterId(ctx));
    if (c.status === 'dead') throw characterDead();
    const save = await store.getSave(c.id);
    const ttl = config.signedUrlTtlSeconds;
    if (!save) {
      return {
        characterId: c.id,
        version: 0,
        url: null,
        checksum: null,
        sizeBytes: 0,
        expiresInSeconds: 0,
      };
    }
    return {
      characterId: c.id,
      version: save.version,
      url: await blobs.signedUrl(save.storage_path, ttl),
      checksum: save.checksum,
      sizeBytes: save.size_bytes,
      expiresInSeconds: ttl,
    };
  });

  app.put('/v1/characters/:id/save', async (ctx): Promise<PutSaveResponse> => {
    // Auth and the hourly save limit run before the body is read.
    await saveRateLimit(ctx);
    const { userId } = await user(ctx);
    const id = characterId(ctx);
    const body = await ctx.bytes(limits.maxEnvelopeBytes);
    await uploadRateLimit(userId, body.length);
    const expected = expectedVersion(ctx);
    const c = await ownedCharacter(userId, id);
    if (c.status === 'dead') throw characterDead();
    const env = await checkEnvelope(ctx, body, c);
    if (env.header.reason === 'death') {
      throw invalidState('a death snapshot goes to POST /v1/characters/:id/death');
    }

    if (env.summaryFailure) {
      // A valid save without a usable summary: stored without a new location.
      ctx.log.warn('save summary failed, location not updated', { summary: env.summaryFailure });
    }

    // Cheap pre-checks; commit_save repeats both atomically.
    const current = await store.getSave(id);
    if ((current?.version ?? 0) !== expected) throw saveConflict(current);
    const used = await store.accountSaveBytes(userId);
    if (used - (current?.size_bytes ?? 0) + env.sizeBytes > limits.maxAccountSaveBytes) {
      throw new HttpError(413, 'save_quota_exceeded', 'account save quota exceeded');
    }

    // New object first, metadata second, old object last (docs/backend.md §3.4).
    const path = `${userId}/${id}/v${expected + 1}-${randomHex(6)}.dzsv`;
    await blobs.put(path, body);
    let committed: { version: number; previousPath: string | null };
    try {
      committed = await store.commitSave({
        userId,
        characterId: id,
        expectedVersion: expected,
        storagePath: path,
        sizeBytes: env.sizeBytes,
        checksum: env.sha256,
        gameDay: env.header.gameDay,
        // From the validated state in the worker (sim `saveSummary`), never from the client.
        location: env.location,
        minuteOfDay: env.minuteOfDay,
      });
    } catch (err) {
      await blobs
        .remove(path)
        .catch(() => ctx.log.warn('orphan save blob left after failed commit'));
      if (err instanceof DataRuleError && err.code === 'save_version_conflict') {
        // Lost the race to another session: name the save that won.
        throw saveConflict(await store.getSave(id).catch(() => undefined));
      }
      ruleToHttp(err);
    }
    if (committed.previousPath && committed.previousPath !== path) {
      await blobs
        .remove(committed.previousPath)
        .catch(() => ctx.log.warn('previous save blob not removed'));
    }
    return {
      characterId: id,
      version: committed.version,
      sizeBytes: env.sizeBytes,
      checksum: env.sha256,
      gameDay: env.header.gameDay,
    };
  });

  app.post('/v1/characters/:id/death', async (ctx): Promise<CharacterSummary> => {
    await saveRateLimit(ctx);
    const { userId } = await user(ctx);
    const c = await ownedCharacter(userId, characterId(ctx));
    if (c.status === 'dead') {
      // Retried request after a confirmed death: idempotent, the tombstone is the answer.
      return toSummary(c, undefined);
    }
    const body = await ctx.bytes(limits.maxEnvelopeBytes);
    await uploadRateLimit(userId, body.length);
    const env = await checkEnvelope(ctx, body, c);
    if (env.header.reason !== 'death')
      throw invalidState('death needs a snapshot with reason "death"');
    const dead = await store.markDead(userId, c.id, env.header.gameDay).catch(ruleToHttp);
    if (dead.storagePath) {
      await blobs.remove(dead.storagePath).catch(() => ctx.log.warn('dead save blob not removed'));
    }
    return toSummary(
      {
        ...c,
        status: 'dead',
        died_at: dead.diedAt,
        days_survived: Math.max(c.days_survived, env.header.gameDay),
      },
      undefined,
    );
  });

  /**
   * Permanent deletion of one character (alive or tombstone) on the owner's request
   * (docs/backend.md §5.1): save blobs first, then the rows. A failure before the rows are gone
   * leaves the character in place, so the client can retry.
   */
  app.delete('/v1/characters/:id', async (ctx) => {
    const { userId } = await user(ctx);
    const c = await ownedCharacter(userId, characterId(ctx));
    await blobs.removePrefix(`${userId}/${c.id}`);
    const { storagePath } = await store.deleteCharacter(userId, c.id).catch(ruleToHttp);
    // A save that committed between the blob sweep and the row delete.
    if (storagePath) {
      await blobs.remove(storagePath).catch(() => ctx.log.warn('deleted character blob left'));
    }
    ctx.status = 204;
    return undefined;
  });

  /**
   * RODO account deletion (docs/backend.md §5.1): all save blobs, then all rows, then the auth
   * user via the admin API. Every step is idempotent, so a failed request can be retried with the
   * same token until it expires.
   */
  app.delete('/v1/me', async (ctx) => {
    // Not `user()`: a retry after a failed Auth admin call finds the profile already gone, but
    // the auth user still exists and must be deletable. A fully deleted user gets 401.
    const { userId } = await authenticate(ctx.header('authorization'), verifier);
    if (!(await store.accountExists(userId)) && !(await accounts.userExists(userId))) {
      throw accountGone();
    }
    await blobs.removePrefix(userId);
    const { storagePaths } = await store.deleteAccountData(userId);
    for (const path of storagePaths) {
      await blobs.remove(path).catch(() => ctx.log.warn('deleted account blob left'));
    }
    await accounts.deleteUser(userId);
    ctx.log.info('account deleted');
    ctx.status = 204;
    return undefined;
  });

  return { ipLimit, close: () => validator.close() };
}
