import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { checkRateLimit, getRateLimitConfig, getClientIp } from '@/lib/rate-limit';

// 公开 API 路由（不需要已登录的 Supabase Auth 会话）
const PUBLIC_API_ROUTES = [
  // 保活端点：供外部 uptime 监控无 cookie 访问，防止 Supabase 免费项目因长时间无活动被暂停
  '/api/keepalive',
  // 同源反向代理的「透传」路由（REST / Auth / Storage / Realtime）。
  // 它们是透明代理：真正的鉴权由上游 Supabase 依据请求里携带的 apikey / Authorization 完成
  // （PostgREST 的 RLS、GoTrue 自身校验），代理侧不注入任何特权密钥，故放行是安全的。
  // ⚠️ /api/auth/v1 必须放行：注册 / 登录 / 找回密码 / OTP 这些流程发生时，用户「本来就还没有会话」，
  // 若被 middleware 的登录校验拦截，就会出现「注册时报 401：未认证，请先登录」。
  '/api/auth/v1',
  '/api/rest/v1',
  '/api/storage/v1',
  '/api/realtime',
  // 诊断端点：仅暴露 build / 目标 host / sameOrigin，无敏感信息（项目 ref 本就内联在客户端）。
  '/api/health',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 只处理 API 路由
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // ===== 限流检查（在认证之前，防止暴力破解消耗资源） =====
  const ip = getClientIp(request);
  const rateLimitConfig = getRateLimitConfig(pathname);
  const rateKey = `${ip}:${pathname}`;
  const { limited, remaining, resetTime } = checkRateLimit(rateKey, rateLimitConfig);

  const rateLimitHeaders = {
    'X-RateLimit-Limit': String(rateLimitConfig.max),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(Math.ceil(resetTime / 1000)),
  };

  if (limited) {
    return NextResponse.json(
      { success: false, message: '请求过于频繁，请稍后再试' },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders,
          'Retry-After': String(Math.ceil((resetTime - Date.now()) / 1000)),
        },
      }
    );
  }

  // 公开路由无需认证
  if (PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route))) {
    const response = NextResponse.next();
    Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  // ===== Supabase Auth 会话校验 =====
  // 用 @supabase/ssr 从请求 cookie 读取会话；getUser() 会验签，拿到真实的 auth.uid()。
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_KEY ?? '',
    {
      // 与浏览器客户端保持一致（见 supabase.ts）：否则两端 cookie 名不同，会话读不到。
      cookieOptions: { name: 'sb-app-auth-token' },
      cookies: {
        getAll() {
          return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json(
      { success: false, message: '未认证，请先登录' },
      { status: 401 }
    );
  }

  // 管理后台受保护路由：额外校验 users.role = 'admin'
  if (pathname.startsWith('/api/admin/')) {
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile || profile.role !== 'admin') {
      return NextResponse.json(
        { success: false, message: '未认证的管理员会话' },
        { status: 403 }
      );
    }
  }

  Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
