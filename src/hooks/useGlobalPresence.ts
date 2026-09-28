'use client';

import { useEffect, useState } from 'react';
import { getGlobalPresence, subscribePresence } from '@/lib/presenceRelay';

export interface GlobalPresenceUser {
  /** Supabase Auth UUID（身份键，绝不存昵称） */
  id: string;
  nickname: string;
}

/**
 * 全局在线状态（跨所有房间）。
 *
 * 设计动机：原先的 `usePresence` 是「按房间」订阅（`presence:<roomId>`），
 * 只有当你和对方「同时打开同一个房间」时，对方才会出现在在线列表——这导致
 * 私聊头部几乎永远显示「离线」（对方在别的群/大厅时你看不到他在线）。
 *
 * 现改走服务端中继：Worker 侧以 `?guid=<UUID>` 为 presence key 加入全局频道
 * `realtime:presence:global` 并代浏览器 track，事件经 SSE 下来合并进 presenceRelay
 * 仓库。私聊/通讯录据此判断对方是否在线，且不再依赖浏览器 WebSocket。
 */
function sameUsers(a: GlobalPresenceUser[], b: GlobalPresenceUser[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].nickname !== b[i].nickname) return false;
  }
  return true;
}

export function useGlobalPresence(nickname: string, myId: string) {
  const [onlineUsers, setOnlineUsers] = useState<GlobalPresenceUser[]>([]);

  useEffect(() => {
    if (!myId) {
      setOnlineUsers([]);
      return;
    }
    const read = () => {
      const next: GlobalPresenceUser[] = [];
      for (const m of getGlobalPresence()) {
        const id = String(m.id || '').trim();
        if (!id) continue;
        next.push({ id, nickname: String(m.nickname || '').trim() });
      }
      setOnlineUsers((prev) => (sameUsers(prev, next) ? prev : next));
    };
    read();
    return subscribePresence(read);
    // nickname 仅作兼容保留：真实上报由 Worker 按 guid 完成，故只依赖 myId
  }, [myId, nickname]);

  return {
    onlineUsers,
    /** 所有在线用户的 UUID 集合（私聊在线判定用） */
    onlineIds: onlineUsers.map((u) => u.id),
    /** 所有在线用户的昵称集合（通讯录在线点用） */
    onlineNicknames: onlineUsers.map((u) => u.nickname),
  };
}
