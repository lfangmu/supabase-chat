import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { MESSAGE_CONFIG } from '@/config';
import { getAuthUser, getDisplayName } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';

export const runtime = 'edge';

// Load messages (initial load + cursor pagination)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');
    const before = searchParams.get('before');
    const after = searchParams.get('after');

    if (!roomId) {
      return NextResponse.json(
        { success: false, message: '缺少 roomId' },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9\u4e00-\u9fff_:-]+$/.test(roomId) || roomId.length > 200) {
      return NextResponse.json(
        { success: false, message: '无效的群聊 ID' },
        { status: 400 }
      );
    }

    // 只能读取自己所在房间的消息（防未授权读取他人聊天记录）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const supabase = getServiceClient();
    if (!(await isRoomParticipant(roomId, actor, supabase))) {
      return NextResponse.json(
        { success: false, message: '无权查看该房间消息' },
        { status: 403 }
      );
    }

    // "after" mode: fetch messages newer than given timestamp (for sync/catch-up)
    if (after) {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .gt('timestamp', after)
        .order('timestamp', { ascending: true })
        .limit(200);

      if (error) {
        console.error('同步消息失败:', error);
        return NextResponse.json(
          { success: false, message: '同步消息失败' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        messages: (data || []).map((m) => ({ ...m, userId: m.user_id, forwardedFrom: m.forwarded_from ?? null })),
      });
    }

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
      console.error('加载消息失败:', error);
      return NextResponse.json(
        { success: false, message: '加载消息失败' },
        { status: 500 }
      );
    }

    // Return in chronological order (oldest first)
    return NextResponse.json({
      success: true,
      messages: (data || []).reverse().map((m) => ({ ...m, userId: m.user_id, forwardedFrom: m.forwarded_from ?? null })),
    });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}

// Insert a new message
export async function POST(request: NextRequest) {
  try {
    // 只能以「自己」的身份发消息（actor 是 Supabase Auth 的 UUID）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const { id, room_id, type, content, timestamp, quote_id, quote } = body;

    // REQ-010: File metadata fields
    const file_name = body.file_name ?? null;
    const file_size = body.file_size ?? null;
    const file_mime = body.file_mime ?? null;
    // 转发来源（被转发消息的原始 id；非转发时为 null）
    const forwarded_from = body.forwarded_from ?? null;

    if (!id || !room_id || !type || content === undefined || !timestamp) {
      return NextResponse.json(
        { success: false, message: '缺少必填字段' },
        { status: 400 }
      );
    }

    const validTypes = ['text', 'image', 'video', 'voice', 'file'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, message: '无效的消息类型' },
        { status: 400 }
      );
    }

    // 展示名从「当前会话的身份资料」解析，绝不信任请求体里的展示名（防伪造）
    const supabase = getServiceClient();
    const displayName = (await getDisplayName(supabase, actor)) ?? '匿名用户';

    // 只能向自己所在的房间发送（防向任意房间灌水 / 越权发消息）
    if (!(await isRoomParticipant(room_id, actor, supabase))) {
      return NextResponse.json(
        { success: false, message: '无权向该房间发送消息' },
        { status: 403 }
      );
    }

    if (typeof content !== 'string' || content.length > MESSAGE_CONFIG.MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        { success: false, message: '消息内容过长' },
        { status: 400 }
      );
    }

    // Reject malformed room IDs (allow ':' for DM rooms like "dm:<uuidA>:<uuidB>")
    if (!/^[a-zA-Z0-9\u4e00-\u9fff_:-]+$/.test(room_id) || room_id.length > 200) {
      return NextResponse.json(
        { success: false, message: '无效的群聊 ID' },
        { status: 400 }
      );
    }

    // 幂等写入：以客户端生成的 id 为主键，重复提交（网络重试 / 超时重发）直接忽略，
    // 避免「服务端已落库但客户端误判失败 → 消息卡在 failed」的孤儿消息。
    const { error } = await supabase
      .from('messages')
      .insert([{
        id,
        room_id,
        user_id: actor,
        user: displayName,
        type,
        content,
        timestamp,
        quote_id: quote_id ?? null,
        quote: quote ?? null,
        file_name,
        file_size,
        file_mime,
        forwarded_from,
      }], { onConflict: 'id', ignoreDuplicates: true } as any);

    if (error) {
      console.error('保存消息失败:', error);
      return NextResponse.json(
        { success: false, message: '保存消息失败' },
        { status: 500 }
      );
    }

    // 消息已落库即为权威源。其他在线成员通过 Postgres Changes（CDC + RLS）实时收到，
    // 无需服务端另行广播；幂等写入（ignoreDuplicates）保证网络重试不会产生重复消息。

    // Update room's last message info (fire-and-forget)
    supabase.from('rooms').update({
      last_message_at: timestamp,
      last_message_content: type === 'text' ? content : null,
      last_message_type: type,
      last_message_user: displayName,
    }).eq('id', room_id).then(({ error: updateError }) => {
      if (updateError) console.error('更新房间最新消息失败:', updateError);
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}

// Edit a message (ownership verified)
export async function PUT(request: NextRequest) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const { id, content } = await request.json();

    if (!id || content === undefined) {
      return NextResponse.json(
        { success: false, message: '缺少参数' },
        { status: 400 }
      );
    }

    if (typeof content !== 'string' || content.length > MESSAGE_CONFIG.MAX_CONTENT_LENGTH || !content.trim()) {
      return NextResponse.json(
        { success: false, message: '消息内容无效' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Verify ownership（以会话身份为准，不信任请求体里的 user）
    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('user_id')
      .eq('id', id)
      .single();

    if (fetchError || !message) {
      return NextResponse.json(
        { success: false, message: '消息未找到' },
        { status: 404 }
      );
    }

    if (message.user_id !== actor) {
      return NextResponse.json(
        { success: false, message: '无权编辑此消息' },
        { status: 403 }
      );
    }

    const { error: updateError } = await supabase
      .from('messages')
      .update({ content, edited_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      console.error('编辑消息失败:', updateError);
      return NextResponse.json(
        { success: false, message: '编辑失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}

// Withdraw a message (ownership verified, extended for file type)
export async function DELETE(request: NextRequest) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const { id, withdraw } = await request.json();

    if (!id) {
      return NextResponse.json(
        { success: false, message: '缺少参数' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Verify ownership（以会话身份为准，不信任请求体里的 user）
    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('user_id, content, type')
      .eq('id', id)
      .single();

    if (fetchError || !message) {
      return NextResponse.json(
        { success: false, message: '消息未找到' },
        { status: 404 }
      );
    }

    if (message.user_id !== actor) {
      return NextResponse.json(
        { success: false, message: '无权操作此消息' },
        { status: 403 }
      );
    }

    // 撤回：软删除（保留记录，标记 withdrawn_at），前端展示「X 撤回了一条消息」
    if (withdraw) {
      // 仅允许 2 分钟内的消息撤回（与微信一致）
      const { data: fullMsg } = await supabase.from('messages').select('timestamp').eq('id', id).single();
      const sentAt = fullMsg?.timestamp ? new Date(fullMsg.timestamp).getTime() : 0;
      if (sentAt && Date.now() - sentAt > 2 * 60 * 1000) {
        return NextResponse.json({ success: false, message: '超过 2 分钟，无法撤回' }, { status: 403 });
      }
      const { error: updErr } = await supabase
        .from('messages')
        .update({ withdrawn_at: new Date().toISOString() })
        .eq('id', id);
      if (updErr) {
        return NextResponse.json({ success: false, message: '撤回失败' }, { status: 500 });
      }
      return NextResponse.json({ success: true, withdrawn: true });
    }

    // 硬删除（管理后台）：同时删除存储中的媒体文件
    if (
      (message.type === 'image' || message.type === 'video' || message.type === 'voice' || message.type === 'file') &&
      !message.content.startsWith('http')
    ) {
      await supabase.storage
        .from('chat-media')
        .remove([message.content]);
    }

    // Delete from DB
    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return NextResponse.json(
        { success: false, message: '删除失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}
