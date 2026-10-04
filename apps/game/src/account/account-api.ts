/**
 * Konto i zapis online (deadzone-hud-v2-spec „Konto i zapis online (UI)”): the client's view of
 * the account API `/v1` (docs/backend.md §5). Screens only talk to `AccountApi`; the default is
 * the offline implementation, so the local flow (menu → Postacie → kreator) is unchanged.
 *
 * Wire types come from `@deadzone/protocol` (Serwer #157 `lastLocation`/`usage`, #164 settings).
 */
import type {
  AccountExport,
  AccountUsage,
  ApiError,
  CharacterSummary,
  CloudSaveReason,
  LastLocation,
  ListCharactersResponse,
  PlayerSettingsResponse,
  SaveConflictServer,
} from '@deadzone/protocol';

export type { AccountExport, AccountUsage, LastLocation };

/** One character of the account (`GET /v1/characters` → `CharacterSummary`). */
export type CloudCharacter = CharacterSummary;

export interface NewCloudCharacter {
  name: string;
  appearance: Record<string, unknown>;
  worldSettings: Record<string, unknown>;
}

/** `GET /v1/characters` (the deprecated `limits` is folded into `usage`). */
export type CharacterList = Pick<ListCharactersResponse, 'characters' | 'usage'>;

export type LoginMethod = 'google' | 'email';

export interface AccountUser {
  id: string;
  email: string;
  method: LoginMethod;
  emailConfirmed: boolean;
  /** Google avatar (https only); otherwise initials. */
  avatarUrl?: string | undefined;
  /** ISO date the login method was linked (`Google · konto połączone 1 paź 2026`). */
  linkedAt?: string | undefined;
}

/** Why an auth call failed; screens map these to the spec's error texts. */
export type AuthErrorCode =
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'captcha-required'
  | 'rate-limited'
  | 'email-taken'
  | 'weak-password'
  | 'invalid-email'
  | 'network'
  | 'not-configured';

export type AuthResult =
  { ok: true; user: AccountUser } | { ok: false; code: AuthErrorCode; retryAfterMin?: number };

/** Sign-up / magic link / reset: the mail went out (or a typed error). */
export type MailResult = { ok: true } | { ok: false; code: AuthErrorCode; retryAfterMin?: number };

/** Common failures of data calls (`401` = session expired). */
export type ApiFailure =
  | { ok: false; reason: 'offline' }
  | { ok: false; reason: 'network' }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'rate-limited'; retryAfterSec?: number }
  | { ok: false; reason: 'error'; status: number; code?: string };

export type ApiResult<T> = ({ ok: true } & T) | ApiFailure;

/**
 * The save on the server named by a 409 `save_version_conflict` (`SaveConflictError.server` of
 * `@deadzone/protocol`): `null` = the server has no save of this character, `minuteOfDay` null =
 * stored before the server recorded it.
 */
export type ServerSaveInfo = SaveConflictServer;

/**
 * `PUT /v1/characters/:id/save` with `If-Match`: accepted, refused because another session saved
 * newer state (409 `save_version_conflict`), or the character is gone (410 / 409
 * `character_dead`: died on another device).
 */
export type SaveResult =
  | { ok: true; version: number; sizeBytes: number }
  | {
      ok: false;
      reason: 'conflict';
      /** `null`: no save on the server; undefined: the 409 body did not carry a valid `server`. */
      server: ServerSaveInfo | null | undefined;
    }
  | { ok: false; reason: 'gone' }
  | { ok: false; reason: 'quota' }
  | ApiFailure;

export interface SaveUpload {
  /** DZSV envelope bytes (docs/backend.md §4.1). */
  bytes: Uint8Array;
  sha256: string;
  reason: CloudSaveReason;
}

/**
 * `GET /v1/me/settings` (and the `PUT` answer): the whole settings object, its version (`ETag`)
 * and time. Version 0 / `settings: null` = never stored (first `PUT` sends `If-Match: "0"`).
 */
export type RemoteSettings = PlayerSettingsResponse;

/** One rejected field of a 422 `invalid_settings` (`ApiError.issues`). */
export type SettingsIssue = NonNullable<ApiError['issues']>[number];

/**
 * `PUT /v1/me/settings` (Serwer #164): saved (server copy as stored), 412 stale `If-Match`
 * (`conflict`: reload with GET), 413 `too-large`, 422 `invalid` with `issues`, 428 missing
 * `If-Match` (`precondition`: a client bug, never sent by this adapter).
 */
export type SettingsPutResult =
  | ({ ok: true } & RemoteSettings)
  | { ok: false; reason: 'conflict' }
  | { ok: false; reason: 'too-large' }
  | { ok: false; reason: 'invalid'; issues: SettingsIssue[] }
  | { ok: false; reason: 'precondition' }
  | ApiFailure;

/**
 * Account API used by the UI. `mode`: `offline` = no account at all (local saves only),
 * `mock` = in-memory demo account (`?online=mock`), `http` = the real `/v1` server.
 */
export interface AccountApi {
  readonly mode: 'offline' | 'mock' | 'http';
  /** Online screens are shown (mock or a configured server). */
  readonly online: boolean;
  /** Mock only: a save „in flight” after login, to show `SYNCHRONIZUJĘ…` (review). */
  readonly demoSync?: { readonly ids: readonly string[]; readonly ms: number } | undefined;

  /** Current session (restored from storage / OAuth redirect); undefined when logged out. */
  session(): Promise<AccountUser | undefined>;
  /** Google OAuth: redirects in the real implementation (resolves only in the mock). */
  signInWithGoogle(): Promise<AuthResult>;
  signInWithPassword(email: string, password: string, captchaToken: string): Promise<AuthResult>;
  signUp(email: string, password: string, captchaToken: string): Promise<MailResult>;
  sendMagicLink(email: string, captchaToken: string): Promise<MailResult>;
  sendPasswordReset(email: string, captchaToken: string): Promise<MailResult>;
  /** „Wyślij ponownie” under `Potwierdź adres e-mail…`. */
  resendConfirmation(email: string, captchaToken: string): Promise<MailResult>;
  signOut(): Promise<void>;

  listCharacters(): Promise<ApiResult<CharacterList>>;
  /** `POST /v1/characters` (Nowa postać); the first save follows right after the start. */
  createCharacter(c: NewCloudCharacter): Promise<ApiResult<{ character: CloudCharacter }>>;
  deleteCharacter(id: string): Promise<ApiResult<object>>;
  putSave(id: string, ifMatch: number, save: SaveUpload): Promise<SaveResult>;

  getSettings(): Promise<ApiResult<RemoteSettings>>;
  putSettings(settings: unknown, ifMatch: number): Promise<SettingsPutResult>;

  /**
   * `GET /v1/me/export` (RODO): account, settings, characters (tombstones too) and per living save
   * a signed `downloadUrl` valid for `expiresInSeconds` (600 s). `fileName` from the server's
   * `Content-Disposition: attachment`. 429 (`MAX_EXPORTS_PER_HOUR` = 5/h) → `rate-limited` with
   * `retryAfterSec` from `Retry-After`.
   */
  exportData(): Promise<ApiResult<{ data: AccountExport; fileName?: string | undefined }>>;
  /** `DELETE /v1/me`: account, characters, saves and tombstones (local offline saves stay). */
  deleteAccount(): Promise<ApiResult<object>>;
}

export const OFFLINE: ApiFailure = { ok: false, reason: 'offline' };
