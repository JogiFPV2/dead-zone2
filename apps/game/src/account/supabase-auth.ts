import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js';
import type { AccountUser, AuthErrorCode, AuthResult, MailResult } from './account-api.js';
import type { AuthProvider } from './http-api.js';

/**
 * Sign-in through Supabase Auth (e-mail + password, magic link, Google OAuth). The supabase-js
 * client is created lazily, so offline builds never load it. The session (and its refresh) is
 * kept by supabase-js in localStorage; `accessToken()` is the bearer of `/v1` calls.
 */
export interface SupabaseAuthOptions {
  url: string;
  /** Publishable (anon) key: public, rate-limited by Supabase. */
  key: string;
  /** Where e-mail links and the Google redirect come back (default: this page without query). */
  redirectTo?: string;
  /** Injectable client (tests). */
  client?: Pick<SupabaseClient, 'auth'>;
}

/** Supabase error → the screens' error codes. */
export function authCodeOf(
  e: Pick<AuthError, 'code' | 'status' | 'message'> | null,
): AuthErrorCode {
  const c = e?.code ?? '';
  if (c === 'invalid_credentials') return 'invalid-credentials';
  if (c === 'email_not_confirmed') return 'email-not-confirmed';
  if (c === 'captcha_failed') return 'captcha-required';
  if (c.startsWith('over_') || e?.status === 429) return 'rate-limited';
  if (c === 'user_already_exists' || c === 'email_exists') return 'email-taken';
  if (c === 'weak_password') return 'weak-password';
  if (c === 'email_address_invalid' || c === 'validation_failed') return 'invalid-email';
  if (c === 'email_provider_disabled' || c === 'provider_disabled' || c === 'signup_disabled') {
    return 'not-configured';
  }
  return 'network';
}

/** Supabase user → the account card. */
export function accountUserOf(u: User): AccountUser {
  const provider = u.app_metadata?.provider;
  const method = provider === 'google' ? 'google' : 'email';
  const avatar = (u.user_metadata as Record<string, unknown> | undefined)?.avatar_url;
  const identity = u.identities?.find((i) => i.provider === provider);
  return {
    id: u.id,
    email: u.email ?? '',
    method,
    emailConfirmed: !!u.email_confirmed_at,
    avatarUrl: typeof avatar === 'string' && avatar.startsWith('https://') ? avatar : undefined,
    linkedAt: identity?.created_at ?? u.created_at,
  };
}

const failAuth = (e: AuthError): AuthResult => ({ ok: false, code: authCodeOf(e) });
const failMail = (e: AuthError): MailResult => ({ ok: false, code: authCodeOf(e) });
const captcha = (t: string): { captchaToken?: string } => (t ? { captchaToken: t } : {});

export function createSupabaseAuth(o: SupabaseAuthOptions): AuthProvider {
  let client: Promise<Pick<SupabaseClient, 'auth'>> | undefined = o.client
    ? Promise.resolve(o.client)
    : undefined;
  const sb = (): Promise<Pick<SupabaseClient, 'auth'>> =>
    (client ??= import('@supabase/supabase-js').then((m) =>
      m.createClient(o.url, o.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }),
    ));
  const redirectTo = (): string =>
    o.redirectTo ?? `${window.location.origin}${window.location.pathname}?online=1`;

  return {
    async session() {
      const { data } = await (await sb()).auth.getSession();
      return data.session ? accountUserOf(data.session.user) : undefined;
    },
    async accessToken() {
      const { data } = await (await sb()).auth.getSession();
      return data.session?.access_token;
    },
    async signInWithGoogle() {
      const { error } = await (
        await sb()
      ).auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectTo() },
      });
      // Success leaves the page (redirect); only errors resolve here.
      return error ? failAuth(error) : { ok: false, code: 'network' };
    },
    async signInWithPassword(email, password, captchaToken) {
      const { data, error } = await (
        await sb()
      ).auth.signInWithPassword({
        email,
        password,
        options: captcha(captchaToken),
      });
      if (error) return failAuth(error);
      return { ok: true, user: accountUserOf(data.user) };
    },
    async signUp(email, password, captchaToken) {
      const { error } = await (
        await sb()
      ).auth.signUp({
        email,
        password,
        options: { ...captcha(captchaToken), emailRedirectTo: redirectTo() },
      });
      return error ? failMail(error) : { ok: true };
    },
    async sendMagicLink(email, captchaToken) {
      const { error } = await (
        await sb()
      ).auth.signInWithOtp({
        email,
        options: {
          ...captcha(captchaToken),
          emailRedirectTo: redirectTo(),
          shouldCreateUser: false,
        },
      });
      return error ? failMail(error) : { ok: true };
    },
    async sendPasswordReset(email, captchaToken) {
      const { error } = await (
        await sb()
      ).auth.resetPasswordForEmail(email, {
        ...captcha(captchaToken),
        redirectTo: redirectTo(),
      });
      return error ? failMail(error) : { ok: true };
    },
    async resendConfirmation(email, captchaToken) {
      const { error } = await (
        await sb()
      ).auth.resend({
        type: 'signup',
        email,
        options: { ...captcha(captchaToken), emailRedirectTo: redirectTo() },
      });
      return error ? failMail(error) : { ok: true };
    },
    async signOut() {
      await (await sb()).auth.signOut();
    },
  };
}
