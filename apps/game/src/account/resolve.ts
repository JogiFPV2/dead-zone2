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
 * - a configured server (`apiUrl` + `auth`) → `/v1` over HTTP;
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
  if (q.get('online') !== 'off' && config.apiUrl && config.auth) {
    return createHttpAccountApi({ baseUrl: config.apiUrl, auth: config.auth });
  }
  return createOfflineAccountApi();
}
