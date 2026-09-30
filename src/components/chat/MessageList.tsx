'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, MessageCircle, RefreshCw, ArrowDown } from 'lucide-react';
import { Message, Reaction } from '@/types';
import MessageItem from './MessageItem';
import DateSeparator from './DateSeparator';
import {
  buildVirtualList,
  estimateItemSize,
  resolveShowScrollBtn,
  computePrependScrollTop,
  pinnedScrollTop,
  isPrependGrowth,
  PINNED_THRESHOLD,
} from '@/utils/virtual-list-utils';
import { formatClock } from '@/utils/date-utils';
import { mediaPlaceholder } from '@/utils/labels';

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
  /** 点击消息头像：打开该用户的个人资料卡（微信式） */
  onAvatarClick?: (info: { userId?: string; name: string }) => void;
}

/** 「贴底」判定阈值：距底部小于它即认为用户在看最新消息 */
const NEAR_BOTTOM_THRESHOLD = 120;
/** 距顶部小于它即触发加载更多历史 */
const LOAD_MORE_THRESHOLD = 80;
/** 顶部插入历史后，内容高度静默多久即解除「滚动锚定」（见 utils 中的滞回/锚定说明） */
const PREPEND_ANCHOR_RELEASE_MS = 400;
/** 顶部插入历史的锚定兜底时长：超时仍未发生高度变化则强制解除，避免锚点残留 */
const PREPEND_ANCHOR_FALLBACK_MS = 5000;

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
  onAvatarClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  /** 内容包裹层：ResizeObserver 观察其高度变化，用于「贴底跟随」与「顶部插入锚定」 */
  const contentRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  /** 与 showScrollBtn 同步的 ref：滚动回调里不能读过期的 state，否则滞回判定失效 */
  const showScrollBtnRef = useRef(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevLenRef = useRef(messages.length);
  /** 虚拟列表末项 key：用于区分「顶部插入历史」与「底部追加新消息」 */
  const lastKeyRef = useRef<string | number | null>(null);
  const isNearBottomRef = useRef(true);
  /** 是否「贴着底部」：比 isNearBottomRef 更紧，用于内容高度变化时的贴底跟随 */
  const isPinnedRef = useRef(true);
  const hasInitialScrolledRef = useRef(false);
  /** 顶部插入历史时的滚动锚点：记录插入前的 scrollHeight / scrollTop */
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null);
  /** 锚点兜底定时器 */
  const prependAnchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** loadingMore 的 ref 镜像：ResizeObserver 回调里必须读到最新值 */
  const loadingMoreRef = useRef(loadingMore);
  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);
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
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = { y: touch.clientY, scrollTop: container.scrollTop };
  }, [refreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const container = containerRef.current;
    if (!container || !touchStartRef.current || refreshing) return;
    // Only activate when scrolled to top
    if (touchStartRef.current.scrollTop > 0 || container.scrollTop > 0) {
      setPullDistance(0);
      return;
    }
    const touch = e.touches[0];
    if (!touch) return;
    const delta = touch.clientY - touchStartRef.current.y;
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
    estimateSize: (index) => {
      const item = virtualItems[index];
      return item ? estimateItemSize(item) : 72;
    },
    overscan: 8,
    getItemKey: (index) => virtualItems[index]?.key ?? index,
  });

  // Detect scroll position for auto-scroll button + load-more trigger
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      const distanceToBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const nearBottom = distanceToBottom < NEAR_BOTTOM_THRESHOLD;
      isNearBottomRef.current = nearBottom;
      isPinnedRef.current = distanceToBottom <= PINNED_THRESHOLD;

      // 滞回：只有明显远离底部才显示按钮；回到阈值内立即隐藏。
      // 用 ref 与 state 双写，保证连续滚动事件之间不会读到过期的 state。
      const shouldShow = resolveShowScrollBtn(distanceToBottom, showScrollBtnRef.current);
      if (shouldShow !== showScrollBtnRef.current) {
        showScrollBtnRef.current = shouldShow;
        setShowScrollBtn(shouldShow);
      }

      if (nearBottom) {
        setUnreadCount(0);
        if (firstUnreadIdRef.current) {
          firstUnreadIdRef.current = null;
          setFirstUnreadId(null);
        }
      }

      // Trigger load more when near top
      if (container.scrollTop < LOAD_MORE_THRESHOLD && hasMore && !loadingMore && messages.length > 0) {
        // 记录锚点：历史插入到列表顶部后，用高度差补偿 scrollTop，保持视口内容不动
        if (!prependAnchorRef.current) {
          prependAnchorRef.current = { height: container.scrollHeight, top: container.scrollTop };
        }
        if (prependAnchorTimerRef.current) clearTimeout(prependAnchorTimerRef.current);
        prependAnchorTimerRef.current = setTimeout(() => {
          prependAnchorRef.current = null;
          prependAnchorTimerRef.current = null;
        }, PREPEND_ANCHOR_FALLBACK_MS);
        onLoadMore();
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [hasMore, loadingMore, messages.length, onLoadMore]);

  // === 滚动稳定性（修复「消息框上下来回弹」） ===
  // 症状：新消息/「输入中」指示器出现时，右侧滚动条与消息内容上下来回弹，且
  //       「回到最新」按钮反复闪现。根因有三：
  //   1) 容器未禁用浏览器**原生滚动锚定**（overflow-anchor），它会与虚拟列表的
  //      挂载/卸载 + measureElement 修正互相打架，各自调整 scrollTop → 抖动；
  //   2) 内容高度变化（输入中指示器 ±28px、图片加载、虚拟列表测量修正）时，若用户
  //       正贴在底部，视口不会重新贴底，最新消息漂出视野、距底距离在阈值附近震荡；
  //   3) 顶部插入历史时没有补偿 scrollTop，视口被整体顶走（实测一次 ~1380px）。
  // 下面用 ResizeObserver 统一处理 2) 与 3)，并在容器上设 overflow-anchor:none 处理 1)。
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') return;

    let releaseTimer: ReturnType<typeof setTimeout> | null = null;

    const ro = new ResizeObserver(() => {
      const height = content.offsetHeight;

      // (3) 顶部插入历史：用高度差补偿 scrollTop，把原视口内容钉在原处
      const anchor = prependAnchorRef.current;
      if (anchor) {
        if (height !== anchor.height) {
          container.scrollTop = computePrependScrollTop(anchor.top, anchor.height, height);
          anchor.height = height;
          anchor.top = container.scrollTop;
        }
        // 释放时机：加载中（loadingMore=true）必须一直保持锚定，否则「静默
        // PREPEND_ANCHOR_RELEASE_MS 就解除」会在真正的历史插入到达之前把锚点
        // 解掉 —— 实测那样只补偿到 200/1371px，视口仍被顶走 ~1000px。
        // 加载结束后再等 PREPEND_ANCHOR_RELEASE_MS，让最后一次布局修正落定。
        if (!loadingMoreRef.current) {
          if (releaseTimer) clearTimeout(releaseTimer);
          releaseTimer = setTimeout(() => {
            prependAnchorRef.current = null;
            releaseTimer = null;
          }, PREPEND_ANCHOR_RELEASE_MS);
        }
        return;
      }

      // (2) 贴底跟随：只在用户确实贴着底部时生效，避免把上滑阅读的用户拽下来。
      //     用「对齐到内容末端」而不是「scrollTop += 高度差」——后者在内容变矮时
      //     会与浏览器的钳制重复抵消，反而把视口顶上去（详见 pinnedScrollTop 注释）。
      //     非贴底时无需处理：追加在底部的内容不会移动视口上方的内容，而视口上方
      //     条目的测量修正由虚拟器自身的 scrollAdjustments 负责。
      if (!isPinnedRef.current) return;
      const target = pinnedScrollTop(container.scrollHeight, container.clientHeight);
      if (container.scrollTop !== target) container.scrollTop = target;
    });

    ro.observe(content);
    return () => {
      ro.disconnect();
      if (releaseTimer) clearTimeout(releaseTimer);
    };
  }, []);

  // 加载结束（loadingMore 由 true 落回 false）后及时解除锚定，避免锚点滞留：
  // 若一直挂着，之后真正到达的**新消息**也会被当成 prepend 去补偿，反而错位。
  useEffect(() => {
    if (loadingMore || !prependAnchorRef.current) return;
    const t = setTimeout(() => {
      prependAnchorRef.current = null;
      if (prependAnchorTimerRef.current) {
        clearTimeout(prependAnchorTimerRef.current);
        prependAnchorTimerRef.current = null;
      }
    }, PREPEND_ANCHOR_RELEASE_MS);
    return () => clearTimeout(t);
  }, [loadingMore]);

  // 卸载时清理锚点兜底定时器
  useEffect(() => () => {
    if (prependAnchorTimerRef.current) clearTimeout(prependAnchorTimerRef.current);
  }, []);

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
      lastKeyRef.current = len > 0 ? virtualItems[len - 1]?.key ?? null : null;
      // 新房间从底部开始看，重置贴底/滚动锚点状态
      isNearBottomRef.current = true;
      isPinnedRef.current = true;
      prependAnchorRef.current = null;
      setUnreadCount(0);
      firstUnreadIdRef.current = null;
      setFirstUnreadId(null);
      return;
    }
    const lastKey = len > 0 ? virtualItems[len - 1]?.key ?? null : null;
    const prevLastKey = lastKeyRef.current;
    lastKeyRef.current = lastKey;

    // 顶部插入历史（prepend）与底部追加新消息（append）都会让 len 变大，必须区分开：
    //   append 一定会改变末项 key；prepend 的末项 key 保持不变。
    // 若把 prepend 当成新消息，就会把正在上滑看历史的用户直接拽到底部（实测被拽走
    // ~3800px），并把历史消息误计入未读数、误显示「新消息」分隔线。
    const isPrepend = isPrependGrowth(len, prevLenRef.current, lastKey, prevLastKey);

    if (len <= prevLenRef.current || !hasInitialScrolledRef.current || isPrepend) {
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
      // 主动贴底：同步收起「回到最新」气泡，避免平滑滚动过程中按钮残留
      if (showScrollBtnRef.current) {
        showScrollBtnRef.current = false;
        setShowScrollBtn(false);
      }
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
          if (!v) continue;
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
    // 顶部插入历史的锚点若仍挂着，会与本次贴底互相抵消，先解除
    prependAnchorRef.current = null;
    if (prependAnchorTimerRef.current) {
      clearTimeout(prependAnchorTimerRef.current);
      prependAnchorTimerRef.current = null;
    }
    isNearBottomRef.current = true;
    isPinnedRef.current = true;
    showScrollBtnRef.current = false;
    setShowScrollBtn(false);
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

  // 最新一条消息的播报文本（见上方离屏 live region 的说明）
  const liveAnnouncement = useMemo(() => {
    if (messages.length === 0) return '';
    const latest = messages[messages.length - 1];
    if (!latest) return '';
    const body =
      latest.type === 'text' ? latest.content : mediaPlaceholder(latest.type) ?? '';
    return `${latest.user}：${body}`;
  }, [messages]);

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col">
      {/* 受控的离屏播报区：只播报**最新一条**消息，避免虚拟列表滚动时持续播报 */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
      {/*
        P3 可访问性修复：这里原先是 `role="log" aria-live="polite"`。
        `role="log"` 隐含 `aria-live="polite"`，而本列表是**虚拟列表** —— 滚动时
        会不断挂载/卸载消息节点，屏幕阅读器会把「上下滚动」当成大量新内容持续播报，
        完全无法使用。现在：容器改为普通 `role="list"`（不播报），
        另用一个受控的、仅包含**最新一条消息**的离屏 live region 做播报。
      */}
      <main
        ref={containerRef}
        className="flex-1 h-full overflow-y-auto px-4 relative"
        role="list"
        aria-label="聊天消息列表"
        // 禁用浏览器原生滚动锚定：它会与虚拟列表的挂载/卸载、measureElement 修正
        // 互相打架，各自改 scrollTop 造成「消息上下来回弹」。锚定改由下方
        // ResizeObserver 精确接管（贴底跟随 + 顶部插入补偿）。
        style={{ overflowAnchor: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => {
          // Dismiss keyboard when tapping on empty area of the message list.
          // ⚠️ 必须排除 TEXTAREA / INPUT：消息「编辑」态下的 textarea 也在本容器里，
          // 一律 blur 会让点击编辑框时被瞬时夺焦（activeElement → BODY），键盘事件
          // 落不到 textarea 上，造成「点了编辑却无法改」的现象。链接/提交按钮同理。
          const tag = (e.target as HTMLElement).tagName;
          if (tag !== 'BUTTON' && tag !== 'A' && tag !== 'TEXTAREA' && tag !== 'INPUT') {
            (document.activeElement as HTMLElement)?.blur?.();
          }
        }}
      >
        {/*
          内容包裹层：ResizeObserver 的观察目标。必须是**紧贴滚动容器的单一子节点**，
          否则观察到的不是完整内容高度，贴底跟随与顶部插入锚定都会算错。
        */}
        <div ref={contentRef}>
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
                    onAvatarClick={onAvatarClick}
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
                if (!item) return null;

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
                      onAvatarClick={onAvatarClick}
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
        </div>
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
