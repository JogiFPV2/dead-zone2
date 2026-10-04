import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AccountExport, AccountExportCharacter } from '@deadzone/protocol';
import type { AuthUser } from '../auth.js';
import type { Limits } from '../config.js';
import type { BlobStore, GameStore } from '../data/types.js';
import { accountGone } from '../errors.js';
import { enforce, type RateLimitStore } from '../rate-limit.js';
import { storedLocation, toSummary } from './summary.js';

/**
 * `GET /v1/me/export` (docs/backend.md §5.1, RODO access): profile, settings, all characters
 * (tombstones too) and, per living save, its metadata with a short-lived signed URL of the blob.
 * Blobs are not inlined. 5 per hour per account on top of the per-IP limit of `/v1`.
 */
export interface ExportRouteDeps {
  store: GameStore;
  blobs: BlobStore;
  user: (req: FastifyRequest) => Promise<AuthUser>;
  rateLimits: RateLimitStore;
  limits: Pick<Limits, 'maxExportsPerHour' | 'maxAccountSaveBytes' | 'maxAliveCharacters'>;
  now: () => Date;
}

/** Validity of the save download URLs in an export. */
export const EXPORT_URL_TTL_SECONDS = 600;
const HOUR_MS = 60 * 60 * 1000;

export function registerExportRoutes(app: FastifyInstance, deps: ExportRouteDeps): void {
  const { store, blobs, user, rateLimits, limits, now } = deps;

  app.get('/v1/me/export', async (req, reply): Promise<AccountExport> => {
    const { userId } = await user(req);
    await enforce(
      rateLimits,
      `export:${userId}`,
      1,
      limits.maxExportsPerHour,
      HOUR_MS,
      'too many exports this hour',
    );
    const [profile, settings, characters, saves, usedBytes] = await Promise.all([
      store.getProfile(userId),
      store.getSettings(userId),
      store.listCharacters(userId),
      store.listSaves(userId),
      store.accountSaveBytes(userId),
    ]);
    if (!profile || !settings) throw accountGone();
    const byCharacter = new Map(saves.map((s) => [s.character_id, s]));

    const exported: AccountExportCharacter[] = [];
    for (const c of characters) {
      const save = c.status === 'alive' ? byCharacter.get(c.id) : undefined;
      exported.push({
        // Character metadata; `save` and `lastLocation` are replaced below.
        ...toSummary(c, undefined),
        lastLocation: storedLocation(c),
        save: save
          ? {
              version: save.version,
              sizeBytes: save.size_bytes,
              sha256: save.checksum,
              gameDay: save.game_day,
              minuteOfDay: save.minute_of_day,
              updatedAt: save.updated_at,
              downloadUrl: await blobs.signedUrl(save.storage_path, EXPORT_URL_TTL_SECONDS),
              expiresInSeconds: EXPORT_URL_TTL_SECONDS,
            }
          : null,
      });
    }

    const at = now();
    req.log.info({ characters: exported.length }, 'account export');
    void reply
      .header('content-type', 'application/json; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename=deadzone-export-${at.toISOString().slice(0, 10)}.json`,
      )
      .header('cache-control', 'no-store');
    return {
      format: 'deadzone-account-export',
      formatVersion: 1,
      exportedAt: at.toISOString(),
      profile: {
        id: profile.id,
        displayName: profile.display_name,
        createdAt: profile.created_at,
      },
      settings: {
        settings: settings.settings,
        version: settings.settings_version,
        updatedAt: settings.settings_updated_at,
      },
      usage: {
        usedBytes,
        limitBytes: limits.maxAccountSaveBytes,
        alive: characters.filter((c) => c.status === 'alive').length,
        aliveLimit: limits.maxAliveCharacters,
      },
      characters: exported,
    };
  });
}
