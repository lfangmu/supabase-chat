'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Message, Reaction } from '@/types';
import { STORAGE_CONFIG_KEYS, MESSAGE_CONFIG } from '@/config';
import { safeSetCache } from '@/utils/cacheUtils';
import { notifyNewMessage, notifyMention, isMentioned, addMentionedRoom } from '@/utils/notifications';
import { receiptHandlerRef } from './useReadReceipts';
import { verifyChatMessageBroadcast } from '@/lib/broadcastSignature';
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
}: UseMessageRealtimeParams) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const cacheTimerRef = useRef<number | null>(null);

  // Store latest callbacks in refs to avoid re-subscribing on every render
  const currentUserRef = useRef(currentUser);
  const roomNameRef = useRef(roomName);
  const roomIdRef = useRef(roomId);
  const onRoomUpdatedRef = useRef(onRoomUpdated);
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
    channel.on('broadcast', { event: 'chat-message' }, async ({ payload }) => {
      const { signature: _sig, ...rawMsg } = payload as Message & { signature?: string };
      // 校验服务端签名：未签名 / 签名无效 -> 丢弃，杜绝同房间参与者伪造消息。
      const ok = await verifyChatMessageBroadcast(roomId, {
        id: rawMsg.id,
        timestamp: rawMsg.timestamp,
        signature: _sig,
      });
      if (!ok) {
        console.warn('[realtime] 丢弃未签名/伪造的 chat-message 广播');
        return;
      }
      const msg = { ...rawMsg, sendStatus: 'sent' as const };
      setMessagesRef.current((prev) => {
        if (prev.some((m) => m.id === msg.id) || processedIdsRef.current.has(msg.id)) return prev;
        processedIdsRef.current.add(msg.id);
        trimProcessedIds(processedIdsRef.current);

        // Check for @mention — trigger notification regardless of visibility state
        const trimmedUser = currentUserRef.current.trim();
        const isSelfMessage = msg.user === trimmedUser;
        if (msg.type === 'text' && !isSelfMessage && isMentioned(msg.content, trimmedUser)) {
          notifyMention(roomNameRef.current || '群聊', msg.user, msg.content.slice(0, 100));
          addMentionedRoom(roomId);
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
    });

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
      receiptHandlerRef.current?.(payload as { messageIds?: string[] });
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
    const heartbeatTimer = setInterval(() => {
      const state = (channel as unknown as { state: string }).state;
      if (state !== 'joined') {
        console.warn(`[Realtime] Room channel not joined (state=${state}), triggering rebuild`);
        setRoomReconnectTick((t) => t + 1);
      }
    }, HEARTBEAT_INTERVAL);

    // Reconnect immediately when user returns to the app (mobile resume)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const state = (channel as unknown as { state: string }).state;
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
      const state = (globalChannel as unknown as { state: string }).state;
      if (state !== 'joined') {
        setGlobalReconnectTick((t) => t + 1);
      }
    }, 30_000);

    const handleGlobalVisibility = () => {
      if (document.visibilityState === 'visible') {
        if ((globalChannel as unknown as { state: string }).state !== 'joined') {
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

  // === Per-room subscriptions (real-time delivery for ALL joined rooms, publication-independent) ===
  // Subscribe to every joined room the user participates in (groups + DMs). Messages in those
  // rooms are delivered via the normal broadcast path (no postgres_changes / realtime-publication
  // dependency). The currently-open room is excluded (handled by the main channel above).
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
      const ch = sb.channel(`chat-room:${id}`, {
        config: { broadcast: { self: false } },
      });

      ch.on('broadcast', { event: 'chat-message' }, async ({ payload }) => {
        const { signature: _sig, ...rawMsg } = payload as Message & { signature?: string };
        // 同主房间：必须校验服务端签名，未签名/无效则丢弃。
        const ok = await verifyChatMessageBroadcast(id, {
          id: rawMsg.id,
          timestamp: rawMsg.timestamp,
          signature: _sig,
        });
        if (!ok) {
          console.warn('[realtime] 丢弃未签名/伪造的 chat-message 广播（外部房间）');
          return;
        }
        onExternalMessageRef.current?.(id, { ...rawMsg, sendStatus: 'sent' as const });
      });

      // Control events in a non-open DM room: just refresh the room list
      // (last_message_at / unread badge) — the body isn't visible anyway.
      ch.on('broadcast', { event: 'withdraw-message' }, () => {
        onRoomUpdatedRef.current?.();
      });
      ch.on('broadcast', { event: 'edit-message' }, () => {
        onRoomUpdatedRef.current?.();
      });

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
