import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';

export const runtime = 'edge';

/**
 * GET /api/me
 * 返回当前 Supabase Auth 会话对应的用户资料（展示名 / 头像 / 角色等）。
 * 未携带有效会话时由 middleware 拦截返回 401，这里只做资料读取与活跃时间刷新。
 */
export async function GET(request: Request) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未认证' }, { status: 401 });
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('users')
      .select('id, display_name, avatar, signature, role, created_at, last_active_at')
      .eq('id', actor)
      .maybeSingle();

    // 刷新活跃时间（best-effort）
    supabase
      .from('users')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', actor)
      .then(() => {}, () => {});

    if (error) {
      return NextResponse.json({ success: false, message: '资料读取失败' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 401 });
    }
    return NextResponse.json({ success: true, user: data });
  } catch {
    return NextResponse.json({ success: false, message: '服务器内部错误' }, { status: 500 });
  }
}
