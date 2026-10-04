import { MAX_ACCOUNT_SAVE_BYTES, MAX_ALIVE_CHARACTERS } from '@deadzone/protocol';
import type {
  AccountApi,
  AccountUser,
  ApiResult,
  AuthResult,
  CharacterList,
  CloudCharacter,
  MailResult,
  RemoteSettings,
  SaveResult,
  ServerSaveInfo,
  SettingsPutResult,
} from './account-api.js';
import { validatePlayerSettings } from '@deadzone/ui/settings';

const MB = 1024 * 1024;

/** How the mock answers `PUT …/save` (session-conflict testing). */
export type MockSaveMode = 'ok' | 'conflict' | 'conflict-bare' | 'gone';

export interface MockAccountOptions {
  /** Answer delay in ms (0 in tests). */
  latencyMs?: number;
  /** Start logged in (`?online=mock&as=google|email`). */
  signedInAs?: 'google' | 'email' | undefined;
  /** Demo characters of the mockup (default) or an empty account. */
  characters?: 'demo' | 'empty';
  save?: MockSaveMode;
  /** `listCharacters` fails like a dead network. */
  failList?: boolean;
  now?: () => number;
}

export const MOCK_EMAIL = 'pawel.rosol@gmail.com';

const at = (now: number, daysAgo: number, h: number, m: number): string => {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const look = (sex: 'female' | 'male', shirt: string, skin: string, hair: string) => ({
  sex,
  portrait: { shirt, skin, hair },
});

/** World of the demo characters (the server copies these from the creation request). */
const DEMO_WORLD = { worldSeed: 4242, worldgenVersion: 4, worldSettings: { map: 'plan-4' } };

/** The account of characters-online.png: 3 living characters and one tombstone. */
export function demoCharacters(now: number): CloudCharacter[] {
  const save = (version: number, mb: number, day: number, updatedAt: string) => ({
    version,
    sizeBytes: Math.round(mb * MB),
    gameDay: day,
    updatedAt,
  });
  return [
    {
      ...DEMO_WORLD,
      id: '6f1c2b1e-0d7a-4f43-9a64-1b2f3c4d5e01',
      name: 'Marta Nowak',
      appearance: look('female', '#4f6d63', '#bf7654', '#3b2924'),
      status: 'alive',
      daysSurvived: 12,
      createdAt: at(now, 9, 18, 0),
      lastPlayedAt: at(now, 0, 19, 52),
      diedAt: null,
      save: save(14, 1.8, 12, at(now, 0, 19, 52)),
      lastLocation: { place: 'Wolnogród', x: 4210, y: 6630, z: 0, day: 12 },
    },
    {
      ...DEMO_WORLD,
      id: '6f1c2b1e-0d7a-4f43-9a64-1b2f3c4d5e02',
      name: 'Jan Kowalski',
      appearance: look('male', '#6c3f35', '#9a684d', '#202326'),
      status: 'alive',
      daysSurvived: 8,
      createdAt: at(now, 6, 20, 0),
      lastPlayedAt: at(now, 1, 22, 10),
      diedAt: null,
      save: save(9, 1.1, 8, at(now, 1, 22, 10)),
      lastLocation: { place: 'Żabno', x: 9020, y: 3110, z: 1, day: 8 },
    },
    {
      ...DEMO_WORLD,
      id: '6f1c2b1e-0d7a-4f43-9a64-1b2f3c4d5e03',
      name: 'Ola Zielińska',
      appearance: look('female', '#b08a3c', '#d18a68', '#c45d38'),
      status: 'alive',
      daysSurvived: 0,
      createdAt: at(now, 0, 8, 10),
      lastPlayedAt: at(now, 0, 8, 14),
      diedAt: null,
      save: save(1, 0.2, 0, at(now, 0, 8, 14)),
      lastLocation: null,
    },
    {
      ...DEMO_WORLD,
      id: '6f1c2b1e-0d7a-4f43-9a64-1b2f3c4d5e04',
      name: 'Piotr Wrona',
      appearance: look('male', '#555b4a', '#b9876a', '#2a2420'),
      status: 'dead',
      daysSurvived: 5,
      createdAt: new Date(2026, 8, 27, 10, 0).toISOString(),
      lastPlayedAt: new Date(2026, 9, 2, 21, 40).toISOString(),
      diedAt: new Date(2026, 9, 2, 21, 41).toISOString(),
      save: null,
      lastLocation: null,
    },
  ];
}

/**
 * In-memory demo account (`?online=mock`): the data of the approved mockups, typical auth
 * errors on demand (password `zle` → wrong password, `limit@…` → rate limit, `niepotwierdzony@…`
 * → unconfirmed e-mail, empty CAPTCHA → captcha error). Nothing leaves the browser.
 */
export function createMockAccountApi(o: MockAccountOptions = {}): AccountApi & {
  /** Test hook: next save answer. */
  setSaveMode(m: MockSaveMode): void;
  setFailList(fail: boolean): void;
} {
  const now = o.now ?? Date.now;
  const latency = o.latencyMs ?? 350;
  let user: AccountUser | undefined;
  let chars: CloudCharacter[] = o.characters === 'empty' ? [] : demoCharacters(now());
  let usedBytes = o.characters === 'empty' ? 0 : 12 * MB;
  let saveMode: MockSaveMode = o.save ?? 'ok';
  let failList = o.failList ?? false;
  let settings: RemoteSettings = { version: 0, settings: null, updatedAt: null };

  const googleUser = (): AccountUser => ({
    id: 'mock-user',
    email: MOCK_EMAIL,
    method: 'google',
    emailConfirmed: true,
    linkedAt: '2026-10-01T09:00:00.000Z',
  });
  const emailUser = (email: string): AccountUser => ({
    id: 'mock-user',
    email,
    method: 'email',
    emailConfirmed: true,
  });
  if (o.signedInAs === 'google') user = googleUser();
  else if (o.signedInAs === 'email') user = emailUser(MOCK_EMAIL);

  const wait = <T>(v: T): Promise<T> =>
    latency > 0 ? new Promise((r) => setTimeout(() => r(v), latency)) : Promise.resolve(v);
  const authed = <T>(v: () => T): Promise<T | { ok: false; reason: 'unauthorized' }> =>
    wait(user ? v() : { ok: false as const, reason: 'unauthorized' as const });

  function mailChecks(email: string, captcha: string): MailResult | undefined {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, code: 'invalid-email' };
    if (!captcha) return { ok: false, code: 'captcha-required' };
    if (email.startsWith('limit@')) return { ok: false, code: 'rate-limited', retryAfterMin: 5 };
    return undefined;
  }
  const usage = (): CharacterList['usage'] => ({
    usedBytes,
    limitBytes: MAX_ACCOUNT_SAVE_BYTES,
    alive: chars.filter((c) => c.status === 'alive').length,
    aliveLimit: MAX_ALIVE_CHARACTERS,
  });

  return {
    mode: 'mock',
    online: true,
    // Jan Kowalski's autosave is still uploading (characters-online.png).
    demoSync:
      o.characters === 'empty' || latency === 0 || failList
        ? undefined
        : { ids: ['6f1c2b1e-0d7a-4f43-9a64-1b2f3c4d5e02'], ms: 45_000 },
    setSaveMode(m) {
      saveMode = m;
    },
    setFailList(fail) {
      failList = fail;
    },
    session: () => Promise.resolve(user),
    signInWithGoogle() {
      user = googleUser();
      return wait<AuthResult>({ ok: true, user });
    },
    signInWithPassword(email, password, captcha) {
      const bad = mailChecks(email, captcha);
      if (bad) return wait<AuthResult>(bad as AuthResult);
      if (email.startsWith('niepotwierdzony@')) {
        return wait<AuthResult>({ ok: false, code: 'email-not-confirmed' });
      }
      if (password.length < 1 || password === 'zle') {
        return wait<AuthResult>({ ok: false, code: 'invalid-credentials' });
      }
      user = emailUser(email);
      return wait<AuthResult>({ ok: true, user });
    },
    signUp(email, password, captcha) {
      const bad = mailChecks(email, captcha);
      if (bad) return wait(bad);
      if (password.length < 8) return wait<MailResult>({ ok: false, code: 'weak-password' });
      if (email.toLowerCase() === MOCK_EMAIL)
        return wait<MailResult>({ ok: false, code: 'email-taken' });
      return wait<MailResult>({ ok: true });
    },
    sendMagicLink: (email, captcha) => wait(mailChecks(email, captcha) ?? { ok: true }),
    sendPasswordReset: (email, captcha) => wait(mailChecks(email, captcha) ?? { ok: true }),
    resendConfirmation: (email, captcha) => wait(mailChecks(email, captcha) ?? { ok: true }),
    signOut() {
      user = undefined;
      return wait(undefined);
    },
    listCharacters() {
      if (failList) return wait({ ok: false as const, reason: 'network' as const });
      return authed<ApiResult<CharacterList>>(() => ({
        ok: true,
        characters: chars.map((c) => ({ ...c })),
        usage: usage(),
      }));
    },
    createCharacter(n) {
      return authed<ApiResult<{ character: CloudCharacter }>>(() => {
        if (usage().alive >= MAX_ALIVE_CHARACTERS) {
          return { ok: false, reason: 'error', status: 409, code: 'alive_character_limit' };
        }
        const t = new Date(now()).toISOString();
        const character: CloudCharacter = {
          ...DEMO_WORLD,
          worldSettings: n.worldSettings,
          id: `mock-${chars.length + 1}-${Math.floor(now())}`,
          name: n.name,
          appearance: n.appearance,
          status: 'alive',
          daysSurvived: 0,
          createdAt: t,
          lastPlayedAt: t,
          diedAt: null,
          save: null,
          lastLocation: null,
        };
        chars = [character, ...chars];
        return { ok: true, character };
      });
    },
    deleteCharacter(id) {
      return authed<ApiResult<object>>(() => {
        const c = chars.find((x) => x.id === id);
        if (c?.save) usedBytes = Math.max(0, usedBytes - c.save.sizeBytes);
        chars = chars.filter((x) => x.id !== id);
        return { ok: true };
      });
    },
    putSave(id, ifMatch, s) {
      return authed<SaveResult>(() => {
        const c = chars.find((x) => x.id === id);
        if (!c || c.status === 'dead' || saveMode === 'gone') return { ok: false, reason: 'gone' };
        const current = c.save?.version ?? 0;
        if (saveMode === 'conflict' || saveMode === 'conflict-bare' || current !== ifMatch) {
          const server: ServerSaveInfo | undefined =
            saveMode === 'conflict-bare'
              ? undefined
              : {
                  version: current + 1,
                  day: 14,
                  minuteOfDay: 11 * 60 + 4,
                  savedAt: at(now(), 0, 11, 4),
                };
          return { ok: false, reason: 'conflict', server };
        }
        const version = current + 1;
        c.save = {
          version,
          sizeBytes: s.bytes.length,
          gameDay: c.save?.gameDay ?? 0,
          updatedAt: new Date(now()).toISOString(),
        };
        return { ok: true, version, sizeBytes: s.bytes.length };
      });
    },
    getSettings: () => authed<ApiResult<RemoteSettings>>(() => ({ ok: true, ...settings })),
    putSettings(value, ifMatch) {
      return authed<SettingsPutResult>(() => {
        // Same rules as Serwer #164: 412 stale If-Match, 413 / 422 from `validatePlayerSettings`.
        if (ifMatch !== settings.version) return { ok: false, reason: 'conflict' };
        const v = validatePlayerSettings(value);
        if (!v.ok) {
          return v.reason === 'too-large'
            ? { ok: false, reason: 'too-large' }
            : {
                ok: false,
                reason: 'invalid',
                issues: v.issues.map((i) => ({
                  path: i.path.map((k) => (typeof k === 'number' ? k : String(k))),
                  code: i.code,
                  message: i.message,
                })),
              };
        }
        settings = {
          version: settings.version + 1,
          settings: v.data,
          updatedAt: new Date(now()).toISOString(),
        };
        return { ok: true, ...settings };
      });
    },
    exportData() {
      return authed<ApiResult<{ data: unknown }>>(() => ({
        ok: true,
        data: {
          exportedAt: new Date(now()).toISOString(),
          account: user,
          characters: chars,
          settings: settings.settings,
        },
      }));
    },
    deleteAccount() {
      return authed<ApiResult<object>>(() => {
        user = undefined;
        chars = [];
        usedBytes = 0;
        return { ok: true };
      });
    },
  };
}
