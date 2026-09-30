import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { requireAdmin } from '@/lib/admin-auth';
import { isValidRoomId } from '@/lib/validate';
import { MESSAGE_CONFIG } from '@/config';
import { logAdminAction, getClientIpFromRequest } from '@/lib/audit';

export const runtime = 'edge';


/**
 * GET /api/admin/messages?roomId=xxx[&before=ISO] — 管理后台：只读查看某房间消息（游标分页）。
 *
 * 鉴权（P1-3）：requireAdmin 路由内独立校验 role='admin'（不再只解析 actor）。
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');
    const before = searchParams.get('before');

    if (!roomId) {
      return NextResponse.json(
        { success: false, message: '缺少 roomId' },
        { status: 400 }
      );
    }

    if (!isValidRoomId(roomId)) {
      return NextResponse.json(
        { success: false, message: '无效的群聊 ID' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    let query = supabase
      .from('messages')
      .select('*')
      .eq('room_id', roomId)
      .order('timestamp', { ascending: false })
      .limit(MESSAGE_CONFIG.PAGE_SIZE);

    if (before) {
      query = query.lt('timestamp', before);
    }

    const { data, error } = await query;

    if (error) {
      console.error('管理后台加载消息失败:', error);
      return NextResponse.json(
        { success: false, message: '加载消息失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      messages: (data || []).reverse(),
    });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/messages — 管理后台：删除某房间内的单条消息（社区 moderation）。
 *
 * 鉴权（P1-3）：requireAdmin 路由内独立校验 role='admin'（不再只解析 actor）。
 * 数据安全：先按 id 取消息确认属于该 room（防止跨房间误删/越权删），快照内容用于审计，
 * 再用 service_role 删除。删除成功/失败均写入 audit_logs。
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const roomId = body?.roomId;
    const messageId = body?.messageId;
    if (!roomId || !messageId || typeof roomId !== 'string' || typeof messageId !== 'string') {
      return NextResponse.json({ success: false, message: '缺少 roomId 或 messageId' }, { status: 400 });
    }
    if (!isValidRoomId(roomId)) {
      return NextResponse.json({ success: false, message: '无效的群聊 ID' }, { status: 400 });
    }

    const adminIp = getClientIpFromRequest(request);
    const supabase = getServiceClient();

    // 先取消息：确认存在且属于该房间，并快照内容供审计
    const { data: msg } = await supabase
      .from('messages')
      .select('id, room_id, user, type, content, timestamp, file_name')
      .eq('id', messageId)
      .maybeSingle();

    if (!msg) {
      return NextResponse.json({ success: false, message: '消息不存在' }, { status: 404 });
    }
    if (msg.room_id !== roomId) {
      // 越权/跨房间尝试，记录审计但不执行删除
      await logAdminAction(
        'delete_message_failed',
        'message',
        messageId,
        { reason: 'room_mismatch', expected_room: roomId, actual_room: msg.room_id },
        adminIp
      );
      return NextResponse.json({ success: false, message: '消息不属于该群聊' }, { status: 403 });
    }

    const { error } = await supabase.from('messages').delete().eq('id', messageId);

    if (error) {
      console.error('Admin delete message failed:', error);
      await logAdminAction(
        'delete_message_failed',
        'message',
        messageId,
        { error: error.message, room_id: roomId, content_snapshot: msg.content, type: msg.type, user: msg.user },
        adminIp
      );
      return NextResponse.json({ success: false, message: '删除消息失败' }, { status: 500 });
    }

    await logAdminAction(
      'delete_message',
      'message',
      messageId,
      {
        room_id: roomId,
        content_snapshot: msg.content,
        type: msg.type,
        user: msg.user,
        timestamp: msg.timestamp,
        file_name: msg.file_name ?? null,
      },
      adminIp
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/messages error:', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
