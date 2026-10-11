import type { Readable } from 'node:stream';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
  type HTTPMethods,
} from 'fastify';
import { HttpError } from './errors.js';
import { createApi, type ApiOptions } from './http/api.js';
import type { ApiRequest, Logger } from './http/core.js';

/**
 * Node server: Fastify is only the transport here. Routes, CORS, rate limits and errors live in
 * the framework-free core (`http/api.ts`), shared with the Supabase Edge Function.
 */
export interface AppOptions extends ApiOptions {
  /** Proxy hops to trust for the client IP (rate limits); 0 = socket address. */
  trustProxyHops?: number;
}

const METHODS: HTTPMethods[] = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'];

function payloadTooLarge(): HttpError {
  return new HttpError(413, 'payload_too_large', 'request body too large');
}

/** Reads an unparsed request stream with a byte limit. */
async function readBody(
  stream: Readable | undefined,
  contentLength: string | undefined,
  limit: number,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  if (contentLength !== undefined && Number(contentLength) > limit) {
    stream.resume();
    throw payloadTooLarge();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const c = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : (chunk as Uint8Array);
    size += c.length;
    if (size > limit) {
      stream.resume();
      throw payloadTooLarge();
    }
    chunks.push(c);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function toLogger(log: FastifyBaseLogger): Logger {
  return {
    info: (msg, data) => (data ? log.info(data, msg) : log.info(msg)),
    warn: (msg, data) => (data ? log.warn(data, msg) : log.warn(msg)),
    error: (msg, data) => (data ? log.error(data, msg) : log.error(msg)),
  };
}

function toApiRequest(req: FastifyRequest): ApiRequest {
  const header = (name: string): string | undefined => {
    const v = req.headers[name];
    return typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : undefined;
  };
  return {
    method: req.method.toUpperCase(),
    path: req.url.split('?')[0] ?? '/',
    header,
    ip: req.ip,
    body: (limit) => readBody(req.body as Readable | undefined, header('content-length'), limit),
  };
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const hops = opts.trustProxyHops ?? 0;
  const options: FastifyServerOptions = {
    // Number of trusted hops; without a proxy `req.ip` is the socket address.
    trustProxy: hops > 0 ? (_addr: string, i: number) => i < hops : false,
    exposeHeadRoutes: false,
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : // Never log save bodies or tokens (docs/backend.md §5.2.7).
          { redact: ['req.headers.authorization'] },
  };
  const app = Fastify(options);
  const api = createApi(opts);
  app.addHook('onClose', () => api.close());

  // Bodies stay unread streams: the core reads them with the route's limit, after auth.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

  const handler = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const res = await api.handle(toApiRequest(req), toLogger(req.log));
    void reply.code(res.status).headers(res.headers);
    return reply.send(res.body ?? undefined);
  };
  app.route({ method: METHODS, url: '/', handler });
  app.route({ method: METHODS, url: '/*', handler });

  return app;
}
