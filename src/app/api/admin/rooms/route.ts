import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminAction, getClientIpFromRequest } from '@/lib/audit';

export const runtime = 'edge';


/**
 * GET /api/admin/rooms — 管理后台：返回全部（非 DM）房间及其最新消息摘要。
 *
 * 鉴权（P1-3）：middleware 已做一道 role='admin' 校验；此处用 requireAdmin **再独立校验一次**，
 * 不再只解析 actor。任一环节被绕过（matcher 调整 / middleware 回归 / 路由被直接调用），
 * 非管理员仍会拿到 403。
 * 只读，不做任何成员过滤。
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const supabase = getServiceClient();

    // 全部房间（排除历史 DM 行）
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('*')
      .neq('type', 'dm')
      .order('created_at', { ascending: false })
      .limit(500);

    if (roomsError || !rooms) {
      return NextResponse.json({ success: false, message: '获取房间列表失败' }, { status: 500 });
    }

    const roomIds = rooms.map((r) => r.id);
    if (roomIds.length === 0) {
      return NextResponse.json({ success: true, rooms: [] });
    }

    const { data: latestMessages, error: msgError } = await supabase
      .from('messages')
      .select('room_id, timestamp, content, type, user')
      .in('room_id', roomIds)
      .order('timestamp', { ascending: false })
      .limit(Math.min(roomIds.length * 2, 1000));

    if (msgError) {
      return NextResponse.json({ success: true, rooms });
    }

    const latestMap = new Map<string, { timestamp: string; content: string; type: string; user: string }>();
    (latestMessages || []).forEach((m: { room_id: string; timestamp: string; content: string; type: string; user: string }) => {
      if (!latestMap.has(m.room_id)) {
        latestMap.set(m.room_id, { timestamp: m.timestamp, content: m.content, type: m.type, user: m.user });
      }
    });

    const roomsWithTimestamp = rooms.map((room) => {
      const lastMsg = latestMap.get(room.id);
      return {
        ...room,
        last_message_at: lastMsg?.timestamp || null,
        last_message_content: lastMsg?.content || null,
        last_message_type: lastMsg?.type || null,
        last_message_user: lastMsg?.user || null,
      };
    });

    return NextResponse.json({ success: true, rooms: roomsWithTimestamp });
  } catch (err) {
    console.error('GET /api/admin/rooms error:', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/rooms — 管理后台：删除指定群聊及其全部消息。
 *
 * 鉴权（P1-3）：requireAdmin 路由内独立校验 role='admin'（不再只解析 actor）。
 * 数据安全：先用 service_role 删除该房间所有消息与成员行，再删房间本身；禁止删除系统保留的默认聊天室。
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const id = body?.id;
    if (!id || typeof id !== 'string' || id.length === 0) {
      return NextResponse.json({ success: false, message: '缺少群聊 ID' }, { status: 400 });
    }

    if (id === 'default-room') {
      return NextResponse.json({ success: false, message: '不能删除默认群聊' }, { status: 403 });
    }

    const adminIp = getClientIpFromRequest(request);
    const supabase = getServiceClient();

    // 先获取房间信息用于审计
    const { data: roomInfo } = await supabase
      .from('rooms')
      .select('id, name, type, created_at')
      .eq('id', id)
      .single();

    // 先统计该房间的消息数量
    const { count: messageCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', id);

    // 先删除该房间的所有消息，再删除房间本身
    const { error: msgError } = await supabase
      .from('messages')
      .delete()
      .eq('room_id', id);
    if (msgError) {
      console.error('Admin delete messages failed:', msgError);
    }

    // P2-13：级联清理成员行，避免 `room_members` 留下孤儿行 →
    // `/api/rooms/mine` 仍会列出已删除的房间，前端反复把幽灵房间加回侧栏。
    const { error: memberDelError } = await supabase
      .from('room_members')
      .delete()
      .eq('room_id', id);
    if (memberDelError) {
      console.error('Admin delete room_members failed:', memberDelError);
    }

    const { error } = await supabase
      .from('rooms')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Admin delete room failed:', error);
      // 记录失败的审计
      await logAdminAction(
        'delete_room_failed',
        'room',
        id,
        { error: error.message, room_name: roomInfo?.name },
        adminIp
      );
      return NextResponse.json({ success: false, message: '删除群聊失败' }, { status: 500 });
    }

    // 记录成功的审计日志
    await logAdminAction(
      'delete_room',
      'room',
      id,
      {
        room_name: roomInfo?.name,
        room_type: roomInfo?.type,
        message_count: messageCount,
      },
      adminIp
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/rooms error:', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
