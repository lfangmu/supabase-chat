import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';
import { isValidRoomId } from '@/lib/validate';

export const runtime = 'edge';

/**
 * POST /api/messages/clear  { roomId }
 *
 * **不做任何写操作**，只做权限校验并返回一个权威的「清空时刻」。
 * 客户端把这个时刻存进 localStorage，本机渲染时隐藏该房间早于该时刻的消息。
 *
 * ⚠️ 语义是**微信式本机清空**：只清自己这一台设备上的记录，不动服务器数据，
 * 因此不会影响群里其他成员（与消息「删除」的语义一致，区别于「撤回」）。
 * 不在服务端硬删的原因：一旦硬删，群里所有人（包括发消息的人自己）的历史都会
 * 消失且不可恢复——那不是「清空聊天记录」该有的行为。
 *
 * 用服务端时间而非客户端时间，避免时钟偏差导致「清空后仍漏出几条」。
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';
    if (!roomId) {
      return NextResponse.json({ success: false, message: '缺少房间 ID' }, { status: 400 });
    }
    if (!isValidRoomId(roomId)) {
      return NextResponse.json({ success: false, message: '无效的房间 ID' }, { status: 400 });
    }

    const supabase = getServiceClient();
    // 只能清空自己所在房间的记录（防越权清他人会话）
    if (!(await isRoomParticipant(roomId, actor, supabase))) {
      return NextResponse.json(
        { success: false, message: '无权清空该会话' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      roomId,
      clearedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[MESSAGES_CLEAR]', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
