import {
  MAX_ACCOUNT_SAVE_BYTES,
  MAX_ALIVE_CHARACTERS,
  MAX_IP_REQUESTS_PER_5_MIN,
  MAX_NEW_CHARACTERS_PER_DAY,
  MAX_SAVES_PER_HOUR,
  MAX_UPLOAD_BYTES_PER_DAY,
} from '@deadzone/protocol';
import { SAVE_VERSION } from '@deadzone/sim';

/** Server limits (docs/backend.md §5.5). Env can only lower the product values. */
export interface Limits {
  maxAliveCharacters: number;
  maxAccountSaveBytes: number;
  maxNewCharactersPerDay: number;
  /** Max compressed DZSV body. */
  maxEnvelopeBytes: number;
  /** Max uncompressed state JSON (gunzip output limit). */
  maxStateBytes: number;
  /** Save + death uploads per account per hour. */
  maxSavesPerHour: number;
  /** Uploaded save bytes per account per 24 h. */
  maxUploadBytesPerDay: number;
  /** `/v1` requests per client IP per 5 minutes. */
  maxIpRequestsPer5Min: number;
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
  /** Proxy hops in front of the server (X-Forwarded-For); 0 = direct, use the socket IP. */
  trustProxyHops: number;
  /** Current deterministic world generator, stored on new characters. */
  worldgenVersion: number;
  /** Newest accepted sim save format (default `SAVE_VERSION` of packages/sim); 1…it accepted. */
  saveFormatVersion: number;
  limits: Limits;
  /** DZSV validation workers (docs/backend.md §5.2.3). */
  validation: {
    /** 0 = `availableParallelism() - 1`. */
    workers: number;
    timeoutMs: number;
    /** V8 old-generation cap per worker, MiB. */
    maxHeapMb: number;
  };
}

export const DEFAULT_LIMITS: Limits = {
  maxAliveCharacters: MAX_ALIVE_CHARACTERS,
  maxAccountSaveBytes: MAX_ACCOUNT_SAVE_BYTES,
  maxNewCharactersPerDay: MAX_NEW_CHARACTERS_PER_DAY,
  maxEnvelopeBytes: 16 * 1024 * 1024,
  maxStateBytes: 64 * 1024 * 1024,
  maxSavesPerHour: MAX_SAVES_PER_HOUR,
  maxUploadBytesPerDay: MAX_UPLOAD_BYTES_PER_DAY,
  maxIpRequestsPer5Min: MAX_IP_REQUESTS_PER_5_MIN,
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

function checked(c: ServerConfig): ServerConfig {
  // A state string larger than the worker heap aborts the process (save/worker-pool.ts).
  const need = Math.ceil((c.limits.maxStateBytes * 4) / (1024 * 1024));
  if (c.validation.maxHeapMb < need) {
    throw new Error(`VALIDATION_HEAP_MB must be at least ${need} for LIMIT_STATE_BYTES`);
  }
  return c;
}

export function loadConfig(env: Env): ServerConfig {
  const supabaseUrl = required(env, 'SUPABASE_URL').replace(/\/+$/, '');
  const jwtIssuer = env.SUPABASE_JWT_ISSUER?.trim() || `${supabaseUrl}/auth/v1`;
  const d = DEFAULT_LIMITS;
  return checked({
    port: int(env, 'PORT', 3001, 1, 65535),
    host: env.HOST?.trim() || '0.0.0.0',
    supabaseUrl,
    supabaseServiceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    jwtIssuer,
    jwksUrl: env.SUPABASE_JWKS_URL?.trim() || `${jwtIssuer}/.well-known/jwks.json`,
    jwtAudience: env.SUPABASE_JWT_AUDIENCE?.trim() || 'authenticated',
    storageBucket: env.SAVES_BUCKET?.trim() || 'saves',
    signedUrlTtlSeconds: int(env, 'SIGNED_URL_TTL_SECONDS', 60, 10, 3600),
    trustProxyHops: int(env, 'TRUST_PROXY_HOPS', 0, 0, 10),
    worldgenVersion: int(env, 'WORLDGEN_VERSION', 1, 1, 0xffff_ffff),
    // Newest sim save version accepted; never above what this server's sim can read.
    saveFormatVersion: int(env, 'SAVE_FORMAT_VERSION', SAVE_VERSION, 1, SAVE_VERSION),
    validation: {
      workers: int(env, 'VALIDATION_WORKERS', 0, 0, 64),
      timeoutMs: int(env, 'VALIDATION_TIMEOUT_MS', 5000, 100, 60_000),
      maxHeapMb: int(env, 'VALIDATION_HEAP_MB', 512, 32, 4096),
    },
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
      maxSavesPerHour: int(env, 'LIMIT_SAVES_PER_HOUR', d.maxSavesPerHour, 1, d.maxSavesPerHour),
      maxUploadBytesPerDay: int(
        env,
        'LIMIT_UPLOAD_BYTES_PER_DAY',
        d.maxUploadBytesPerDay,
        1024,
        d.maxUploadBytesPerDay,
      ),
      maxIpRequestsPer5Min: int(
        env,
        'LIMIT_IP_REQUESTS_PER_5_MIN',
        d.maxIpRequestsPer5Min,
        1,
        d.maxIpRequestsPer5Min,
      ),
    },
  });
}
