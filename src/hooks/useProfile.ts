'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { UserProfile } from '@/types';
import { API_CONFIG } from '@/config';

/**
 * 用户资料系统：
 *  - 昵称确定后自动 upsert 到 users 表（等同「注册」）
 *  - 定时心跳刷新 last_active_at（在线状态兜底）
 *  - 维护 昵称 → 头像 的本地缓存，供消息列表 / 会话列表渲染头像
 */
export function useProfile(user: string) {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const upsert = useCallback(async (patch: Partial<Pick<UserProfile, 'avatar' | 'signature'>> = {}) => {
    const u = userRef.current.trim();
    if (!u) return null;
    try {
      const res = await fetch(API_CONFIG.USERS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: u, ...patch }),
      });
      const json = await res.json();
      if (json.success && json.user) {
        setMe(json.user as UserProfile);
        setAvatars((prev) => ({ ...prev, [u]: (json.user as UserProfile).avatar }));
        return json.user as UserProfile;
      }
    } catch {
      /* 非致命：资料表未就绪时不影响聊天 */
    }
    return null;
  }, []);

  // 昵称确定 → 建档 + 心跳
  useEffect(() => {
    const u = user.trim();
    if (!u) return;
    fetchedRef.current.add(u);
    upsert();
    const timer = setInterval(() => { upsert(); }, 60_000);
    return () => clearInterval(timer);
  }, [user, upsert]);

  /** 批量补齐这些昵称的头像（只请求未拉取过的） */
  const ensureProfiles = useCallback(async (nicknames: string[]) => {
    const missing = Array.from(
      new Set(nicknames.map((n) => n?.trim()).filter((n): n is string => !!n && !fetchedRef.current.has(n)))
    );
    if (missing.length === 0) return;
    missing.forEach((n) => fetchedRef.current.add(n));
    try {
      const res = await fetch(`${API_CONFIG.USERS_ENDPOINT}?users=${encodeURIComponent(missing.join(','))}`);
      const json = await res.json();
      setAvatars((prev) => {
        const next = { ...prev };
        for (const n of missing) if (!(n in next)) next[n] = null;
        if (json.success && Array.isArray(json.users)) {
          for (const u of json.users as UserProfile[]) next[u.nickname] = u.avatar;
        }
        return next;
      });
    } catch {
      /* 忽略 */
    }
  }, []);

  const saveProfile = useCallback(
    (patch: { avatar?: string | null; signature?: string }) =>
      upsert({
        ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
        ...(patch.signature !== undefined ? { signature: patch.signature } : {}),
      }),
    [upsert]
  );

  return { me, avatars, ensureProfiles, saveProfile };
}
