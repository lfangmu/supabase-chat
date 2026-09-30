import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';
import { isValidRoomId, isValidMessageId } from '@/lib/validate';

export const runtime = 'edge';

/** 已读回执涉及的消息条数上限（GET 侧，防止把整表拉回内存）。 */
const MAX_READ_LOOKUP_MESSAGES = 500;

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
    const messageIds: string[] = Array.isArray(body.messageIds)
      ? body.messageIds.filter((x: unknown) => isValidMessageId(x))
      : [];
    if (!roomId || !user || messageIds.length === 0) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }
    if (!isValidRoomId(roomId)) {
      return NextResponse.json({ success: false, message: '无效的群聊 ID' }, { status: 400 });
    }
    if (user !== actor) {
      return NextResponse.json({ success: false, message: '只能标记自己的已读' }, { status: 403 });
    }
    const supabase = getServiceClient();

    // P2-3：补上房间成员校验（同文件 GET 早已有，POST 此前缺失）——
    // 否则任何登录用户可向任意 roomId 写入 message_reads 行（脏数据 + 探测房间是否存在）。
    if (!(await isRoomParticipant(roomId, actor, supabase))) {
      return NextResponse.json({ success: false, message: '无权操作该房间' }, { status: 403 });
    }

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
      // P2-3：此前把**所有** DB 错误都当成「已读重复」返回 success:true，真错误被静默吞掉。
      // 现在只把唯一冲突（23505）视为幂等重复；其余错误如实上报 500。
      const code = (error as { code?: string }).code;
      if (code !== '23505') {
        console.error('标记已读失败:', error);
        return NextResponse.json({ success: false, message: '标记已读失败' }, { status: 500 });
      }
      // 唯一冲突：并发/重复标记，回读一次实际落库的集合
      const { data } = await supabase.from('message_reads').select('message_id').in('message_id', toMark);
      return NextResponse.json({
        success: true,
        marked: (data || []).map((r: { message_id: string }) => r.message_id),
      });
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
    if (!isValidRoomId(roomId)) {
      return NextResponse.json({ success: false, message: '无效的群聊 ID' }, { status: 400 });
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

    // P2-11：此前直接 `select message_id from message_reads where room_id = X and user_id <> me`，
    // 把房间内**整张**已读表拉回内存去重，无任何 limit —— 房间越活跃响应越大（长尾慢查询 + 内存放大）。
    // 现在先取「我在本房间最近发出的消息 id」（有界），再据此过滤已读表：
    // 语义更准确（只关心自己消息的回执），且查询规模有上界。
    const { data: mine, error: mineError } = await supabase
      .from('messages')
      .select('id')
      .eq('room_id', roomId)
      .eq('user_id', user)
      .order('timestamp', { ascending: false })
      .limit(MAX_READ_LOOKUP_MESSAGES);
    if (mineError) {
      console.error('查询本人消息失败:', mineError);
      return NextResponse.json({ success: false, message: '查询失败' }, { status: 500 });
    }
    const myMessageIds = (mine || []).map((m: { id: string }) => m.id);
    if (myMessageIds.length === 0) {
      return NextResponse.json({ success: true, readMessageIds: [] });
    }

    const { data, error } = await supabase
      .from('message_reads')
      .select('message_id')
      .in('message_id', myMessageIds)
      .neq('user_id', user)
      .limit(MAX_READ_LOOKUP_MESSAGES * 4);
    if (error) {
      console.error('查询已读回执失败:', error);
      return NextResponse.json({ success: false, message: '查询失败' }, { status: 500 });
    }
    const readIds = Array.from(new Set((data || []).map((r: { message_id: string }) => r.message_id)));
    return NextResponse.json({ success: true, readMessageIds: readIds });
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
