'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { FriendsData, UserProfile } from '@/types';
import { API_CONFIG } from '@/config';

interface UseFriendsParams {
  user: string;
  enabled?: boolean;
}

/** 好友系统：拉取好友全景 + 申请/通过/拒绝/删除/拉黑 动作 */
export function useFriends({ user, enabled = true }: UseFriendsParams) {
  const [data, setData] = useState<FriendsData>({ friends: [], incoming: [], outgoing: [], blocked: [] });
  const [loading, setLoading] = useState(false);
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const load = useCallback(async () => {
    const u = userRef.current.trim();
    if (!u || !enabled) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_CONFIG.FRIENDS_ENDPOINT}?user=${encodeURIComponent(u)}`);
      const json = await res.json();
      if (json.success) setData(json as FriendsData);
    } catch {
      /* 非致命 */
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  const sendRequest = useCallback(async (target: string) => {
    const res = await fetch(API_CONFIG.FRIENDS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: userRef.current.trim(), target: target.trim() }),
    });
    const json = await res.json();
    if (json.success) await load();
    return json;
  }, [load]);

  const respond = useCallback(async (target: string, action: 'accept' | 'reject') => {
    const res = await fetch(API_CONFIG.FRIENDS_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: userRef.current.trim(), target: target.trim(), action }),
    });
    const json = await res.json();
    if (json.success) await load();
    return json;
  }, [load]);

  const removeOrBlock = useCallback(async (target: string, action: 'remove' | 'block' | 'unblock') => {
    const res = await fetch(API_CONFIG.FRIENDS_ENDPOINT, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: userRef.current.trim(), target: target.trim(), action }),
    });
    const json = await res.json();
    if (json.success) await load();
    return json;
  }, [load]);

  /** 判断 target 是否为当前用户的好友 */
  const isFriend = useCallback((target: string) => {
    const t = target.trim();
    return data.friends.some((f) => f.nickname === t);
  }, [data.friends]);

  return { data, loading, load, sendRequest, respond, removeOrBlock, isFriend };
}
