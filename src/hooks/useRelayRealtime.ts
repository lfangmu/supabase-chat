'use client';

// 基于"服务端中继"的实时 hook（替代 useMessageRealtime 里的 supabase.channel 链路）。
// 浏览器不再直连 Supabase WebSocket，而是：
//   * 接收：connectRelay() 走 SSE（见 src/lib/realtimeRelay.ts）
//   * 发送：sendRelay() 走 POST /realtime/send
//
// 覆盖范围（v0）：
//   ✅ 当前房间 + 后台房间的消息 INSERT/UPDATE（postgres_changes / CDC）
//   ✅ 当前房间的 broadcast：typing / withdraw / edit / receipt / reaction / room-deleted
//   ✅ 全局 chat-events：room-updated / new-dm
//   ✅ system 错误 → 断线重连（带退避）+ 令牌刷新后重连
//   ⚠️ presence（在线列表）：事件已转发到 onPresence，但 usePresence 的接入仍待整合
//   ⚠️ 仍需线上验证：Worker 侧 Realtime 协议（尤其 presence track/diff）与实际事件字段
//
// 与原 useMessageRealtime 相同的去重 / @提及 / 通知 / 缓存逻辑已移植。

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { connectRelay, sendRelay, type RelayClient, type RelayEvent } from '@/lib/realtimeRelay';
import { applyRelayPresence } from '@/lib/presenceRelay';
import { Message, Reaction } from '@/types';
import { STORAGE_CONFIG_KEYS, MESSAGE_CONFIG } from '@/config';
import { safeSetCache } from '@/utils/cacheUtils';
import { notifyNewMessage, notifyMention, isMentioned, addMentionedRoom } from '@/utils/notifications';
import { receiptHandlerRef } from './useReadReceipts';

const MAX_PROCESSED_IDS = MESSAGE_CONFIG.MAX_PROCESSED_IDS;

// 中继地址与公开 key（NEXT_PUBLIC_* 构建期内联，取一次即可）
const PROXY_URL =
  process.env.NEXT_PUBLIC_SUPABASE_PROXY_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';
const RELAY_APIKEY = process.env.NEXT_PUBLIC_SUPABASE_KEY || '';

function trimProcessedIds(set: Set<string>) {
  if (set.size > MAX_PROCESSED_IDS) {
    const arr = Array.from(set);
    const keep = arr.slice(arr.length - Math.floor(MAX_PROCESSED_IDS / 2));
    set.clear();
    keep.forEach((id) => set.add(id));
  }
}

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    user: row.user as string,
    userId: row.user_id as string,
    type: row.type as Message['type'],
    content: row.content as string,
    timestamp: row.timestamp as string,
    quoteId: (row.quote_id as string | undefined) ?? undefined,
    quote: (row.quote as Message['quote']) ?? undefined,
    edited_at: (row.edited_at as string | null) ?? null,
    withdrawn_at: (row.withdrawn_at as string | null) ?? null,
    file_name: (row.file_name as string | null) ?? null,
    file_size: (row.file_size as number | null) ?? null,
    file_mime: (row.file_mime as string | null) ?? null,
    sendStatus: 'sent' as const,
  };
}

interface UseRelayRealtimeParams {
  roomId: string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setTypingUsers: React.Dispatch<React.SetStateAction<string[]>>;
  processedIdsRef: React.MutableRefObject<Set<string>>;
  typingTimersRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
  onRoomDeleted?: (roomId: string) => void;
  onRoomUpdated?: () => void;
  onSync?: () => void;
  currentUser?: string;
  /** 我的 Supabase Auth UUID：全局在线（presence:global）以它为 key */
  myId?: string;
  roomName?: string;
  onExternalMessage?: (roomId: string, message: Message) => void;
  roomIds?: string[];
  onNewDM?: (roomId: string) => void;
  onReaction?: (messageId: string, reactions: Reaction[]) => void;
  isActive?: boolean;
  onMention?: (roomId: string) => void;
  // presence 事件转发（接入 usePresence 时消费；v0 暂未完整整合）
  onPresence?: (data: any) => void;
}

export function useRelayRealtime({
  roomId,
  setMessages,
  setTypingUsers,
  processedIdsRef,
  typingTimersRef,
  onRoomDeleted,
  onRoomUpdated,
  onSync,
  currentUser = '',
  myId = '',
  roomName = '',
  onExternalMessage,
  roomIds = [],
  onNewDM,
  onReaction,
  isActive = false,
  onMention,
  onPresence,
}: UseRelayRealtimeParams) {
  const currentUserRef = useRef(currentUser);
  const myIdRef = useRef(myId);
  const roomNameRef = useRef(roomName);
  const roomIdRef = useRef(roomId);
  const onRoomUpdatedRef = useRef(onRoomUpdated);
  const isActiveRef = useRef(isActive);
  const onMentionRef = useRef(onMention);
  const onRoomDeletedRef = useRef(onRoomDeleted);
  const onSyncRef = useRef(onSync);
  const setMessagesRef = useRef(setMessages);
  const setTypingUsersRef = useRef(setTypingUsers);
  const onExternalMessageRef = useRef(onExternalMessage);
  const onNewDMRef = useRef(onNewDM);
  const onReactionRef = useRef(onReaction);
  const onPresenceRef = useRef(onPresence);

  useEffect(() => {
    currentUserRef.current = currentUser;
    myIdRef.current = myId;
    roomNameRef.current = roomName;
    roomIdRef.current = roomId;
    onRoomUpdatedRef.current = onRoomUpdated;
    onRoomDeletedRef.current = onRoomDeleted;
    onSyncRef.current = onSync;
    setMessagesRef.current = setMessages;
    setTypingUsersRef.current = setTypingUsers;
    onExternalMessageRef.current = onExternalMessage;
    onNewDMRef.current = onNewDM;
    onReactionRef.current = onReaction;
    isActiveRef.current = isActive;
    onMentionRef.current = onMention;
    onPresenceRef.current = onPresence;
  });

  const scheduleCacheWrite = useRef((messages: Message[]) => {
    if (typeof requestAnimationFrame === 'undefined') return;
    requestAnimationFrame(() => {
      safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomIdRef.current}`, messages);
    });
  }).current;

  const [reconnectTick, setReconnectTick] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    // 捕获成局部 const：TS 的 null 收窄不会带进异步闭包
    const sb = supabase;
    let closed = false;
    let client: RelayClient | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;
    let currentToken = '';
    const cacheTimerRef: { current: number | null } = { current: null };

    const proxyUrl = PROXY_URL;
    const apikey = RELAY_APIKEY;

    const handleEvent = (ev: RelayEvent) => {
      const { type, data } = ev;
      if (type === 'system') {
        if (data?.status === 'error') {
          // 半死 / RLS 失效：断开并重建
          client?.close();
          reconnect();
        }
        return;
      }
      if (type === 'presence') {
        // 合并进 presence 仓库（usePresence / useGlobalPresence 从仓库读）
        applyRelayPresence(data);
        onPresenceRef.current?.(data);
        return;
      }
      if (type === 'broadcast') {
        const rid = data.roomId;
        const event = data.event;
        const payload = data.payload;
        if (!rid || rid === '__global__') {
          // 全局 chat-events（Worker 把 chat-events 映射成 __global__）
          if (event === 'room-updated') onRoomUpdatedRef.current?.();
          else if (event === 'new-dm') onNewDMRef.current?.(payload?.roomId);
          return;
        }
        if (rid !== roomIdRef.current) return;
        switch (event) {
          case 'typing-start': {
            const typer = payload?.user as string;
            setTypingUsersRef.current((prev) => (prev.includes(typer) ? prev : [...prev, typer]));
            const existing = typingTimersRef.current.get(typer);
            if (existing) clearTimeout(existing);
            typingTimersRef.current.set(
              typer,
              setTimeout(() => {
                setTypingUsersRef.current((prev) => prev.filter((u) => u !== typer));
                typingTimersRef.current.delete(typer);
              }, 3000)
            );
            break;
          }
          case 'typing-stop': {
            const typer = payload?.user as string;
            setTypingUsersRef.current((prev) => prev.filter((u) => u !== typer));
            const existing = typingTimersRef.current.get(typer);
            if (existing) {
              clearTimeout(existing);
              typingTimersRef.current.delete(typer);
            }
            break;
          }
          case 'withdraw-message': {
            const withdrawId = payload?.id as string;
            setMessagesRef.current((prev) => {
              const updated = prev.map((m) =>
                m.id === withdrawId ? { ...m, withdrawn_at: new Date().toISOString() } : m
              );
              scheduleCacheWrite(updated);
              return updated;
            });
            break;
          }
          case 'edit-message': {
            const { id, content, edited_at } = payload as {
              id: string;
              content: string;
              edited_at: string;
            };
            setMessagesRef.current((prev) => {
              const updated = prev.map((m) => (m.id === id ? { ...m, content, edited_at } : m));
              scheduleCacheWrite(updated);
              return updated;
            });
            break;
          }
          case 'receipt':
            receiptHandlerRef.current?.(payload as { messageIds?: string[] });
            break;
          case 'room-deleted':
            if (payload?.roomId === roomIdRef.current) onRoomDeletedRef.current?.(payload.roomId);
            break;
          case 'chat-reaction':
            if (payload?.messageId)
              onReactionRef.current?.(payload.messageId, (payload.reactions as Reaction[]) || []);
            break;
        }
        return;
      }
      // message-insert / message-update（postgres_changes / CDC）
      const rid = data.roomId;
      const row = data.row;
      if (!row) return;
      if (rid !== roomIdRef.current) {
        // 后台房间
        if (type === 'message-insert') onExternalMessageRef.current?.(rid, rowToMessage(row));
        else onRoomUpdatedRef.current?.();
        return;
      }
      if (type === 'message-update') {
        // 当前房间 UPDATE：撤回 / 编辑
        const withdrawn = row.withdrawn_at;
        const edited = row.edited_at;
        const id = row.id as string;
        setMessagesRef.current((prev) => {
          const updated = prev.map((m) => {
            if (m.id !== id) return m;
            return {
              ...m,
              ...(withdrawn ? { withdrawn_at: withdrawn as string } : {}),
              ...(edited ? { content: row.content as string, edited_at: edited as string } : {}),
            };
          });
          scheduleCacheWrite(updated);
          return updated;
        });
        return;
      }
      // message-insert（当前房间）
      const msg = rowToMessage(row as Record<string, unknown>);
      setMessagesRef.current((prev) => {
        if (prev.some((m) => m.id === msg.id) || processedIdsRef.current.has(msg.id)) return prev;
        processedIdsRef.current.add(msg.id);
        trimProcessedIds(processedIdsRef.current);
        const trimmedUser = currentUserRef.current.trim();
        const isSelfMessage = msg.user === trimmedUser;
        if (msg.type === 'text' && !isSelfMessage && isMentioned(msg.content, trimmedUser)) {
          notifyMention(roomNameRef.current || '群聊', msg.user, msg.content.slice(0, 100));
          if (!isActiveRef.current) {
            addMentionedRoom(roomIdRef.current);
            onMentionRef.current?.(roomIdRef.current);
          }
        } else {
          notifyNewMessage(
            msg.user,
            msg.type === 'text'
              ? msg.content
              : `[${msg.type === 'image' ? '图片' : msg.type === 'video' ? '视频' : msg.type === 'voice' ? '语音' : '文件'}]`,
            isSelfMessage
          );
        }
        return [...prev, msg];
      });
    };

    const connect = async () => {
      if (closed) return;
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        reconnect();
        return;
      }
      currentToken = token;
      const allRooms = Array.from(new Set([roomIdRef.current, ...roomIds])).filter(Boolean);
      client = connectRelay({
        proxyUrl,
        token,
        apikey,
        rooms: allRooms,
        userId: currentUserRef.current ? `user-${currentUserRef.current.trim()}` : '',
        nickname: currentUserRef.current,
        guid: myIdRef.current,
        onEvent: handleEvent,
        onError: () => reconnect(),
      });
      // 首次连上后补一次漏掉的消息（覆盖重连间隙）
      onSyncRef.current?.();
    };

    const reconnect = () => {
      if (closed) return;
      attempt += 1;
      const backoff = Math.min(1000 * 2 ** Math.min(attempt, 5), 30000);
      reconnectTimer = setTimeout(connect, backoff);
    };

    connect();

    // 令牌刷新：一旦会话 token 变化，断开旧连接让下次重连用新 token
    heartbeatTimer = setInterval(async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (token && token !== currentToken && client) {
        client.close();
        attempt = 0;
        connect();
      }
    }, 30000);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (cacheTimerRef.current) cancelAnimationFrame(cacheTimerRef.current);
      client?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, roomIds.join(','), reconnectTick]);

  /**
   * 通过服务端中继发一条 broadcast。
   * @param rid 目标房间 id；传 '__global__' 则发到全局 chat-events 频道
   *            （用于 room-updated / new-dm）。
   */
  const sendBroadcast = useCallback(
    async (rid: string, event: string, payload: any) => {
      if (!supabase) return;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        await sendRelay({
          proxyUrl: PROXY_URL,
          token,
          apikey: RELAY_APIKEY,
          roomId: rid,
          event,
          payload,
        });
      } catch {
        // 中继发送失败不阻断主流程：消息本身已由服务端落库，对端靠 CDC 也能收到。
        // broadcast 只承载 typing / 撤回 / 编辑 / 回执这类「增强体验」信号。
      }
    },
    []
  );

  return { reconnectTick, sendBroadcast };
}
