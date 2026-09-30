import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/service-client';
import { getAuthUser } from '@/lib/auth-user';
import { isRoomParticipant } from '@/lib/rooms';
import { isValidRoomId, isValidUuid } from '@/lib/validate';

export const runtime = 'edge';


interface MemberRow {
  room_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
}

/**
 * P2-6：校验一组用户 UUID 既**格式合法**又**真实存在**于 `users` 表。
 * 此前建群 `members` / 拉人 `add` 直接入库，可写入不存在的 UUID → 脏数据
 * （群成员列表出现 null 展示名的幽灵成员）。
 *
 * @returns 非法/不存在的 id 数组（空数组表示全部通过）
 */
async function findInvalidUserIds(
  supabase: ReturnType<typeof getServiceClient>,
  ids: string[]
): Promise<string[]> {
  const badFormat = ids.filter((id) => !isValidUuid(id));
  const wellFormed = ids.filter((id) => isValidUuid(id));
  if (wellFormed.length === 0) return badFormat;

  const { data, error } = await supabase.from('users').select('id').in('id', wellFormed);
  if (error) {
    // 查询失败即视为不可信 → 全部拒绝（fail-closed）
    console.error('findInvalidUserIds: 查询 users 失败', error);
    return ids;
  }
  const known = new Set((data || []).map((u: { id: string }) => u.id));
  return [...badFormat, ...wellFormed.filter((id) => !known.has(id))];
}

/**
 * GET /api/rooms/members?roomId=X — 群成员列表（含头像/展示名/角色）
 */
export async function GET(request: NextRequest) {
  try {
    const roomId = request.nextUrl.searchParams.get('roomId')?.trim();
    if (!roomId) {
      return NextResponse.json({ success: false, message: '缺少房间 ID' }, { status: 400 });
    }
    if (!isValidRoomId(roomId)) {
      return NextResponse.json({ success: false, message: '无效的房间 ID' }, { status: 400 });
    }
    // 仅群成员可查看成员列表（防枚举任意群的成员关系）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const supabase = getServiceClient();
    if (!(await isRoomParticipant(roomId, actor, supabase))) {
      return NextResponse.json(
        { success: false, message: '无权查看该群成员' },
        { status: 403 }
      );
    }
    const { data: members, error } = await supabase
      .from('room_members')
      .select('room_id, user_id, role, joined_at')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });
    if (error) {
      return NextResponse.json({ success: false, message: '获取成员失败' }, { status: 500 });
    }
    const uuids = (members || []).map((m: MemberRow) => m.user_id);
    const { data: profiles } = await supabase
      .from('users')
      .select('id, display_name, avatar, signature')
      .in('id', uuids);
    const pm = new Map((profiles || []).map((p: { id: string; display_name: string | null; avatar: string | null; signature: string | null }) => [p.id, p]));
    const list = (members || []).map((m: MemberRow) => ({
      id: m.user_id,
      display_name: pm.get(m.user_id)?.display_name ?? null,
      role: m.role,
      joined_at: m.joined_at,
      avatar: pm.get(m.user_id)?.avatar ?? null,
      signature: pm.get(m.user_id)?.signature ?? '',
    }));
    return NextResponse.json({ success: true, members: list });
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/members
 *  - 建群: { name, owner, members:[...] } → 建 room + 写入 owner/members，返回 roomId
 *  - 拉人: { roomId, add:[...] }          → 向已有群添加成员
 */
export async function POST(request: NextRequest) {
  try {
    // 建群/拉人都以本人身份操作（防伪造群主、向非自己所在群拉人）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const supabase = getServiceClient();

    // 建群
    if (body.name && body.owner) {
      const name = String(body.name).trim();
      const owner = String(body.owner).trim();
      const members: string[] = Array.isArray(body.members) ? body.members.map((m: string) => String(m).trim()).filter(Boolean) : [];
      if (!name || name.length > 50) {
        return NextResponse.json({ success: false, message: '群名不合法' }, { status: 400 });
      }
      if (owner !== actor) {
        return NextResponse.json({ success: false, message: '只能以本人身份建群' }, { status: 403 });
      }
      if (members.length < 1) {
        return NextResponse.json({ success: false, message: '群聊至少需要 1 名成员' }, { status: 400 });
      }
      // P2-6：成员必须是「格式合法 + 真实存在」的 UUID，拒绝脏数据
      const candidateIds = Array.from(new Set([owner, ...members.filter((m: string) => m !== owner)]));
      const invalid = await findInvalidUserIds(supabase, candidateIds);
      if (invalid.length > 0) {
        return NextResponse.json(
          { success: false, message: `存在无效或不存在成员（${invalid.slice(0, 3).join('、')}）` },
          { status: 400 }
        );
      }
      const roomId = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      const { error: re } = await supabase.from('rooms').insert({
        id: roomId,
        name,
        created_by: owner,
        created_at: new Date().toISOString(),
        type: 'public',
      });
      if (re) return NextResponse.json({ success: false, message: '创建群聊失败' }, { status: 500 });

      const rows = [owner, ...members.filter((m: string) => m !== owner)].map((u: string, i: number) => ({
        room_id: roomId,
        user_id: u,
        role: i === 0 ? 'owner' : 'member',
      }));
      const { error: me } = await supabase.from('room_members').insert(rows);
      if (me) return NextResponse.json({ success: false, message: '写入成员失败' }, { status: 500 });
      return NextResponse.json({ success: true, roomId });
    }

    // 自助入群：{ roomId, join: true }
    // 进入/加入一个公开群聊时调用，幂等写一条自己的成员行。
    // 必须落库——实时消息走 Postgres Changes + RLS，RLS 的 is_room_participant()
    // 只认 room_members 里的真实行，localStorage 里的「已加入」记录对 RLS 无效。
    if (body.roomId && body.join === true) {
      const roomId = String(body.roomId).trim();
      if (!isValidRoomId(roomId)) {
        return NextResponse.json({ success: false, message: '无效的房间 ID' }, { status: 400 });
      }
      const { data: room } = await supabase
        .from('rooms')
        .select('id, type')
        .eq('id', roomId)
        .maybeSingle();
      if (!room) {
        return NextResponse.json({ success: false, message: '房间不存在' }, { status: 404 });
      }
      if (room.type === 'dm') {
        return NextResponse.json({ success: false, message: '私聊无需加入' }, { status: 400 });
      }
      // ignoreDuplicates：已在群里（含群主/管理员）时保持原角色，绝不被降级
      const { error } = await supabase
        .from('room_members')
        .upsert(
          { room_id: roomId, user_id: actor, role: 'member' },
          { onConflict: 'room_id,user_id', ignoreDuplicates: true }
        );
      if (error) {
        return NextResponse.json({ success: false, message: '加入失败' }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    // 拉人进已有群
    if (body.roomId && Array.isArray(body.add)) {
      const roomId = String(body.roomId).trim();
      if (!isValidRoomId(roomId)) {
        return NextResponse.json({ success: false, message: '无效的房间 ID' }, { status: 400 });
      }
      const add: string[] = Array.from(
        new Set(body.add.map((m: string) => String(m).trim()).filter(Boolean))
      );
      if (!add.length) return NextResponse.json({ success: false, message: '无成员' }, { status: 400 });
      // 仅群成员可拉人（WeChat 行为：群员可邀请）
      const { data: me } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', roomId)
        .eq('user_id', actor)
        .maybeSingle();
      if (!me) {
        return NextResponse.json({ success: false, message: '仅群成员可拉人' }, { status: 403 });
      }
      // P2-6：被拉的人必须是「格式合法 + 真实存在」的 UUID
      const invalid = await findInvalidUserIds(supabase, add);
      if (invalid.length > 0) {
        return NextResponse.json(
          { success: false, message: `存在无效或不存在成员（${invalid.slice(0, 3).join('、')}）` },
          { status: 400 }
        );
      }
      // 已在群内的人跳过（此前直接 insert 会撞唯一键 → 500「添加失败」）
      const { data: existingRows } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', roomId)
        .in('user_id', add);
      const alreadyIn = new Set((existingRows || []).map((r: { user_id: string }) => r.user_id));
      const rows = add
        .filter((u: string) => !alreadyIn.has(u))
        .map((u: string) => ({ room_id: roomId, user_id: u, role: 'member' as const }));
      if (rows.length === 0) {
        // 全员已在群内 → 幂等成功，不是错误
        return NextResponse.json({ success: true, added: 0, skipped: add.length });
      }
      const { error } = await supabase.from('room_members').insert(rows).select();
      if (error) return NextResponse.json({ success: false, message: '添加失败' }, { status: 500 });
      return NextResponse.json({ success: true, added: rows.length, skipped: add.length - rows.length });
    }

    return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/**
 * PUT /api/rooms/members — 改角色 / 转让群主（仅群主）
 * body: { roomId, user, target, role: 'owner' | 'admin' | 'member' }
 *
 * P2-7 修复要点：
 *  1. 校验 `target` **确实是本群成员**（此前不校验，可给群外用户写入角色行）；
 *  2. `role: 'owner'` 视为**转让群主**，服务端原子完成「旧群主降级 + 新群主上位 +
 *     rooms.created_by 改指新群主」，杜绝出现**多个群主**。
 *     （此前客户端要连发两次 PUT，而第二次会因「自己已不是群主」被 403，
 *      旧群主角色残留 → 群里长期存在两个 owner。）
 *  3. 允许「已非群主者把自己设为 member」的幂等调用，兼容上述转让流程的第二次请求。
 */
export async function PUT(request: NextRequest) {
  try {
    // 只能以本人身份管理成员（防伪造群主改他人角色）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const { roomId, user, target, role } = body;
    if (
      !isValidRoomId(roomId) ||
      !isValidUuid(user) ||
      !isValidUuid(target) ||
      !['admin', 'member', 'owner'].includes(role)
    ) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }
    if (user !== actor) {
      return NextResponse.json({ success: false, message: '只能以本人身份管理成员' }, { status: 403 });
    }
    const supabase = getServiceClient();

    // 群主判定：rooms.created_by 或 room_members.role='owner'
    const [roomRow, meRow, targetRow] = await Promise.all([
      supabase.from('rooms').select('created_by').eq('id', roomId).maybeSingle(),
      supabase.from('room_members').select('role').eq('room_id', roomId).eq('user_id', actor).maybeSingle(),
      supabase.from('room_members').select('role').eq('room_id', roomId).eq('user_id', target).maybeSingle(),
    ]);
    const isOwner = roomRow.data?.created_by === actor || meRow.data?.role === 'owner';

    // P2-7(1)：target 必须在本群内
    if (!targetRow.data) {
      return NextResponse.json({ success: false, message: '该用户不在群内' }, { status: 404 });
    }

    if (!isOwner) {
      // P2-7(3)：转让后的幂等自降级（把已是 member 的自己再设为 member）
      if (target === actor && role === 'member') {
        const { error } = await supabase
          .from('room_members')
          .update({ role: 'member' })
          .eq('room_id', roomId)
          .eq('user_id', actor);
        if (error) {
          console.error('PUT /api/rooms/members 幂等自降级失败:', error);
          return NextResponse.json({ success: false, message: '修改失败' }, { status: 500 });
        }
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ success: false, message: '仅群主可管理成员' }, { status: 403 });
    }

    if (role === 'owner') {
      // P2-7(2)：转让群主 —— 原子化，保证任何时刻只有一个 owner
      const { error: demoteError } = await supabase
        .from('room_members')
        .update({ role: 'member' })
        .eq('room_id', roomId)
        .eq('role', 'owner')
        .neq('user_id', target);
      if (demoteError) {
        console.error('转让群主：旧群主降级失败', demoteError);
        return NextResponse.json({ success: false, message: '转让失败' }, { status: 500 });
      }
      const { error: promoteError } = await supabase
        .from('room_members')
        .update({ role: 'owner' })
        .eq('room_id', roomId)
        .eq('user_id', target);
      if (promoteError) {
        console.error('转让群主：新群主上位失败', promoteError);
        return NextResponse.json({ success: false, message: '转让失败' }, { status: 500 });
      }
      // rooms.created_by 语义上即「当前群主」，需同步改指，否则旧群主仍被当作群主
      const { error: roomError } = await supabase
        .from('rooms')
        .update({ created_by: target })
        .eq('id', roomId);
      if (roomError) {
        console.error('转让群主：更新 rooms.created_by 失败', roomError);
      }
      return NextResponse.json({ success: true });
    }

    const { error } = await supabase
      .from('room_members')
      .update({ role })
      .eq('room_id', roomId)
      .eq('user_id', target);
    if (error) {
      console.error('PUT /api/rooms/members 修改角色失败:', error);
      return NextResponse.json({ success: false, message: '修改失败' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

/**
 * DELETE /api/rooms/members — 移除成员 / 退群
 * body: { roomId, user, target }
 *  - target === user：自己退群
 *  - 否则：仅群主可移除；群主退群时把群主转给最早的管理员/成员
 */
export async function DELETE(request: NextRequest) {
  try {
    // 只能以本人身份退群/移除（防伪造他人退群或群主移除）
    const actor = await getAuthUser(request);
    if (!actor) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    const body = await request.json();
    const { roomId, user, target } = body;
    if (!isValidRoomId(roomId) || !isValidUuid(user) || !isValidUuid(target)) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }
    if (user !== actor) {
      return NextResponse.json({ success: false, message: '只能以本人身份操作' }, { status: 403 });
    }
    const supabase = getServiceClient();

    const selfLeave = user === target;
    if (!selfLeave) {
      const { data: me } = await supabase.from('room_members').select('role').eq('room_id', roomId).eq('user_id', user).maybeSingle();
      const { data: roomRow } = await supabase.from('rooms').select('created_by').eq('id', roomId).maybeSingle();
      const isOwner = roomRow?.created_by === user || me?.role === 'owner';
      if (!isOwner) {
        return NextResponse.json({ success: false, message: '仅群主可移除成员' }, { status: 403 });
      }
    }

    // 群主退群：转让
    if (selfLeave) {
      const { data: me } = await supabase.from('room_members').select('role').eq('room_id', roomId).eq('user_id', user).maybeSingle();
      if (me?.role === 'owner') {
        const { data: others } = await supabase
          .from('room_members')
          .select('user_id, role, joined_at')
          .eq('room_id', roomId)
          .neq('user_id', user)
          .order('joined_at', { ascending: true })
          .limit(1);
        const successor = others?.[0];
        if (successor) {
          await supabase.from('room_members').update({ role: 'owner' }).eq('room_id', roomId).eq('user_id', successor.user_id);
          // 与 PUT 的转让语义保持一致：rooms.created_by 即「当前群主」
          const { error: roomError } = await supabase
            .from('rooms')
            .update({ created_by: successor.user_id })
            .eq('id', roomId);
          if (roomError) console.error('群主退群：更新 rooms.created_by 失败', roomError);
        } else {
          // 群空了 → 删群（同时清理成员行，避免孤儿行让 /api/rooms/mine 复活幽灵房间）
          await supabase.from('rooms').delete().eq('id', roomId);
          await supabase.from('room_members').delete().eq('room_id', roomId);
          return NextResponse.json({ success: true, roomDeleted: true });
        }
      }
    }

    const { error } = await supabase.from('room_members').delete().eq('room_id', roomId).eq('user_id', target);
    if (error) return NextResponse.json({ success: false, message: '移除失败' }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
