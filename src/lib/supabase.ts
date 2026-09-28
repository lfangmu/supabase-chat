import { createBrowserClient } from '@supabase/ssr';

// 浏览器侧连接地址：优先用「代理域名」NEXT_PUBLIC_SUPABASE_PROXY_URL（如 https://supabase.your-domain.com），
// 由 Cloudflare Worker 转发到真实 Supabase 项目，从而绕过国内对 *.supabase.co 的网络层拦截（墙）；
// 若该变量未配置，则回退直连 NEXT_PUBLIC_SUPABASE_URL（真实项目地址）——适用于本地 dev 网络能直连 supabase.co 的场景。
// 服务端客户端（supabase-server.ts / service-client.ts 等）始终用 NEXT_PUBLIC_SUPABASE_URL 直连真实项目地址，二者解耦。
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_PROXY_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? '';

// Browser Supabase client.
//
// After the Supabase Auth migration this client:
//   * owns the auth session (persisted to a cookie via @supabase/ssr),
//   * provides the real `auth.uid()` for postgres_changes (Realtime) RLS —
//     no more `/api/realtime-token` minting a nickname-masquerading JWT.
//
// `persistSession` MUST stay enabled so the session cookie survives reloads and
// Realtime subscriptions don't drop on refresh.
//
// ⚠️ 千万不要在这里加顶层 `accessToken` 选项！
// supabase-js 一旦检测到顶层 `accessToken`（那是给「第三方鉴权」用的，如 Clerk / Auth0），
// 就会把 `client.auth` 换成一个「访问任何属性都抛错」的 Proxy：
//   this.auth = new Proxy({}, { get: () => { throw new Error(
//     '...accessing supabase.auth.<x> is not possible') } })
// 后果：`supabase.auth.signUp / signInWithPassword / signInAnonymously` 会在**发出任何网络请求之前**
// 直接抛异常，被 UI 的 catch 吞成笼统的「网络错误」，而 DevTools Network 面板里**看不到任何请求**，
// 极难排查（2026-09 线上注册一直报「网络错误」的真凶就是这个）。
//
// 「Realtime 每次（重）连都能拿到最新 token」不需要这个选项 —— 不配它时由 supabase-js 原生完成：
//   * `_listenForAuthEvents()` 在 SIGNED_IN / TOKEN_REFRESHED 时自动调用 `realtime.setAuth(token)`；
//   * RealtimeClient 的 accessToken 回调走 `_getAccessToken()`，在未配顶层 accessToken 时回退到
//     `await auth.getSession()` 取**最新**会话 token（见 supabase-js 的 SupabaseClient.ts）。
// 所以这里只保留 `realtime` 参数即可，两件事都能满足。
export const supabase =
  supabaseUrl && supabaseKey
    ? createBrowserClient(supabaseUrl, supabaseKey, {
        // 显式固定会话 cookie 名：浏览器走代理域名、服务端走真实域名，
        // 两者默认会按 URL 首段推导不同 cookie 名导致会话对不上 → 固定为同一个。
        cookieOptions: { name: 'sb-app-auth-token' },
        // Realtime 上游推送频率上限；token 由上面的原生机制同步，无需 accessToken 选项。
        realtime: {
          params: { eventsPerSecond: 10 },
        },
      })
    : null;
