import {
  MAX_ACCOUNT_SAVE_BYTES,
  MAX_ALIVE_CHARACTERS,
  MAX_NEW_CHARACTERS_PER_DAY,
} from '@deadzone/protocol';

/** Server limits (docs/backend.md §5.5). Env can only lower the product values. */
export interface Limits {
  maxAliveCharacters: number;
  maxAccountSaveBytes: number;
  maxNewCharactersPerDay: number;
  /** Max compressed DZSV body. */
  maxEnvelopeBytes: number;
  /** Max uncompressed state JSON (gunzip output limit). */
  maxStateBytes: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  supabaseUrl: string;
  /** Service role key: server only, never sent to clients or logged. */
  supabaseServiceRoleKey: string;
  /** JWT issuer, default `${supabaseUrl}/auth/v1`. */
  jwtIssuer: string;
  /** JWKS endpoint, default `${jwtIssuer}/.well-known/jwks.json`. */
  jwksUrl: string;
  jwtAudience: string;
  storageBucket: string;
  signedUrlTtlSeconds: number;
  /** Current deterministic world generator, stored on new characters. */
  worldgenVersion: number;
  /** Current sim save format (`SAVE_VERSION` in packages/sim/src/save/save.ts). */
  saveFormatVersion: number;
  limits: Limits;
}

export const DEFAULT_LIMITS: Limits = {
  maxAliveCharacters: MAX_ALIVE_CHARACTERS,
  maxAccountSaveBytes: MAX_ACCOUNT_SAVE_BYTES,
  maxNewCharactersPerDay: MAX_NEW_CHARACTERS_PER_DAY,
  maxEnvelopeBytes: 16 * 1024 * 1024,
  maxStateBytes: 64 * 1024 * 1024,
};

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name} (see apps/server/.env.example)`);
  return v;
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`Env ${name} must be an integer in ${min}..${max}`);
  }
  return v;
}

export function loadConfig(env: Env): ServerConfig {
  const supabaseUrl = required(env, 'SUPABASE_URL').replace(/\/+$/, '');
  const jwtIssuer = env.SUPABASE_JWT_ISSUER?.trim() || `${supabaseUrl}/auth/v1`;
  const d = DEFAULT_LIMITS;
  return {
    port: int(env, 'PORT', 3001, 1, 65535),
    host: env.HOST?.trim() || '0.0.0.0',
    supabaseUrl,
    supabaseServiceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    jwtIssuer,
    jwksUrl: env.SUPABASE_JWKS_URL?.trim() || `${jwtIssuer}/.well-known/jwks.json`,
    jwtAudience: env.SUPABASE_JWT_AUDIENCE?.trim() || 'authenticated',
    storageBucket: env.SAVES_BUCKET?.trim() || 'saves',
    signedUrlTtlSeconds: int(env, 'SIGNED_URL_TTL_SECONDS', 60, 10, 3600),
    worldgenVersion: int(env, 'WORLDGEN_VERSION', 1, 1, 0xffff_ffff),
    saveFormatVersion: int(env, 'SAVE_FORMAT_VERSION', 1, 1, 0xffff_ffff),
    limits: {
      maxAliveCharacters: int(
        env,
        'LIMIT_ALIVE_CHARACTERS',
        d.maxAliveCharacters,
        1,
        d.maxAliveCharacters,
      ),
      maxAccountSaveBytes: int(
        env,
        'LIMIT_ACCOUNT_SAVE_BYTES',
        d.maxAccountSaveBytes,
        1,
        d.maxAccountSaveBytes,
      ),
      maxNewCharactersPerDay: int(
        env,
        'LIMIT_NEW_CHARACTERS_PER_DAY',
        d.maxNewCharactersPerDay,
        1,
        d.maxNewCharactersPerDay,
      ),
      maxEnvelopeBytes: int(
        env,
        'LIMIT_ENVELOPE_BYTES',
        d.maxEnvelopeBytes,
        1024,
        d.maxEnvelopeBytes,
      ),
      maxStateBytes: int(env, 'LIMIT_STATE_BYTES', d.maxStateBytes, 1024, d.maxStateBytes),
    },
  };
}
