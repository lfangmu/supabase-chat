import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? '';

/**
 * Build a Supabase client for use inside Route Handlers (and reusable by the
 * middleware). Reads the session from the incoming request cookies so that
 * `auth.getUser()` resolves the real Supabase Auth identity (a UUID).
 *
 * Writes are a no-op: a Route Handler is stateless with respect to the
 * response — the *browser* client (`createBrowserClient` in `supabase.ts`)
 * owns the session lifecycle and persists the cookie. Realtime RLS then sees
 * the real `auth.uid()` with no extra token minting.
 */
export function createServerSupabase(request: Request): SupabaseClient {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = cookieHeader
    ? cookieHeader
        .split(';')
        .map((pair) => {
          const idx = pair.indexOf('=');
          return { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim() };
        })
        .filter((c) => c.name)
    : [];

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    // 与浏览器客户端保持一致（见 supabase.ts）：否则两端 cookie 名不同，会话读不到。
    cookieOptions: { name: 'sb-app-auth-token' },
    cookies: {
      getAll: () => cookies,
      setAll: () => {
        // Intentionally a no-op — see note above.
      },
    },
  });
}
