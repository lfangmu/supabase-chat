'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { UserProfile } from '@/types';
import { API_CONFIG } from '@/config';

/**
 * 用户资料系统（Supabase Auth 版）
 *  - 身份 = Supabase Auth UUID；展示名 = public.users.display_name
 *  - 首次进入时按 UUID 拉取自己的资料，并定时心跳刷新 last_active_at
 *  - 维护「展示名 → 头像」本地缓存，供消息列表 / 会话列表渲染头像
 *
 * 注意：/api/users 的 ?user= / ?users= 参数接收的是 **UUID**，不是展示名；
 *       但出于向后兼容渲染层，avatars 仍以「展示名」为 key。
 */
export function useProfile(userId: string, displayName = '') {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  /** UUID → 展示名（私聊对象解析、头像兜底都要用） */
  const [namesById, setNamesById] = useState<Record<string, string>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  const userIdRef = useRef(userId);
  const nameRef = useRef(displayName);
  const meRef = useRef<UserProfile | null>(null);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { nameRef.current = displayName; }, [displayName]);
  useEffect(() => { meRef.current = me; }, [me]);

  /** 拉取自己的资料（按 UUID） */
  const loadMe = useCallback(async () => {
    const uid = userIdRef.current.trim();
    if (!uid) return null;
    try {
      const res = await fetch(`${API_CONFIG.USERS_ENDPOINT}?user=${encodeURIComponent(uid)}`);
      const json = await res.json();
      if (json.success && json.user) {
        const p = json.user as UserProfile;
        setMe(p);
        if (p.display_name) {
          setAvatars((prev) => ({ ...prev, [p.display_name as string]: p.avatar }));
          setNamesById((prev) => ({ ...prev, [p.id]: p.display_name as string }));
        }
        return p;
      }
    } catch {
      /* 非致命：资料表未就绪时不影响聊天 */
    }
    return null;
  }, []);

  /** 更新自己的资料（展示名 / 头像 / 签名），顺便刷新 last_active_at */
  const upsert = useCallback(async (
    patch: Partial<Pick<UserProfile, 'display_name' | 'avatar' | 'signature'>> = {}
  ) => {
    const uid = userIdRef.current.trim();
    if (!uid) return null;
    // 允许本次直接改展示名；否则沿用当前展示名
    const name = (patch.display_name ?? nameRef.current ?? meRef.current?.display_name ?? '').trim();
    if (!name) return null;
    try {
      const res = await fetch(API_CONFIG.USERS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name, ...patch }),
      });
      const json = await res.json();
      if (json.success && json.user) {
        const p = json.user as UserProfile;
        setMe(p);
        setAvatars((prev) => ({ ...prev, [name]: p.avatar }));
        setNamesById((prev) => ({ ...prev, [p.id]: name }));
        return p;
      }
    } catch {
      /* 非致命 */
    }
    return null;
  }, []);

  // 会话就绪 → 拉资料 + 心跳
  useEffect(() => {
    const uid = userId.trim();
    if (!uid) return;
    loadMe();
    const timer = setInterval(() => { upsert(); }, 60_000);
    return () => clearInterval(timer);
  }, [userId, loadMe, upsert]);

  /** 批量补齐这些用户的头像（入参为 UUID 列表，只请求未拉取过的） */
  const ensureProfiles = useCallback(async (userIds: string[]) => {
    const missing = Array.from(
      new Set(userIds.map((n) => n?.trim()).filter((n): n is string => !!n && !fetchedRef.current.has(n)))
    );
    if (missing.length === 0) return;
    missing.forEach((n) => fetchedRef.current.add(n));
    try {
      const res = await fetch(`${API_CONFIG.USERS_ENDPOINT}?users=${encodeURIComponent(missing.join(','))}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.users)) {
        const list = json.users as UserProfile[];
        setAvatars((prev) => {
          const next = { ...prev };
          for (const u of list) {
            if (u.display_name) next[u.display_name] = u.avatar;
          }
          return next;
        });
        setNamesById((prev) => {
          const next = { ...prev };
          for (const u of list) {
            if (u.display_name) next[u.id] = u.display_name;
          }
          return next;
        });
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  /** 按展示名登记一个已知头像（例如房间列表已带回来的） */
  const registerAvatar = useCallback((name: string, avatar: string | null) => {
    if (!name) return;
    setAvatars((prev) => (name in prev ? prev : { ...prev, [name]: avatar }));
  }, []);

  const saveProfile = useCallback(
    (patch: { avatar?: string | null; signature?: string; display_name?: string }) =>
      upsert({
        ...(patch.display_name !== undefined ? { display_name: patch.display_name } : {}),
        ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
        ...(patch.signature !== undefined ? { signature: patch.signature } : {}),
      }),
    [upsert]
  );

  return { me, avatars, namesById, ensureProfiles, registerAvatar, saveProfile, loadMe };
}
