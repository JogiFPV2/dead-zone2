import { PROTOCOL_VERSION, type HealthResponse } from '@deadzone/protocol';
import { DEFAULT_CORS_ORIGINS, corsFor } from '../cors.js';
import { HttpError } from '../errors.js';
import { registerCharacterRoutes, type CharacterRouteDeps } from '../routes/characters.js';
import {
  JSON_TYPE,
  RouteContext,
  Router,
  errorResponse,
  type ApiRequest,
  type ApiResponse,
  type Logger,
} from './core.js';

export interface ApiOptions {
  /** Cloud save API `/v1` (docs/backend.md §5); omitted = only `/health`. */
  characters?: CharacterRouteDeps;
  /** Browser origins allowed by CORS (`CORS_ORIGINS`); default: GitHub Pages + Vite dev. */
  corsOrigins?: readonly string[];
}

/** The whole API as one function, shared by the Node server and the Edge Function. */
export interface Api {
  handle(req: ApiRequest, log: Logger): Promise<ApiResponse>;
  close(): Promise<void>;
}

export function createApi(opts: ApiOptions = {}): Api {
  const corsOrigins = opts.corsOrigins ?? DEFAULT_CORS_ORIGINS;
  const router = new Router();
  router.get('/health', (): Promise<HealthResponse> =>
    Promise.resolve({ status: 'ok', protocolVersion: PROTOCOL_VERSION }),
  );
  const characters = opts.characters ? registerCharacterRoutes(router, opts.characters) : undefined;

  async function dispatch(req: ApiRequest, log: Logger): Promise<ApiResponse> {
    // Per-IP limit on the whole `/v1` API, before routing, auth and reading any body.
    if (characters && (req.path === '/v1' || req.path.startsWith('/v1/'))) {
      await characters.ipLimit(req.ip);
    }
    const head = req.method === 'HEAD';
    const match = router.match(head ? 'GET' : req.method, req.path);
    if (!match) throw new HttpError(404, 'character_not_found', 'route not found');
    const ctx = new RouteContext(req, match.params, log);
    const result = await match.handler(ctx);
    const headers = { ...ctx.headers };
    if (result === undefined) return { status: ctx.status, headers, body: null };
    headers['content-type'] ??= JSON_TYPE;
    return { status: ctx.status, headers, body: head ? null : JSON.stringify(result) };
  }

  return {
    async handle(req, log) {
      // CORS first: headers go on every answer (errors and 429 included) and a preflight is
      // answered here, before auth and the rate limits.
      const cors = corsFor(corsOrigins, {
        method: req.method,
        origin: req.header('origin'),
        requestMethod: req.header('access-control-request-method'),
      });
      if (cors.preflight) return { status: 204, headers: cors.headers, body: null };
      let res: ApiResponse;
      try {
        res = await dispatch(req, log);
      } catch (err) {
        res = errorResponse(err, log);
      }
      return { ...res, headers: { ...res.headers, ...cors.headers } };
    },
    close: () => characters?.close() ?? Promise.resolve(),
  };
}
