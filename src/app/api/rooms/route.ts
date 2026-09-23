import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { extractSession, getSessionUser } from '@/lib/auth';

export const runtime = 'edge';


/** GET /api/rooms — list all rooms with latest message timestamp (extended with type filter) */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const supabase = getServiceClient();
    const jwtSecret = process.env.CHAT_JWT_SECRET;

    // 管理员总览：?all=1 且持有有效管理员令牌时返回全部房间；否则必须显式传 ids
    let requestedIds: string[] | null = null; // null = 返回全部（仅管理员）
    const allParam = searchParams.get('all');
    if (allParam === '1' && jwtSecret) {
      const session = await extractSession(request.headers.get('cookie'), jwtSecret);
      if (session.valid && session.payload?.isAdmin === true) {
        requestedIds = null;
      } else {
        return NextResponse.json(
          { success: false, message: '无权限查看全部房间' },
          { status: 403 }
        );
      }
    } else {
      // 非公开目录模型：必须显式传入 ids 才返回对应房间，避免任何人枚举全部房间。
      const idsParam = searchParams.get('ids');
      if (!idsParam) {
        return NextResponse.json({ success: true, rooms: [] });
      }
      const ids = idsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        return NextResponse.json({ success: true, rooms: [] });
      }
      requestedIds = ids;
    }

    // Fetch rooms. For the admin "all" view, exclude DM rooms to hide private
    // 1:1 rows. When explicit ids are requested (joined-rooms model), include
    // them — DM rooms are legitimate joined rooms the user participates in.
    let roomQuery = supabase
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: false });
    if (requestedIds === null) {
      // 管理员总览：排除私聊行 + 限制返回量，避免一次性拉全表。
      roomQuery = roomQuery.neq('type', 'dm').limit(200);
    }
    if (requestedIds) {
      // 已加入房间模型：必须返回传入的全部房间，绝不能截断（否则 >100 个房间时列表丢失）。
      roomQuery = roomQuery.in('id', requestedIds);
    }

    const { data: rooms, error: roomsError } = await roomQuery;

    if (roomsError || !rooms) {
      return NextResponse.json({ success: false, message: '获取群聊列表失败' }, { status: 500 });
    }

    // 每个房间取各自最新一条消息（RPC 按 room_id 分组，走 idx_messages_room_timestamp 索引）。
    // 此前用 messages 全局 timestamp desc limit 200，活跃群会挤占 top200，导致多数房间的
    // last_message_at 丢失、列表排序/未读角标失真。改用 RPC 后每个房间都能稳定拿到最新一条。
    const roomIds = rooms.map(r => r.id);
    if (roomIds.length === 0) {
      return NextResponse.json({ success: true, rooms: [] });
    }

    const { data: latestMessages, error: msgError } = await supabase.rpc(
      'get_room_last_messages',
      { p_room_ids: roomIds }
    );

    if (msgError) {
      // Non-fatal: return rooms without last_message_at
      return NextResponse.json({ success: true, rooms });
    }

    // Build map of room_id → latest message info
    const latestMap = new Map<string, { timestamp: string; content: string; type: string; user: string }>();
    (latestMessages || []).forEach((m: { room_id: string; timestamp: string; content: string; type: string; user: string }) => {
      if (!latestMap.has(m.room_id)) {
        latestMap.set(m.room_id, { timestamp: m.timestamp, content: m.content, type: m.type, user: m.user });
      }
    });

    const roomsWithTimestamp = rooms.map(room => {
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
    console.error('GET /api/rooms error:', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/** POST /api/rooms — create a new room (extended with type/participants for DM) */
export async function POST(request: NextRequest) {
  try {
    // 以本人身份创建（防伪造他人为创建者）
    const actor = await getSessionUser(request.headers.get('cookie'));
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const { name, created_by, type, participants, id: customId } = body;

    const roomType = type || 'public';

    // ============ DM (private 1:1) room creation ============
    if (roomType === 'dm') {
      if (!participants || !Array.isArray(participants) || participants.length !== 2) {
        return NextResponse.json({ success: false, message: '私聊需要两个参与者' }, { status: 400 });
      }
      if (!created_by) {
        return NextResponse.json({ success: false, message: '缺少创建者' }, { status: 400 });
      }
      if (created_by.trim() !== actor) {
        return NextResponse.json({ success: false, message: '只能以本人身份创建私聊' }, { status: 403 });
      }
      if (!participants.map((p: string) => p.trim()).includes(actor)) {
        return NextResponse.json({ success: false, message: '私聊必须包含本人' }, { status: 403 });
      }

      // DM room ID: dm:{sortedUsers}
      const sortedUsers = [...participants].map((u: string) => u.trim()).sort((a: string, b: string) => a.localeCompare(b));
      const dmRoomId = customId || `dm:${sortedUsers.join(':')}`;
      const otherUser = participants.find((p: string) => p.trim() !== created_by.trim()) || sortedUsers[0];

      const supabase = getServiceClient();

      // Upsert with ON CONFLICT DO NOTHING (idempotent — DM already exists)
      const { data: rooms, error } = await supabase
        .from('rooms')
        .upsert([{
          id: dmRoomId,
          name: otherUser.trim(),
          created_by: created_by.trim(),
          created_at: new Date().toISOString(),
          type: 'dm',
        }], {
          onConflict: 'id',
          ignoreDuplicates: true,
        })
        .select();

      if (error) {
        console.error('Create DM room failed:', error);
        return NextResponse.json({ success: false, message: '创建私聊失败' }, { status: 500 });
      }

      return NextResponse.json({ success: true, room: rooms?.[0] });
    }

    // ============ Standard public room creation ============
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ success: false, message: '群聊名称不能为空' }, { status: 400 });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 50) {
      return NextResponse.json({ success: false, message: '群聊名称最长50个字符' }, { status: 400 });
    }

    if (created_by && created_by.trim() !== actor) {
      return NextResponse.json({ success: false, message: '只能以本人身份建群' }, { status: 403 });
    }

    // 短随机房间号：8 位 base16，URL 安全、易输入/口述；房间名另存 name 字段照常显示
    const roomId = crypto.randomUUID().replace(/-/g, '').slice(0, 8);

    const supabase = getServiceClient();

    const { data: rooms, error } = await supabase
      .from('rooms')
      .insert([{
        id: roomId,
        name: trimmedName,
        created_by: actor,
        created_at: new Date().toISOString(),
        type: 'public',
      }])
      .select();

    if (error) {
      console.error('Create room failed:', error);
      return NextResponse.json({ success: false, message: '创建群聊失败' }, { status: 500 });
    }

    // 创建者同时写入 room_members（owner），保证成员关系一致（与 /rooms/members 路径统一）
    const { error: memberError } = await supabase
      .from('room_members')
      .insert([{ room_id: roomId, user: actor, role: 'owner' }]);
    if (memberError) {
      console.error('Create room owner membership failed:', memberError);
      // 房间已建，成员写入失败不影响主流程，仅记录
    }

    return NextResponse.json({ success: true, room: rooms?.[0] });
  } catch (err) {
    console.error('POST /api/rooms error:', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/** PUT /api/rooms — rename a room */
export async function PUT(request: NextRequest) {
  try {
    // 只能重命名自己所在的群（防篡改任意群名）
    const actor = await getSessionUser(request.headers.get('cookie'));
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const { id, name } = body;

    // Rename logic
    if (!id || !name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 50) {
      return NextResponse.json({ success: false, message: '群聊名称最长50个字符' }, { status: 400 });
    }

    if (id === 'default-room') {
      return NextResponse.json({ success: false, message: '不能重命名默认群聊' }, { status: 403 });
    }

    const supabase = getServiceClient();

    const [memberRow, roomRow] = await Promise.all([
      supabase.from('room_members').select('user').eq('room_id', id).eq('user', actor).maybeSingle(),
      supabase.from('rooms').select('created_by').eq('id', id).maybeSingle(),
    ]);
    const isOwner = roomRow.data?.created_by === actor;
    if (!memberRow.data && !isOwner) {
      return NextResponse.json({ success: false, message: '只能重命名自己所在的群' }, { status: 403 });
    }

    const { error } = await supabase
      .from('rooms')
      .update({ name: trimmedName })
      .eq('id', id);

    if (error) {
      console.error('Rename room failed:', error);
      return NextResponse.json({ success: false, message: '重命名失败' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('PUT /api/rooms error:', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/** DELETE /api/rooms — delete a room */
export async function DELETE(request: NextRequest) {
  try {
    // 只能删除自己所在的群（防删除任意群）
    const actor = await getSessionUser(request.headers.get('cookie'));
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: '缺少群聊 ID' }, { status: 400 });
    }

    if (id === 'default-room') {
      return NextResponse.json({ success: false, message: '不能删除默认群聊' }, { status: 403 });
    }

    const supabase = getServiceClient();

    const [memberRow, roomRow] = await Promise.all([
      supabase.from('room_members').select('user').eq('room_id', id).eq('user', actor).maybeSingle(),
      supabase.from('rooms').select('created_by').eq('id', id).maybeSingle(),
    ]);
    const isOwner = roomRow.data?.created_by === actor;
    if (!memberRow.data && !isOwner) {
      return NextResponse.json({ success: false, message: '只能删除自己所在的群' }, { status: 403 });
    }

    // Delete all messages in the room
    const { error: msgError } = await supabase
      .from('messages')
      .delete()
      .eq('room_id', id);

    if (msgError) {
      console.error('Delete messages failed:', msgError);
    }

    // Delete the room
    const { error } = await supabase
      .from('rooms')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Delete room failed:', error);
      return NextResponse.json({ success: false, message: '删除群聊失败' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/rooms error:', err);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
