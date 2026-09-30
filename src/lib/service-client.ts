import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client backed by the Service Role Key.
 *
 * Bypasses RLS — only ever call this from Edge/Node API routes, never from
 * client code.
 *
 * 关键：service role key 缺失时**直接抛错**，而不是静默回退到 anon key。
 * anon key 受 RLS 约束，用它跑「本应绕过 RLS 的特权查询」会导致读写被静默拒绝
 * （403 / 返回空），且极难定位——典型 fail-silent 陷阱。改为 fail-loud：
 * 一旦 SUPABASE_SERVICE_ROLE_KEY 没注入（环境变量误删/改名），接口立即报错暴露根因。
 * 生产环境该 key 经 Cloudflare 环境变量注入；本地 dev 若未配置会明确报错提示配置。
 *
 * Centralised here so the ~16 route handlers no longer each re-declare their
 * own `getClient()` copy.
 */
/**
 * 进程内单例（P3）。
 *
 * 此前每次调用都 `createClient()` —— 一个 route handler 里常常调用 2~4 次
 * （先查权限、再读写、再写审计），每次都重建一整套 fetch/auth/realtime 子系统，
 * 既浪费内存又让 keep-alive 连接无法复用。
 * Edge/Node 运行时里模块作用域在同一个 isolate 内是持久的，缓存一次即可。
 */
let cached: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set — cannot create service client.');
  }
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Refusing to fall back to the anon key ' +
        '(it cannot bypass RLS and would silently break privileged queries). ' +
        'Set SUPABASE_SERVICE_ROLE_KEY in your environment.'
    );
  }
  cached = createClient(url, key);
  return cached;
}
