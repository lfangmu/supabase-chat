'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Filter } from 'lucide-react';
import Avatar from './Avatar';
import { formatClock } from '@/utils/date-utils';
import { mediaPlaceholder, mediaTypeLabel } from '@/utils/labels';

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

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'text', label: '文字' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'voice', label: '语音' },
  { value: 'file', label: '文件' },
];

interface GlobalSearchModalProps {
  onClose: () => void;
  /** 选中某条结果：跳转到该条消息（传 roomId + 具体 messageId 以定位高亮） */
  onSelect: (roomId: string, messageId: string) => void;
}

/** 全局跨会话消息搜索弹层：复用 /api/messages/search，结果点击后跳转到对应房间。 */
const GlobalSearchModal: React.FC<GlobalSearchModalProps> = React.memo(({ onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sender, setSender] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  /**
   * P3 修复：搜索请求没有取消/序号机制，慢响应会覆盖新结果。
   * 例：先搜「a」（慢）再搜「ab」（快）→ 「ab」的结果先渲染，随后「a」的旧响应到达把它覆盖，
   * 用户看到的关键词与结果对不上。现在用 AbortController + 单调序号双保险。
   */
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 卸载时中止在途请求，避免对已卸载组件 setState
  useEffect(
    () => () => {
      searchAbortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const runSearch = useCallback(async () => {
    const term = query.trim();
    if (term.length === 0) {
      searchAbortRef.current?.abort();
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }

    // 取消上一次在途请求，并递增序号（响应回来时比对，过期则丢弃）
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    searchSeqRef.current += 1;
    const seq = searchSeqRef.current;

    setLoading(true);
    try {
      const params = new URLSearchParams({ q: term });
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (sender.trim()) params.set('sender', sender.trim());
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/messages/search?${params.toString()}`, {
        signal: controller.signal,
      });
      const data = await res.json();
      if (seq !== searchSeqRef.current) return; // 已有更新的搜索，丢弃本次结果
      setResults(data.success ? (data.results || []) : []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (seq !== searchSeqRef.current) return;
      setResults([]);
    } finally {
      // 只有最新一次请求才允许结束 loading 状态
      if (seq === searchSeqRef.current) {
        setLoading(false);
        setSearched(true);
      }
    }
  }, [query, typeFilter, sender, from, to]);

  // 任一筛选条件变化（且已输入关键词）即重新检索
  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      setSearched(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runSearch(), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, typeFilter, sender, from, to, runSearch]);

  const onQueryChange = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runSearch(), 300);
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
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
            }}
            placeholder="搜索消息内容（跨所有会话）"
            maxLength={100}
            className="flex-1 h-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`p-1.5 rounded-lg transition-colors ${showFilters ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
            aria-label="筛选"
            aria-expanded={showFilters}
            title="筛选"
          >
            <Filter className="w-4 h-4" />
          </button>
          {loading && <span className="text-xs text-muted-foreground">搜索中…</span>}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted" aria-label="关闭">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* 高级筛选 */}
        {showFilters && (
          <div className="px-4 py-3 border-b border-border flex flex-col gap-2.5 bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground w-12 flex-shrink-0">类型</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-8 flex-1 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground focus:outline-none"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground w-12 flex-shrink-0">发送者</span>
              <input
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                placeholder="按展示名筛选（可留空）"
                className="h-8 flex-1 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground focus:outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground w-12 flex-shrink-0">时间</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 flex-1 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground focus:outline-none"
                aria-label="起始日期"
              />
              <span className="text-[12px] text-muted-foreground">至</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 flex-1 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground focus:outline-none"
                aria-label="结束日期"
              />
            </div>
          </div>
        )}


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
                  {r.type !== 'text' && (
                    <span className="inline-block text-[11px] text-primary/80 border border-primary/30 rounded px-1 mr-1 leading-tight align-middle">
                      {mediaTypeLabel(r.type)}
                    </span>
                  )}
                  {r.type === 'text' ? r.content : mediaPlaceholder(r.type)}
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
