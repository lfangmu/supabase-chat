import { NextResponse } from 'next/server';
import { AUTH_CONFIG } from '@/config';

export const runtime = 'edge';

/**
 * POST /api/auth/logout
 * 清除聊天会话 cookie。放在公开路由，未登录时调用也安全（只是清掉空 cookie）。
 */
export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(AUTH_CONFIG.SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return res;
}
