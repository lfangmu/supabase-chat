'use client';

import { useCallback, useRef, useEffect } from 'react';
import { Message } from '@/types';
import { STORAGE_CONFIG_KEYS, API_CONFIG } from '@/config';
import { safeSetCache } from '@/utils/cacheUtils';
import { showError } from '@/utils/errorHandler';
import type { SendBroadcast } from '@/lib/realtimeRelay';

interface UseMessageActionsParams {
  roomId: string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  /**
   * 服务端中继的广播出口（替代 supabase.channel 的 send）。
   * 传 '__global__' 作为 roomId 即发到全局 chat-events 频道（room-updated / new-dm）。
   */
  sendBroadcast: SendBroadcast;
  processedIdsRef: React.MutableRefObject<Set<string>>;
  messagesRef: React.MutableRefObject<Message[]>;
  onMessageSent?: () => void;
}

export function useMessageActions({
  roomId,
  setMessages,
  sendBroadcast,
  processedIdsRef,
  messagesRef,
  onMessageSent,
}: UseMessageActionsParams) {
  const onMessageSentRef = useRef(onMessageSent);
  useEffect(() => { onMessageSentRef.current = onMessageSent; });

  // Persist message to DB via server API
  const persistMessage = useCallback(
    async (message: Message): Promise<boolean> => {
      try {
        const res = await fetch(API_CONFIG.MESSAGES_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: message.id,
            room_id: roomId,
            user: message.user,
            type: message.type,
            content: message.content,
            timestamp: message.timestamp,
            quote_id: message.quoteId ?? null,
            quote: message.quote ? message.quote : null,
            file_name: message.file_name ?? null,
            file_size: message.file_size ?? null,
            file_mime: message.file_mime ?? null,
            forwarded_from: message.forwardedFrom ?? null,
          }),
        });
        if (res.status === 401) {
          showError('登录已过期，请刷新页面重新登录');
          return false;
        }
        const data = await res.json();
        return data.success;
      } catch {
        return false;
      }
    },
    [roomId]
  );

  // Send message with optimistic local display + send status tracking
  const sendMessage = useCallback(
    (message: Message) => {
      // Haptic feedback on send (mobile)
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(15);
      }

      processedIdsRef.current.add(message.id);

      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, { ...message, sendStatus: 'sending' as const }];
      });

      // Persist to DB first, only broadcast to others after successful persistence
      persistMessage(message).then((success) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === message.id ? { ...m, sendStatus: success ? 'sent' : 'failed' } : m
          )
        );
        if (success) {
          // 消息落库后由数据库 Postgres Changes 实时推送给同房间成员
          // （CDC + RLS，天然防伪造、无需签名）。发送方本地消息已由乐观插入 +
          // POST 响应展示，无需自广播。
          // Notify all clients to refresh their chat list
          sendBroadcast('__global__', 'room-updated', { roomId });
          // For DM rooms, tell the other participant to discover this room in real-time
          // (they may not yet be subscribed to its channel).
          if (roomId.startsWith('dm:')) {
            sendBroadcast('__global__', 'new-dm', { roomId });
          }
          // Refresh sender's own room list (self: false means they don't get the broadcast)
          onMessageSentRef.current?.();
        }
      });
    },
    [persistMessage, setMessages, sendBroadcast, processedIdsRef, roomId]
  );

  // Retry sending a failed message
  const retryMessage = useCallback(
    (messageId: string) => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      if (!message || message.sendStatus !== 'failed') return;

      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, sendStatus: 'sending' as const } : m))
      );

      // Persist first, broadcast only after successful persistence
      persistMessage(message).then((success) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, sendStatus: success ? 'sent' : 'failed' } : m
          )
        );
        if (success) {
          // 消息落库后由数据库 Postgres Changes 实时推送给同房间成员
          // （CDC + RLS，天然防伪造、无需签名）。发送方本地消息已由乐观插入 +
          // POST 响应展示，无需自广播。
          // Notify all clients to refresh their chat list
          sendBroadcast('__global__', 'room-updated', { roomId });
          // For DM rooms, tell the other participant to discover this room in real-time
          if (roomId.startsWith('dm:')) {
            sendBroadcast('__global__', 'new-dm', { roomId });
          }
          // Refresh sender's own room list
          onMessageSentRef.current?.();
        }
      });
    },
    [persistMessage, setMessages, sendBroadcast, messagesRef, roomId]
  );

  // Withdraw message — 服务端校验归属 + 2 分钟时限，成功后再本地软撤回并广播，
  // 避免「本地已撤回、服务端拒绝」的状态不一致。
  const withdrawMessage = useCallback(
    async (messageId: string, user: string) => {
      try {
        const res = await fetch(API_CONFIG.MESSAGES_ENDPOINT, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: messageId, user, withdraw: true }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          showError(data.message || '撤回失败');
          return;
        }
      } catch {
        showError('网络异常，撤回失败');
        return;
      }

      const withdrawnAt = new Date().toISOString();
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === messageId ? { ...m, withdrawn_at: withdrawnAt } : m
        );
        safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, updated);
        return updated;
      });

      // 走服务端中继广播给同房间其他客户端（HTTP POST，国内可达）
      sendBroadcast(roomId, 'withdraw-message', {
        id: messageId,
        withdrawn_at: withdrawnAt,
      });
    },
    [roomId, setMessages, sendBroadcast]
  );

  // Edit message — optimistic update + server PUT + broadcast
  const editMessage = useCallback(
    async (messageId: string, user: string, newContent: string) => {
      const prevMessages = messagesRef.current;

      // 乐观更新（本地先显示新内容）
      const editedAt = new Date().toISOString();
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === messageId ? { ...m, content: newContent, edited_at: editedAt } : m
        );
        safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, updated);
        return updated;
      });

      // 先落库，服务端校验通过后再广播给同房间其他客户端。
      // 否则 PUT 失败时本地已回滚、对端却保留了编辑，状态不一致（与 withdrawMessage 保持一致）。
      try {
        const res = await fetch(API_CONFIG.MESSAGES_ENDPOINT, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: messageId, user, content: newContent }),
        });

        if (!res.ok) {
          // 服务端拒绝：回滚本地与缓存
          setMessages(prevMessages);
          safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, prevMessages);
          return;
        }
        // 成功才广播（走服务端中继）
        sendBroadcast(roomId, 'edit-message', {
          id: messageId,
          content: newContent,
          edited_at: editedAt,
        });
      } catch {
        setMessages(prevMessages);
        safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, prevMessages);
      }
    },
    [roomId, setMessages, sendBroadcast, messagesRef]
  );

  return { sendMessage, retryMessage, withdrawMessage, editMessage };
}