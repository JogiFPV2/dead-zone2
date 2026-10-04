/**
 * CORS for the `/v1` API (docs/backend.md §5.1): the game (GitHub Pages) and the API (Supabase)
 * are cross-origin. Framework-free (no Node or Fastify imports) so the planned Edge Function port
 * (`supabase/functions/api`) can reuse it with `Request`/`Response` headers.
 *
 * Strict allowlist, the matched origin is echoed (never `*`), no credentials (bearer tokens).
 * A request without `Origin` (curl, server to server) or from another origin gets no CORS headers
 * and is otherwise handled normally: the browser then blocks the response for that page.
 */

export const DEFAULT_CORS_ORIGINS: readonly string[] = [
  'https://jogifpv2.github.io',
  'http://localhost:5173',
];
export const CORS_ALLOW_METHODS = 'GET, PUT, POST, DELETE, OPTIONS';
/** Request headers the client sends (apps/game/src/account/http-api.ts). */
export const CORS_ALLOW_HEADERS = 'Authorization, Content-Type, If-Match, X-DZSV-SHA256';
/** Response headers the client reads (settings ETag, export filename, 429 retry). */
export const CORS_EXPOSE_HEADERS = 'ETag, Content-Disposition, Retry-After';
export const CORS_MAX_AGE_SECONDS = 600;

/**
 * Parses `CORS_ORIGINS` (comma-separated): each entry must be a bare `scheme://host[:port]`
 * origin (no path, query, wildcard or trailing slash). Throws on a bad entry; empty → defaults.
 */
export function parseCorsOrigins(raw: string | undefined): readonly string[] {
  const entries = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return DEFAULT_CORS_ORIGINS;
  return [
    ...new Set(
      entries.map((e) => {
        let url: URL;
        try {
          url = new URL(e);
        } catch {
          throw new Error(`CORS_ORIGINS: "${e}" is not an origin`);
        }
        if (
          (url.protocol !== 'https:' && url.protocol !== 'http:') ||
          e.includes('*') ||
          url.origin !== e.toLowerCase()
        ) {
          throw new Error(`CORS_ORIGINS: "${e}" must be a bare origin like https://example.com`);
        }
        return url.origin;
      }),
    ),
  ];
}

export interface CorsResult {
  /** Headers to add (empty for a request without an allowed `Origin`, except `Vary`). */
  headers: Record<string, string>;
  /** A CORS preflight: answer 204 with `headers` right away (no auth, no rate limit). */
  preflight: boolean;
}

/**
 * CORS headers for one request. `Vary: Origin` is always set (the answer depends on it). A
 * preflight is `OPTIONS` with `Access-Control-Request-Method`; it is answered with 204 even for
 * a disallowed origin, just without CORS headers, so the browser rejects it.
 */
export function corsFor(
  allowed: readonly string[],
  req: { method: string; origin: string | undefined; requestMethod: string | undefined },
): CorsResult {
  const preflight = req.method.toUpperCase() === 'OPTIONS' && req.requestMethod !== undefined;
  const headers: Record<string, string> = { vary: 'Origin' };
  const origin = req.origin;
  if (origin === undefined || !allowed.includes(origin)) return { headers, preflight };
  headers['access-control-allow-origin'] = origin;
  if (preflight) {
    headers['access-control-allow-methods'] = CORS_ALLOW_METHODS;
    headers['access-control-allow-headers'] = CORS_ALLOW_HEADERS;
    headers['access-control-max-age'] = String(CORS_MAX_AGE_SECONDS);
  } else {
    headers['access-control-expose-headers'] = CORS_EXPOSE_HEADERS;
  }
  return { headers, preflight };
}
