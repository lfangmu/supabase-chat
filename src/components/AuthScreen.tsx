'use client';

import React, { useState } from 'react';
import { Lock, Loader2, UserPlus, LogIn, Ghost } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// 浏览器认证走的反向代理域名（构建期注入）。用于在报错里直接点名失败的连接目标，
// 避免只丢一句「网络错误」让用户无从下手。
const SUPABASE_PROXY_URL = process.env.NEXT_PUBLIC_SUPABASE_PROXY_URL ?? '';

interface AuthScreenProps {
  /** 登录 / 注册 / 匿名登录成功后回调，由父组件重新探测会话并进入主界面 */
  onAuthed: () => void;
}

type Mode = 'login' | 'register';

/**
 * 把 Supabase Auth 的报错转成面向用户的中文提示。
 * 技术细节（原始英文报错、代理域名、后台配置等）只写入控制台，便于排查，绝不展示给用户。
 */
function friendlyAuthError(err: { code?: string; message?: string } | null): string {
  if (!err) return '操作失败，请稍后重试';
  const code = err.code;
  const msg = err.message || '';

  // 网络层失败：请求没成功到达服务端（Supabase JS 在 fetch 失败时 message 为 'Failed to fetch'）。
  // 常见成因（CORS / 项目暂停 / 环境变量错指 / 代理 Worker 未部署）只记录到控制台，不暴露给用户。
  if (/failed to fetch|load failed|networkerror|typeerror/i.test(msg)) {
    console.error('[auth] 网络层失败（Failed to fetch）:', { proxy: SUPABASE_PROXY_URL, err });
    return '网络异常，暂时无法连接服务器，请稍后重试。';
  }
  if (code === 'anonymous_provider_disabled' || /anonymous sign-?ins are disabled/i.test(msg)) {
    return '当前暂不支持匿名登录，请使用邮箱注册或登录。';
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
    return '邮箱或密码不正确';
  }
  if (code === 'email_exists' || /user already registered/i.test(msg)) {
    return '该邮箱已注册，请直接登录';
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) {
    return '邮箱尚未验证，请先查收验证邮件完成验证后再登录';
  }
  if (/weak password/i.test(msg)) {
    return '密码太弱，请至少设置 6 位';
  }
  if (code === 'signup_disabled' || /signup is disabled/i.test(msg)) {
    return '注册已关闭，请联系管理员';
  }
  if (code === 'over_email_send_rate_limit' || /rate limit|too many requests/i.test(msg)) {
    return '操作过于频繁，请稍后再试';
  }
  // 未识别的错误：不把服务端英文原文抛给用户，仅记录到控制台
  console.error('[auth] 未识别的认证错误:', err);
  return '操作失败，请稍后重试';
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthed }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /** 展示名：匿名/注册时写入 user_metadata，由 00022 触发器落成 public.users.display_name */
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  /** 成功类提示（如「注册成功，请查收验证邮件」），用绿色区别于报错 */
  const [successMsg, setSuccessMsg] = useState('');

  const handleAnonymous = async () => {
    if (!supabase) {
      setError('服务未正确配置，暂时无法登录');
      return;
    }
    const name = displayName.trim();
    if (!name) {
      setError('请先填一个昵称（进聊天后也能改）');
      return;
    }
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const { error: err } = await supabase.auth.signInAnonymously({
        options: { data: { display_name: name } },
      });
      if (err) {
        setError(friendlyAuthError(err));
        return;
      }
      onAuthed();
    } catch (e) {
      const msg = (e as { message?: string })?.message || '';
      setError(friendlyAuthError({ message: msg }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailAuth = async () => {
    if (!supabase) {
      setError('服务未正确配置，暂时无法登录');
      return;
    }
    const e = email.trim();
    if (!e || !password) {
      setError('请输入邮箱和密码');
      return;
    }
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: e, password });
        if (err) {
          setError(friendlyAuthError(err));
          return;
        }
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email: e,
          password,
          options: {
            data: displayName.trim() ? { display_name: displayName.trim() } : undefined,
            // 验证链接跳回 /auth/callback 兑换 PKCE code；用当前 origin 自动适配本地与线上。
            emailRedirectTo:
              (typeof window !== 'undefined' ? window.location.origin : '') + '/auth/callback',
          },
        });
        if (err) {
          setError(friendlyAuthError(err));
          return;
        }
        // 邮箱确认开启时，注册成功但不会有立即会话（需点邮件链接）。
        // 此时若直接 onAuthed，会被 loadSession 静默弹回登录页，故改为提示去查收邮件。
        if (!data.session) {
          setSuccessMsg(
            '注册成功！请查收验证邮件（' + (data.user?.email ?? '注册邮箱') + '）完成验证后再登录。'
          );
          return;
        }
        if (!data.user) {
          setError('注册失败，请稍后重试');
          return;
        }
      }
      onAuthed();
    } catch (e) {
      const msg = (e as { message?: string })?.message || '';
      setError(friendlyAuthError({ message: msg }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background flex items-stretch justify-center z-50 p-0">
      <div className="w-full max-w-2xl h-screen flex flex-col items-center justify-center p-9">
        {/* Logo */}
        <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center mb-7 shadow-lg shadow-primary/30">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </div>

        <h2 className="text-2xl font-bold text-foreground mb-2 tracking-tight">
          登录聊天
        </h2>
        <p className="text-muted-foreground text-[15px] mb-6">
          填个昵称就能聊，也可以绑定邮箱长期保留
        </p>

        {/* 昵称（展示名）：匿名/注册时写入资料表 */}
        <div className="w-full max-w-[300px] mb-4">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && displayName.trim()) handleAnonymous(); }}
            maxLength={20}
            placeholder="你的昵称（聊天里展示）"
            className="w-full h-[48px] px-[16px] border-[1.5px] border-input rounded-[14px] bg-card text-foreground text-[15px] outline-none transition-all duration-200 focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground"
          />
        </div>

        {/* 匿名进入（主操作） */}
        <button
          onClick={handleAnonymous}
          disabled={submitting}
          className={`w-full max-w-[300px] h-[52px] rounded-[14px] text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
            submitting
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary hover:opacity-90 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0'
          }`}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              处理中...
            </>
          ) : (
            <>
              <Ghost className="w-4 h-4" /> 匿名进入
            </>
          )}
        </button>

        <div className="w-full max-w-[300px] flex items-center gap-3 my-5 text-muted-foreground text-xs">
          <div className="flex-1 h-px bg-border" />
          或使用邮箱
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Tab 切换 */}
        <div className="flex w-full max-w-[300px] mb-5 bg-muted rounded-xl p-1">
          <button
            onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
            className={`flex-1 h-9 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all ${
              mode === 'login' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" /> 登录
          </button>
          <button
            onClick={() => { setMode('register'); setError(''); setSuccessMsg(''); }}
            className={`flex-1 h-9 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all ${
              mode === 'register' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" /> 注册
          </button>
        </div>

        {/* Form */}
        <div className="w-full max-w-[300px] space-y-4">
          <div className="relative">
            <LogIn className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); setSuccessMsg(''); }}
              onKeyDown={(e) => e.key === 'Enter' && !submitting && handleEmailAuth()}
              className="w-full h-[52px] pl-10 pr-[18px] border-[1.5px] border-input rounded-[14px] bg-card text-foreground text-base outline-none transition-all duration-200 focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground"
              placeholder="邮箱"
              autoFocus
              disabled={submitting}
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); setSuccessMsg(''); }}
              onKeyDown={(e) => e.key === 'Enter' && !submitting && handleEmailAuth()}
              className="w-full h-[52px] pl-10 pr-[18px] border-[1.5px] border-input rounded-[14px] bg-card text-foreground text-base outline-none transition-all duration-200 focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground"
              placeholder="密码（6-128 字）"
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
          {successMsg && (
            <p className="text-sm text-emerald-600 text-center">{successMsg}</p>
          )}

          <button
            onClick={handleEmailAuth}
            disabled={!email.trim() || !password || submitting}
            className={`w-full h-[52px] rounded-[14px] text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
              !email.trim() || !password || submitting
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-primary hover:opacity-90 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0'
            }`}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                处理中...
              </>
            ) : mode === 'login' ? '登录' : '注册并进入'}
            </button>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
