/**
 * Online configuration of the build (vite env, all public values; nothing secret ships here):
 * - `VITE_API_URL`: base of the `/v1` API (Supabase Edge Function `…/functions/v1/api`);
 * - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: Supabase Auth (publishable key).
 * Missing values = the game stays offline. While the server is being rolled out the real API is
 * opt-in with `?online=1` (account/resolve.ts); `?online=mock` stays the in-memory demo.
 */
export interface OnlineConfig {
  apiUrl: string;
  supabaseUrl: string;
  supabaseKey: string;
}

type Env = Partial<
  Record<'VITE_API_URL' | 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY', unknown>
>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** All three values, or undefined (offline build). */
export function onlineConfigOf(env: Env): OnlineConfig | undefined {
  const apiUrl = str(env.VITE_API_URL);
  const supabaseUrl = str(env.VITE_SUPABASE_URL);
  const supabaseKey = str(env.VITE_SUPABASE_ANON_KEY);
  if (!apiUrl || !supabaseUrl || !supabaseKey) return undefined;
  if (!/^https?:\/\//.test(apiUrl) || !/^https?:\/\//.test(supabaseUrl)) return undefined;
  return { apiUrl, supabaseUrl, supabaseKey };
}

/** The page's build config (`import.meta.env`). */
export const buildOnlineConfig = (): OnlineConfig | undefined =>
  onlineConfigOf(import.meta.env as Env);
