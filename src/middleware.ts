import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { extractSession } from '@/lib/auth';
import { checkRateLimit, getRateLimitConfig, getClientIp } from '@/lib/rate-limit';

// 公开的 API 路由（不需要普通聊天会话）
const PUBLIC_API_ROUTES = [
  // 注册 / 登录 / 登出：账号体系的入口，必须免会话
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/logout',
  // 保活端点：供外部 uptime 监控（或本项目 GitHub Actions 定时任务）无 cookie 访问，
  // 用于防止 Supabase 免费项目因长时间无活动被自动暂停。必须公开，否则监控一 ping 就被 401 挡掉。
  '/api/keepalive',
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

  // 管理后台登录/登出端点自身验证密码，无需会话即可访问
  if (pathname.startsWith('/api/admin/verify')) {
    const response = NextResponse.next();
    Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  const jwtSecret = process.env.CHAT_JWT_SECRET;
  if (!jwtSecret) {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      console.warn('[middleware] CHAT_JWT_SECRET 未配置，开发模式下放行所有 API 请求');
      return NextResponse.next();
    }
    return NextResponse.json(
      { success: false, message: '服务器配置错误' },
      { status: 500 }
    );
  }

  const cookieHeader = request.headers.get('cookie');

  // 管理后台受保护路由：始终要求独立的 admin_session（isAdmin:true），不受聊天开关影响
  if (pathname.startsWith('/api/admin/')) {
    const adminSession = await extractSession(cookieHeader, jwtSecret, 'admin_session');
    if (!adminSession.valid || adminSession.payload?.isAdmin !== true) {
      return NextResponse.json(
        { success: false, message: '未认证的管理员会话，请先登录管理后台' },
        { status: 401 }
      );
    }
    const response = NextResponse.next();
    Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  // 公开路由无需认证
  if (PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route))) {
    const response = NextResponse.next();
    Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  // 普通聊天会话 JWT 验证（注册/登录体系下，只有通过账号登录才能拿到会话）
  const session = await extractSession(cookieHeader, jwtSecret);
  if (!session.valid) {
    return NextResponse.json(
      { success: false, message: '未认证，请先登录' },
      { status: 401 }
    );
  }

  const response = NextResponse.next();
  Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
