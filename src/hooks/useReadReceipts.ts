'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Message } from '@/types';
import { API_CONFIG } from '@/config';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseReadReceiptsParams {
  roomId: string;
  currentUser: string;
  isDM: boolean;
  isActive: boolean; // 当前房间是否正被查看
  messages: Message[];
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  messagesRef: React.MutableRefObject<Message[]>;
}

/**
 * 已读回执（微信式）：
 *  - 接收方查看房间时，把对方发来的消息标记为已读（持久化 + 广播 receipt）
 *  - 发送方监听 receipt 广播，在自己发出的消息下显示「已读」
 * 仅私聊(isDM)展示「已读」字样。
 */
export function useReadReceipts({
  roomId,
  currentUser,
  isDM,
  isActive,
  messages,
  channelRef,
  setMessages,
  messagesRef,
}: UseReadReceiptsParams) {
  const me = currentUser.trim();
  const markedRef = useRef<Set<string>>(new Set());
  const readByOtherRef = useRef<Set<string>>(new Set());

  // 拉取初始已读状态（我发出的消息中，被对方读过的有哪些）
  const fetchReadState = useCallback(async () => {
    if (!isDM || !me) return;
    try {
      const res = await fetch(`${API_CONFIG.MESSAGE_READ_ENDPOINT}?roomId=${encodeURIComponent(roomId)}&user=${encodeURIComponent(me)}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.readMessageIds)) {
        readByOtherRef.current = new Set(json.readMessageIds);
        setMessages((prev) =>
          prev.map((m) => (readByOtherRef.current.has(m.id) ? { ...m, readByOther: true } : m))
        );
      }
    } catch { /* 非致命 */ }
  }, [isDM, me, roomId, setMessages]);

  useEffect(() => {
    markedRef.current = new Set();
    readByOtherRef.current = new Set();
    fetchReadState();
  }, [roomId, fetchReadState]);

  // 监听 receipt 广播（对方标记我的消息已读）
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !isDM) return;
    const handler = (payload: { messageIds?: string[] }) => {
      const ids = payload?.messageIds || [];
      if (!ids.length) return;
      ids.forEach((id) => readByOtherRef.current.add(id));
      setMessages((prev) => prev.map((m) => (readByOtherRef.current.has(m.id) ? { ...m, readByOther: true } : m)));
    };
    // 使用 ref 透传最新 handler
    receiptHandlerRef.current = handler;
    return () => { receiptHandlerRef.current = null; };
  }, [channelRef, isDM, setMessages]);

  // 接收方：查看房间时标记对方消息已读
  useEffect(() => {
    if (!isActive || !isDM || !me) return;
    const incoming = messages.filter(
      (m) => m.user !== me && !m.withdrawn_at && !markedRef.current.has(m.id) && !readByOtherRef.current.has(m.id)
    );
    if (incoming.length === 0) return;
    const ids = incoming.map((m) => m.id);
    ids.forEach((id) => markedRef.current.add(id));

    fetch(API_CONFIG.MESSAGE_READ_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, user: me, messageIds: ids }),
    }).catch(() => {});

    // 广播给发送方
    channelRef.current?.send({
      type: 'broadcast',
      event: 'receipt',
      payload: { reader: me, messageIds: ids },
    });
  }, [messages, isActive, isDM, me, roomId, channelRef]);

  // 暴露给 useMessageRealtime 调用 receipt 分发
  return { fetchReadState };
}

// 模块级转发：useMessageRealtime 收到 'receipt' 时调用
export const receiptHandlerRef: { current: ((payload: { messageIds?: string[] }) => void) | null } = { current: null };
