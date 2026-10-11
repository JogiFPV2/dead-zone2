/**
 * Web `Request` → API core → `Response`: the adapter of the Supabase Edge Function
 * (`supabase/functions/api`, Deno). No Node APIs.
 */
import { HttpError } from '../errors.js';
import type { Api } from './api.js';
import type { ApiRequest, Logger } from './core.js';

export interface FetchAdapterOptions {
  /**
   * Leading path segments to drop: Supabase serves the function `api` under
   * `/functions/v1/api/...` and hands it `/api/...`, so `/api/v1/characters` → `/v1/characters`.
   */
  basePaths?: readonly string[];
  /**
   * Proxy hops in front of the function that append to `X-Forwarded-For`; the client IP is the
   * entry this many places from the right (0 = the connection address).
   */
  trustProxyHops?: number;
  log?: Logger;
}

export const DEFAULT_BASE_PATHS: readonly string[] = ['/functions/v1/api', '/api'];

/** JSON lines on the console (Supabase function logs); never bodies or tokens. */
export const consoleLogger: Logger = {
  info: (msg, data) => console.log(JSON.stringify({ level: 'info', msg, ...data })),
  warn: (msg, data) => console.warn(JSON.stringify({ level: 'warn', msg, ...data })),
  error: (msg, data) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
};

export function stripBasePath(path: string, bases: readonly string[]): string {
  for (const b of bases) {
    if (path === b) return '/';
    if (path.startsWith(`${b}/`)) return path.slice(b.length);
  }
  return path;
}

/** Client IP from `X-Forwarded-For` + the connection address, trusting `hops` proxies. */
export function clientIp(forwarded: string | null, remote: string, hops: number): string {
  const chain = [
    ...(forwarded ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    remote,
  ];
  return chain[Math.max(0, chain.length - 1 - hops)] ?? remote;
}

async function readBody(req: Request, limit: number): Promise<Uint8Array> {
  const tooLarge = (): HttpError =>
    new HttpError(413, 'payload_too_large', 'request body too large');
  const length = req.headers.get('content-length');
  if (length !== null && Number(length) > limit) throw tooLarge();
  if (!req.body) return new Uint8Array(0);
  const reader = (req.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** `fetch`-style handler (`Deno.serve`) over the API core. */
export function fetchHandler(
  api: Api,
  opts: FetchAdapterOptions = {},
): (req: Request, info?: { remoteAddr?: { hostname?: string } }) => Promise<Response> {
  const bases = opts.basePaths ?? DEFAULT_BASE_PATHS;
  const hops = opts.trustProxyHops ?? 1;
  const log = opts.log ?? consoleLogger;
  return async (request, info) => {
    const url = new URL(request.url);
    const req: ApiRequest = {
      method: request.method.toUpperCase(),
      path: stripBasePath(url.pathname, bases),
      header: (name) => request.headers.get(name) ?? undefined,
      ip: clientIp(
        request.headers.get('x-forwarded-for'),
        info?.remoteAddr?.hostname ?? 'unknown',
        hops,
      ),
      body: (limit) => readBody(request, limit),
    };
    const res = await api.handle(req, log);
    return new Response(res.body, { status: res.status, headers: res.headers });
  };
}
