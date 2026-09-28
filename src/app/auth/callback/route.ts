import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Cloudflare Pages（next-on-pages）要求所有动态路由跑 Edge Runtime。
export const runtime = 'edge';

// PKCE 回调：Supabase Auth 的邮件验证链接 / 第三方登录会跳回这里，
// 用 URL 里的 ?code= 兑换 session，并把会话 cookie 写回（@supabase/ssr
// 浏览器端下次加载会读这个 cookie，从而自动登录）。
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_KEY!,
      {
        // 与浏览器客户端保持一致（见 supabase.ts）：写回的会话 cookie 名必须和浏览器读的一致。
        cookieOptions: { name: 'sb-app-auth-token' },
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // 从 Server Component 触发 setAll 时会抛错，可忽略
              // （若已配置 middleware 刷新会话则更无影响）。
            }
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // 兑换失败 / 无 code：跳到错误页（见 ./auth-code-error）。
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
