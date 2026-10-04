import { buildApp } from './app.js';
import { createJwksVerifier } from './auth.js';
import { loadConfig } from './config.js';
import {
  createServiceClient,
  createSupabaseBlobStore,
  createSupabaseStore,
} from './data/supabase.js';

const config = loadConfig(process.env);
const db = createServiceClient(config);

const app = buildApp({
  characters: {
    config,
    verifier: createJwksVerifier(config.jwksUrl, config.jwtIssuer, config.jwtAudience),
    store: createSupabaseStore(db),
    blobs: createSupabaseBlobStore(db, config.storageBucket),
  },
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
