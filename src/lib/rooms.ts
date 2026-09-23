import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 判定 actor 是否为房间的「可读成员」，用于读接口的权限校验。
 *
 * - `default-room`：全局公共大厅，任何已登录用户均可读。
 * - 私聊房间（ID 形如 `dm:A:B`）：actor 须为其中一方参与者。
 * - 普通群：`room_members` 中存在 (room_id, actor) 一行，或 actor 为房间创建者。
 *
 * 使用匿名 key 的 supabase 客户端即可（room_members / rooms 的 SELECT 对匿名可见，
 * 与既有 GET /api/rooms/members 一致）；传入 service-role 客户端也同样可用。
 */
export async function isRoomParticipant(
  roomId: string,
  actor: string,
  supabase: SupabaseClient
): Promise<boolean> {
  if (!roomId || !actor) return false;

  // 全局公共大厅
  if (roomId === 'default-room') return true;

  // 私聊房间：ID = dm:A:B
  if (roomId.startsWith('dm:')) {
    const participants = roomId.slice(3).split(':');
    return participants.includes(actor);
  }

  // 普通群：成员行或创建者
  const [memberRes, roomRes] = await Promise.all([
    supabase
      .from('room_members')
      .select('user')
      .eq('room_id', roomId)
      .eq('user', actor)
      .maybeSingle(),
    supabase.from('rooms').select('created_by').eq('id', roomId).maybeSingle(),
  ]);

  if (memberRes.data) return true;
  return roomRes.data?.created_by === actor;
}
