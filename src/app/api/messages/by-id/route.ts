import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';

export const runtime = 'edge';

// 按需加载单条消息：用于「全局搜索 → 跳转到该条消息」时，目标消息可能尚未进入
// 当前房间已加载窗口（分页/缓存），需按 id 精准取回。带 isRoomParticipant 越权校验，
// 只能取回自己可读房间里的消息。
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]+$/.test(id) || id.length > 100) {
      return NextResponse.json({ success: false, message: '无效的消息 id' }, { status: 400 });
    }

    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const supabase = getServiceClient();
    const { data: msg, error } = await supabase
      .from('messages')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('加载单条消息失败:', error);
      return NextResponse.json({ success: false, message: '加载失败' }, { status: 500 });
    }
    if (!msg) {
      return NextResponse.json({ success: false, message: '消息不存在' }, { status: 404 });
    }

    // 校验调用者对该消息所属房间的可读权限
    if (!(await isRoomParticipant(msg.room_id, actor, supabase))) {
      return NextResponse.json({ success: false, message: '无权查看该消息' }, { status: 403 });
    }

    return NextResponse.json({ success: true, message: msg });
  } catch (err) {
    console.error('by-id 路由异常:', err);
    return NextResponse.json({ success: false, message: '服务器内部错误' }, { status: 500 });
  }
}
