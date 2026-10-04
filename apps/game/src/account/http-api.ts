import type { ApiError, CharacterSummary, PlayerSettingsResponse } from '@deadzone/protocol';
import type {
  AccountApi,
  AccountUser,
  ApiFailure,
  ApiResult,
  AuthResult,
  CharacterList,
  CloudCharacter,
  MailResult,
  SaveResult,
  ServerSaveInfo,
  SettingsPutResult,
} from './account-api.js';

/**
 * Sign-in side of the account (Supabase Auth later, configured by Serwer). Not part of this
 * client: without a provider the HTTP API is not "configured" and the game stays offline.
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
interface ErrorBody extends Partial<ApiError> {
  /** [ZAŁ.] newer save named by a 409 (`save_version_conflict`). */
  server?: { version?: number; gameDay?: number; minuteOfDay?: number; updatedAt?: string };
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** The newer server save from a 409 body; undefined unless it names a version. */
export function conflictInfo(body: unknown): ServerSaveInfo | undefined {
  const s = (body as ErrorBody | undefined)?.server;
  const version = num(s?.version);
  if (!s || version === undefined) return undefined;
  return {
    version,
    day: num(s.gameDay),
    minuteOfDay: num(s.minuteOfDay),
    savedAt: typeof s.updatedAt === 'string' ? s.updatedAt : undefined,
  };
}

/** Common status → failure mapping (401, 429, network). */
export function failureOf(status: number, body: unknown, retryAfter: string | null): ApiFailure {
  if (status === 401) return { ok: false, reason: 'unauthorized' };
  if (status === 429) {
    const s = Number(retryAfter);
    return Number.isFinite(s) && s > 0
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
): SaveResult {
  const b = body as (ErrorBody & { version?: number; sizeBytes?: number }) | undefined;
  if (status >= 200 && status < 300) {
    return { ok: true, version: num(b?.version) ?? 0, sizeBytes: num(b?.sizeBytes) ?? 0 };
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
export function remoteSettingsOf(body: unknown, etag: string | null): PlayerSettingsResponse {
  const b = body as Partial<PlayerSettingsResponse> | undefined;
  const s = b?.settings;
  return {
    settings: s !== null && typeof s === 'object' && !Array.isArray(s) ? s : null,
    version: num(b?.version) ?? versionOf(etag),
    updatedAt: typeof b?.updatedAt === 'string' ? b.updatedAt : null,
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

/** `ETag: "7"` / `7` → 7 (0 when absent). */
export function versionOf(etag: string | null): number {
  const v =
    etag
      ?.trim()
      .replace(/^W\//, '')
      .replace(/^"(.*)"$/, '$1') ?? '';
  return /^\d{1,9}$/.test(v) ? Number(v) : 0;
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
 * The real `/v1` API (docs/backend.md §5). Auth comes from an `AuthProvider`; every request
 * carries `Authorization: Bearer`. Not wired to any server yet (no Supabase config in the client).
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
          'if-match': `"${ifMatch}"`,
          'x-dzsv-sha256': s.sha256,
        },
      });
      return isFailure(r) ? r : saveResultOf(r.status, r.body, r.headers.get('retry-after'));
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
        headers: { 'content-type': 'application/json', 'if-match': `"${ifMatch}"` },
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
      // [ZAŁ.] endpoint name; Serwer has no export route yet.
      const r = await call('GET', '/v1/me/export');
      return isFailure(r) ? r : okOr(r, () => ({ data: r.body }));
    },
    async deleteAccount() {
      const r = await call('DELETE', '/v1/me');
      return isFailure(r) ? r : okOr(r, () => ({}));
    },
  };
}
