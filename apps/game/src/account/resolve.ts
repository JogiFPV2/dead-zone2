import type { AccountApi } from './account-api.js';
import { createHttpAccountApi, type AuthProvider } from './http-api.js';
import { createMockAccountApi, type MockSaveMode } from './mock-api.js';
import { createOfflineAccountApi } from './offline-api.js';

/** A configured server: API base URL and the sign-in provider (both needed). */
export interface AccountConfig {
  apiUrl?: string | undefined;
  auth?: AuthProvider | undefined;
}

const SAVE_MODES: readonly MockSaveMode[] = [
  'ok',
  'conflict',
  'conflict-nominute',
  'conflict-bare',
  'gone',
];

/**
 * Which account API the page uses:
 * - `?online=mock` → demo account in memory (review / screenshots; any build, nothing is sent).
 *   Extra params: `as=google|email` (start logged in), `chars=empty`, `save=conflict|
 *   conflict-nominute|conflict-bare|gone`, `net=down` (Postacie fails like a lost connection).
 * - `?online=1` with a configured server (`apiUrl` + `auth`, from the build's vite env) →
 *   `/v1` over HTTP. Opt-in while the server is rolled out; the default switches once the API
 *   answers (then `?online=0` will keep a page offline);
 * - otherwise offline: no account, local saves only (today's behaviour).
 */
export function resolveAccountApi(search: string, config: AccountConfig = {}): AccountApi {
  const q = new URLSearchParams(search);
  if (q.get('online') === 'mock') {
    const as = q.get('as');
    const save = q.get('save') as MockSaveMode | null;
    return createMockAccountApi({
      signedInAs: as === 'google' || as === 'email' ? as : undefined,
      characters: q.get('chars') === 'empty' ? 'empty' : 'demo',
      save: save && SAVE_MODES.includes(save) ? save : 'ok',
      failList: q.get('net') === 'down',
    });
  }
  if (q.get('online') === '1' && config.apiUrl && config.auth) {
    return createHttpAccountApi({ baseUrl: config.apiUrl, auth: config.auth });
  }
  return createOfflineAccountApi();
}

/** The page's account config: the build's online config with Supabase Auth (lazy). */
export async function pageAccountConfig(search: string): Promise<AccountConfig> {
  if (new URLSearchParams(search).get('online') !== '1') return {};
  const { buildOnlineConfig } = await import('./config.js');
  const c = buildOnlineConfig();
  if (!c) return {};
  const { createSupabaseAuth } = await import('./supabase-auth.js');
  return { apiUrl: c.apiUrl, auth: createSupabaseAuth({ url: c.supabaseUrl, key: c.supabaseKey }) };
}
