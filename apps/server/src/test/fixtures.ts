import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { SaveEnvelopeHeader } from '@deadzone/protocol';
import { SAVE_VERSION } from '@deadzone/sim';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { buildApp } from '../app.js';
import { createPlacesCache } from '@deadzone/content/node';
import { createJwtVerifier } from '../auth.js';
import type { CharacterRouteDeps } from '../routes/characters.js';
import { DEFAULT_LIMITS, type Limits } from '../config.js';
import { sha256Hex } from '../save/envelope.js';
import { realSave } from './sim-save.js';
import { MemoryRateLimitStore } from '../rate-limit.js';
import { createWorkerPool, type SaveValidator } from '../save/worker-pool.js';
import { MemoryAccounts, MemoryBlobs, MemoryStore } from './memory-store.js';

export const ISSUER = 'https://test.supabase.co/auth/v1';
export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';

const keys = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test', alg: 'ES256' };
export const jwks = createLocalJWKSet({ keys: [jwk] });

export async function token(
  sub: string,
  opts: {
    exp?: string;
    aud?: string;
    iss?: string;
    role?: string;
    key?: Parameters<SignJWT['sign']>[0];
  } = {},
): Promise<string> {
  return new SignJWT({ role: opts.role ?? 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setSubject(sub)
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .sign(opts.key ?? keys.privateKey);
}

export function setup(
  limits: Partial<Limits> = {},
  opts: {
    trustProxyHops?: number;
    validator?: SaveValidator;
    corsOrigins?: string[];
    places?: CharacterRouteDeps['places'];
  } = {},
) {
  const l = { ...DEFAULT_LIMITS, ...limits };
  const store = new MemoryStore(l.maxAliveCharacters, l.maxAccountSaveBytes);
  const blobs = new MemoryBlobs();
  const accounts = new MemoryAccounts();
  for (const u of [USER_A, USER_B]) {
    store.profiles.add(u);
    accounts.users.add(u);
  }
  const validator =
    opts.validator ?? createWorkerPool({ size: 1, timeoutMs: 25_000, maxHeapMb: 256 });
  const rateLimits = new MemoryRateLimitStore(() => store.clock);
  let seed = 1000;
  const characters: CharacterRouteDeps = {
    config: {
      limits: l,
      worldgenVersion: 1,
      saveFormatVersion: SAVE_VERSION,
      signedUrlTtlSeconds: 60,
    },
    verifier: createJwtVerifier({ issuer: ISSUER, audience: 'authenticated', keys: jwks }),
    store,
    blobs,
    accounts,
    validator,
    rateLimits,
    now: () => new Date(store.clock),
    newSeed: () => seed++,
    places: opts.places ?? createPlacesCache(),
  };
  const app = buildApp({
    trustProxyHops: opts.trustProxyHops ?? 0,
    ...(opts.corsOrigins ? { corsOrigins: opts.corsOrigins } : {}),
    characters,
  });
  return { app, store, blobs, accounts, rateLimits, characters };
}

export interface EnvelopeOpts {
  header?: Partial<SaveEnvelopeHeader>;
  state?: unknown;
  /** Overrides of the raw prefix. */
  magic?: string;
  envelopeVersion?: number;
  flags?: number;
  /** Extra random-ish bytes in the state (to grow the envelope). */
  padding?: number;
}

export function envelope(characterId: string, worldSeed: number, o: EnvelopeOpts = {}): Buffer {
  const given =
    o.state && typeof o.state === 'object' && !Array.isArray(o.state)
      ? { seed: worldSeed, ...o.state }
      : o.state;
  const state =
    given ??
    (o.padding
      ? { ...realSave(worldSeed), pad: randomBytes(o.padding).toString('base64') }
      : realSave(worldSeed));
  const raw = Buffer.from(JSON.stringify(state), 'utf8');
  const header: SaveEnvelopeHeader = {
    formatVersion: SAVE_VERSION,
    simVersion: '0.0.0',
    world_seed: worldSeed,
    worldgen_version: 1,
    characterId,
    gameDay: 3,
    reason: 'autosave',
    rawSize: raw.length,
    createdAt: '2026-10-04T12:00:00.000Z',
    ...o.header,
  };
  const h = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.alloc(12);
  prefix.write(o.magic ?? 'DZSV', 0, 'ascii');
  prefix.writeUInt16LE(o.envelopeVersion ?? 1, 4);
  prefix.writeUInt16LE(o.flags ?? 1, 6);
  prefix.writeUInt32LE(h.length, 8);
  return Buffer.concat([prefix, h, gzipSync(raw)]);
}

export const checksum = (b: Uint8Array): string => sha256Hex(b);
