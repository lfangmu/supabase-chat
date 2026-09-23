'use client';

import React, { useState } from 'react';
import { Lock, Loader2, UserPlus, LogIn } from 'lucide-react';
import { API_CONFIG } from '@/config';

export interface AuthUser {
  nickname: string;
  avatar: string | null;
  signature: string;
  created_at: string | null;
  last_active_at: string | null;
}

interface AuthScreenProps {
  onSuccess: (user: AuthUser) => void;
}

type Mode = 'login' | 'register';

const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const endpoint = mode === 'login' ? API_CONFIG.AUTH_LOGIN_ENDPOINT : API_CONFIG.AUTH_REGISTER_ENDPOINT;

  const handleSubmit = async () => {
    const n = nickname.trim();
    if (!n || !password) {
      setError('请输入昵称和密码');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: n, password }),
      });
      const data = await res.json();
      if (data.success && data.user) {
        onSuccess(data.user as AuthUser);
      } else {
        setError(data.message || (mode === 'login' ? '登录失败' : '注册失败'));
        setPassword('');
      }
    } catch {
      setError('网络错误，请检查连接后重试');
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
          {mode === 'login' ? '登录聊天' : '注册账号'}
        </h2>
        <p className="text-muted-foreground text-[15px] mb-6">
          {mode === 'login' ? '使用昵称和密码登录' : '创建你的昵称和密码'}
        </p>

        {/* Tab 切换 */}
        <div className="flex w-full max-w-[300px] mb-5 bg-muted rounded-xl p-1">
          <button
            onClick={() => { setMode('login'); setError(''); }}
            className={`flex-1 h-9 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all ${
              mode === 'login' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" /> 登录
          </button>
          <button
            onClick={() => { setMode('register'); setError(''); }}
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
            <UserPlus className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={nickname}
              onChange={(e) => { setNickname(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && !submitting && handleSubmit()}
              className="w-full h-[52px] pl-10 pr-[18px] border-[1.5px] border-input rounded-[14px] bg-card text-foreground text-base outline-none transition-all duration-200 focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground"
              placeholder="昵称（2-30 字）"
              autoFocus
              disabled={submitting}
              maxLength={30}
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && !submitting && handleSubmit()}
              className="w-full h-[52px] pl-10 pr-[18px] border-[1.5px] border-input rounded-[14px] bg-card text-foreground text-base outline-none transition-all duration-200 focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground"
              placeholder="密码（6-128 字）"
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!nickname.trim() || !password || submitting}
            className={`w-full h-[52px] rounded-[14px] text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
              !nickname.trim() || !password || submitting
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
