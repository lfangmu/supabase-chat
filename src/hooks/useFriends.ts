'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { FriendsData } from '@/types';
import { API_CONFIG } from '@/config';
import { showSuccess } from '@/utils/errorHandler';

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

  // 已见过的「待通过申请」UUID 集合，用于轮询时识别「新增申请」并弹提醒
  const seenIncomingRef = useRef<Set<string>>(new Set());
  // 首屏加载不弹 toast，避免把历史存量申请当成「新通知」轰炸用户
  const firstLoadRef = useRef(true);

  const load = useCallback(async () => {
    const u = userRef.current.trim();
    if (!u || !enabled) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_CONFIG.FRIENDS_ENDPOINT}?user=${encodeURIComponent(u)}`);
      const json = await res.json();
      if (json.success) {
        const incoming: { id: string; display_name: string }[] = json.incoming || [];
        // 实时提醒：轮询发现「新增的待通过申请」时弹 toast（首屏加载不弹）
        if (!firstLoadRef.current) {
          const fresh = incoming.filter((x) => !seenIncomingRef.current.has(x.id));
          for (const f of fresh) {
            showSuccess(`收到来自 ${f.display_name || '新用户'} 的好友申请`);
          }
        }
        firstLoadRef.current = false;
        seenIncomingRef.current = new Set(incoming.map((x) => x.id));
        setData(json as FriendsData);
      }
    } catch {
      /* 非致命 */
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  // 好友申请无服务端实时推送：每 15s 轮询一次，保证对方发来申请时能及时（红点 + toast）提醒。
  // 与房间 30s 对账、@提及 10s 轮询同属「轻量周期性刷新」策略，无需额外后端改造。
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => { load(); }, 15_000);
    return () => clearInterval(timer);
  }, [load, enabled]);

  const sendRequest = useCallback(async (target: string) => {
    const me = userRef.current.trim();
    // 身份未初始化（myId 为空）时不再发出坏请求，直接给清晰提示，便于定位登录态问题
    if (!me) {
      return { success: false, message: '身份未初始化，请重新登录后重试' };
    }
    const res = await fetch(API_CONFIG.FRIENDS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: me, target: target.trim() }),
    });
    const json = await res.json();
    if (json.success) await load();
    return json;
  }, [load]);

  const respond = useCallback(async (target: string, action: 'accept' | 'reject') => {
    const me = userRef.current.trim();
    if (!me) {
      return { success: false, message: '身份未初始化，请重新登录后重试' };
    }
    const res = await fetch(API_CONFIG.FRIENDS_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: me, target: target.trim(), action }),
    });
    const json = await res.json();
    if (json.success) await load();
    return json;
  }, [load]);

  const removeOrBlock = useCallback(async (target: string, action: 'remove' | 'block' | 'unblock') => {
    const me = userRef.current.trim();
    if (!me) {
      return { success: false, message: '身份未初始化，请重新登录后重试' };
    }
    const res = await fetch(API_CONFIG.FRIENDS_ENDPOINT, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: me, target: target.trim(), action }),
    });
    const json = await res.json();
    if (json.success) await load();
    return json;
  }, [load]);

  /** 判断 target（用户 UUID）是否为当前用户的好友 */
  const isFriend = useCallback((target: string) => {
    const t = target.trim();
    return data.friends.some((f) => f.id === t);
  }, [data.friends]);

  return { data, loading, load, sendRequest, respond, removeOrBlock, isFriend };
}
