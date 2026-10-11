import type { PlayerSettingsResponse } from '@deadzone/protocol';
import { PLAYER_SETTINGS_MAX_BYTES, validatePlayerSettings } from '@deadzone/ui/settings';
import type { AuthUser } from '../auth.js';
import type { RouteContext, Router } from '../http/core.js';
import { DataRuleError, type GameStore, type SettingsRow } from '../data/types.js';
import { HttpError, accountGone, badRequest } from '../errors.js';

/**
 * Player settings in the cloud (docs/backend.md §5.1): `GET`/`PUT /v1/me/settings`, one JSON
 * object per account in `profiles.settings`, optimistic concurrency through `ETag` / `If-Match`.
 * The per-IP limit of the whole `/v1` API applies (hook in `registerCharacterRoutes`).
 */
export interface SettingsRouteDeps {
  store: GameStore;
  /** Authenticated user with an existing account (shared JWT check of the character routes). */
  user: (ctx: RouteContext) => Promise<AuthUser>;
}

/** Max body; `validatePlayerSettings` checks the same limit on the parsed JSON. */
export const SETTINGS_BODY_LIMIT = PLAYER_SETTINGS_MAX_BYTES;
const MAX_ISSUES = 20;

const etag = (version: number): string => `"${version}"`;

/** `If-Match: "<version>"` (quotes optional, weak `W/` accepted); 0 = never stored. */
function ifMatch(ctx: RouteContext): number {
  const raw = ctx.header('if-match');
  if (raw === undefined) {
    throw new HttpError(428, 'precondition_required', 'If-Match: <settings ETag> is required');
  }
  const v = typeof raw === 'string' ? raw.trim().replace(/^(W\/)?"(.*)"$/, '$2') : '';
  if (!/^\d{1,9}$/.test(v)) throw badRequest('If-Match must be the settings ETag');
  return Number(v);
}

function reply(ctx: RouteContext, row: SettingsRow): PlayerSettingsResponse {
  ctx.setHeader('etag', etag(row.settings_version)).setHeader('cache-control', 'no-store');
  return {
    settings: row.settings,
    version: row.settings_version,
    updatedAt: row.settings_updated_at,
  };
}

export function registerSettingsRoutes(app: Router, deps: SettingsRouteDeps): void {
  const { store, user } = deps;

  app.get('/v1/me/settings', async (ctx): Promise<PlayerSettingsResponse> => {
    const { userId } = await user(ctx);
    const row = await store.getSettings(userId);
    if (!row) throw accountGone();
    return reply(ctx, row);
  });

  app.put('/v1/me/settings', async (ctx): Promise<PlayerSettingsResponse> => {
    const { userId } = await user(ctx);
    const expected = ifMatch(ctx);
    const body = await ctx.json(SETTINGS_BODY_LIMIT);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw badRequest('body must be a JSON settings object');
    }
    const v = validatePlayerSettings(body);
    if (!v.ok) {
      if (v.reason === 'too-large') {
        throw new HttpError(413, 'payload_too_large', `settings over ${SETTINGS_BODY_LIMIT} bytes`);
      }
      throw new HttpError(422, 'invalid_settings', 'settings failed validation', {
        issues: v.issues.slice(0, MAX_ISSUES).map((i) => ({
          path: i.path.map((p) => (typeof p === 'number' ? p : String(p))),
          code: i.code,
          message: i.message,
        })),
      });
    }
    try {
      // Only the validated output (unknown keys stripped, defaults filled) is stored.
      const row = await store.putSettings(userId, expected, v.data);
      return reply(ctx, row);
    } catch (err) {
      if (err instanceof DataRuleError) {
        if (err.code === 'settings_version_conflict') {
          throw new HttpError(
            412,
            'settings_version_conflict',
            'settings changed elsewhere, reload with GET',
          );
        }
        if (err.code === 'account_not_found') throw accountGone();
      }
      throw err;
    }
  });
}
