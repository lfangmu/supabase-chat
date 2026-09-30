'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Message, Reaction } from '@/types';
import { STORAGE_CONFIG_KEYS, MESSAGE_CONFIG } from '@/config';
import { safeSetCache } from '@/utils/cacheUtils';
import { notifyNewMessage, notifyMention, isMentioned, addMentionedRoom } from '@/utils/notifications';
import { dispatchReceipt } from './useReadReceipts';
import type { RealtimeChannel } from '@supabase/supabase-js';

const MAX_PROCESSED_IDS = MESSAGE_CONFIG.MAX_PROCESSED_IDS;

function trimProcessedIds(set: Set<string>) {
  if (set.size > MAX_PROCESSED_IDS) {
    const arr = Array.from(set);
    const keep = arr.slice(arr.length - Math.floor(MAX_PROCESSED_IDS / 2));
    set.clear();
    keep.forEach((id) => set.add(id));
  }
}

// 将 postgres_changes 推送的 messages 行（snake_case）映射为前端 Message 类型。
// postgres_changes 直接承载完整行，无需像旧广播那样携带签名 / 手工拼接字段。
function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    user: row.user as string,
    // 补齐发送者 UUID，使实时消息与历史消息一致（已读回执自消息识别、去重均依赖 userId）
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

interface UseMessageRealtimeParams {
  roomId: string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setTypingUsers: React.Dispatch<React.SetStateAction<string[]>>;
  processedIdsRef: React.MutableRefObject<Set<string>>;
  typingTimersRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
  onRoomDeleted?: (roomId: string) => void;
  // Global room update notification (triggers chat list refresh)
  onRoomUpdated?: () => void;
  // REQ-007: current user nickname for @mention detection
  currentUser?: string;
  // REQ-007: room name for mention notification title
  roomName?: string;
  // Called when room channel (re)subscribes successfully — parent should sync missed messages
  onSync?: () => void;
  // A NEW message arrived for a room OTHER than the one currently open (driven by
  // the per-room subscription). Parent marks it unread / shows a notification /
  // discovers the DM room. This is the fix for "messages don't arrive in time":
  // the receiver is subscribed to every joined room it participates in, so messages
  // arrive via the normal broadcast path even when that room isn't open.
  onExternalMessage?: (roomId: string, message: Message) => void;
  // IDs of ALL joined rooms (groups + DMs) the current user participates in, EXCEPT
  // the currently open one. We subscribe to each so messages (and @mentions) are
  // delivered in real-time even when that room isn't open.
  roomIds?: string[];
  // Signal fired when someone starts/continues a DM with us (global broadcast). The
  // parent discovers the room (adds to joined list) so it shows up + gets subscribed.
  onNewDM?: (roomId: string) => void;
  // REQ-001: 收到他人的表情回应广播 → 更新本地聚合
  onReaction?: (messageId: string, reactions: Reaction[]) => void;
  // 是否真的停留在聊天页（移动端列表页与聊天页共用同一个 roomId）。
  // 只在「不在聊天页」时才把 @提及记成未读红点 —— 否则用户正看着房间也会被打上红点。
  isActive?: boolean;
  // @提及被记为未读后回调，让父层立刻刷新 mentionedRoomIds 状态
  // （否则要等父层 10s 的轮询，红点会明显滞后）。
  onMention?: (roomId: string) => void;
}

export function useMessageRealtime({
  roomId,
  setMessages,
  setTypingUsers,
  processedIdsRef,
  typingTimersRef,
  onRoomDeleted,
  onRoomUpdated,
  currentUser = '',
  roomName = '',
  onSync,
  onExternalMessage,
  roomIds = [],
  onNewDM,
  onReaction,
  isActive = false,
  onMention,
}: UseMessageRealtimeParams) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const cacheTimerRef = useRef<number | null>(null);

  // Store latest callbacks in refs to avoid re-subscribing on every render
  const currentUserRef = useRef(currentUser);
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

  useEffect(() => {
    currentUserRef.current = currentUser;
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
  });

  // Debounced cache writer (batches frequent writes within 500ms) — uses roomIdRef to avoid stale closure
  const scheduleCacheWrite = useRef((messages: Message[]) => {
    if (cacheTimerRef.current) {
      cancelAnimationFrame(cacheTimerRef.current);
    }
    cacheTimerRef.current = requestAnimationFrame(() => {
      safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomIdRef.current}`, messages);
      cacheTimerRef.current = null;
    });
  }).current;

  // Reconnect triggers — incrementing these tears down + rebuilds channels via React effect lifecycle
  const [roomReconnectTick, setRoomReconnectTick] = useState(0);
  const [globalReconnectTick, setGlobalReconnectTick] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    const channelName = `chat-room:${roomId}`;
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: true } },
    });
    channelRef.current = channel;

    // Register all handlers BEFORE subscribing to avoid missing early events
    // 实时消息投递：改用 Postgres Changes（CDC）。数据库在消息落库后自动把 INSERT 行
    // 推给本房间成员（authenticated 角色 + RLS 按房间过滤），天然防伪造、无需签名。
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
      ({ new: row }) => {
        const msg = rowToMessage(row as Record<string, unknown>);
        setMessagesRef.current((prev) => {
          if (prev.some((m) => m.id === msg.id) || processedIdsRef.current.has(msg.id)) return prev;
          processedIdsRef.current.add(msg.id);
          trimProcessedIds(processedIdsRef.current);

          // Check for @mention — trigger notification regardless of visibility state
          const trimmedUser = currentUserRef.current.trim();
          const isSelfMessage = msg.user === trimmedUser;
          if (msg.type === 'text' && !isSelfMessage && isMentioned(msg.content, trimmedUser)) {
            notifyMention(roomNameRef.current || '群聊', msg.user, msg.content.slice(0, 100));
            // 只有「不在聊天页」才把这条 @我 记成未读红点。
            // 历史 bug（2026-09-27 双账号复测）：这里无条件 addMentionedRoom，
            // 而清除只在 switchRoom 里做 → 用户正看着房间时收到 @我 也会打上红点，
            // 且不会再触发 switchRoom，红点永久残留。
            if (!isActiveRef.current) {
              addMentionedRoom(roomId);
              onMentionRef.current?.(roomId);
            }
          } else {
            // Normal notification (only when page hidden)
            notifyNewMessage(
              msg.user,
              msg.type === 'text' ? msg.content : `[${msg.type === 'image' ? '图片' : msg.type === 'video' ? '视频' : msg.type === 'voice' ? '语音' : '文件'}]`,
              isSelfMessage
            );
          }

          return [...prev, msg];
        });
      }
    );

    channel.on('broadcast', { event: 'withdraw-message' }, ({ payload }) => {
      const withdrawId = payload.id as string;
      // 软撤回：保留消息占位，标记为已撤回（前端渲染为「X 撤回了一条消息」）
      setMessagesRef.current((prev) => {
        const updated = prev.map((m) =>
          m.id === withdrawId ? { ...m, withdrawn_at: new Date().toISOString() } : m
        );
        scheduleCacheWrite(updated);
        return updated;
      });
    });

    channel.on('broadcast', { event: 'edit-message' }, ({ payload }) => {
      const { id, content, edited_at } = payload as { id: string; content: string; edited_at: string };
      setMessagesRef.current((prev) => {
        const updated = prev.map((m) =>
          m.id === id ? { ...m, content, edited_at } : m
        );
        scheduleCacheWrite(updated);
        return updated;
      });
    });

    // Typing indicators
    channel.on('broadcast', { event: 'typing-start' }, ({ payload }) => {
      const typer = payload.user as string;
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
    });

    channel.on('broadcast', { event: 'typing-stop' }, ({ payload }) => {
      const typer = payload.user as string;
      setTypingUsersRef.current((prev) => prev.filter((u) => u !== typer));
      const existing = typingTimersRef.current.get(typer);
      if (existing) {
        clearTimeout(existing);
        typingTimersRef.current.delete(typer);
      }
    });

    // 已读回执：接收方标记我的消息已读 → 在我的消息下显示「已读」
    channel.on('broadcast', { event: 'receipt' }, ({ payload }) => {
      dispatchReceipt(payload as { messageIds?: string[] });
    });

    // Room deleted notification — auto-switch clients out of deleted room
    channel.on('broadcast', { event: 'room-deleted' }, ({ payload }) => {
      const deletedRoomId = payload.roomId as string;
      if (deletedRoomId === roomId && onRoomDeletedRef.current) {
        onRoomDeletedRef.current(deletedRoomId);
      }
    });

    // REQ-001: 表情回应广播 —— 更新该消息的本地聚合
    channel.on('broadcast', { event: 'chat-reaction' }, ({ payload }) => {
      const { messageId, reactions } = payload as { messageId: string; reactions: Reaction[] };
      if (messageId) onReactionRef.current?.(messageId, reactions || []);
    });

    // REQ-002: Realtime 服务端 system 事件 —— 鉴权/订阅出错会在这里上报。
    //
    // 背景（2026-09-27 双账号 E2E 复现）：postgres_changes 的推送要走 RLS，
    // 一旦该订阅背后的 JWT 失效，服务端会**静默停止推送**（不报错、不关连接），
    // 而同一个 channel 上的 broadcast（正在输入/撤回/回应）照常工作。
    // 结果就是：用户以为还连着，其实新消息再也收不到，直到手动切换房间或刷新。
    // 只检查 `channel.state === 'joined'` 抓不到这种「半死」状态，所以这里显式兜一层。
    channel.on('system', {}, (payload: { status?: string; message?: string }) => {
      if (payload?.status === 'error') {
        console.warn(`[Realtime] system error on ${channelName}: ${payload.message}`);
        setRoomReconnectTick((t) => t + 1);
      }
    });

    // Subscribe after all handlers are registered
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.debug(`[Realtime] Connected to room channel: ${channelName}`);
        // Sync missed messages from DB (covers gap during reconnect)
        onSyncRef.current?.();
      } else if (status === 'CHANNEL_ERROR') {
        console.warn(`[Realtime] Channel error for: ${channelName}`);
      } else if (status === 'TIMED_OUT') {
        console.warn(`[Realtime] Channel timeout for: ${channelName}`);
      }
    });

    // === Heartbeat: detect dead connections → trigger full teardown+rebuild via React ===
    const HEARTBEAT_INTERVAL = 25_000;
    const sb = supabase;
    // 上次同步给 Realtime 的 access token，用于识别「会话已刷新但 socket 还在用旧 token」
    let lastAuthToken: string | null = null;
    const heartbeatTimer = setInterval(async () => {
      const state = channel.state;
      if (state !== 'joined') {
        console.warn(`[Realtime] Room channel not joined (state=${state}), triggering rebuild`);
        setRoomReconnectTick((t) => t + 1);
        return;
      }

      // 会话 token 变了（自动刷新 / 重新登录）→ 立刻补发给 Realtime。
      //
      // 为什么必须做：Realtime 只在「(重)连接」和 `setAuth` 时取新 token。
      // 长连接期间 access token 到期后，postgres_changes 的 RLS 订阅就会失效并静默停推
      // （broadcast 不受影响），表现为「正在输入正常、新消息永远收不到」。
      // 这里在心跳里比对 token，变了就 setAuth，并立刻从 DB 补一次漏掉的消息。
      try {
        const { data } = await sb.auth.getSession();
        const token = data.session?.access_token ?? null;
        if (token && token !== lastAuthToken) {
          lastAuthToken = token;
          sb.realtime.setAuth(token);
          console.debug('[Realtime] Re-asserted auth token; resyncing missed messages');
          onSyncRef.current?.();
        }
      } catch {
        // 取会话失败不致命，下一轮心跳会再试
      }
    }, HEARTBEAT_INTERVAL);

    // Reconnect immediately when user returns to the app (mobile resume)
    // 注意：回到前台时的「补漏同步」已由 useMessages.ts 的 visibilitychange 处理器负责，
    // 这里只负责把「没 joined」的 channel 重建掉。
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const state = channel.state;
        if (state !== 'joined') {
          setRoomReconnectTick((t) => t + 1);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      channel.unsubscribe();
      channelRef.current = null;
      if (cacheTimerRef.current) cancelAnimationFrame(cacheTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, roomReconnectTick]);

  // Global chat-events channel — receives room-updated + new-dm notifications
  const globalChannelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!supabase) return;
    const globalChannel = supabase.channel('chat-events', {
      config: { broadcast: { self: false } },
    });
    globalChannelRef.current = globalChannel;

    globalChannel.on('broadcast', { event: 'room-updated' }, () => {
      onRoomUpdatedRef.current?.();
    });

    // Someone started or sent a message in a DM room we participate in — discover it
    // so it appears in our list and gets subscribed for real-time delivery.
    globalChannel.on('broadcast', { event: 'new-dm' }, ({ payload }) => {
      const rid = (payload as { roomId?: string }).roomId;
      if (rid) onNewDMRef.current?.(rid);
    });

    globalChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.debug('[Realtime] Connected to global chat-events channel');
      } else if (status === 'CHANNEL_ERROR') {
        console.warn('[Realtime] Global chat-events channel error');
      }
    });

    // Heartbeat for global channel — trigger full rebuild if dead
    const globalHeartbeat = setInterval(() => {
      const state = globalChannel.state;
      if (state !== 'joined') {
        setGlobalReconnectTick((t) => t + 1);
      }
    }, 30_000);

    const handleGlobalVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (globalChannel.state !== 'joined') {
          setGlobalReconnectTick((t) => t + 1);
        }
      }
    };
    document.addEventListener('visibilitychange', handleGlobalVisibility);

    return () => {
      clearInterval(globalHeartbeat);
      document.removeEventListener('visibilitychange', handleGlobalVisibility);
      globalChannel.unsubscribe();
      globalChannelRef.current = null;
    };
  }, [globalReconnectTick]);

  // === Per-room subscriptions (real-time delivery for ALL joined rooms) ===
  // Subscribe to every joined room the user participates in (groups + DMs) so messages arrive
  // via Postgres Changes even when that room isn't the one currently open. The currently-open
  // room is excluded here (handled by the main channel above).
  const uniqueRoomIds = roomIds.filter((id, i, arr) => arr.indexOf(id) === i);
  const dmRoomKey = uniqueRoomIds
    .filter((id) => id && id !== roomId)
    .sort()
    .join(',');

  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    const ids = dmRoomKey ? dmRoomKey.split(',') : [];
    if (ids.length === 0) return;

    const channels: RealtimeChannel[] = [];

    ids.forEach((id) => {
      // ⚠️ 必须用与「当前打开房间」不同的 topic 名（chat-bg: 而非 chat-room:）。
      //
      // supabase-js 的 `client.channel(topic)` 是**按 topic 复用已存在的频道对象**的：
      //   RealtimeClient.channel(): const exists = getChannels().find(c => c.topic === `realtime:${topic}`);
      //                             if (exists) return exists;   // ← 新传的 config 被直接忽略
      // 若两者同名，房间从「后台」切到「前台」时，主频道会拿到那个**正在 unsubscribe**
      // 的后台频道对象（React 的 cleanup 先于 setup 执行，unsubscribe 是异步的），
      // 于是新注册的 postgres_changes 绑定落在了一个已关闭/正在关闭的频道上
      // → **打开着的会话收不到任何实时消息**，必须刷新页面才看得到。
      const ch = sb.channel(`chat-bg:${id}`, {
        config: { broadcast: { self: false } },
      });

      // 实时消息投递（外部/未打开房间）：同样用 Postgres Changes，无需签名校验。
      ch.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${id}` },
        ({ new: row }) => {
          onExternalMessageRef.current?.(id, rowToMessage(row as Record<string, unknown>));
        }
      );

      // 撤回 / 编辑消息 = messages 行 UPDATE。这里只刷新会话列表（侧栏预览 / 未读角标），
      // 消息体本身在后台房间里不可见。
      //
      // 注意用 CDC 而不是 broadcast：后台频道已改用 chat-bg:<id> topic，收不到别人发在
      // chat-room:<id> 上的 withdraw-message / edit-message 广播；CDC 是权威来源，
      // 与订阅方 topic 无关，因此更可靠。
      ch.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${id}` },
        () => {
          onRoomUpdatedRef.current?.();
        }
      );

      ch.subscribe();
      channels.push(ch);
    });

    return () => {
      channels.forEach((c) => c.unsubscribe());
    };
    // dmRoomKey covers the set of DM rooms; roomId is included so switching rooms
    // re-evaluates the "exclude current room" filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmRoomKey, roomId, globalReconnectTick]);

  return { channelRef, globalChannelRef };
}
