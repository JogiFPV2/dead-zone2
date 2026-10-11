import type {
  AccountExport,
  ApiError,
  CharacterSummary,
  PlayerSettingsResponse,
  SaveConflictError,
} from '@deadzone/protocol';
import type {
  AccountApi,
  AccountUser,
  ApiFailure,
  ApiResult,
  AuthResult,
  CharacterList,
  CloudCharacter,
  CloudSaveOpen,
  IfMatch,
  MailResult,
  RemoteSettings,
  SaveResult,
  ServerSaveInfo,
  SettingsPutResult,
} from './account-api.js';

/**
 * Sign-in side of the account (Supabase Auth: account/supabase-auth.ts). Without a provider the
 * HTTP API is not "configured" and the game stays offline.
 */
export interface AuthProvider {
  session(): Promise<AccountUser | undefined>;
  /** Bearer token of the current session. */
  accessToken(): Promise<string | undefined>;
  signInWithGoogle(): Promise<AuthResult>;
  signInWithPassword(email: string, password: string, captchaToken: string): Promise<AuthResult>;
  signUp(email: string, password: string, captchaToken: string): Promise<MailResult>;
  sendMagicLink(email: string, captchaToken: string): Promise<MailResult>;
  sendPasswordReset(email: string, captchaToken: string): Promise<MailResult>;
  resendConfirmation(email: string, captchaToken: string): Promise<MailResult>;
  signOut(): Promise<void>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpAccountOptions {
  /** `https://api.example.eu` (no trailing slash needed). */
  baseUrl: string;
  auth: AuthProvider;
  fetch?: FetchLike;
  /** Request timeout (the Postacie screen errors out after 10 s). */
  timeoutMs?: number;
}

/** `ApiError` of `@deadzone/protocol`, read defensively. */
type ErrorBody = Partial<ApiError>;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * `SaveConflictError.server` of a 409 body (Serwer #167): the save on the server, `null` when the
 * server has none, undefined when the body carries no valid `server` (older server, bad body).
 */
export function conflictInfo(body: unknown): ServerSaveInfo | null | undefined {
  const b = body as Partial<Record<keyof SaveConflictError, unknown>> | undefined;
  if (!b || typeof b !== 'object' || !('server' in b)) return undefined;
  const s = b.server as Partial<Record<keyof ServerSaveInfo, unknown>> | null;
  if (s === null) return null;
  if (typeof s !== 'object') return undefined;
  // A number in JSON; an ETag-like string (`W/"15"`, `"15"`) is read too.
  const version =
    num(s.version) ?? (typeof s.version === 'string' ? etagVersion(s.version) : undefined);
  const gameDay = num(s.gameDay);
  const updatedAt = typeof s.updatedAt === 'string' ? s.updatedAt : undefined;
  if (version === undefined || gameDay === undefined || updatedAt === undefined) return undefined;
  const minute = num(s.minuteOfDay);
  return {
    version,
    gameDay,
    minuteOfDay: minute !== undefined && minute >= 0 && minute < 1440 ? minute : null,
    updatedAt,
  };
}

/** `Retry-After`: delay seconds or an HTTP date; undefined when absent / unreadable. */
export function retryAfterSec(v: string | null, now = Date.now()): number | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (/^\d+$/.test(t)) return Number(t) > 0 ? Number(t) : undefined;
  const at = Date.parse(t);
  return Number.isFinite(at) && at > now ? Math.ceil((at - now) / 1000) : undefined;
}

/** File name of `Content-Disposition: attachment; filename=…` (plain or quoted). */
export function attachmentName(v: string | null): string | undefined {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(v ?? '');
  const name = m?.[1]?.trim();
  return name && /^[\w.-]+$/.test(name) ? name : undefined;
}

/** `GET /v1/me/export` body; undefined unless it is an `AccountExport` (format 1). */
export function accountExportOf(body: unknown): AccountExport | undefined {
  const b = body as Partial<AccountExport> | undefined;
  return b?.format === 'deadzone-account-export' &&
    b.formatVersion === 1 &&
    Array.isArray(b.characters)
    ? (b as AccountExport)
    : undefined;
}

/** Common status → failure mapping (401, 429, network). */
export function failureOf(status: number, body: unknown, retryAfter: string | null): ApiFailure {
  if (status === 401) return { ok: false, reason: 'unauthorized' };
  if (status === 429) {
    const s = retryAfterSec(retryAfter);
    return s !== undefined
      ? { ok: false, reason: 'rate-limited', retryAfterSec: s }
      : { ok: false, reason: 'rate-limited' };
  }
  const code = (body as ErrorBody | undefined)?.error;
  return code
    ? { ok: false, reason: 'error', status, code }
    : { ok: false, reason: 'error', status };
}

/** `PUT /v1/characters/:id/save` answer → `SaveResult` (409 conflict / dead, 410, 413). */
export function saveResultOf(
  status: number,
  body: unknown,
  retryAfter: string | null = null,
  etag: string | null = null,
): SaveResult {
  const b = body as (ErrorBody & { version?: number; sizeBytes?: number }) | undefined;
  if (status >= 200 && status < 300) {
    return {
      ok: true,
      version: num(b?.version) ?? versionOf(etag),
      sizeBytes: num(b?.sizeBytes) ?? 0,
      ...(etag ? { etag } : {}),
    };
  }
  if (status === 410 || (status === 409 && b?.error === 'character_dead')) {
    return { ok: false, reason: 'gone' };
  }
  if (status === 404 && b?.error === 'character_not_found') return { ok: false, reason: 'gone' };
  if (status === 409) return { ok: false, reason: 'conflict', server: conflictInfo(body) };
  if (status === 413 && b?.error === 'save_quota_exceeded') return { ok: false, reason: 'quota' };
  return failureOf(status, body, retryAfter);
}

/** `GET`/`PUT /v1/me/settings` body → `PlayerSettingsResponse` (ETag as the fallback version). */
export function remoteSettingsOf(body: unknown, etag: string | null): RemoteSettings {
  const b = body as Partial<PlayerSettingsResponse> | undefined;
  const s = b?.settings;
  return {
    settings: s !== null && typeof s === 'object' && !Array.isArray(s) ? s : null,
    version: num(b?.version) ?? versionOf(etag),
    updatedAt: typeof b?.updatedAt === 'string' ? b.updatedAt : null,
    ...(etag?.trim() ? { etag: etag.trim() } : {}),
  };
}

/**
 * `PUT /v1/me/settings` answer (Serwer #164): 200 stored copy, 412 `settings_version_conflict`,
 * 413 `payload_too_large`, 422 `invalid_settings` + `issues`, 428 `precondition_required`.
 */
export function settingsResultOf(
  status: number,
  body: unknown,
  etag: string | null,
  retryAfter: string | null = null,
): SettingsPutResult {
  if (status >= 200 && status < 300) return { ok: true, ...remoteSettingsOf(body, etag) };
  const b = body as ErrorBody | undefined;
  if (status === 412 || b?.error === 'settings_version_conflict') {
    return { ok: false, reason: 'conflict' };
  }
  if (status === 413) return { ok: false, reason: 'too-large' };
  if (status === 422) {
    return { ok: false, reason: 'invalid', issues: Array.isArray(b?.issues) ? b.issues : [] };
  }
  if (status === 428) return { ok: false, reason: 'precondition' };
  return failureOf(status, body, retryAfter);
}

/** `POST …/open` body → `CloudSaveOpen` (no usable save → version 0, no URL). */
export function cloudSaveOf(body: unknown, etag: string | null = null): CloudSaveOpen {
  const b = body as Partial<Record<keyof CloudSaveOpen, unknown>> | undefined;
  const version = num(b?.version) ?? versionOf(etag);
  const url = typeof b?.url === 'string' && b.url ? b.url : null;
  return {
    version: Math.max(0, Math.floor(version)),
    url,
    checksum: typeof b?.checksum === 'string' ? b.checksum : null,
    sizeBytes: num(b?.sizeBytes) ?? 0,
    ...(etag?.trim() ? { etag: etag.trim() } : {}),
  };
}

/** `ETag` → version: strong `"7"`, weak `W/"7"` (Supabase gateway) or bare `7`; else undefined. */
export function etagVersion(etag: string | null | undefined): number | undefined {
  const v =
    etag
      ?.trim()
      .replace(/^W\//i, '')
      .replace(/^"(.*)"$/, '$1') ?? '';
  return /^\d{1,9}$/.test(v) ? Number(v) : undefined;
}

/** `ETag: "7"` / `W/"7"` / `7` → 7 (0 when absent or unreadable). */
export function versionOf(etag: string | null): number {
  return etagVersion(etag) ?? 0;
}

/** `If-Match` header: a received ETag goes back byte for byte; a version number as `"7"`. */
export function ifMatchHeader(v: IfMatch): string {
  return typeof v === 'string' && v.trim() ? v.trim() : `"${typeof v === 'number' ? v : 0}"`;
}

/** Server summary → card data (`lastLocation` and `usage` from Serwer #157; older servers lack them). */
function characterOf(c: Record<string, unknown>): CloudCharacter {
  const s = c as unknown as Partial<CharacterSummary>;
  return {
    ...(c as unknown as CloudCharacter),
    appearance: s.appearance ?? {},
    worldSettings: s.worldSettings ?? {},
    lastLocation: s.lastLocation ?? null,
  };
}

/**
 * The real `/v1` API (docs/backend.md §5). Auth comes from an `AuthProvider` (Supabase Auth,
 * account/supabase-auth.ts); every request carries `Authorization: Bearer`. Opt-in with `?online=1`.
 */
export function createHttpAccountApi(o: HttpAccountOptions): AccountApi {
  const base = o.baseUrl.replace(/\/+$/, '');
  const doFetch: FetchLike = o.fetch ?? ((u, i) => fetch(u, i));
  const timeoutMs = o.timeoutMs ?? 10_000;

  async function call(
    method: string,
    path: string,
    init: { body?: BodyInit; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: unknown; headers: Headers } | ApiFailure> {
    const token = await o.auth.accessToken();
    if (!token) return { ok: false, reason: 'unauthorized' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...init.headers },
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: ctrl.signal,
      });
      const text = res.status === 204 ? '' : await res.text();
      let body: unknown = undefined;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      return { status: res.status, body, headers: res.headers };
    } catch {
      return { ok: false, reason: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
  const isFailure = (r: unknown): r is ApiFailure => (r as ApiFailure).ok === false;
  const okOr = <T extends object>(
    r: { status: number; body: unknown; headers: Headers },
    value: () => T,
  ): ApiResult<T> =>
    r.status >= 200 && r.status < 300
      ? { ok: true, ...value() }
      : failureOf(r.status, r.body, r.headers.get('retry-after'));

  return {
    mode: 'http',
    online: true,
    session: () => o.auth.session(),
    signInWithGoogle: () => o.auth.signInWithGoogle(),
    signInWithPassword: (e, p, c) => o.auth.signInWithPassword(e, p, c),
    signUp: (e, p, c) => o.auth.signUp(e, p, c),
    sendMagicLink: (e, c) => o.auth.sendMagicLink(e, c),
    sendPasswordReset: (e, c) => o.auth.sendPasswordReset(e, c),
    resendConfirmation: (e, c) => o.auth.resendConfirmation(e, c),
    signOut: () => o.auth.signOut(),

    async listCharacters() {
      const r = await call('GET', '/v1/characters');
      if (isFailure(r)) return r;
      return okOr<CharacterList>(r, () => {
        const b = r.body as {
          characters?: Record<string, unknown>[];
          usage?: CharacterList['usage'];
          limits?: { maxAlive: number; alive: number; maxSaveBytes: number; usedSaveBytes: number };
        };
        const l = b.limits;
        return {
          characters: (b.characters ?? []).map(characterOf),
          usage: b.usage ?? {
            usedBytes: l?.usedSaveBytes ?? 0,
            limitBytes: l?.maxSaveBytes ?? 0,
            alive: l?.alive ?? 0,
            aliveLimit: l?.maxAlive ?? 0,
          },
        };
      });
    },
    async createCharacter(n) {
      const r = await call('POST', '/v1/characters', {
        body: JSON.stringify({
          name: n.name,
          appearance: n.appearance,
          world_settings: n.worldSettings,
        }),
        headers: { 'content-type': 'application/json' },
      });
      if (isFailure(r)) return r;
      return okOr(r, () => ({ character: characterOf(r.body as Record<string, unknown>) }));
    },
    async deleteCharacter(id) {
      const r = await call('DELETE', `/v1/characters/${encodeURIComponent(id)}`);
      return isFailure(r) ? r : okOr(r, () => ({}));
    },
    async putSave(id, ifMatch, s) {
      const r = await call('PUT', `/v1/characters/${encodeURIComponent(id)}/save`, {
        body: s.bytes as unknown as BodyInit,
        headers: {
          'content-type': 'application/octet-stream',
          'if-match': ifMatchHeader(ifMatch),
          'x-dzsv-sha256': s.sha256,
        },
      });
      return isFailure(r)
        ? r
        : saveResultOf(r.status, r.body, r.headers.get('retry-after'), r.headers.get('etag'));
    },
    async openSave(id) {
      const r = await call('POST', `/v1/characters/${encodeURIComponent(id)}/open`);
      if (isFailure(r)) return r;
      return okOr(r, () => ({ save: cloudSaveOf(r.body, r.headers.get('etag')) }));
    },
    async downloadSave(url) {
      // Signed storage URL: no bearer (the signature is the access), same timeout.
      if (!/^https:\/\//.test(url))
        return { ok: false, reason: 'error', status: 0, code: 'bad_url' };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs * 3);
      try {
        const res = await doFetch(url, { method: 'GET', signal: ctrl.signal });
        if (!res.ok) return { ok: false, reason: 'error', status: res.status };
        return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
      } catch {
        return { ok: false, reason: 'network' };
      } finally {
        clearTimeout(timer);
      }
    },
    async reportDeath(id, s) {
      const r = await call('POST', `/v1/characters/${encodeURIComponent(id)}/death`, {
        body: s.bytes as unknown as BodyInit,
        headers: { 'content-type': 'application/octet-stream', 'x-dzsv-sha256': s.sha256 },
      });
      return isFailure(r) ? r : okOr(r, () => ({}));
    },
    async getSettings() {
      const r = await call('GET', '/v1/me/settings');
      if (isFailure(r)) return r;
      return okOr(r, () => remoteSettingsOf(r.body, r.headers.get('etag')));
    },
    async putSettings(settings, ifMatch) {
      const r = await call('PUT', '/v1/me/settings', {
        // The body IS the settings object (Serwer validates it with `validatePlayerSettings`).
        body: JSON.stringify(settings),
        headers: { 'content-type': 'application/json', 'if-match': ifMatchHeader(ifMatch) },
      });
      if (isFailure(r)) return r;
      return settingsResultOf(
        r.status,
        r.body,
        r.headers.get('etag'),
        r.headers.get('retry-after'),
      );
    },
    async exportData() {
      const r = await call('GET', '/v1/me/export');
      if (isFailure(r)) return r;
      if (r.status >= 200 && r.status < 300) {
        const data = accountExportOf(r.body);
        if (!data) return { ok: false, reason: 'error', status: r.status, code: 'invalid_export' };
        return {
          ok: true,
          data,
          fileName: attachmentName(r.headers.get('content-disposition')),
        };
      }
      return failureOf(r.status, r.body, r.headers.get('retry-after'));
    },
    async deleteAccount() {
      const r = await call('DELETE', '/v1/me');
      return isFailure(r) ? r : okOr(r, () => ({}));
    },
  };
}
