'use client';

import React, { useState, useEffect, useCallback } from 'react';
import AuthScreen, { AuthUser } from '@/components/AuthScreen';
import ChatApp from '@/components/chat/ChatApp';
import { Loader2 } from 'lucide-react';
import { API_CONFIG } from '@/config';

/**
 * Root client component — 注册/登录门禁。
 *
 * Flow:
 *   checking → spinner
 *   unauthenticated → AuthScreen（登录 / 注册）
 *   orphaned session → 账号恢复面板（会话有效但 users/room_members 数据丢失，设新密码自愈）
 *   authenticated → ChatApp（主聊天界面）
 *
 * On mount, probes /api/me：
 *   If 200 → 会话仍有效，直接进入聊天（昵称取自服务端身份）。
 *   If 401 且 message==='用户不存在' → 会话 JWT 有效但数据被清，展示恢复面板。
 *   If 401 其他 → 展示登录/注册界面。
 */
export default function ChatClient() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [recoverMode, setRecoverMode] = useState(false);
  const [recoverPwd, setRecoverPwd] = useState('');
  const [recoverError, setRecoverError] = useState('');
  const [recovering, setRecovering] = useState(false);

  const probeAuth = useCallback(() => {
    setChecking(true);
    setRecoverMode(false);
    fetch(API_CONFIG.AUTH_ME_ENDPOINT, { credentials: 'same-origin' })
      .then(async (res) => {
        let nickname: string | null = null;
        let message = '';
        try {
          const data = await res.json();
          nickname = data?.user?.nickname ?? null;
          message = data?.message ?? '';
        } catch {
          /* ignore parse errors */
        }
        if (res.ok && nickname) {
          try { localStorage.setItem('chat_nickname', nickname); } catch { /* ignore */ }
          setIsAuthenticated(true);
          setChecking(false);
          return;
        }
        // 会话 JWT 有效但数据丢失（users 行被清）：进入自愈恢复面板
        if (res.status === 401 && message === '用户不存在') {
          setRecoverMode(true);
          setChecking(false);
          return;
        }
        setIsAuthenticated(false);
        setChecking(false);
      })
      .catch(() => {
        setIsAuthenticated(false);
        setChecking(false);
      });
  }, []);

  useEffect(() => {
    probeAuth();
  }, [probeAuth]);

  const handleAuthSuccess = useCallback((user: AuthUser) => {
    try { localStorage.setItem('chat_nickname', user.nickname); } catch { /* ignore */ }
    setIsAuthenticated(true);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch(API_CONFIG.AUTH_LOGOUT_ENDPOINT, { method: 'POST' });
    } catch { /* ignore */ }
    window.location.reload();
  }, []);

  // 账号自愈：用仍然有效的会话，设新密码并重建 users / room_members
  const handleRecover = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (recoverPwd.length < 6) {
      setRecoverError('密码至少 6 个字符');
      return;
    }
    setRecovering(true);
    setRecoverError('');
    try {
      const res = await fetch(API_CONFIG.AUTH_RECOVER_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: recoverPwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setRecoverError(data?.message || '恢复失败，请稍后重试');
        setRecovering(false);
        return;
      }
      // 恢复成功：重新探测登录态（此时 users/room_members 已就绪，应返回 200）
      probeAuth();
    } catch {
      setRecoverError('网络错误，请重试');
      setRecovering(false);
    }
  }, [recoverPwd, probeAuth]);

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

  // 账号恢复面板（会话有效但数据丢失）
  if (recoverMode) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background p-4">
        <form onSubmit={handleRecover} className="w-full max-w-sm flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-lg">
          <h1 className="text-xl font-semibold text-foreground">恢复账号</h1>
          <p className="text-sm text-muted-foreground">
            检测到你的登录会话仍然有效，但账号数据（资料 / 房间成员关系）在服务器端丢失了。
            设置一个新密码即可恢复访问，历史消息通常不受影响。
          </p>
          <input
            type="password"
            autoFocus
            value={recoverPwd}
            onChange={(e) => setRecoverPwd(e.target.value)}
            placeholder="设置新密码（至少 6 位）"
            className="rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
          />
          {recoverError && <p className="text-sm text-destructive">{recoverError}</p>}
          <button
            type="submit"
            disabled={recovering}
            className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity disabled:opacity-60"
          >
            {recovering ? '恢复中…' : '恢复账号'}
          </button>
        </form>
      </div>
    );
  }

  // Unauthenticated → show login / register
  if (!isAuthenticated) {
    return <AuthScreen onSuccess={handleAuthSuccess} />;
  }

  // Authenticated → show main app
  return <ChatApp onLogout={handleLogout} />;
}
