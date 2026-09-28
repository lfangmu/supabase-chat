import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';

export const runtime = 'edge';


/**
 * POST /api/messages/read — 标记消息已读（持久化）
 * body: { roomId, user, messageIds: string[] }
 * 只记录「他人发来的消息」被当前用户已读；自己的消息不会被标。
 * 身份以 actor（UUID）为准，用于过滤非本人发送的消息（按 user_id 而非展示名）。
 */
export async function POST(request: NextRequest) {
  try {
    // 只能以自己的身份标记已读（防伪造他人已读回执）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const roomId = (body.roomId as string)?.trim();
    const user = (body.user as string)?.trim();
    const messageIds: string[] = Array.isArray(body.messageIds) ? body.messageIds.filter((x: unknown) => typeof x === 'string') : [];
    if (!roomId || !user || messageIds.length === 0) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }
    if (user !== actor) {
      return NextResponse.json({ success: false, message: '只能标记自己的已读' }, { status: 403 });
    }
    const supabase = getServiceClient();

    // 仅标记「非本人发送」的消息为已读（借助 messages 表 user_id 过滤）
    const { data: msgs } = await supabase
      .from('messages')
      .select('id')
      .eq('room_id', roomId)
      .neq('user_id', actor)
      .in('id', messageIds);
    const toMark = (msgs || []).map((m: { id: string }) => m.id);
    if (toMark.length === 0) {
      return NextResponse.json({ success: true, marked: [] });
    }

    const rows = toMark.map((id: string) => ({ message_id: id, room_id: roomId, user_id: actor, read_at: new Date().toISOString() }));
    const { error } = await supabase.from('message_reads').insert(rows).select('message_id');
    if (error) {
      // 忽略唯一冲突（已读重复标记）
      return NextResponse.json({ success: true, marked: toMark });
    }
    const { data } = await supabase.from('message_reads').select('message_id').in('message_id', toMark);
    return NextResponse.json({ success: true, marked: (data || []).map((r: { message_id: string }) => r.message_id) });
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/**
 * GET /api/messages/read?roomId=X&user=A
 * 返回「本房间内、被非 A 的其他人已读」的消息 id 列表。
 * 用于：A 发出的消息下方显示「已读」。
 */
export async function GET(request: NextRequest) {
  try {
    const roomId = request.nextUrl.searchParams.get('roomId')?.trim();
    const user = request.nextUrl.searchParams.get('user')?.trim();
    if (!roomId || !user) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }
    // 只能查询自己发出消息的已读回执，且须为房间成员（防枚举他人已读状态）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    if (user !== actor) {
      return NextResponse.json(
        { success: false, message: '只能查询自己的已读回执' },
        { status: 403 }
      );
    }
    const supabase = getServiceClient();
    if (!(await isRoomParticipant(roomId, actor, supabase))) {
      return NextResponse.json(
        { success: false, message: '无权查看该房间' },
        { status: 403 }
      );
    }
    const { data, error } = await supabase
      .from('message_reads')
      .select('message_id')
      .eq('room_id', roomId)
      .neq('user_id', user);
    if (error) {
      return NextResponse.json({ success: false, message: '查询失败' }, { status: 500 });
    }
    const readIds = Array.from(new Set((data || []).map((r: { message_id: string }) => r.message_id)));
    return NextResponse.json({ success: true, readMessageIds: readIds });
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
