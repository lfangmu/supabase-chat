import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { MESSAGE_CONFIG } from '@/config';
import { getAuthUser, getDisplayName } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';
import { isAllowedMimeType } from '@/lib/file-types';
import {
  isValidRoomId,
  isValidMessageId,
  isValidClientTimestamp,
  isWithinJsonBudget,
} from '@/lib/validate';

export const runtime = 'edge';

/** 文件消息元数据上限（防止超长文件名 / 非法 MIME 入库）。 */
const MAX_FILE_NAME_LENGTH = 255;

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

    // 统一走共享校验器（P3：原先本文件与其它接口用了范围不同的两套正则）
    if (!isValidRoomId(roomId)) {
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

    // P2-4：此前完全不校验这四项，攻击者可写入超长 id、任意 timestamp（破坏排序/分页游标）、
    // 任意大小 JSON 的 quote（撑大 DB 行）、任意 forwarded_from。
    if (!isValidMessageId(id)) {
      return NextResponse.json(
        { success: false, message: '无效的消息 id' },
        { status: 400 }
      );
    }
    if (!isValidRoomId(room_id)) {
      return NextResponse.json(
        { success: false, message: '无效的群聊 ID' },
        { status: 400 }
      );
    }
    // 时间戳必须可解析且落在合理区间：否则排序 / 分页游标会错乱，
    // 且会让「2 分钟撤回限制」因 NaN 被整体跳过（见 P2-5）。
    if (!isValidClientTimestamp(timestamp)) {
      return NextResponse.json(
        { success: false, message: '无效的消息时间戳' },
        { status: 400 }
      );
    }
    if (quote_id !== undefined && quote_id !== null && !isValidMessageId(quote_id)) {
      return NextResponse.json(
        { success: false, message: '无效的引用消息 id' },
        { status: 400 }
      );
    }
    if (!isWithinJsonBudget(quote)) {
      return NextResponse.json(
        { success: false, message: '引用内容过大' },
        { status: 400 }
      );
    }
    if (
      forwarded_from !== undefined &&
      forwarded_from !== null &&
      !isValidMessageId(forwarded_from)
    ) {
      return NextResponse.json(
        { success: false, message: '无效的转发来源 id' },
        { status: 400 }
      );
    }
    // 文件元数据（可选）：长度 / 数值 / MIME 白名单
    if (file_name !== null && (typeof file_name !== 'string' || file_name.length > MAX_FILE_NAME_LENGTH)) {
      return NextResponse.json(
        { success: false, message: '无效的文件名' },
        { status: 400 }
      );
    }
    if (
      file_size !== null &&
      (typeof file_size !== 'number' || !Number.isFinite(file_size) || file_size < 0)
    ) {
      return NextResponse.json(
        { success: false, message: '无效的文件大小' },
        { status: 400 }
      );
    }
    if (file_mime !== null && (typeof file_mime !== 'string' || !isAllowedMimeType(file_mime))) {
      return NextResponse.json(
        { success: false, message: '不支持的文件类型' },
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

    // 幂等写入：以客户端生成的 id 为主键，重复提交（网络重试 / 超时重发）直接忽略，
    // 避免「服务端已落库但客户端误判失败 → 消息卡在 failed」的孤儿消息。
    //
    // ⚠️ 必须用 upsert 而非 insert：
    //   postgrest-js 的 `insert(values, options)` 只认 `count` / `defaultToNull`，
    //   传 onConflict / ignoreDuplicates 会被**静默忽略**。此前这里写的是
    //   `insert(..., { onConflict: 'id', ignoreDuplicates: true } as any)` —— 那个 `as any`
    //   恰好把「参数不被支持」的类型报错压住了，于是「幂等」从未真正生效：
    //   重发会撞主键 → 23505 → 接口返回 500，用户看到发送失败。
    //   `upsert` 才支持这两个选项（会转成 Prefer: resolution=ignore-duplicates + on_conflict=id）。
    const { error } = await supabase
      .from('messages')
      .upsert([{
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
      }], { onConflict: 'id', ignoreDuplicates: true });

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

    if (!isValidMessageId(id)) {
      return NextResponse.json(
        { success: false, message: '无效的消息 id' },
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

    if (!isValidMessageId(id)) {
      return NextResponse.json(
        { success: false, message: '无效的消息 id' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Verify ownership（以会话身份为准，不信任请求体里的 user）
    // P3：一次把撤回时限需要的 `timestamp` 一并取出，省掉后面那次重复查询。
    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('user_id, content, type, timestamp')
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
      // 仅允许 2 分钟内的消息撤回（与微信一致）。
      // P2-5：此前写成 `if (sentAt && Date.now() - sentAt > 2*60*1000)` ——
      // 当 `timestamp` 非法时 `sentAt` 为 0 或 NaN（falsy），整个限制被**静默跳过**。
      // 现在：时间戳不可解析即拒绝撤回（fail-closed），正常路径按 2 分钟判定。
      const sentAt = message.timestamp ? new Date(message.timestamp).getTime() : Number.NaN;
      if (!Number.isFinite(sentAt)) {
        console.error('撤回失败：消息时间戳不可解析', { id, timestamp: message.timestamp });
        return NextResponse.json(
          { success: false, message: '消息时间戳异常，无法撤回' },
          { status: 400 }
        );
      }
      if (Date.now() - sentAt > 2 * 60 * 1000) {
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
    // P3：`content` 可能为 null（老数据 / 非文本消息），原先直接 `.startsWith` 会抛 TypeError
    // （被外层 catch 兜成 500「服务器内部错误」）。这里先做类型判断。
    if (
      (message.type === 'image' || message.type === 'video' || message.type === 'voice' || message.type === 'file') &&
      typeof message.content === 'string' &&
      message.content.length > 0 &&
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
