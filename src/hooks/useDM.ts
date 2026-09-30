'use client';

import { useState, useCallback, useEffect } from 'react';
import { DMRoom } from '@/types';
import { DM_CONFIG, API_CONFIG } from '@/config';

interface UseDMParams {
  /** 当前用户的 Supabase Auth UUID */
  currentUserId: string;
  onSwitchRoom: (roomId: string) => void;
}

/**
 * 由两位参与者的 UUID 生成「双向唯一」的私聊房间 ID。
 * 形如 dm:<uuidA>:<uuidB>（按字典序排序，保证两人视角一致）。
 */
export function generateDMRoomId(userA: string, userB: string): string {
  const a = userA.trim();
  const b = userB.trim();
  const sorted = [a, b].sort((x, y) => x.localeCompare(y));
  return `${DM_CONFIG.ID_PREFIX}${sorted.join(':')}`;
}

/**
 * 从私聊房间 ID 中解析出「另一参与者」的 UUID。
 * 仅在房间确实属于 currentUserId 时返回；否则返回 null（说明这不是我的私聊）。
 */
export function getDMOtherUser(roomId: string, currentUserId: string): string | null {
  if (!roomId.startsWith(DM_CONFIG.ID_PREFIX)) return null;
  const rest = roomId.slice(DM_CONFIG.ID_PREFIX.length); // e.g. "<uuidA>:<uuidB>"
  const parts = rest.split(':');
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!a || !b) return null;
  const user = currentUserId.trim();
  if (user === a) return b;
  if (user === b) return a;
  return null;
}

/** 判断某私聊房间是否属于 currentUserId（无需解析展示名） */
export function isUserInDMRoom(roomId: string, currentUserId: string): boolean {
  return getDMOtherUser(roomId, currentUserId) !== null;
}

export function useDM({ currentUserId, onSwitchRoom }: UseDMParams) {
  const [dmRooms, setDmRooms] = useState<DMRoom[]>([]);

  /** Load DM rooms for the current user */
  const loadDMs = useCallback(async () => {
    const uid = currentUserId.trim();
    if (!uid) return;

    try {
      // P2-10：服务端已支持游标分页（每页 200，返回 hasMore/nextCursor）。
      // 这里循环取全，避免私聊超过一页时静默丢失（页数上限兜底，防异常循环）。
      const all: DMRoom[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const params = new URLSearchParams({ user: uid });
        if (cursor) params.set('before', cursor);
        const res = await fetch(`${API_CONFIG.DM_LIST_ENDPOINT}?${params}`);
        const data = await res.json();
        if (!data.success || !Array.isArray(data.rooms)) break;
        all.push(...(data.rooms as DMRoom[]));
        if (!data.hasMore || !data.nextCursor) break;
        cursor = data.nextCursor as string;
      }
      setDmRooms(all);
    } catch {
      // Non-fatal
    }
  }, [currentUserId]);

  // Load DMs when user changes
  useEffect(() => {
    loadDMs();
  }, [loadDMs]);

  /** Start a DM with another user (creates room if not exists, then switches to it) */
  const startDM = useCallback(
    async (otherUserId: string): Promise<string | null> => {
      const me = currentUserId.trim();
      const other = otherUserId.trim();

      if (!me || !other || me === other) return null;

      const dmRoomId = generateDMRoomId(me, other);

      // 先切换到该私聊会话，消除「先闪一下默认聊天室再跳到私聊」的观感；
      // 建房间 / 拉列表在后台异步进行（messages 无 rooms 外键，提前切换不影响发消息）。
      onSwitchRoom(dmRoomId);

      try {
        // Create DM room (idempotent — upsert with ON CONFLICT DO NOTHING)
        await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'dm',
            id: dmRoomId,
            created_by: me,
            participants: [me, other],
          }),
        });

        // Refresh DM list
        await loadDMs();

        return dmRoomId;
      } catch {
        return null;
      }
    },
    [currentUserId, loadDMs, onSwitchRoom]
  );

  return {
    dmRooms,
    loadDMs,
    startDM,
  };
}
