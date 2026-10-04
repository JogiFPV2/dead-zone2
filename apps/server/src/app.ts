import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, type ApiError, type HealthResponse } from '@deadzone/protocol';
import { HttpError } from './errors.js';
import { registerCharacterRoutes, type CharacterRouteDeps } from './routes/characters.js';

export interface AppOptions {
  /** Cloud save API `/v1` (docs/backend.md §5); omitted = only `/health`. */
  characters?: CharacterRouteDeps;
}

const FASTIFY_CODES: Record<number, ApiError['error']> = {
  400: 'bad_request',
  401: 'unauthorized',
  404: 'character_not_found',
  413: 'payload_too_large',
  415: 'bad_request',
  429: 'rate_limited',
};

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : // Never log save bodies or tokens (docs/backend.md §5.2.7).
          { redact: ['req.headers.authorization'] },
  });

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) {
      if (err.statusCode >= 400 && err.statusCode !== 401) {
        req.log.info({ code: err.code }, 'request rejected');
      }
      return reply
        .code(err.statusCode)
        .send({ error: err.code, message: err.message } satisfies ApiError);
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    const code = FASTIFY_CODES[status];
    if (status < 500 && code) {
      return reply.code(status).send({ error: code, message: err.message } satisfies ApiError);
    }
    req.log.error({ err: { message: err.message, code: err.code } }, 'internal error');
    return reply
      .code(500)
      .send({ error: 'internal', message: 'internal error' } satisfies ApiError);
  });

  app.get('/health', (): HealthResponse => ({ status: 'ok', protocolVersion: PROTOCOL_VERSION }));

  if (opts.characters) registerCharacterRoutes(app, opts.characters);

  return app;
}
