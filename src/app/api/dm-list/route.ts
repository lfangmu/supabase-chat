import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser, getDisplayName } from '@/lib/auth-user';

export const runtime = 'edge';


/** GET /api/dm-list — Get DM rooms for the current user (identity = UUID) */
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

    const supabase = getServiceClient();

    // 私聊房间 id 形如 dm:<uuidA>:<uuidB>，actor 须为其中一方参与者
    const dmPattern1 = `dm:${actor}:%`;
    const dmPattern2 = `dm:%:${actor}`;
    const { data: dmRooms, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('type', 'dm')
      .or(`id.like.${dmPattern1},id.like.${dmPattern2}`)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('获取 DM 列表失败:', error);
      return NextResponse.json(
        { success: false, message: '获取 DM 列表失败' },
        { status: 500 }
      );
    }

    // 收集对方 UUID，批量查 display_name（绝不依赖昵称）
    const otherIds = (dmRooms || []).map((room: { id: string }) => {
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
    const rooms = (dmRooms || []).map((room: Record<string, unknown>) => {
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

    return NextResponse.json({ success: true, rooms });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}
