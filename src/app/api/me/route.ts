import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { extractSession } from '@/lib/auth';

export const runtime = 'edge';


/**
 * GET /api/me
 * 返回当前会话对应的用户资料，供前端探测登录态与获取身份。
 * 未携带有效会话 cookie 时由 middleware 拦截返回 401，无需在此再判。
 */
export async function GET(request: Request) {
  try {
    const jwtSecret = (process.env.CHAT_JWT_SECRET ?? '').trim();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, message: '服务器配置错误' }, { status: 500 });
    }
    const session = await extractSession(request.headers.get('cookie'), jwtSecret);
    if (!session.valid || !session.payload?.nickname) {
      return NextResponse.json({ success: false, message: '未认证' }, { status: 401 });
    }
    const nickname = session.payload.nickname as string;

    const supabase = getServiceClient();
    const { data } = await supabase
      .from('users')
      .select('nickname, avatar, signature, created_at, last_active_at')
      .eq('nickname', nickname)
      .maybeSingle();

    // 刷新活跃时间（best-effort）
    supabase.from('users').update({ last_active_at: new Date().toISOString() }).eq('nickname', nickname).then(
      () => {},
      () => {}
    );

    if (!data) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 401 });
    }
    return NextResponse.json({ success: true, user: data });
  } catch {
    return NextResponse.json({ success: false, message: '服务器内部错误' }, { status: 500 });
  }
}
