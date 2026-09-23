'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Message, Reaction } from '@/types';
import { useMessageLoader } from './useMessageLoader';
import { useMessageRealtime } from './useMessageRealtime';
import { useMessageActions } from './useMessageActions';
import { useTypingIndicator } from './useTypingIndicator';
import { useReadReceipts } from './useReadReceipts';

interface UseMessagesParams {
  currentUser?: string;
  roomName?: string;
  onRoomUpdated?: () => void;
  onMessageSent?: () => void;
  onExternalMessage?: (roomId: string, message: Message) => void;
  roomIds?: string[];
  onNewDM?: (roomId: string) => void;
  isDM?: boolean;
  isActive?: boolean;
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

  // Realtime broadcast subscription (onSync triggers DB catch-up after reconnect)
  const { channelRef, globalChannelRef } = useMessageRealtime({
    roomId,
    setMessages,
    setTypingUsers,
    processedIdsRef,
    typingTimersRef,
    onRoomDeleted,
    onRoomUpdated: params?.onRoomUpdated,
    currentUser: params?.currentUser,
    roomName: params?.roomName,
    onSync: syncNewMessages,
    onExternalMessage: params?.onExternalMessage,
    roomIds: params?.roomIds,
    onNewDM: params?.onNewDM,
    onReaction: handleReactionUpdate,
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
    channelRef,
    globalChannelRef,
    processedIdsRef,
    messagesRef,
    onMessageSent: params?.onMessageSent,
  });

  // Typing indicators
  const { sendTypingStart, sendTypingStop } = useTypingIndicator({ channelRef });

  // 已读回执（仅私聊）
  const { fetchReadState } = useReadReceipts({
    roomId,
    currentUser: params?.currentUser || '',
    isDM: !!params?.isDM,
    isActive: !!params?.isActive,
    messages,
    channelRef,
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
        // 广播给同房间其他客户端
        channelRef.current?.send({
          type: 'broadcast',
          event: 'chat-reaction',
          payload: { messageId, reactions: data.reactions },
        });
      }
    } catch {
      /* 失败不回滚，下次加载会修正 */
    }
  }, [params?.currentUser, channelRef]);

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
    channelRef,
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
