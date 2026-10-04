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
    expect(c.limits.maxSavesPerHour).toBe(120);
    expect(c.limits.maxUploadBytesPerDay).toBe(200 * 1024 * 1024);
    expect(c.limits.maxIpRequestsPer5Min).toBe(300);
    expect(c.limits.maxExportsPerHour).toBe(5);
    expect(c.trustProxyHops).toBe(0);
    expect(c.saveFormatVersion).toBe(3);
    expect(() => loadConfig({ ...base, SAVE_FORMAT_VERSION: '4' })).toThrow();
  });

  it('requires secrets from env and never raises product limits', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'https://x' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => loadConfig({ ...base, LIMIT_ALIVE_CHARACTERS: '21' })).toThrow();
    expect(loadConfig({ ...base, LIMIT_ALIVE_CHARACTERS: '5' }).limits.maxAliveCharacters).toBe(5);
    expect(() => loadConfig({ ...base, LIMIT_SAVES_PER_HOUR: '121' })).toThrow();
    expect(() => loadConfig({ ...base, LIMIT_IP_REQUESTS_PER_5_MIN: '301' })).toThrow();
    expect(() => loadConfig({ ...base, LIMIT_EXPORTS_PER_HOUR: '6' })).toThrow();
    expect(loadConfig({ ...base, LIMIT_SAVES_PER_HOUR: '30' }).limits.maxSavesPerHour).toBe(30);
  });

  it('validation workers: defaults and a heap cap big enough for the state limit', () => {
    const c = loadConfig(base);
    expect(c.validation).toEqual({ workers: 0, timeoutMs: 5000, maxHeapMb: 512 });
    expect(() => loadConfig({ ...base, VALIDATION_HEAP_MB: '128' })).toThrow(/VALIDATION_HEAP_MB/);
    expect(
      loadConfig({ ...base, VALIDATION_HEAP_MB: '128', LIMIT_STATE_BYTES: '16777216' }).validation
        .maxHeapMb,
    ).toBe(128);
  });
});
