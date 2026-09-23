'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import Avatar from './Avatar';
import { formatClock } from '@/utils/date-utils';

interface SearchResult {
  id: string;
  room_id: string;
  user: string;
  content: string;
  type: string;
  timestamp: string;
  roomName: string;
  roomType: string;
}

interface GlobalSearchModalProps {
  onClose: () => void;
  /** 选中某条结果：跳转到该条消息（传 roomId + 具体 messageId 以定位高亮） */
  onSelect: (roomId: string, messageId: string) => void;
}

/** 全局跨会话消息搜索弹层：复用 /api/messages/search，结果点击后跳转到对应房间。 */
const GlobalSearchModal: React.FC<GlobalSearchModalProps> = React.memo(({ onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const runSearch = useCallback(async (q: string) => {
    const term = q.trim();
    if (term.length === 0) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/messages/search?q=${encodeURIComponent(term)}`);
      const data = await res.json();
      setResults(data.success ? (data.results || []) : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, []);

  const onChange = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runSearch(v), 300);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-start justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="全局消息搜索"
    >
      <div
        className="w-full max-w-lg mt-[8vh] bg-card rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索框 */}
        <div className="flex items-center gap-2 px-4 h-14 border-b border-border flex-shrink-0">
          <Search className="w-5 h-5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch(query);
            }}
            placeholder="搜索消息内容（跨所有会话）"
            maxLength={100}
            className="flex-1 h-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {loading && <span className="text-xs text-muted-foreground">搜索中…</span>}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted" aria-label="关闭">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* 结果列表 */}
        <div className="flex-1 overflow-y-auto">
          {!searched && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              输入关键词，搜索你参与过的会话消息
            </div>
          )}
          {searched && !loading && results.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">没有找到相关消息</div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelect(r.room_id, r.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left border-b border-border/60"
            >
              <Avatar name={r.roomName} size={40} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-medium text-foreground truncate">{r.roomName}</span>
                  <span className="text-[11px] text-muted-foreground flex-shrink-0">
                    {formatClock(new Date(r.timestamp))}
                  </span>
                </div>
                <div className="text-[13px] text-muted-foreground truncate">
                  <span className="text-foreground/70">{r.user}: </span>
                  {r.content}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

GlobalSearchModal.displayName = 'GlobalSearchModal';

export default GlobalSearchModal;
