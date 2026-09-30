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

/**
 * 批量版 `isRoomParticipant`：一次性筛出 `candidateIds` 中 actor 真正可读的房间。
 *
 * 与逐个调用 `isRoomParticipant` 同源语义，但把 N 次往返压成 2 次：
 *   1. `room_members` 中 actor 的成员行（仅针对候选 id）
 *   2. `rooms` 中 `created_by = actor` 的候选 id
 *   `dm:` 前缀房间号内嵌参与方 UUID，纯字符串判定，不查库。
 *
 * **失败即关闭（fail-closed）**：任一查询出错时对应来源贡献 0 个房间，
 * 绝不放行「查询失败 → 全量返回」。
 *
 * @param candidateIds 待判定的房间 id（调用方需已做长度上限与去重）
 * @param actor 当前登录用户的 Supabase Auth UUID
 * @param supabase 任意客户端（service_role 或 anon 均可）
 * @returns 可读房间 id 集合
 */
export async function filterReadableRooms(
  candidateIds: string[],
  actor: string,
  supabase: SupabaseClient
): Promise<Set<string>> {
  const result = new Set<string>();
  if (!actor || candidateIds.length === 0) return result;

  const dmIds: string[] = [];
  const groupIds: string[] = [];
  for (const id of candidateIds) {
    if (id === 'default-room') {
      // 全局公共大厅：任何已登录用户可读
      result.add(id);
    } else if (id.startsWith('dm:')) {
      dmIds.push(id);
    } else {
      groupIds.push(id);
    }
  }

  for (const id of dmIds) {
    if (isDMParticipant(id, actor)) result.add(id);
  }

  if (groupIds.length === 0) return result;

  const [memberRes, roomRes] = await Promise.all([
    supabase.from('room_members').select('room_id').eq('user_id', actor).in('room_id', groupIds),
    supabase.from('rooms').select('id').eq('created_by', actor).in('id', groupIds),
  ]);

  if (memberRes.error) {
    console.error('filterReadableRooms: 查询 room_members 失败', memberRes.error);
  } else {
    (memberRes.data || []).forEach((r: { room_id: string }) => result.add(r.room_id));
  }

  if (roomRes.error) {
    console.error('filterReadableRooms: 查询 rooms 失败', roomRes.error);
  } else {
    (roomRes.data || []).forEach((r: { id: string }) => result.add(r.id));
  }

  return result;
}
