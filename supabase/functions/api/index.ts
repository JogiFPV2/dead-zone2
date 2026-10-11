// Supabase Edge Function `api`: the Deadzone cloud save API (docs/backend.md §10).
// `server.js` is generated: `pnpm --filter @deadzone/server build:edge` (bundle of apps/server/src/edge.ts).
// Deploy with JWT verification off (`--no-verify-jwt`): the API checks tokens itself and CORS
// preflights carry no Authorization header.
import { createEdgeHandler } from './server.js';

Deno.serve(createEdgeHandler(Deno.env.toObject()));
