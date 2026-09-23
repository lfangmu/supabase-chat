import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'edge';


/** GET /api/dm-list?user={nickname} — Get DM rooms for a user */
export async function GET(request: NextRequest) {
  try {
    // 只能查自己的私聊列表（防枚举他人私聊关系）
    const actor = await getSessionUser(request.headers.get('cookie'));
    if (!actor) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }
    const { searchParams } = new URL(request.url);
    const user = searchParams.get('user');

    if (!user) {
      return NextResponse.json(
        { success: false, message: '缺少 user 参数' },
        { status: 400 }
      );
    }

    const trimmedUser = user.trim();
    if (trimmedUser !== actor) {
      return NextResponse.json(
        { success: false, message: '只能查看自己的私聊' },
        { status: 403 }
      );
    }
    const supabase = getServiceClient();

    // Query rooms where type='dm' and user is either creator or the other participant
    // created_by stores the initiator, name stores the other user's nickname
    const { data: dmRooms, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('type', 'dm')
      .or(`created_by.eq.${trimmedUser},name.eq.${trimmedUser}`)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('获取 DM 列表失败:', error);
      return NextResponse.json(
        { success: false, message: '获取 DM 列表失败' },
        { status: 500 }
      );
    }

    // Transform to DMRoom format with participants and otherUser
    const rooms = (dmRooms || []).map((room: Record<string, unknown>) => {
      const createdBy = room.created_by as string;
      const name = room.name as string;
      const otherUser = createdBy === trimmedUser ? name : createdBy;
      return {
        id: room.id as string,
        name: name as string,
        created_by: createdBy,
        created_at: room.created_at as string,
        type: 'dm' as const,
        last_message_at: room.last_message_at ?? null,
        last_message_content: room.last_message_content ?? null,
        last_message_type: room.last_message_type ?? null,
        last_message_user: room.last_message_user ?? null,
        participants: [createdBy, name] as [string, string],
        otherUser,
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
