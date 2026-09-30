'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Message, Reaction } from '@/types';
import { useMessageLoader } from './useMessageLoader';
import { useRelayRealtime } from './useRelayRealtime';
import { useMessageActions } from './useMessageActions';
import { useTypingIndicator } from './useTypingIndicator';
import { useReadReceipts } from './useReadReceipts';

interface UseMessagesParams {
  currentUser?: string;
  // 当前用户 Supabase Auth UUID（用于已读回执 API，需与 actor 一致；displayName 会被拒）
  currentUserId?: string;
  roomName?: string;
  onRoomUpdated?: () => void;
  onMessageSent?: () => void;
  onExternalMessage?: (roomId: string, message: Message) => void;
  roomIds?: string[];
  onNewDM?: (roomId: string) => void;
  isDM?: boolean;
  isActive?: boolean;
  // @提及被记为未读后的回调（父层据此立刻刷新红点状态，避免等 10s 轮询）
  onMention?: (roomId: string) => void;
}

export const useMessages = (roomId: string, onRoomDeleted?: (roomId: string) => void, params?: UseMessagesParams) => {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const processedIdsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);

  // REQ-001: 表情回应（按 messageId 聚合）
  const [reactionsByMessage, setReactionsByMessage] = useState<Record<string, Reaction[]>>({});
  const reactionsRef = useRef<Record<string, Reaction[]>>({});
  useEffect(() => {
    reactionsRef.current = reactionsByMessage;
  }, [reactionsByMessage]);

  // Message loading (DB + cache merge, pagination, sync)
  const { messages, setMessages, loadingMore, hasMore, loadMoreHistory, isLoading, syncNewMessages } = useMessageLoader({
    roomId,
    processedIdsRef,
    abortControllerRef,
  });

  // REQ-001: 收到他人的表情回应广播时，更新本地聚合
  const handleReactionUpdate = useCallback((messageId: string, reactions: Reaction[]) => {
    setReactionsByMessage((prev) => ({ ...prev, [messageId]: reactions }));
  }, []);

  // Keep messagesRef in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 权威刷新：收到 edit-message / withdraw-message 广播时，按 id 回源 DB 取回真实内容。
  // 用 ref 间接调用，因为 useRelayRealtime 在下面（更早）就要用到这个回调，
  // 而真正的实现依赖 setMessages。
  const authoritativeRefreshRef = useRef<(id: string) => void>(() => {});

  // 实时链路：服务端中继（SSE 收 + POST 发），替代 supabase.channel 的 WebSocket。
  // 浏览器全程只走 HTTP，规避国内对浏览器 → Cloudflare WebSocket 的封锁。
  const { sendBroadcast } = useRelayRealtime({
    roomId,
    setMessages,
    setTypingUsers,
    processedIdsRef,
    typingTimersRef,
    onRoomDeleted,
    onRoomUpdated: params?.onRoomUpdated,
    currentUser: params?.currentUser,
    // 全局在线（presence:global）以 UUID 为 key，必须传真实身份
    myId: params?.currentUserId,
    roomName: params?.roomName,
    onSync: syncNewMessages,
    onExternalMessage: params?.onExternalMessage,
    roomIds: params?.roomIds,
    onNewDM: params?.onNewDM,
    onReaction: handleReactionUpdate,
    onAuthoritativeUpdate: (messageId: string) => authoritativeRefreshRef.current(messageId),
    isActive: !!params?.isActive,
    onMention: params?.onMention,
  });

  // Additional safety: sync from DB when app becomes visible (mobile resume)
  const lastSyncRef = useRef(0);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastSyncRef.current > 3000) {
          lastSyncRef.current = now;
          syncNewMessages();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [syncNewMessages]);

  // Manual refresh (pull-to-refresh)
  const refreshMessages = useCallback(async () => {
    lastSyncRef.current = Date.now();
    return syncNewMessages();
  }, [syncNewMessages]);

  // Message actions (send, retry, withdraw, edit)
  const { sendMessage, retryMessage, withdrawMessage, editMessage } = useMessageActions({
    roomId,
    setMessages,
    sendBroadcast,
    processedIdsRef,
    messagesRef,
    onMessageSent: params?.onMessageSent,
  });

  // Typing indicators
  const { sendTypingStart, sendTypingStop } = useTypingIndicator({ roomId, sendBroadcast });

  // 已读回执（仅私聊）
  const { fetchReadState } = useReadReceipts({
    roomId,
    currentUserId: params?.currentUserId || '',
    isDM: !!params?.isDM,
    isActive: !!params?.isActive,
    messages,
    sendBroadcast,
    setMessages,
    messagesRef,
  });

  // REQ-001: 加载 + 切换表情回应
  // 全局搜索跳转：按 id 精准加载单条消息（可能未在当前已加载窗口内）。
  // 校验由 API 端 isRoomParticipant 完成；成功后插入消息列表并去重排序。
  const loadMessageById = useCallback(async (messageId: string): Promise<Message | null> => {
    try {
      const res = await fetch(`/api/messages/by-id?id=${encodeURIComponent(messageId)}`);
      const data = await res.json();
      if (!data.success || !data.message) return null;
      const msg = data.message as Message;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const merged = [...prev, { ...msg, sendStatus: 'sent' as const }].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        return merged;
      });
      return msg;
    } catch {
      return null;
    }
  }, [setMessages]);

  // P0-1 收口：编辑 / 撤回广播只当「信令」用，内容一律回源 DB 取权威值，
  // 避免攻击者伪造 `edit-message` 广播内容（服务端已鉴权，客户端再兜一层）。
  const refreshMessageById = useCallback(async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/by-id?id=${encodeURIComponent(messageId)}`);
      const data = await res.json();
      if (!data.success || !data.message) return;
      const fresh = data.message as Message;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === fresh.id);
        if (idx === -1) {
          return [...prev, { ...fresh, sendStatus: 'sent' as const }].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        }
        const existing = prev[idx];
        if (!existing) return prev;
        // 只覆盖「服务端权威字段」，保留纯客户端状态（sendStatus / readByOther / tempId）
        const merged: Message = {
          ...existing,
          content: fresh.content,
          type: fresh.type,
          timestamp: fresh.timestamp,
          edited_at: fresh.edited_at ?? null,
          withdrawn_at: fresh.withdrawn_at ?? null,
          file_name: fresh.file_name ?? null,
          file_size: fresh.file_size ?? null,
          file_mime: fresh.file_mime ?? null,
        };
        const next = [...prev];
        next[idx] = merged;
        return next;
      });
    } catch {
      /* 网络异常时保留本地内容，下一次 syncNewMessages 会修正 */
    }
  }, [setMessages]);

  useEffect(() => {
    authoritativeRefreshRef.current = (id: string) => {
      void refreshMessageById(id);
    };
  }, [refreshMessageById]);

  const loadReactions = useCallback(async (rid: string) => {
    try {
      const res = await fetch(`/api/messages/reactions?roomId=${encodeURIComponent(rid)}`);
      const data = await res.json();
      if (data.success) setReactionsByMessage(data.reactions || {});
    } catch {
      /* 离线时忽略，下次进入房间再加载 */
    }
  }, []);

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    const me = (params?.currentUser || '').trim();
    if (!me) return;
    // 乐观更新
    setReactionsByMessage((prev) => {
      const list = prev[messageId] || [];
      const has = list.some((r) => r.user === me && r.emoji === emoji);
      const next = has
        ? list.filter((r) => !(r.user === me && r.emoji === emoji))
        : [...list, { id: 'optimistic', message_id: messageId, user: me, emoji, created_at: new Date().toISOString() }];
      return { ...prev, [messageId]: next };
    });
    try {
      const res = await fetch('/api/messages/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, emoji }),
      });
      const data = await res.json();
      if (data.success) {
        setReactionsByMessage((prev) => ({ ...prev, [messageId]: data.reactions }));
        // 广播给同房间其他客户端（走服务端中继）
        sendBroadcast(roomId, 'chat-reaction', {
          messageId,
          reactions: data.reactions,
        });
      }
    } catch {
      /* 失败不回滚，下次加载会修正 */
    }
  }, [params?.currentUser, roomId, sendBroadcast]);

  // 切换房间时重置并加载该房间的表情回应
  useEffect(() => {
    setReactionsByMessage({});
    loadReactions(roomId);
  }, [roomId, loadReactions]);

  return {
    messages,
    loadingMore,
    hasMore,
    isLoading,
    typingUsers,
    loadMoreHistory,
    refreshMessages,
    sendMessage,
    retryMessage,
    withdrawMessage,
    editMessage,
    sendTypingStart,
    sendTypingStop,
    fetchReadState,
    reactionsByMessage,
    toggleReaction,
    loadReactions,
    loadMessageById,
  };
};
