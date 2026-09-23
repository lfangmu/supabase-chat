import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'edge';


export interface UserProfile {
  nickname: string;
  avatar: string | null;
  signature: string;
  created_at: string | null;
  last_active_at: string | null;
}

/**
 * GET /api/users
 *  - ?q=xxx           搜索昵称（返回头像/签名），用于加好友/建群选人
 *  - ?user=xxx        获取单个用户资料
 *  - ?users=a,b,c     批量获取资料（用于消息列表头像映射，最多 100 个）
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const user = searchParams.get('user')?.trim();
    const usersParam = searchParams.get('users')?.trim();

    const supabase = getServiceClient();

    if (usersParam) {
      const list = Array.from(
        new Set(
          usersParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        )
      ).slice(0, 100);
      if (list.length === 0) {
        return NextResponse.json({ success: true, users: [] });
      }
      const { data, error } = await supabase
        .from('users')
        .select('nickname, avatar, signature, created_at, last_active_at')
        .in('nickname', list);
      if (error) {
        return NextResponse.json({ success: false, message: '查询失败' }, { status: 500 });
      }
      return NextResponse.json({ success: true, users: (data || []) as UserProfile[] });
    }

    if (user) {
      const { data, error } = await supabase
        .from('users')
        .select('nickname, avatar, signature, created_at, last_active_at')
        .eq('nickname', user)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ success: false, message: '查询失败' }, { status: 500 });
      }
      return NextResponse.json({ success: true, user: data ?? null });
    }

    if (!q || q.length < 1) {
      return NextResponse.json({ success: true, users: [] });
    }
    if (q.length > 50) {
      return NextResponse.json({ success: false, message: '搜索关键词过长' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('users')
      .select('nickname, avatar, signature, created_at, last_active_at')
      .ilike('nickname', `%${q}%`)
      .order('last_active_at', { ascending: false, nullsFirst: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ success: false, message: '搜索用户失败' }, { status: 500 });
    }
    return NextResponse.json({ success: true, users: (data || []) as UserProfile[] });
  } catch {
    return NextResponse.json({ success: false, message: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * POST /api/users — upsert 自己的用户资料（首次使用/修改头像签名时调用）
 * body: { nickname, avatar?, signature? }
 */
export async function POST(request: NextRequest) {
  try {
    // 只能修改自己的资料（防 IDOR：昵称来自会话，不接受请求体里的他人昵称）
    const actor = await getSessionUser(request.headers.get('cookie'));
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const nickname = (body.nickname as string)?.trim();
    if (!nickname) {
      return NextResponse.json({ success: false, message: '缺少昵称' }, { status: 400 });
    }
    if (nickname !== actor) {
      return NextResponse.json({ success: false, message: '只能修改自己的资料' }, { status: 403 });
    }
    if (nickname.length > 30) {
      return NextResponse.json({ success: false, message: '昵称过长' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const patch: Record<string, unknown> = {
      nickname,
      last_active_at: new Date().toISOString(),
    };
    if (typeof body.avatar === 'string') patch.avatar = body.avatar || null;
    if (typeof body.signature === 'string') patch.signature = body.signature.slice(0, 60);

    const { data, error } = await supabase
      .from('users')
      .upsert(patch, { onConflict: 'nickname' })
      .select('nickname, avatar, signature, created_at, last_active_at')
      .single();

    if (error) {
      return NextResponse.json({ success: false, message: '保存资料失败' }, { status: 500 });
    }
    return NextResponse.json({ success: true, user: data as UserProfile });
  } catch {
    return NextResponse.json({ success: false, message: '服务器内部错误' }, { status: 500 });
  }
}
