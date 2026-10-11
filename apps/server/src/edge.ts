/**
 * Supabase Edge Function entry (docs/backend.md §10): the same API core as the Node server, with
 * the fetch adapter, inline DZSV validation and the Supabase data layer. Bundled by
 * `pnpm --filter @deadzone/server build:edge` into `supabase/functions/api/server.js`, which
 * `supabase/functions/api/index.ts` serves with `Deno.serve`. No Node-only APIs besides
 * `node:crypto` / `node:zlib`, which the Edge Runtime provides.
 */
import { createJwksVerifier } from './auth.js';
import { createBundledPlaces } from './edge-places.js';
import { loadConfig, type ServerConfig } from './config.js';
import {
  createServiceClient,
  createSupabaseAccountAdmin,
  createSupabaseBlobStore,
  createSupabaseStore,
} from './data/supabase.js';
import { createApi, type Api } from './http/api.js';
import { fetchHandler } from './http/fetch.js';
import { MemoryRateLimitStore } from './rate-limit.js';
import { createInlineValidator } from './save/validate.js';

export { createApi, fetchHandler };
export type { Api };

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Edge defaults that differ from the Node server (env still wins): the isolate has far less
 * memory than a worker heap, so the uncompressed state limit is lower.
 */
export const EDGE_DEFAULTS: Readonly<Record<string, string>> = {
  LIMIT_STATE_BYTES: String(32 * 1024 * 1024),
  // Behind the Supabase gateway: the client is the last X-Forwarded-For entry it appends.
  TRUST_PROXY_HOPS: '1',
};

export function loadEdgeConfig(env: Env): ServerConfig {
  const merged: Record<string, string | undefined> = { ...EDGE_DEFAULTS };
  for (const [k, v] of Object.entries(env)) if (v?.trim()) merged[k] = v;
  return loadConfig(merged);
}

/** `Deno.serve` handler for the `api` function. */
export function createEdgeHandler(
  env: Env,
): (req: Request, info?: { remoteAddr?: { hostname?: string } }) => Promise<Response> {
  const config = loadEdgeConfig(env);
  const db = createServiceClient(config);
  const api = createApi({
    corsOrigins: config.corsOrigins,
    characters: {
      config,
      verifier: createJwksVerifier(config.jwksUrl, config.jwtIssuer, config.jwtAudience),
      store: createSupabaseStore(db),
      blobs: createSupabaseBlobStore(db, config.storageBucket),
      accounts: createSupabaseAccountAdmin(db),
      // Per isolate only: a best-effort first line; the database enforces quotas and limits.
      rateLimits: new MemoryRateLimitStore(),
      validator: createInlineValidator(),
      places: createBundledPlaces(),
    },
  });
  return fetchHandler(api, { trustProxyHops: config.trustProxyHops });
}
