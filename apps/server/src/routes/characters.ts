import { randomBytes, randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  CharacterSummary,
  ListCharactersResponse,
  OpenSaveResponse,
  PutSaveResponse,
} from '@deadzone/protocol';
import { createCharacterRequestSchema } from '@deadzone/protocol/schema';
import { authenticate, type AuthUser, type TokenVerifier } from '../auth.js';
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
  versionConflict,
} from '../errors.js';
import { enforce, type RateLimitStore } from '../rate-limit.js';
import { parseEnvelope, type ParsedEnvelope } from '../save/envelope.js';
import { validateState } from '../save/state.js';

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
  /** Injectable for tests. */
  now?: () => Date;
  newSeed?: () => number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const IP_WINDOW_MS = 5 * 60 * 1000;

function toSummary(c: CharacterRow, save: SaveRow | undefined): CharacterSummary {
  return {
    id: c.id,
    name: c.name,
    appearance: c.appearance,
    worldSeed: c.world_seed,
    worldgenVersion: c.worldgen_version,
    worldSettings: c.world_settings,
    status: c.status,
    daysSurvived: c.days_survived,
    createdAt: c.created_at,
    lastPlayedAt: c.last_played_at,
    diedAt: c.died_at,
    save:
      save && c.status === 'alive'
        ? {
            version: save.version,
            sizeBytes: save.size_bytes,
            gameDay: save.game_day,
            updatedAt: save.updated_at,
          }
        : null,
  };
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
    }
  }
  throw err;
}

function characterId(req: FastifyRequest): string {
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw notFound();
  return id.toLowerCase();
}

function bodyBytes(req: FastifyRequest): Uint8Array {
  if (!Buffer.isBuffer(req.body)) {
    throw badRequest('body must be a DZSV envelope (application/octet-stream)');
  }
  return req.body;
}

/** `If-Match: <version>` (optionally quoted); 0 = no cloud save yet. */
function expectedVersion(req: FastifyRequest): number {
  const raw = req.headers['if-match'];
  const v = typeof raw === 'string' ? raw.trim().replace(/^"(.*)"$/, '$1') : '';
  if (!/^\d{1,9}$/.test(v)) throw badRequest('If-Match: <save version> is required');
  return Number(v);
}

export function registerCharacterRoutes(app: FastifyInstance, deps: CharacterRouteDeps): void {
  const { config, store, blobs, verifier, accounts } = deps;
  const limits = config.limits;
  const now = deps.now ?? (() => new Date());
  const newSeed = deps.newSeed ?? (() => randomInt(0, 0x1_0000_0000));

  const { rateLimits } = deps;
  // One JWT verification per request even when a route hook already authenticated.
  const authed = new WeakMap<FastifyRequest, Promise<AuthUser>>();
  const user = (req: FastifyRequest): Promise<AuthUser> => {
    let u = authed.get(req);
    if (!u) {
      u = authenticate(req, verifier);
      authed.set(req, u);
    }
    return u;
  };

  // Per-IP limit on the whole API, before auth and before reading any body.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/v1/') && req.url !== '/v1') return;
    await enforce(
      rateLimits,
      `ip:${req.ip}`,
      1,
      limits.maxIpRequestsPer5Min,
      IP_WINDOW_MS,
      'too many requests from this address',
    );
  });

  /** Save/death uploads per account per hour; runs before the body is read. */
  const saveRateLimit = async (req: FastifyRequest): Promise<void> => {
    const { userId } = await user(req);
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

  async function ownedCharacter(userId: string, id: string): Promise<CharacterRow> {
    const c = await store.getCharacter(userId, id);
    if (!c) throw notFound();
    return c;
  }

  /** Envelope + state checks shared by save and death; values must match the character row. */
  function checkEnvelope(req: FastifyRequest, c: CharacterRow): ParsedEnvelope {
    const bytes = bodyBytes(req);
    const claimed = req.headers['x-dzsv-sha256'];
    if (typeof claimed !== 'string' || !SHA256.test(claimed.toLowerCase())) {
      throw badRequest('X-DZSV-SHA256: <hex sha256 of the envelope> is required');
    }
    const env = parseEnvelope(bytes, {
      saveFormatVersion: config.saveFormatVersion,
      maxStateBytes: limits.maxStateBytes,
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
    validateState(env.state, config.saveFormatVersion);
    return env;
  }

  app.get('/v1/characters', async (req): Promise<ListCharactersResponse> => {
    const { userId } = await user(req);
    const [characters, saves] = await Promise.all([
      store.listCharacters(userId),
      store.listSaves(userId),
    ]);
    const byCharacter = new Map(saves.map((s) => [s.character_id, s]));
    return {
      characters: characters.map((c) => toSummary(c, byCharacter.get(c.id))),
      limits: {
        maxAlive: limits.maxAliveCharacters,
        alive: characters.filter((c) => c.status === 'alive').length,
        maxSaveBytes: limits.maxAccountSaveBytes,
        usedSaveBytes: saves.reduce((sum, s) => sum + s.size_bytes, 0),
      },
    };
  });

  app.post('/v1/characters', async (req, reply): Promise<CharacterSummary> => {
    const { userId } = await user(req);
    const parsed = createCharacterRequestSchema.safeParse(req.body);
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
    void reply.code(201);
    return toSummary(row, undefined);
  });

  app.post('/v1/characters/:id/open', async (req): Promise<OpenSaveResponse> => {
    const { userId } = await user(req);
    const c = await ownedCharacter(userId, characterId(req));
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

  app.put(
    '/v1/characters/:id/save',
    { bodyLimit: limits.maxEnvelopeBytes, onRequest: saveRateLimit },
    async (req): Promise<PutSaveResponse> => {
      const { userId } = await user(req);
      const id = characterId(req);
      await uploadRateLimit(userId, bodyBytes(req).length);
      const expected = expectedVersion(req);
      const c = await ownedCharacter(userId, id);
      if (c.status === 'dead') throw characterDead();
      const env = checkEnvelope(req, c);
      if (env.header.reason === 'death') {
        throw invalidState('a death snapshot goes to POST /v1/characters/:id/death');
      }

      // Cheap pre-checks; commit_save repeats both atomically.
      const current = await store.getSave(id);
      if ((current?.version ?? 0) !== expected) throw versionConflict();
      const used = await store.accountSaveBytes(userId);
      if (used - (current?.size_bytes ?? 0) + env.sizeBytes > limits.maxAccountSaveBytes) {
        throw new HttpError(413, 'save_quota_exceeded', 'account save quota exceeded');
      }

      // New object first, metadata second, old object last (docs/backend.md §3.4).
      const path = `${userId}/${id}/v${expected + 1}-${randomBytes(6).toString('hex')}.dzsv`;
      await blobs.put(path, bodyBytes(req));
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
        });
      } catch (err) {
        await blobs
          .remove(path)
          .catch(() => req.log.warn('orphan save blob left after failed commit'));
        ruleToHttp(err);
      }
      if (committed.previousPath && committed.previousPath !== path) {
        await blobs
          .remove(committed.previousPath)
          .catch(() => req.log.warn('previous save blob not removed'));
      }
      return {
        characterId: id,
        version: committed.version,
        sizeBytes: env.sizeBytes,
        checksum: env.sha256,
        gameDay: env.header.gameDay,
      };
    },
  );

  app.post(
    '/v1/characters/:id/death',
    { bodyLimit: limits.maxEnvelopeBytes, onRequest: saveRateLimit },
    async (req): Promise<CharacterSummary> => {
      const { userId } = await user(req);
      const c = await ownedCharacter(userId, characterId(req));
      if (c.status === 'dead') {
        // Retried request after a confirmed death: idempotent, the tombstone is the answer.
        return toSummary(c, undefined);
      }
      await uploadRateLimit(userId, bodyBytes(req).length);
      const env = checkEnvelope(req, c);
      if (env.header.reason !== 'death')
        throw invalidState('death needs a snapshot with reason "death"');
      const dead = await store.markDead(userId, c.id, env.header.gameDay).catch(ruleToHttp);
      if (dead.storagePath) {
        await blobs
          .remove(dead.storagePath)
          .catch(() => req.log.warn('dead save blob not removed'));
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
    },
  );

  /**
   * Permanent deletion of one character (alive or tombstone) on the owner's request
   * (docs/backend.md §5.1): save blobs first, then the rows. A failure before the rows are gone
   * leaves the character in place, so the client can retry.
   */
  app.delete('/v1/characters/:id', async (req, reply) => {
    const { userId } = await user(req);
    const c = await ownedCharacter(userId, characterId(req));
    await blobs.removePrefix(`${userId}/${c.id}`);
    const { storagePath } = await store.deleteCharacter(userId, c.id).catch(ruleToHttp);
    // A save that committed between the blob sweep and the row delete.
    if (storagePath) {
      await blobs.remove(storagePath).catch(() => req.log.warn('deleted character blob left'));
    }
    return reply.code(204).send();
  });

  /**
   * RODO account deletion (docs/backend.md §5.1): all save blobs, then all rows, then the auth
   * user via the admin API. Every step is idempotent, so a failed request can be retried with the
   * same token until it expires.
   */
  app.delete('/v1/me', async (req, reply) => {
    const { userId } = await user(req);
    await blobs.removePrefix(userId);
    const { storagePaths } = await store.deleteAccountData(userId);
    for (const path of storagePaths) {
      await blobs.remove(path).catch(() => req.log.warn('deleted account blob left'));
    }
    await accounts.deleteUser(userId);
    req.log.info('account deleted');
    return reply.code(204).send();
  });
}
