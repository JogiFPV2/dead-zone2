/**
 * Framework-free HTTP layer of the API (docs/backend.md §5): plain request/response objects, a
 * tiny router and the shared error mapping. No Node or Fastify imports, so the same routes run in
 * the Node server (Fastify adapter, `app.ts`) and in the Supabase Edge Function (fetch adapter,
 * `http/fetch.ts`, `supabase/functions/api`).
 */
import type { ApiError } from '@deadzone/protocol';
import { HttpError, badRequest } from '../errors.js';

/** One incoming request, independent of the server framework. */
export interface ApiRequest {
  /** Upper-case HTTP method. */
  method: string;
  /** Path without query string, e.g. `/v1/characters`. */
  path: string;
  /** Header value by lower-case name; repeated headers are joined with `, `. */
  header(name: string): string | undefined;
  /** Client IP for the rate limits (already resolved through trusted proxies). */
  ip: string;
  /**
   * Reads the whole body, at most `limit` bytes (413 `payload_too_large` above it). Called at
   * most once per request, and only by routes that need a body, after auth and rate limits.
   */
  body(limit: number): Promise<Uint8Array>;
}

/** Structured log; never pass save bodies or tokens (docs/backend.md §5.2.7). */
export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  /** `null` = no body (204, HEAD). */
  body: string | null;
}

/** Fastify's default body limit, kept for the JSON routes. */
export const DEFAULT_BODY_LIMIT = 1024 * 1024;

/** Per-request context handed to a route handler. */
export class RouteContext {
  status = 200;
  readonly headers: Record<string, string> = {};
  private bodyRead: Promise<Uint8Array> | undefined;

  constructor(
    readonly req: ApiRequest,
    readonly params: Readonly<Record<string, string>>,
    readonly log: Logger,
  ) {}

  header(name: string): string | undefined {
    return this.req.header(name);
  }

  setHeader(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  private contentType(): string {
    return (this.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  }

  private raw(limit: number): Promise<Uint8Array> {
    this.bodyRead ??= this.req.body(limit);
    return this.bodyRead;
  }

  /** Binary body (`application/octet-stream`), e.g. a DZSV envelope. */
  async bytes(limit: number): Promise<Uint8Array> {
    if (this.contentType() !== 'application/octet-stream') {
      throw badRequest('body must be a DZSV envelope (application/octet-stream)');
    }
    return this.raw(limit);
  }

  /**
   * JSON body (`application/json`); `undefined` for a request without body and content type.
   * Like Fastify: 415 for another content type, 400 for an empty or invalid JSON body.
   */
  async json(limit = DEFAULT_BODY_LIMIT): Promise<unknown> {
    const type = this.contentType();
    if (type !== 'application/json') {
      if (type === '' && (await this.raw(limit)).length === 0) return undefined;
      throw new HttpError(415, 'bad_request', 'content type must be application/json');
    }
    const bytes = await this.raw(limit);
    if (bytes.length === 0) throw badRequest('body is empty');
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        (k, v: unknown) => {
          if (k === '__proto__') throw new Error('forbidden key');
          return v;
        },
      ) as unknown;
    } catch {
      throw badRequest('body is not valid JSON');
    }
  }
}

/** Returns the JSON response body, or `undefined` for none (set `ctx.status`, e.g. 204). */
export type RouteHandler = (ctx: RouteContext) => Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

/** Method + path router; `:name` segments become `ctx.params.name`. */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler): void {
    const keys: string[] = [];
    const source = path
      .split('/')
      .map((seg) => {
        if (!seg.startsWith(':')) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        keys.push(seg.slice(1));
        return '([^/]+)';
      })
      .join('/');
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
  }

  get(path: string, h: RouteHandler): void {
    this.add('GET', path, h);
  }
  post(path: string, h: RouteHandler): void {
    this.add('POST', path, h);
  }
  put(path: string, h: RouteHandler): void {
    this.add('PUT', path, h);
  }
  delete(path: string, h: RouteHandler): void {
    this.add('DELETE', path, h);
  }

  match(
    method: string,
    path: string,
  ): { handler: RouteHandler; params: Record<string, string> } | undefined {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]!);
        } catch {
          params[k] = m[i + 1]!;
        }
      });
      return { handler: r.handler, params };
    }
    return undefined;
  }
}

export const JSON_TYPE = 'application/json; charset=utf-8';

/** API error body for a thrown error; unknown errors are logged and become a plain 500. */
export function errorResponse(err: unknown, log: Logger): ApiResponse {
  if (err instanceof HttpError) {
    const headers: Record<string, string> = { 'content-type': JSON_TYPE };
    const retryAfter = (err as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof retryAfter === 'number') headers['retry-after'] = String(retryAfter);
    if (err.statusCode >= 400 && err.statusCode !== 401) {
      log.info('request rejected', { code: err.code });
    }
    const body: ApiError = { error: err.code, message: err.message, ...err.details };
    return { status: err.statusCode, headers, body: JSON.stringify(body) };
  }
  const e = err as { message?: unknown; code?: unknown } | null;
  log.error('internal error', { err: { message: e?.message, code: e?.code } });
  const body: ApiError = { error: 'internal', message: 'internal error' };
  return { status: 500, headers: { 'content-type': JSON_TYPE }, body: JSON.stringify(body) };
}
