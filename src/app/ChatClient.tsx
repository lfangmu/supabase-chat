'use client';

import React, { useState, useEffect, useCallback } from 'react';
import AuthScreen from '@/components/AuthScreen';
import ChatApp from '@/components/chat/ChatApp';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { API_CONFIG } from '@/config';
import type { CurrentUser } from '@/lib/identity';

/**
 * Root client component — 注册/登录门禁。
 *
 * Flow:
 *   checking → spinner
 *   unauthenticated (no Supabase session) → AuthScreen（匿名 / 邮箱登录 / 注册）
 *   authenticated → ChatApp（主聊天界面）。display_name 为空时由 ChatApp 引导设置。
 *
 * 身份来源：supabase.auth.getUser() 给出 UUID / email / is_anonymous；
 * GET /api/me 给出 public.users 的展示名 / 头像 / 角色。两者合并为 CurrentUser。
 */
export default function ChatClient() {
  const [checking, setChecking] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  /**
   * 重新探测会话身份。
   *
   * `silent` = 静默刷新：**不置 `checking`**。
   * 这是必须的：`checking === true` 会渲染全屏 loading，从而把整个 `<ChatApp>` **卸载**，
   * 刷新完成后重新挂载 → 用户在 ChatApp 里的全部本地状态（当前 tab、打开的会话、
   * 滚动位置、草稿输入）都被重置。改昵称后回读资料就属于这种情况，会表现为
   * 「提交后页面像刷新了一样，跳回消息 tab」。
   * 静默刷新只更新 `currentUser`，组件树保持挂载。
   */
  const loadSession = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setChecking(true);
    try {
      if (!supabase) {
        setCurrentUser(null);
        setChecking(false);
        return;
      }

      // 1) Supabase 会话（UUID 身份）
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setCurrentUser(null);
        setChecking(false);
        return;
      }
      const authUser = authData.user;

      // 2) 资料（展示名等）—— 失败（如 users 行尚未创建）也继续，交给引导设置
      let displayName = '';
      let profileRole: string | undefined;
      try {
        const res = await fetch(API_CONFIG.AUTH_ME_ENDPOINT, { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          if (data?.success && data?.user) {
            displayName = data.user.display_name ?? '';
            profileRole = data.user.role;
          }
        }
      } catch {
        /* 资料接口异常不阻断进入 */
      }

      setCurrentUser({
        userId: authUser.id,
        displayName,
        email: authUser.email ?? null,
        isAnonymous: authUser.is_anonymous,
        // 把角色一并带出，供 ChatApp 判断是否为管理员
        role: profileRole,
      });
      setChecking(false);
    } catch {
      setCurrentUser(null);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  /** 改完资料后回读身份：走静默路径，避免 ChatApp 卸载重挂导致界面跳回消息 tab */
  const refreshIdentity = useCallback(() => loadSession({ silent: true }), [loadSession]);

  const handleLogout = useCallback(async () => {
    try {
      await supabase?.auth.signOut();
    } catch {
      /* ignore */
    }
    window.location.reload();
  }, []);

  // Checking existing session
  if (checking) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      </div>
    );
  }

  // Unauthenticated → show login / register
  if (!currentUser) {
    return <AuthScreen onAuthed={loadSession} />;
  }

  // Authenticated → show main app
  return (
    <ChatApp
      currentUser={currentUser}
      onLogout={handleLogout}
      onIdentityRefresh={refreshIdentity}
    />
  );
}
