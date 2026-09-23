import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { hashPassword, issueSessionToken } from '@/lib/auth';
import { AUTH_CONFIG } from '@/config';

export const runtime = 'edge';


function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(AUTH_CONFIG.SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: AUTH_CONFIG.JWT_EXPIRY,
    path: '/',
  });
}

/**
 * POST /api/auth/register
 * body: { nickname, password }
 * 注册新账号：昵称唯一（users 主键），密码 PBKDF2 哈希存储，签发会话 cookie。
 */
export async function POST(request: NextRequest) {
  try {
    const jwtSecret = (process.env.CHAT_JWT_SECRET ?? '').trim();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, message: '服务器配置错误：未配置 CHAT_JWT_SECRET' }, { status: 500 });
    }

    const body = await request.json();
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (nickname.length < 2 || nickname.length > 30) {
      return NextResponse.json({ success: false, message: '昵称需 2-30 个字符' }, { status: 400 });
    }
    if (password.length < 6 || password.length > 128) {
      return NextResponse.json({ success: false, message: '密码需 6-128 个字符' }, { status: 400 });
    }

    const supabase = getServiceClient();

    // 昵称是否已被注册
    const { data: existing } = await supabase
      .from('users')
      .select('nickname, password_hash')
      .eq('nickname', nickname)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ success: false, message: '该昵称已被注册' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const { data, error } = await supabase
      .from('users')
      .insert({
        nickname,
        password_hash: passwordHash,
        signature: '',
        created_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      })
      .select('nickname, avatar, signature, created_at, last_active_at')
      .maybeSingle();

    if (error) {
      console.error('[REGISTER_INSERT_ERROR]', error.message, error.details, error.hint, error.code);
      return NextResponse.json({ success: false, message: '注册失败，请稍后重试' }, { status: 500 });
    }
    if (!data) {
      console.error('[REGISTER_INSERT_NO_DATA]');
      return NextResponse.json({ success: false, message: '注册失败，未返回用户数据' }, { status: 500 });
    }

    const token = await issueSessionToken(nickname, jwtSecret);
    const res = NextResponse.json({ success: true, user: data });
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const stack = err instanceof Error ? err.stack : '';
    console.error('[REGISTER_ERROR]', detail, stack);
    console.error('[REGISTER_ENV]', {
      hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasAnon: !!process.env.NEXT_PUBLIC_SUPABASE_KEY,
      hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasJwtSecret: !!process.env.CHAT_JWT_SECRET,
    });
    // 临时暴露具体错误以便生产环境诊断；定位后可改回通用提示
    return NextResponse.json(
      { success: false, message: `服务器内部错误: ${detail}` },
      { status: 500 }
    );
  }
}
