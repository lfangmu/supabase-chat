'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { RoomMember } from '@/types';
import { API_CONFIG } from '@/config';

/** 群成员管理：拉取成员、建群、拉人、改角色、移除/退群 */
export function useRoomMembers(roomId: string, enabled = true) {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [loading, setLoading] = useState(false);
  const roomIdRef = useRef(roomId);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  const load = useCallback(async () => {
    const rid = roomIdRef.current;
    if (!rid || !enabled || rid.startsWith('dm:')) {
      setMembers([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_CONFIG.ROOM_MEMBERS_ENDPOINT}?roomId=${encodeURIComponent(rid)}`);
      const json = await res.json();
      if (json.success) setMembers(json.members as RoomMember[]);
    } catch {
      /* 非致命 */
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load, roomId]);

  const addMembers = useCallback(async (add: string[]) => {
    const res = await fetch(API_CONFIG.ROOM_MEMBERS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: roomIdRef.current, add }),
    });
    const json = await res.json();
    if (json.success) await load();
    return json;
  }, [load]);

  const setRole = useCallback(async (user: string, target: string, role: 'owner' | 'admin' | 'member') => {
    const res = await fetch(API_CONFIG.ROOM_MEMBERS_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: roomIdRef.current, user, target, role }),
    });
    const json = await res.json();
    if (json.success) await load();
    return json;
  }, [load]);

  const removeMember = useCallback(async (user: string, target: string) => {
    const res = await fetch(API_CONFIG.ROOM_MEMBERS_ENDPOINT, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: roomIdRef.current, user, target }),
    });
    const json = await res.json();
    if (json.success) await load();
    return json;
  }, [load]);

  return { members, loading, load, addMembers, setRole, removeMember };
}

/** 建群（不依赖当前房间上下文） */
export async function createGroup(name: string, owner: string, members: string[]) {
  const res = await fetch(API_CONFIG.ROOM_MEMBERS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, owner, members }),
  });
  return res.json() as Promise<{ success: boolean; roomId?: string; message?: string }>;
}
