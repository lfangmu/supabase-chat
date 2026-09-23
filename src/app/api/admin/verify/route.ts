import { NextRequest, NextResponse } from 'next/server';
import { signJwt, timingSafeEqual } from '@/lib/auth';
import { AUTH_CONFIG } from '@/config';
import { getClientIp } from '@/lib/rate-limit';

// Simple in-memory rate limiting (Edge-compatible)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10;         // max attempts per window

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count++;
  return true;
}

let lastCleanup = Date.now();
function cleanupRateLimit() {
  const now = Date.now();
  if (now - lastCleanup > 300_000) { // every 5 min
    const entries = Array.from(rateLimitMap.entries());
    for (const [ip, entry] of entries) {
      if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
    lastCleanup = now;
  }
}

// 超级密码支持多个候选变量名，按顺序取第一个非空值生效。
// 首选 ADMIN_PASSWORD（Cloudflare Pages 上新增变量注入最稳定），备选 SUPER_PASSWORD / CHAT_SUPER_PASSWORD。
const SUPER_PASSWORD_CANDIDATES = ['ADMIN_PASSWORD', 'SUPER_PASSWORD', 'CHAT_SUPER_PASSWORD'];

function resolveAdminPassword(): string {
  return (
    SUPER_PASSWORD_CANDIDATES.map((k) => (process.env[k] ?? '').trim()).find((v) => v.length > 0) ?? ''
  );
}

/**
 * POST /api/admin/verify — 管理后台登录。
 *
 * 认 ADMIN_PASSWORD（或备选变量），成功后签发独立的 admin_session cookie（isAdmin:true）。
 * 与普通聊天会话 chat_session 物理隔离：两者互不影响，各自登出。
 * 无论聊天门禁开关（CHAT_AUTH_ENABLED）是否关闭，管理后台始终要求密码。
 */
export async function POST(request: NextRequest) {
  try {
    // 用 CF-Connecting-IP / X-Forwarded-For 取真实客户端 IP（Edge 下 request.ip 不可靠）。
    // 注意：本限流为单实例内存实现，Cloudflare Pages 多实例部署时非全局生效。
    const ip = getClientIp(request);

    cleanupRateLimit();

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { success: false, message: '请求过于频繁，请稍后再试' },
        { status: 429 }
      );
    }

    const { password } = await request.json();
    const adminPassword = resolveAdminPassword();
    const jwtSecret = (process.env.CHAT_JWT_SECRET ?? '').trim();

    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, message: '服务器配置错误：未配置 CHAT_JWT_SECRET' },
        { status: 500 }
      );
    }

    if (!adminPassword) {
      return NextResponse.json(
        { success: false, message: '服务器未配置管理员密码（ADMIN_PASSWORD）' },
        { status: 500 }
      );
    }

    if (typeof password !== 'string' || password.length > 256) {
      return NextResponse.json(
        { success: false, message: '密码格式错误' },
        { status: 400 }
      );
    }

    if (!password.trim()) {
      return NextResponse.json(
        { success: false, message: '密码不能为空' },
        { status: 400 }
      );
    }

    if (!timingSafeEqual(password, adminPassword)) {
      return NextResponse.json(
        { success: false, message: '管理员密码错误' },
        { status: 401 }
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        authenticated: true,
        isAdmin: true,
        iat: now,
        exp: now + AUTH_CONFIG.JWT_EXPIRY,
      },
      jwtSecret
    );

    const response = NextResponse.json({ success: true });
    response.cookies.set('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: AUTH_CONFIG.JWT_EXPIRY,
      path: '/',
    });

    return response;
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}

/** DELETE /api/admin/verify — 管理后台登出，清除 admin_session cookie。 */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export const runtime = 'edge';
