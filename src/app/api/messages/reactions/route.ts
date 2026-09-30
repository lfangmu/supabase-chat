import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';
import { isValidRoomId, isValidMessageId } from '@/lib/validate';

export const runtime = 'edge';

/** 房间内参与聚合的消息条数上限。 */
const MAX_MESSAGES_PER_ROOM = 2000;
/**
 * 单次 `.in()` 的 id 数量上限（P2-9）。
 * 此前一次塞入最多 2000 个 id → 生成超长请求 URL（PostgREST 走 query string），
 * 在网关/PostgREST 层可能直接 414/400。改为分片并发查询后合并。
 */
const IN_CLAUSE_CHUNK = 200;

/** 把数组切成固定大小的分片。 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// GET /api/messages/reactions?roomId=xxx
// 返回该房间全部消息的表情回应，聚合成 { [messageId]: Reaction[] }
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');
    if (!roomId) {
      return NextResponse.json({ success: false, message: '缺少 roomId' }, { status: 400 });
    }
    if (!isValidRoomId(roomId)) {
      return NextResponse.json({ success: false, message: '无效的房间 ID' }, { status: 400 });
    }

    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const supabase = getServiceClient();
    if (!(await isRoomParticipant(roomId, actor, supabase))) {
      return NextResponse.json({ success: false, message: '无权查看该房间' }, { status: 403 });
    }

    // 取房间内最近消息 id（限制规模，避免超大房间拉全表）
    const { data: msgRows, error: msgErr } = await supabase
      .from('messages')
      .select('id')
      .eq('room_id', roomId)
      .order('timestamp', { ascending: false })
      .limit(MAX_MESSAGES_PER_ROOM);
    if (msgErr) {
      console.error('[REACTIONS_GET]', msgErr.message);
      return NextResponse.json({ success: false, message: '加载回应失败' }, { status: 500 });
    }
    const ids = (msgRows || []).map((m: { id: string }) => m.id);
    if (ids.length === 0) {
      return NextResponse.json({ success: true, reactions: {} });
    }

    // P2-9：分片并发查询，避免超长 `.in()` URL
    const batches = await Promise.all(
      chunk(ids, IN_CLAUSE_CHUNK).map((part) =>
        supabase.from('reactions').select('*').in('message_id', part)
      )
    );
    const failed = batches.find((b) => b.error);
    if (failed?.error) {
      console.error('[REACTIONS_GET]', failed.error.message);
      return NextResponse.json({ success: false, message: '加载回应失败' }, { status: 500 });
    }
    const reactions = batches.flatMap((b) => b.data || []);

    const map: Record<string, typeof reactions> = {};
    for (const r of reactions) {
      (map[r.message_id] ||= []).push(r);
    }
    return NextResponse.json({ success: true, reactions: map });
  } catch (err) {
    console.error('[REACTIONS_GET]', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

// POST /api/messages/reactions  { messageId, emoji }
// 切换当前用户对某条消息的某个 emoji 回应（已存在则删除，否则新增）
export async function POST(request: NextRequest) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
    const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : '';
    if (!isValidMessageId(messageId) || !emoji || emoji.length > 8) {
      return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 });
    }

    const supabase = getServiceClient();

    // 校验消息存在且当前用户是该房间的参与者（防越权）
    const { data: msg, error: msgErr } = await supabase
      .from('messages')
      .select('room_id')
      .eq('id', messageId)
      .maybeSingle();
    if (msgErr || !msg) {
      return NextResponse.json({ success: false, message: '消息不存在' }, { status: 404 });
    }
    if (!(await isRoomParticipant(msg.room_id, actor, supabase))) {
      return NextResponse.json({ success: false, message: '无权回应该消息' }, { status: 403 });
    }

    // 切换（user_id 为发起回应的用户 UUID，绝不用昵称）
    const { data: existing } = await supabase
      .from('reactions')
      .select('*')
      .eq('message_id', messageId)
      .eq('user_id', actor)
      .eq('emoji', emoji)
      .maybeSingle();

    if (existing) {
      const { error: delErr } = await supabase.from('reactions').delete().eq('id', existing.id);
      if (delErr) {
        // P2-8：删除失败此前被完全忽略，客户端仍收到 success:true（界面显示已取消，实际仍在库）
        console.error('[REACTIONS_POST] 删除回应失败:', delErr.message);
        return NextResponse.json({ success: false, message: '取消回应失败' }, { status: 500 });
      }
    } else {
      const id =
        typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `${messageId}_${actor}_${emoji}_${Date.now()}`;
      const { error: insErr } = await supabase.from('reactions').insert({
        id,
        message_id: messageId,
        user_id: actor,
        emoji,
        created_at: new Date().toISOString(),
      });
      if (insErr) {
        // P2-8：insert 未检查 error，失败仍返回 success:true（P2-8 的核心问题）
        console.error('[REACTIONS_POST] 写入回应失败:', insErr.message);
        return NextResponse.json({ success: false, message: '保存回应失败' }, { status: 500 });
      }
    }

    // 返回该消息最新的完整回应列表
    const { data: fresh, error: freshErr } = await supabase
      .from('reactions')
      .select('*')
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });
    if (freshErr) {
      console.error('[REACTIONS_POST]', freshErr.message);
      return NextResponse.json({ success: false, message: '保存回应失败' }, { status: 500 });
    }

    return NextResponse.json({ success: true, messageId, reactions: fresh || [] });
  } catch (err) {
    console.error('[REACTIONS_POST]', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
