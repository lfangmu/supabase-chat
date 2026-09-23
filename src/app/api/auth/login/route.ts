import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { verifyPassword, issueSessionToken, hashPassword, needsRehash } from '@/lib/auth';
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
 * POST /api/auth/login
 * body: { nickname, password }
 * 校验昵称+密码，签发会话 cookie。密码错误/用户不存在均返回 401（不暴露具体原因以外的信息）。
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

    if (!nickname || !password) {
      return NextResponse.json({ success: false, message: '请输入昵称和密码' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: userRow } = await supabase
      .from('users')
      .select('nickname, password_hash, avatar, signature, created_at, last_active_at')
      .eq('nickname', nickname)
      .maybeSingle();

    // 用户不存在或未设置密码（旧的无密码昵称行）→ 视为未注册
    if (!userRow || !userRow.password_hash) {
      return NextResponse.json({ success: false, message: '用户不存在或尚未注册' }, { status: 401 });
    }

    let ok = false;
    try {
      ok = await verifyPassword(password, userRow.password_hash);
    } catch (e) {
      // 旧版高迭代哈希（如 310000）在 Cloudflare 上无法验证，给出清晰引导而非 500
      if (e instanceof Error && e.message === 'UNSUPPORTED_PBKDF2_ITERATIONS') {
        return NextResponse.json(
          {
            success: false,
            message:
              '该账号使用旧版加密（迭代 310000），当前线上环境不支持验证。请注册新账号，或用本地脚本 scripts/reset-password.mjs 重设密码后登录。',
          },
          { status: 401 }
        );
      }
      throw e;
    }
    if (!ok) {
      return NextResponse.json({ success: false, message: '密码错误' }, { status: 401 });
    }

    // 透明重哈希：若存储哈希迭代次数与当前不一致（如未来上调），登录成功后自动升级
    if (needsRehash(userRow.password_hash)) {
      try {
        const newHash = await hashPassword(password);
        await supabase.from('users').update({ password_hash: newHash }).eq('nickname', nickname);
      } catch {
        // 重哈希失败不阻断本次登录
      }
    }

    // 刷新活跃时间
    await supabase.from('users').update({ last_active_at: new Date().toISOString() }).eq('nickname', nickname);

    const token = await issueSessionToken(nickname, jwtSecret);
    const res = NextResponse.json({
      success: true,
      user: {
        nickname: userRow.nickname,
        avatar: userRow.avatar,
        signature: userRow.signature,
        created_at: userRow.created_at,
        last_active_at: userRow.last_active_at,
      },
    });
    setSessionCookie(res, token);
    return res;
  } catch {
    return NextResponse.json({ success: false, message: '服务器内部错误' }, { status: 500 });
  }
}
