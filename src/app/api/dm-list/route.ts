import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';
import { requireUuidForFilter } from '@/lib/validate';

export const runtime = 'edge';

/** 单页私聊数量（默认）。 */
const DM_PAGE_SIZE = 200;
/** 单页上限（防超大 limit 拉全表）。 */
const DM_MAX_PAGE_SIZE = 500;

/**
 * GET /api/dm-list?before=<ISO>&limit=<n>
 * 返回当前用户的私聊列表（身份以 token 的 actor 为准，忽略请求体/查询里的 user）。
 *
 * P2-10：此前固定 `.limit(100)` 且无分页 —— 私聊超过 100 个时**静默丢失**。
 * 现在支持游标分页（`before` = 上一页最后一行的 `created_at`）并返回 `hasMore`，
 * 客户端可循环取全；单页默认 200、上限 500。
 */
export async function GET(request: NextRequest) {
  try {
    // 只能查自己的私聊列表（防枚举他人私聊关系）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before');
    const limitRaw = parseInt(searchParams.get('limit') || String(DM_PAGE_SIZE), 10);
    const limit = Math.min(
      Math.max(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DM_PAGE_SIZE, 1),
      DM_MAX_PAGE_SIZE
    );

    const supabase = getServiceClient();

    // 私聊房间 id 形如 dm:<uuidA>:<uuidB>，actor 须为其中一方参与者。
    // actor 会被拼进 `.or()` 过滤器表达式，先显式断言 UUID（P3）。
    const uid = requireUuidForFilter(actor);
    const dmPattern1 = `dm:${uid}:%`;
    const dmPattern2 = `dm:%:${uid}`;
    let query = supabase
      .from('rooms')
      .select('*')
      .eq('type', 'dm')
      .or(`id.like.${dmPattern1},id.like.${dmPattern2}`)
      .order('created_at', { ascending: false })
      // 多取一条用于判断是否还有下一页
      .limit(limit + 1);
    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: dmRooms, error } = await query;

    if (error) {
      console.error('获取 DM 列表失败:', error);
      return NextResponse.json(
        { success: false, message: '获取 DM 列表失败' },
        { status: 500 }
      );
    }

    const page = (dmRooms || []).slice(0, limit);
    const hasMore = (dmRooms || []).length > limit;

    // 收集对方 UUID，批量查 display_name（绝不依赖昵称）
    const otherIds = page.map((room: { id: string }) => {
      const parts = room.id.slice(3).split(':');
      return (parts.find((p: string) => p !== actor) || actor) as string;
    });
    const { data: profiles } = await supabase
      .from('users')
      .select('id, display_name')
      .in('id', otherIds);
    const nameMap = new Map<string, string | null>(
      (profiles || []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name])
    );

    // Transform to DMRoom format with participants and otherUser (UUID)
    const rooms = page.map((room: Record<string, unknown>) => {
      const parts = (room.id as string).slice(3).split(':');
      const other = (parts.find((p: string) => p !== actor) || actor) as string;
      const displayName = nameMap.get(other) ?? other;
      return {
        id: room.id as string,
        name: displayName,
        created_by: room.created_by as string,
        created_at: room.created_at as string,
        type: 'dm' as const,
        last_message_at: room.last_message_at ?? null,
        last_message_content: room.last_message_content ?? null,
        last_message_type: room.last_message_type ?? null,
        last_message_user: room.last_message_user ?? null,
        participants: [actor, other] as [string, string],
        otherUser: other,
      };
    });

    const last = rooms[rooms.length - 1];

    return NextResponse.json({
      success: true,
      rooms,
      hasMore,
      nextCursor: hasMore && last ? last.created_at : null,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}
