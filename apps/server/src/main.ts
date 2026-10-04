import { buildApp } from './app.js';
import { createJwksVerifier } from './auth.js';
import { MemoryRateLimitStore } from './rate-limit.js';
import { createWorkerPool } from './save/worker-pool.js';
import { loadConfig } from './config.js';
import {
  createServiceClient,
  createSupabaseAccountAdmin,
  createSupabaseBlobStore,
  createSupabaseStore,
} from './data/supabase.js';

const config = loadConfig(process.env);
const db = createServiceClient(config);

const app = buildApp({
  trustProxyHops: config.trustProxyHops,
  characters: {
    config,
    verifier: createJwksVerifier(config.jwksUrl, config.jwtIssuer, config.jwtAudience),
    store: createSupabaseStore(db),
    blobs: createSupabaseBlobStore(db, config.storageBucket),
    accounts: createSupabaseAccountAdmin(db),
    // Single process for now; swap for a Redis store when the server scales out.
    rateLimits: new MemoryRateLimitStore(),
    validator: createWorkerPool({
      ...(config.validation.workers > 0 ? { size: config.validation.workers } : {}),
      timeoutMs: config.validation.timeoutMs,
      maxHeapMb: config.validation.maxHeapMb,
    }),
  },
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
