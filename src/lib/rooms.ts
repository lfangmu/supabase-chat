import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 同步判定：DM 房间号 `dm:<uuidA>:<uuidB>` 是否包含 actor（纯字符串，不查库）。
 * 房间号内嵌两方 UUID，可作为「我是参与方」的权威判据（无需信任请求体）。
 */
export function isDMParticipant(roomId: string, actor: string): boolean {
  if (!roomId.startsWith('dm:') || !actor) return false;
  return roomId.slice(3).split(':').includes(actor);
}

/**
 * 判定 actor（Supabase Auth 的 UUID）是否为房间的「可读成员」，用于读接口的权限校验。
 *
 * - `default-room`：全局公共大厅，任何已登录用户均可读。
 * - 私聊房间（ID 形如 `dm:<uuidA>:<uuidB>`）：actor 须为其中一方参与者。
 * - 普通群：`room_members` 中存在 (room_id, actor) 一行，或 actor 为房间创建者。
 *
 * 数据库侧的 RLS 通过 `is_room_participant(room_id, auth.uid())` 已做到同源校验；
 * 此 TS 版用于 API 路由内部需要「先判权限再读」的场景（如构建 DM 列表）。
 * 使用匿名 key 的 supabase 客户端即可（room_members / rooms 的 SELECT 对 authenticated 可见）。
 */
export async function isRoomParticipant(
  roomId: string,
  actor: string,
  supabase: SupabaseClient
): Promise<boolean> {
  if (!roomId || !actor) return false;

  // 全局公共大厅
  if (roomId === 'default-room') return true;

  // 私聊房间：ID = dm:<uuidA>:<uuidB>
  if (roomId.startsWith('dm:')) {
    return isDMParticipant(roomId, actor);
  }

  // 普通群：成员行或创建者
  const [memberRes, roomRes] = await Promise.all([
    supabase.from('room_members').select('user_id').eq('room_id', roomId).eq('user_id', actor).maybeSingle(),
    supabase.from('rooms').select('created_by').eq('id', roomId).maybeSingle(),
  ]);

  if (memberRes.data) return true;
  return roomRes.data?.created_by === actor;
}
