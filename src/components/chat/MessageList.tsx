'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, MessageCircle, RefreshCw, ArrowDown } from 'lucide-react';
import { Message, Reaction } from '@/types';
import MessageItem from './MessageItem';
import DateSeparator from './DateSeparator';
import { buildVirtualList, estimateItemSize } from '@/utils/virtual-list-utils';
import { formatClock } from '@/utils/date-utils';

interface MessageListProps {
  messages: Message[];
  user: string;
  typingUsers?: string[];
  uploadingMessages: Map<string, { progress: number; fileName: string }>;
  loadingMore: boolean;
  isLoading?: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onRefresh?: () => Promise<number>;
  onWithdraw: (id: string) => void;
  onRetry: (id: string) => void;
  onQuote?: (message: Message) => void;
  onEdit?: (id: string, newContent: string) => void;
  onDelete?: (id: string) => void;
  onForward?: (message: Message) => void;
  /** 1:1 私聊时隐藏每条消息的昵称+时间 */
  isDM?: boolean;
  /** 昵称 → 头像 URL 映射 */
  avatars?: Record<string, string | null>;
  /** 房间内消息搜索关键词（非空时过滤已加载文本消息） */
  searchQuery?: string;
  /** REQ-001: 表情回应聚合（按 messageId） */
  reactionsByMessage?: Record<string, Reaction[]>;
  /** 切换某条消息的某个 emoji 回应 */
  onToggleReaction?: (messageId: string, emoji: string) => void;
  /** 全局搜索跳转：需要滚动并高亮定位的具体消息 id */
  highlightMessageId?: string | null;
  /** 目标消息未在当前已加载窗口时，按 id 精准加载（插入后再次定位） */
  onLoadMessageById?: (id: string) => Promise<Message | null>;
  /** 当前房间 id（用于切换房间时重置未读/分隔线状态，避免串台） */
  roomId?: string;
  /** 当前用户 UUID：自消息判定以它为准（展示名会被改名改掉） */
  currentUserId?: string;
}

const NEAR_BOTTOM_THRESHOLD = 120;
const LOAD_MORE_THRESHOLD = 80;

const MessageList: React.FC<MessageListProps> = React.memo(({
  messages,
  user,
  typingUsers = [],
  uploadingMessages,
  loadingMore,
  isLoading = false,
  hasMore,
  onLoadMore,
  onRefresh,
  onWithdraw,
  onRetry,
  onQuote,
  onEdit,
  onDelete,
  onForward,
  isDM = false,
  avatars,
  searchQuery = '',
  reactionsByMessage = {},
  onToggleReaction,
  highlightMessageId = null,
  onLoadMessageById,
  roomId = '',
  currentUserId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevLenRef = useRef(messages.length);
  const isNearBottomRef = useRef(true);
  const hasInitialScrolledRef = useRef(false);
  // 切换房间重置锚点
  const roomIdRef = useRef(roomId);
  // 全局搜索跳转：当前需高亮的消息 id（2.5s 后由 effect 清除）
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // 防止对同一条未加载消息重复发起 by-id 请求
  const pendingLoadRef = useRef<Set<string>>(new Set());
  // 上滑期间收到的「第一条未读消息」id —— 在其上方渲染「新消息」分隔线
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const firstUnreadIdRef = useRef<string | null>(null);

  // === Pull-to-refresh ===
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartRef = useRef<{ y: number; scrollTop: number } | null>(null);
  const PULL_THRESHOLD = 60;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const container = containerRef.current;
    if (!container || refreshing) return;
    touchStartRef.current = { y: e.touches[0].clientY, scrollTop: container.scrollTop };
  }, [refreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const container = containerRef.current;
    if (!container || !touchStartRef.current || refreshing) return;
    // Only activate when scrolled to top
    if (touchStartRef.current.scrollTop > 0 || container.scrollTop > 0) {
      setPullDistance(0);
      return;
    }
    const delta = e.touches[0].clientY - touchStartRef.current.y;
    if (delta > 0) {
      // Apply resistance (diminishing pull)
      setPullDistance(Math.min(delta * 0.4, 100));
    } else {
      setPullDistance(0);
    }
  }, [refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance >= PULL_THRESHOLD && onRefresh && !refreshing) {
      setRefreshing(true);
      setPullDistance(0);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    } else {
      setPullDistance(0);
    }
    touchStartRef.current = null;
  }, [pullDistance, onRefresh, refreshing]);

  // REQ-005: Build mixed virtual list with date separators
  const virtualItems = useMemo(() => buildVirtualList(messages), [messages]);

  const virtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => estimateItemSize(virtualItems[index]),
    overscan: 8,
    getItemKey: (index) => virtualItems[index].key,
  });

  // Detect scroll position for auto-scroll button + load-more trigger
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      const nearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_THRESHOLD;
      isNearBottomRef.current = nearBottom;
      setShowScrollBtn(!nearBottom);
      if (nearBottom) {
        setUnreadCount(0);
        if (firstUnreadIdRef.current) {
          firstUnreadIdRef.current = null;
          setFirstUnreadId(null);
        }
      }

      // Trigger load more when near top
      if (container.scrollTop < LOAD_MORE_THRESHOLD && hasMore && !loadingMore && messages.length > 0) {
        onLoadMore();
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [hasMore, loadingMore, messages.length, onLoadMore]);

  // Initial scroll to bottom (once)
  useEffect(() => {
    if (!hasInitialScrolledRef.current && virtualItems.length > 0) {
      virtualizer.scrollToIndex(virtualItems.length - 1, { align: 'end' });
      hasInitialScrolledRef.current = true;
    }
  }, [virtualItems.length, virtualizer]);

  // Auto-scroll on new messages
  useEffect(() => {
    const len = virtualItems.length;
    // 切换房间：重置未读态与基线长度，避免把新房间的历史消息当成「新消息」
    if (roomId !== roomIdRef.current) {
      roomIdRef.current = roomId;
      prevLenRef.current = len;
      setUnreadCount(0);
      firstUnreadIdRef.current = null;
      setFirstUnreadId(null);
      return;
    }
    if (len <= prevLenRef.current || !hasInitialScrolledRef.current) {
      prevLenRef.current = len;
      return;
    }

    // Find the last message item in the virtual list
    const lastItem = virtualItems[len - 1];
    if (lastItem?.type !== 'message') {
      prevLenRef.current = len;
      return;
    }

    const lastMsg = lastItem.message;
    const isSelf = currentUserId && lastMsg?.userId
      ? lastMsg.userId === currentUserId
      : lastMsg?.user === user;

    if (isNearBottomRef.current || isSelf) {
      virtualizer.scrollToIndex(len - 1, {
        behavior: isSelf ? 'smooth' : 'auto',
        align: 'end',
      });
    } else {
      setUnreadCount((c) => c + 1);
      // 记录「第一条未读」边界（上滑期间收到的首条新消息），用于渲染分隔线
      if (!firstUnreadIdRef.current) {
        let boundary: Message | null = null;
        for (let i = prevLenRef.current; i < virtualItems.length; i++) {
          const v = virtualItems[i];
          if (v.type === 'message') {
            boundary = v.message;
            break;
          }
        }
        if (boundary) {
          firstUnreadIdRef.current = boundary.id;
          setFirstUnreadId(boundary.id);
        }
      }
    }

    prevLenRef.current = len;
  }, [virtualItems, user, currentUserId, virtualizer, roomId]);

  // Cache upload start times to avoid flickering timestamps on re-render
  const uploadStartTimesRef = useRef<Map<string, string>>(new Map());

  const getUploadStartTime = useCallback((uploadId: string) => {
    if (!uploadStartTimesRef.current.has(uploadId)) {
      uploadStartTimesRef.current.set(uploadId, formatClock(new Date()));
    }
    return uploadStartTimesRef.current.get(uploadId)!;
  }, []);

  const scrollToBottom = useCallback(() => {
    virtualizer.scrollToIndex(virtualItems.length - 1, { behavior: 'smooth', align: 'end' });
    setUnreadCount(0);
    if (firstUnreadIdRef.current) {
      firstUnreadIdRef.current = null;
      setFirstUnreadId(null);
    }
  }, [virtualizer, virtualItems.length]);

  // 全局搜索跳转：滚动到目标消息并高亮。若目标不在已加载窗口，按需加载后由
  // virtualItems 变化再次触发本 effect，定位成功。
  useEffect(() => {
    if (!highlightMessageId) return;
    const idx = virtualItems.findIndex(
      (v) => v.type === 'message' && v.message?.id === highlightMessageId
    );
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'center', behavior: 'smooth' });
      setHighlightedId(highlightMessageId);
      pendingLoadRef.current.delete(highlightMessageId);
      const t = setTimeout(() => setHighlightedId(null), 2500);
      return () => clearTimeout(t);
    }
    // 未加载：发起精准加载（带去重，避免重复请求）
    if (pendingLoadRef.current.has(highlightMessageId)) return;
    pendingLoadRef.current.add(highlightMessageId);
    onLoadMessageById?.(highlightMessageId)
      .then((m) => {
        if (!m) pendingLoadRef.current.delete(highlightMessageId);
      })
      .catch(() => pendingLoadRef.current.delete(highlightMessageId));
  }, [highlightMessageId, virtualItems, virtualizer, onLoadMessageById]);

  const renderedVirtualItems = virtualizer.getVirtualItems();

  // 房间内搜索：过滤已加载的文本消息（大小写不敏感）
  const searchActive = searchQuery.trim().length > 0;
  const filteredMessages = useMemo(() => {
    if (!searchActive) return [];
    const q = searchQuery.trim().toLowerCase();
    return messages.filter(
      (m) => m.type === 'text' && m.content.toLowerCase().includes(q)
    );
  }, [messages, searchQuery, searchActive]);

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col">
      <main
        ref={containerRef}
        className="flex-1 h-full overflow-y-auto px-4 relative"
        role="log"
        aria-label="聊天消息列表"
        aria-live="polite"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => {
          // Dismiss keyboard when tapping on empty area of the message list
          const tag = (e.target as HTMLElement).tagName;
          if (tag !== 'BUTTON' && tag !== 'A') {
            (document.activeElement as HTMLElement)?.blur?.();
          }
        }}
      >
        {/* Pull-to-refresh indicator */}
        {(pullDistance > 0 || refreshing) && (
          <div
            className="flex items-center justify-center overflow-hidden transition-all duration-150"
            style={{ height: refreshing ? 48 : pullDistance }}
          >
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className={`h-4 w-4 ${refreshing || pullDistance >= PULL_THRESHOLD ? 'animate-spin' : ''}`}
                style={!refreshing && pullDistance < PULL_THRESHOLD ? { transform: `rotate(${pullDistance * 3}deg)` } : undefined}
              />
              <span>{refreshing ? '同步中...' : pullDistance >= PULL_THRESHOLD ? '释放刷新' : '下拉刷新'}</span>
            </div>
          </div>
        )}
        {/* Top loading indicator */}
        {loadingMore && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">加载更多历史...</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <Loader2 className="animate-spin h-8 w-8 text-primary" />
            <p className="text-muted-foreground">加载消息中...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center">
              <MessageCircle className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">还没有消息，开始聊天吧！</p>
          </div>
        ) : (
          <>
            {!hasMore && (
              <div className="text-center text-muted-foreground text-sm py-4">已加载全部历史</div>
            )}

            {searchActive && (
              <div className="text-center text-muted-foreground text-sm py-2">
                {filteredMessages.length > 0 ? `找到 ${filteredMessages.length} 条相关消息` : '没有找到相关消息'}
              </div>
            )}

            {/* Virtualized mixed list (separators + messages) — 搜索模式下改为直接渲染匹配结果 */}
            {searchActive ? (
              <div className="py-2">
                  {filteredMessages.map((message) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    user={user}
                    currentUserId={currentUserId}
                    onWithdraw={onWithdraw}
                    onRetry={onRetry}
                    onQuote={onQuote}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onForward={onForward}
                    isDM={isDM}
                    avatarUrl={avatars?.[message.user] ?? null}
                    reactions={reactionsByMessage[message.id]}
                    onToggleReaction={onToggleReaction}
                    highlight={message.id === highlightedId}
                  />
                ))}
              </div>
            ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }}
            >
              {/* Top padding */}
              <div style={{ height: renderedVirtualItems[0]?.start ?? 0 }} />

              {renderedVirtualItems.map((virtualRow) => {
                const item = virtualItems[virtualRow.index];

                if (item.type === 'separator') {
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                    >
                      <DateSeparator date={item.date} />
                    </div>
                  );
                }

                // Message item
                const message = item.message;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    id={`msg-${message.id}`}
                    style={{ paddingBottom: '4px' }}
                  >
                    {message.id === firstUnreadId && (
                      <div className="flex items-center gap-2 my-2 px-1 select-none" aria-hidden="true">
                        <div className="flex-1 h-px bg-primary/40" />
                        <span className="text-xs font-medium text-primary whitespace-nowrap">新消息</span>
                        <div className="flex-1 h-px bg-primary/40" />
                      </div>
                    )}
                    <MessageItem
                      message={message}
                      user={user}
                      currentUserId={currentUserId}
                      onWithdraw={onWithdraw}
                      onRetry={onRetry}
                      onQuote={onQuote}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onForward={onForward}
                      isDM={isDM}
                      avatarUrl={avatars?.[message.user] ?? null}
                      reactions={reactionsByMessage[message.id]}
                      onToggleReaction={onToggleReaction}
                      highlight={message.id === highlightedId}
                    />
                  </div>
                );
              })}
            </div>
            )}

            {/* Uploading messages (always visible at bottom) */}
            {Array.from(uploadingMessages.entries()).map(([uploadId, uploadData]) => (
              <div key={uploadId} className="flex flex-col items-end mb-4 animate-fadeIn">
                {!isDM && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-primary">
                    {user}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {getUploadStartTime(uploadId)}
                  </span>
                </div>
                )}
                <div className="relative group inline-block">
                  <div className="inline-flex flex-col items-center px-4 py-3 rounded-2xl bg-accent text-foreground shadow-sm min-w-[200px]">
                    <div className="flex items-center gap-2 mb-2">
                      <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
                      <span className="text-sm font-medium">上传中</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2.5 mb-2">
                      <div
                        className="bg-primary h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${uploadData.progress}%` }}
                      ></div>
                    </div>
                    <div className="text-xs text-muted-foreground text-center">
                      {uploadData.fileName}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {uploadData.progress}%
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground animate-fadeIn" role="status" aria-live="polite">
            <div className="flex gap-0.5">
              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>
              {typingUsers.length === 1
                ? `${typingUsers[0]} 正在输入...`
                : `${typingUsers.length} 人正在输入...`}
            </span>
          </div>
        )}

        {/* Bottom spacer for scroll anchor */}
        <div className="h-2" />
      </main>

      {/* 回到最新 / N 条新消息 气泡 */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 z-10 h-10 px-4 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center gap-1.5 hover:bg-primary/90 active:bg-primary/80 transition-all duration-200"
          aria-label={unreadCount > 0 ? `${unreadCount} 条新消息，点击查看` : '回到最新消息'}
        >
          {unreadCount > 0 ? `${unreadCount} 条新消息` : '回到最新'}
          <ArrowDown className={`w-4 h-4 ${unreadCount > 0 ? 'animate-bounce' : ''}`} />
        </button>
      )}
    </div>
  );
});

MessageList.displayName = 'MessageList';

export default MessageList;
