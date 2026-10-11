import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { HttpError } from './errors.js';

/** Authenticated caller; `userId` always comes from the token, never from the body. */
export interface AuthUser {
  userId: string;
}

export interface TokenVerifier {
  /** Resolves the user of a valid access token, rejects otherwise. */
  verify(token: string): Promise<AuthUser>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JwtVerifierOptions {
  issuer: string;
  audience: string;
  /** Key set; production uses the project's JWKS (asymmetric signing keys, docs §2.1). */
  keys: JWTVerifyGetKey;
}

/**
 * Verifies Supabase access tokens locally (signature, issuer, audience, expiry). Email OTP and
 * Google sign-in both end in the same Supabase session JWT, so the server needs no provider code.
 */
export function createJwtVerifier(opts: JwtVerifierOptions): TokenVerifier {
  return {
    async verify(token) {
      let sub: unknown;
      let role: unknown;
      try {
        const { payload } = await jwtVerify(token, opts.keys, {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: ['ES256', 'RS256', 'EdDSA'],
        });
        sub = payload.sub;
        role = payload.role;
      } catch {
        throw new HttpError(401, 'unauthorized', 'invalid or expired token');
      }
      if (typeof sub !== 'string' || !UUID.test(sub) || role !== 'authenticated') {
        throw new HttpError(401, 'unauthorized', 'token is not a signed-in user');
      }
      return { userId: sub.toLowerCase() };
    },
  };
}

export function createJwksVerifier(
  jwksUrl: string,
  issuer: string,
  audience: string,
): TokenVerifier {
  return createJwtVerifier({ issuer, audience, keys: createRemoteJWKSet(new URL(jwksUrl)) });
}

/** Reads `Authorization: Bearer <jwt>` and verifies it. */
export async function authenticate(
  header: string | undefined,
  verifier: TokenVerifier,
): Promise<AuthUser> {
  const m = typeof header === 'string' ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(header) : null;
  if (!m?.[1]) throw new HttpError(401, 'unauthorized', 'missing bearer token');
  return verifier.verify(m[1]);
}
