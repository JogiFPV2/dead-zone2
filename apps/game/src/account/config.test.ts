import { describe, expect, it } from 'vitest';
import { onlineConfigOf } from './config.js';
import { pageAccountConfig } from './resolve.js';

describe('online config (vite env)', () => {
  it('needs all three public values with http(s) URLs', () => {
    const env = {
      VITE_API_URL: 'https://p.supabase.co/functions/v1/api',
      VITE_SUPABASE_URL: 'https://p.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_x',
    };
    expect(onlineConfigOf(env)).toEqual({
      apiUrl: 'https://p.supabase.co/functions/v1/api',
      supabaseUrl: 'https://p.supabase.co',
      supabaseKey: 'sb_publishable_x',
    });
    expect(onlineConfigOf({ ...env, VITE_SUPABASE_ANON_KEY: '' })).toBeUndefined();
    expect(onlineConfigOf({ ...env, VITE_API_URL: 'ftp://x' })).toBeUndefined();
  });

  it('a page without ?online=1 loads no auth at all', async () => {
    expect(await pageAccountConfig('')).toEqual({});
    expect(await pageAccountConfig('?online=mock')).toEqual({});
  });
});
