import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';

export const runtime = 'edge';

// 转义 LIKE/ILIKE 通配符（% 与 _），避免用户输入被当成通配
function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, '\\$&');
}

// 日期筛选：仅传 YYYY-MM-DD 时补成当天起止，保证区间包含整天
function normalizeDate(v: string, endOfDay: boolean): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return endOfDay ? `${v}T23:59:59.999Z` : `${v}T00:00:00.000Z`;
  }
  return v;
}

/**
 * GET /api/messages/search?q=<关键词>&type=<all|text|image|video|voice|file>&sender=<展示名>&from=<ISO>&to=<ISO>&limit=50
 * 全局跨会话消息搜索：仅在「当前用户可读」的房间范围内检索。
 * 可读范围与 isRoomParticipant 完全一致：
 *   - default-room（公共大厅）
 *   - 私聊 dm:<uuidA>:<uuidB>（actor 为参与方之一）
 *   - 普通群（room_members 成员 或 创建者）
 * 过滤项（可选）：type 按消息类型、sender 按发送者展示名（模糊）、from/to 按时间区间。
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    if (q.length < 1 || q.length > 100) {
      return NextResponse.json({ success: false, message: '搜索词需 1-100 个字符' }, { status: 400 });
    }
    const limitRaw = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 100), 100);

    // 可选过滤项
    const typeParam = (searchParams.get('type') || 'all').trim();
    const validTypes = ['all', 'text', 'image', 'video', 'voice', 'file'];
    const typeFilter = validTypes.includes(typeParam) ? typeParam : 'all';
    const sender = (searchParams.get('sender') || '').trim();
    const fromParam = normalizeDate((searchParams.get('from') || '').trim(), false);
    const toParam = normalizeDate((searchParams.get('to') || '').trim(), true);

    const supabase = getServiceClient();

    // === 汇集可读房间 ID ===
    const likePattern = `%${escapeLike(q)}%`;

    // 群成员行 + 我创建的群（created_by 但可能不在 room_members）
    const [memberRes, createdRes] = await Promise.all([
      supabase.from('room_members').select('room_id').eq('user_id', actor),
      supabase.from('rooms').select('id').eq('created_by', actor).neq('type', 'dm'),
    ]);

    // 私聊：ID 形如 dm:<uuidA>:<uuidB>，actor 须为参与方之一（用 OR LIKE 命中两种位置）
    const dmPattern1 = `dm:${escapeLike(actor)}:%`;
    const dmPattern2 = `dm:%:${escapeLike(actor)}`;
    const { data: dmRes } = await supabase
      .from('rooms')
      .select('id')
      .like('id', 'dm:%')
      .or(`id.like.${dmPattern1},id.like.${dmPattern2}`);

    const ids = new Set<string>(['default-room']);
    for (const r of memberRes.data || []) ids.add(r.room_id);
    for (const r of createdRes.data || []) ids.add(r.id);
    for (const r of dmRes || []) ids.add(r.id);

    if (ids.size === 0) {
      return NextResponse.json({ success: true, results: [] });
    }
    const roomIdArr = Array.from(ids);

    // === 检索消息 ===
    let query = supabase
      .from('messages')
      .select('id, room_id, user, content, type, timestamp, file_name, file_mime, user_id')
      .in('room_id', roomIdArr)
      .is('withdrawn_at', null)
      .ilike('content', likePattern);

    // type 过滤（all = 不过滤）
    if (typeFilter !== 'all') query = query.eq('type', typeFilter);
    // sender 过滤（展示名模糊匹配）
    if (sender) query = query.ilike('user', `%${escapeLike(sender)}%`);
    // 时间区间过滤
    if (fromParam) query = query.gte('timestamp', fromParam);
    if (toParam) query = query.lte('timestamp', toParam);

    const { data: msgs, error } = await query
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[SEARCH_ERROR]', error.message);
      return NextResponse.json({ success: false, message: '搜索失败' }, { status: 500 });
    }

    // === 房间名映射 ===
    const { data: roomsData } = await supabase
      .from('rooms')
      .select('id, name, type')
      .in('id', roomIdArr);
    const roomMap = new Map<string, { id: string; name: string | null; type: string }>(
      (roomsData || []).map((r) => [r.id, r])
    );

    const results = (msgs || []).map((m) => {
      const rm = roomMap.get(m.room_id);
      let roomName = rm?.name || (m.room_id === 'default-room' ? '公共大厅' : m.room_id);
      if (m.room_id.startsWith('dm:')) {
        const parts: string[] = m.room_id.slice(3).split(':');
        const other = parts.find((p) => p !== actor) || m.room_id;
        roomName = rm?.name || other;
      }
      return {
        ...m,
        roomName,
        roomType: rm?.type || 'unknown',
      };
    });

    return NextResponse.json({ success: true, results });
  } catch (err) {
    console.error('[SEARCH_FATAL]', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
