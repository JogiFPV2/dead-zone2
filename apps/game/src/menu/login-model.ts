/** Logowanie: error texts and local checks (deadzone-hud-v2-spec „Ekran logowania”), pure. */
import type { AuthErrorCode } from '../account/account-api.js';

export type LoginView = 'login' | 'register' | 'magic' | 'reset';
export type LoginField = 'email' | 'password' | 'password2' | 'captcha' | 'form';

export interface LoginError {
  field: LoginField;
  text: string;
  /** Both e-mail and password fields red (wrong credentials). */
  both?: boolean;
  /** Link after the text. */
  action?: 'resend' | 'to-login';
}

export const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function authErrorText(code: AuthErrorCode, email: string, retryMin = 1): LoginError {
  switch (code) {
    case 'invalid-credentials':
      return { field: 'password', text: 'Nieprawidłowy e-mail lub hasło.', both: true };
    case 'email-not-confirmed':
      return {
        field: 'email',
        text: `Potwierdź adres e-mail. Wysłaliśmy link na ${email}.`,
        action: 'resend',
      };
    case 'captcha-required':
      return { field: 'captcha', text: 'Potwierdź, że nie jesteś robotem.' };
    case 'rate-limited':
      return { field: 'form', text: `Za dużo prób. Spróbuj za ${retryMin} min.` };
    case 'email-taken':
      return {
        field: 'email',
        text: 'Konto z tym e-mailem już istnieje.',
        action: 'to-login',
      };
    case 'weak-password':
      return { field: 'password', text: `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.` };
    case 'invalid-email':
      return { field: 'email', text: 'Wpisz poprawny adres e-mail.' };
    case 'network':
      return { field: 'form', text: 'Brak połączenia z serwerem. Spróbuj ponownie.' };
    case 'not-configured':
      return { field: 'form', text: 'Logowanie nie jest jeszcze dostępne w tej wersji gry.' };
  }
}

export interface LoginInput {
  email: string;
  password: string;
  password2: string;
  captcha: string;
}

/** Checks before any request (the server repeats them). */
export function localCheck(view: LoginView, i: LoginInput): LoginError | undefined {
  if (!EMAIL.test(i.email.trim())) return authErrorText('invalid-email', i.email);
  if (view === 'login' && !i.password) {
    return { field: 'password', text: 'Wpisz hasło.' };
  }
  if (view === 'register') {
    if (i.password.length < MIN_PASSWORD) return authErrorText('weak-password', i.email);
    if (i.password2 !== i.password) return { field: 'password2', text: 'Hasła nie są takie same.' };
  }
  if (!i.captcha) return authErrorText('captcha-required', i.email);
  return undefined;
}
