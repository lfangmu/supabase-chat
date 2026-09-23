'use client';

import React, { useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';

interface AdminGateProps {
  onSuccess: () => void;
  endpoint: string;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
}

/**
 * 管理后台登录框（仅密码）。与普通聊天的「注册/登录」账号体系相互独立：
 * 普通聊天走 /api/auth/*，后台走 /api/admin/verify（认 ADMIN_PASSWORD，签发 admin_session）。
 */
const AdminGate: React.FC<AdminGateProps> = ({
  onSuccess,
  endpoint,
  title = '管理后台',
  subtitle = '请输入管理员密码',
  submitLabel = '进入后台',
}) => {
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const trimmed = password.trim();
    if (!trimmed) return;
    setVerifying(true);
    setError('');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: trimmed }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccess();
      } else {
        setError(data.message || '密码错误');
        setPassword('');
      }
    } catch {
      setError('网络错误，请检查连接后重试');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background flex items-stretch justify-center z-50 p-0">
      <div className="w-full max-w-2xl h-screen flex flex-col items-center justify-center p-9">
        <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center mb-7 shadow-lg shadow-primary/30">
          <Lock className="w-10 h-10 text-primary-foreground" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2 tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-[15px] mb-7">{subtitle}</p>

        <div className="w-full max-w-[300px] space-y-4">
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && !verifying && handleSubmit()}
              className="w-full h-[52px] pl-10 pr-[18px] border-[1.5px] border-input rounded-[14px] bg-card text-foreground text-base outline-none transition-all duration-200 focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground"
              placeholder="输入管理员密码"
              autoFocus
              disabled={verifying}
            />
          </div>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={!password.trim() || verifying}
            className={`w-full h-[52px] rounded-[14px] text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
              !password.trim() || verifying
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
