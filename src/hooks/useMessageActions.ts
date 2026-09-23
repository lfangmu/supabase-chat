'use client';

import { useCallback, useRef, useEffect } from 'react';
import { Message } from '@/types';
import { STORAGE_CONFIG_KEYS, API_CONFIG } from '@/config';
import { safeSetCache } from '@/utils/cacheUtils';
import { showError } from '@/utils/errorHandler';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseMessageActionsParams {
  roomId: string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  globalChannelRef: React.MutableRefObject<RealtimeChannel | null>;
  processedIdsRef: React.MutableRefObject<Set<string>>;
  messagesRef: React.MutableRefObject<Message[]>;
  onMessageSent?: () => void;
}

export function useMessageActions({
  roomId,
  setMessages,
  channelRef,
  globalChannelRef,
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
          // 不再由客户端广播 chat-message：改由服务端 Edge Function（broadcast-message）
          // 签名后广播（路B），客户端校验签名后才渲染，杜绝同房间参与者伪造消息。
          // 发送方本地消息已由乐观插入 + POST 响应展示，无需自广播。
          // Notify all clients to refresh their chat list
          globalChannelRef.current?.send({
            type: 'broadcast',
            event: 'room-updated',
            payload: { roomId },
          });
          // For DM rooms, tell the other participant to discover this room in real-time
          // (they may not yet be subscribed to its channel).
          if (roomId.startsWith('dm:')) {
            globalChannelRef.current?.send({
              type: 'broadcast',
              event: 'new-dm',
              payload: { roomId },
            });
          }
          // Refresh sender's own room list (self: false means they don't get the broadcast)
          onMessageSentRef.current?.();
        }
      });
    },
    [persistMessage, setMessages, channelRef, globalChannelRef, processedIdsRef, roomId]
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
          // 不再由客户端广播 chat-message：改由服务端 Edge Function（broadcast-message）
          // 签名后广播（路B），客户端校验签名后才渲染，杜绝同房间参与者伪造消息。
          // 发送方本地消息已由乐观插入 + POST 响应展示，无需自广播。
          // Notify all clients to refresh their chat list
          globalChannelRef.current?.send({
            type: 'broadcast',
            event: 'room-updated',
            payload: { roomId },
          });
          // For DM rooms, tell the other participant to discover this room in real-time
          if (roomId.startsWith('dm:')) {
            globalChannelRef.current?.send({
              type: 'broadcast',
              event: 'new-dm',
              payload: { roomId },
            });
          }
          // Refresh sender's own room list
          onMessageSentRef.current?.();
        }
      });
    },
    [persistMessage, setMessages, channelRef, globalChannelRef, messagesRef, roomId]
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

      channelRef.current?.send({
        type: 'broadcast',
        event: 'withdraw-message',
        payload: { id: messageId, withdrawn_at: withdrawnAt },
      });
    },
    [roomId, setMessages, channelRef]
  );

  // Edit message — optimistic update + server PUT + broadcast
  const editMessage = useCallback(
    async (messageId: string, user: string, newContent: string) => {
      const prevMessages = messagesRef.current;

      const editedAt = new Date().toISOString();
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === messageId ? { ...m, content: newContent, edited_at: editedAt } : m
        );
        safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, updated);
        return updated;
      });

      channelRef.current?.send({
        type: 'broadcast',
        event: 'edit-message',
        payload: { id: messageId, content: newContent, edited_at: editedAt },
      });

      try {
        const res = await fetch(API_CONFIG.MESSAGES_ENDPOINT, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: messageId, user, content: newContent }),
        });

        if (!res.ok) {
          setMessages(prevMessages);
          safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, prevMessages);
        }
      } catch {
        setMessages(prevMessages);
        safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, prevMessages);
      }
    },
    [roomId, setMessages, channelRef, messagesRef]
  );

  return { sendMessage, retryMessage, withdrawMessage, editMessage };
}