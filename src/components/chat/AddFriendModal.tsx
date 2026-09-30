'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Search, UserPlus, MessageCircle, Check, Loader2 } from 'lucide-react';
import Avatar from './Avatar';
import { formatRelativeTime } from '@/utils/labels';

interface SearchResult {
  /** 用户 UUID（身份） */
  id: string;
  /** 展示名 */
  display_name: string;
  avatar: string | null;
  created_at: string;
  last_active_at: string | null;
}

interface AddFriendModalProps {
  /** 当前用户的 Supabase Auth UUID */
  currentUserId: string;
  onClose: () => void;
  /** 入参为对方 UUID */
  onStartDM: (userId: string) => void;
  /** 发送好友申请；入参为对方 UUID；返回 { success, message } */
  onSendRequest?: (userId: string) => Promise<{ success?: boolean; message?: string } | void>;
  /** 已是好友的用户 UUID 列表 */
  friendIds?: string[];
  /** 已发出申请、等待对方通过的用户 UUID 列表 */
  outgoingIds?: string[];
}

/**
 * Format relative time（P3：改为调用共享实现 `utils/labels.ts`，
 * 此前与 ContactsPage 各抄一份，改一处漏两处会导致同一时间在不同界面显示不一致）
 */
function formatLastSeen(ts: string | null): string {
  return formatRelativeTime(ts, { withYesterday: true });
}

const AddFriendModal: React.FC<AddFriendModalProps> = ({
  currentUserId,
  onClose,
  onStartDM,
  onSendRequest,
  friendIds = [],
  outgoingIds = [],
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  /** 本次会话内已点过「添加」的昵称（乐观置为「已申请」） */
  const [requested, setRequested] = useState<string[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape key to close + body scroll lock
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Debounced search
  const search = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      setError('');
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/users?q=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (data.success) {
          // Filter out current user
          setResults((data.users as SearchResult[]).filter((u) => u.id !== currentUserId.trim()));
          setSearched(true);
        } else {
          setResults([]);
          setSearched(true);
          setError(data.message || '搜索失败，请稍后重试');
        }
      } catch {
        setResults([]);
        setSearched(true);
        setError('网络错误，请检查连接后重试');
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [currentUserId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    search(val);
  };

  const handleStartDM = (nickname: string) => {
    onStartDM(nickname);
    onClose();
  };

  const handleAdd = async (nickname: string) => {
    if (!onSendRequest || sending) return;
    setSending(nickname);
    setError('');
    try {
      const r = await onSendRequest(nickname);
      if (r && r.success === false) {
        setError(r.message || '发送申请失败');
      } else {
        setRequested((prev) => (prev.includes(nickname) ? prev : [...prev, nickname]));
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[70vh] bg-card rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="添加好友"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-base font-semibold text-foreground">添加好友</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="关闭"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Search input */}
        <div className="px-4 py-3 border-b border-border flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleInputChange}
              placeholder="搜索用户昵称..."
              className="w-full h-10 bg-muted rounded-xl pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm text-muted-foreground">搜索中...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : searched && results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <UserPlus className="w-10 h-10 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">未找到用户 &quot;{query}&quot;</p>
              <p className="text-xs text-muted-foreground mt-1">请检查昵称是否正确</p>
            </div>
          ) : (
            results.map((u) => {
              const isFriend = friendIds.includes(u.id);
              const isPending = outgoingIds.includes(u.id) || requested.includes(u.id);
              const isSending = sending === u.id;
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border/50"
                >
                  <Avatar name={u.display_name} avatar={u.avatar} size={40} rounded="xl" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-medium text-foreground">{u.display_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {u.last_active_at ? `最近活跃: ${formatLastSeen(u.last_active_at)}` : '已注册'}
                    </p>
                  </div>
                  {isFriend ? (
                    <button
                      onClick={() => handleStartDM(u.id)}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1 flex-shrink-0"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      发消息
                    </button>
                  ) : isPending ? (
                    <span className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium flex items-center gap-1 flex-shrink-0">
                      <Check className="w-3.5 h-3.5" />
                      等待验证
                    </span>
                  ) : onSendRequest ? (
                    <button
                      onClick={() => handleAdd(u.id)}
                      disabled={isSending}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1 flex-shrink-0 disabled:opacity-60"
                    >
                      {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                      添加
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStartDM(u.id)}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1 flex-shrink-0"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      发消息
                    </button>
                  )}
                </div>
              );
            })
          )}

          {!searched && !loading && (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <Search className="w-10 h-10 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">输入昵称搜索用户</p>
              <p className="text-xs text-muted-foreground mt-1">找到后可以直接发起私聊</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddFriendModal;
