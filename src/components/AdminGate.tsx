'use client';

import React, { useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { API_CONFIG } from '@/config';

interface AdminGateProps {
  onSuccess: () => void;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  /** 进入页面时的提示（例如「当前账号不是管理员」），区别于登录失败的错误 */
  notice?: string;
}

/**
 * 管理后台登录。迁移后不再有独立的 admin_session / ADMIN_PASSWORD：
 * 管理员就是一个普通的 Supabase Auth 账号，其 public.users.role = 'admin'。
 *
 * 流程：邮箱+密码 signInWithPassword → 浏览器持有会话 → 拉取 /api/me 确认 role='admin'
 * → 放行。后续 /api/admin/* 由 middleware 按 users.role 再做一次服务端校验。
 */
const AdminGate: React.FC<AdminGateProps> = ({
  onSuccess,
  title = '管理后台',
  subtitle = '请使用管理员账号登录',
  submitLabel = '进入后台',
  notice,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    const trimmed = password.trim();
    if (!trimmedEmail || !trimmed) return;
    if (!supabase) {
      setError('服务未正确配置，暂时无法登录');
      return;
    }
    setVerifying(true);
    setError('');
    try {
      // 1) Supabase Auth 登录（成功后浏览器自动持有会话 cookie）
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password: trimmed,
      });
      if (signInError) {
        setError(signInError.message || '登录失败');
        setPassword('');
        return;
      }

      // 2) 确认该账号确为管理员（role 存在 users 表，服务器端才是权威来源）
      const res = await fetch(API_CONFIG.AUTH_ME_ENDPOINT, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      const role = data?.success ? data?.user?.role : undefined;
      if (role !== 'admin') {
        setError('该账号不是管理员');
        setPassword('');
        // 非管理员：立即登出，避免留下一个无权訪問后台的会话
        try {
          await supabase.auth.signOut();
        } catch {
          /* ignore */
        }
        return;
      }

      onSuccess();
    } catch {
      setError('网络错误，请检查连接后重试');
    } finally {
      setVerifying(false);
    }
  };

  const canSubmit = !!email.trim() && !!password.trim() && !verifying;

  return (
    <div className="fixed inset-0 bg-background flex items-stretch justify-center z-50 p-0">
      <div className="w-full max-w-2xl h-screen flex flex-col items-center justify-center p-9">
        <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center mb-7 shadow-lg shadow-primary/30">
          <Lock className="w-10 h-10 text-primary-foreground" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2 tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-[15px] mb-7">{subtitle}</p>

        {notice && (
          <p className="w-full max-w-[300px] mb-5 text-[13px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 text-center">
            {notice}
          </p>
        )}

        <div className="w-full max-w-[300px] space-y-4">
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
              className="w-full h-[52px] pl-10 pr-[18px] border-[1.5px] border-input rounded-[14px] bg-card text-foreground text-base outline-none transition-all duration-200 focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground"
              placeholder="管理员邮箱"
              autoFocus
              disabled={verifying}
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
              className="w-full h-[52px] pl-10 pr-[18px] border-[1.5px] border-input rounded-[14px] bg-card text-foreground text-base outline-none transition-all duration-200 focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground"
              placeholder="密码"
              disabled={verifying}
            />
          </div>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full h-[52px] rounded-[14px] text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
              !canSubmit
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-primary hover:opacity-90 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0'
            }`}
          >
            {verifying ? (<><Loader2 className="w-4 h-4 animate-spin" />验证中...</>) : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminGate;
