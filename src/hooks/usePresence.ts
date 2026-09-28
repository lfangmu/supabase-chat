'use client';

import { useEffect, useState } from 'react';
import {
  getRoomPresence,
  subscribePresence,
  type RelayPresenceMeta,
} from '@/lib/presenceRelay';

export interface PresenceUser {
  id: string;
  nickname: string;
  online_at: string;
}

/**
 * 按房间的在线用户（群聊头部「X 人在线」）。
 *
 * 已从 supabase.channel(presence:<roomId>) 改为消费服务端中继：
 * Worker 侧以 `?userId=user-<昵称>` 为 presence key 代浏览器 track，
 * presence_state / presence_diff 经 SSE 下来后合并进 presenceRelay 仓库，
 * 这里只负责读取 + 渲染。这样在线列表也走 HTTP，不依赖国内被掐的浏览器 WebSocket。
 */
function toUsers(metas: RelayPresenceMeta[]): PresenceUser[] {
  const users: PresenceUser[] = [];
  for (const m of metas) {
    const nickname = String(m.nickname || '').trim();
    if (!nickname) continue;
    users.push({
      id: String(m.id || ''),
      nickname,
      online_at: String(m.online_at || ''),
    });
  }
  // 按 online_at 倒序（与旧实现保持一致）
  users.sort(
    (a, b) => new Date(b.online_at || 0).getTime() - new Date(a.online_at || 0).getTime()
  );
  return users;
}

function sameUsers(a: PresenceUser[], b: PresenceUser[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].nickname !== b[i].nickname || a[i].online_at !== b[i].online_at) {
      return false;
    }
  }
  return true;
}

export function usePresence(roomId: string, nickname: string) {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  // Stable userId based on nickname — prevents ghost entries on remount
  const userId = `user-${nickname.trim() || 'anonymous'}`;

  useEffect(() => {
    if (!roomId) {
      setOnlineUsers([]);
      return;
    }
    const read = () => {
      const next = toUsers(getRoomPresence(roomId));
      // 内容不变时保持原引用，避免 presence 事件引发无谓重渲染
      setOnlineUsers((prev) => (sameUsers(prev, next) ? prev : next));
    };
    read();
    return subscribePresence(read);
  }, [roomId]);

  return { onlineUsers, userId };
}
