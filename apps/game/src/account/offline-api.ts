import { OFFLINE, type AccountApi, type AuthResult, type MailResult } from './account-api.js';

const NOT_CONFIGURED: AuthResult & MailResult = { ok: false, code: 'not-configured' };

/**
 * No account (the default): every online call answers `offline`. The menu keeps the local
 * Postacie (IndexedDB) and creator flow exactly as before.
 */
export function createOfflineAccountApi(): AccountApi {
  return {
    mode: 'offline',
    online: false,
    session: () => Promise.resolve(undefined),
    signInWithGoogle: () => Promise.resolve(NOT_CONFIGURED),
    signInWithPassword: () => Promise.resolve(NOT_CONFIGURED),
    signUp: () => Promise.resolve(NOT_CONFIGURED),
    sendMagicLink: () => Promise.resolve(NOT_CONFIGURED),
    sendPasswordReset: () => Promise.resolve(NOT_CONFIGURED),
    resendConfirmation: () => Promise.resolve(NOT_CONFIGURED),
    signOut: () => Promise.resolve(),
    listCharacters: () => Promise.resolve(OFFLINE),
    createCharacter: () => Promise.resolve(OFFLINE),
    deleteCharacter: () => Promise.resolve(OFFLINE),
    putSave: () => Promise.resolve(OFFLINE),
    getSettings: () => Promise.resolve(OFFLINE),
    putSettings: () => Promise.resolve(OFFLINE),
    exportData: () => Promise.resolve(OFFLINE),
    deleteAccount: () => Promise.resolve(OFFLINE),
  };
}
