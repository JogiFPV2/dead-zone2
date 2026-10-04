import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'k' };

describe('loadConfig', () => {
  it('derives issuer and JWKS from SUPABASE_URL', () => {
    const c = loadConfig(base);
    expect(c.jwtIssuer).toBe('https://x.supabase.co/auth/v1');
    expect(c.jwksUrl).toBe('https://x.supabase.co/auth/v1/.well-known/jwks.json');
    expect(c.limits.maxAliveCharacters).toBe(20);
    expect(c.limits.maxAccountSaveBytes).toBe(50 * 1024 * 1024);
  });

  it('requires secrets from env and never raises product limits', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'https://x' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => loadConfig({ ...base, LIMIT_ALIVE_CHARACTERS: '21' })).toThrow();
    expect(loadConfig({ ...base, LIMIT_ALIVE_CHARACTERS: '5' }).limits.maxAliveCharacters).toBe(5);
  });
});
