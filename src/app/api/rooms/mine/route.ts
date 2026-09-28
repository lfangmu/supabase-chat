import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';

export const runtime = 'edge';

/**
 * GET /api/rooms/mine
 * 返回当前登录用户「在服务端 room_members 中记录」的全部房间 ID。
 *
 * 用途：客户端房间发现对账（修复「被别人拉进群，自己侧边栏看不到」的问题）。
 * 非公开目录模型下，侧边栏只显示 localStorage 里记过号的房间；管理员/群友通过
 * POST /api/rooms/members 拉人时只写服务端 room_members，并不会回写对方浏览器，
 * 导致被拉者永远看不到该群。此端点让客户端在加载/周期刷新时，把服务端成员关系里
 * 「本地还没记」的房间补进已加入列表。本端点是「只增」语义——前端只 addJoinedRoom，
 * 绝不在本地删除房间，避免误伤用户主动隐藏/保留的会话。
 *
 * 注意：DM 私聊房间不写入 room_members，由 useDM 的 new-dm/实时消息链路独立发现，
 * 故此处只返回群聊类房间（即 room_members 中 user_id=当前用户 的全部 room_id）。
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('user_id', actor);

    if (error) {
      console.error('GET /api/rooms/mine error:', error);
      return NextResponse.json({ success: false, message: '获取我的房间失败' }, { status: 500 });
    }

    const roomIds = (data || []).map((r: { room_id: string }) => r.room_id);
    return NextResponse.json({ success: true, roomIds });
  } catch (err) {
    console.error('GET /api/rooms/mine unexpected error:', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
