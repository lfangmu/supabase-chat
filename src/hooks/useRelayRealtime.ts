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

import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { connectRelay, sendRelay, type RelayClient, type RelayEvent } from '@/lib/realtimeRelay';
import { applyRelayPresence } from '@/lib/presenceRelay';
import { Message, Reaction } from '@/types';
import { STORAGE_CONFIG_KEYS, MESSAGE_CONFIG } from '@/config';
import { safeSetCache } from '@/utils/cacheUtils';
import { notifyNewMessage, notifyMention, isMentioned, addMentionedRoom } from '@/utils/notifications';
import { dispatchReceipt } from './useReadReceipts';

const MAX_PROCESSED_IDS = MESSAGE_CONFIG.MAX_PROCESSED_IDS;

// 中继地址与公开 key（NEXT_PUBLIC_* 构建期内联，取一次即可）
const PROXY_URL =
  process.env.NEXT_PUBLIC_SUPABASE_PROXY_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';
const RELAY_APIKEY = process.env.NEXT_PUBLIC_SUPABASE_KEY || '';

/** 宽松收窄：中继负载是外部输入，取字符串字段前一律过一遍类型判断。 */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 宽松收窄：把 unknown 当成字典读；非对象一律返回空对象，避免后续取字段抛错。 */
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function trimProcessedIds(set: Set<string>) {
  if (set.size > MAX_PROCESSED_IDS) {
    const arr = Array.from(set);
    const keep = arr.slice(arr.length - Math.floor(MAX_PROCESSED_IDS / 2));
    set.clear();
    keep.forEach((id) => set.add(id));
  }
}

function rowToMessage(row: Record<string, unknown>): Message {
  // 兼容两种上游形态：① 直接给出行数据；② 给 CDC 信封 { record, old_record, ... }。
  // 后者是 Supabase postgres_changes 的原始负载，行数据在 .record —— 解包一层再取字段，
  // 否则 id/user/timestamp 全为 undefined（症状：消息时间戳 Invalid → 日期分隔线「NaN年NaN月NaN日」）。
  const envelope = row as { record?: unknown };
  const inner = envelope.record;
  const r: Record<string, unknown> =
    inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : row;
  return {
    id: r.id as string,
    user: r.user as string,
    userId: r.user_id as string,
    type: r.type as Message['type'],
    content: r.content as string,
    timestamp: r.timestamp as string,
    quoteId: (r.quote_id as string | undefined) ?? undefined,
    quote: (r.quote as Message['quote']) ?? undefined,
    edited_at: (r.edited_at as string | null) ?? null,
    withdrawn_at: (r.withdrawn_at as string | null) ?? null,
    file_name: (r.file_name as string | null) ?? null,
    file_size: (r.file_size as number | null) ?? null,
    file_mime: (r.file_mime as string | null) ?? null,
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
  /**
   * 「权威刷新」回调：收到 edit-message / withdraw-message 广播时调用，
   * 由上层按 id 回源数据库取回真实内容（广播 payload 不可信）。
   */
  onAuthoritativeUpdate?: (messageId: string) => void;
  isActive?: boolean;
  onMention?: (roomId: string) => void;
  // presence 事件转发（接入 usePresence 时消费；v0 暂未完整整合）
  onPresence?: (data: Record<string, unknown>) => void;
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
  onAuthoritativeUpdate,
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
  const onAuthoritativeUpdateRef = useRef(onAuthoritativeUpdate);
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
    onAuthoritativeUpdateRef.current = onAuthoritativeUpdate;
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
        if (data.status === 'error') {
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
        const rid = asString(data.roomId);
        const event = asString(data.event);
        const payload = asRecord(data.payload);
        if (!rid || rid === '__global__') {
          // 全局 chat-events（Worker 把 chat-events 映射成 __global__）
          if (event === 'room-updated') onRoomUpdatedRef.current?.();
          else if (event === 'new-dm') onNewDMRef.current?.(asString(payload.roomId));
          return;
        }
        if (rid !== roomIdRef.current) return;
        switch (event) {
          case 'typing-start': {
            const typer = asString(payload.user);
            if (!typer) break;
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
            const typer = asString(payload.user);
            if (!typer) break;
            setTypingUsersRef.current((prev) => prev.filter((u) => u !== typer));
            const existing = typingTimersRef.current.get(typer);
            if (existing) {
              clearTimeout(existing);
              typingTimersRef.current.delete(typer);
            }
            break;
          }
          case 'withdraw-message':
          case 'edit-message': {
            // ⚠️ 广播只当「有变更」的提示，**绝不**用 payload 里的 content 直接改写本地消息。
            // 原因：服务端虽已校验「必须是消息作者本人」，但作者仍可以广播一份与
            // 数据库不一致的内容（先正常 PUT 再广播伪造文案）。正文一律回源 DB。
            const id = asString(payload.id);
            if (id) onAuthoritativeUpdateRef.current?.(id);
            break;
          }
          case 'receipt': {
            const ids = Array.isArray(payload.messageIds)
              ? (payload.messageIds as string[])
              : undefined;
            dispatchReceipt({ messageIds: ids });
            break;
          }
          case 'room-deleted':
            if (asString(payload.roomId) === roomIdRef.current) {
              onRoomDeletedRef.current?.(roomIdRef.current);
            }
            break;
          case 'chat-reaction': {
            const messageId = asString(payload.messageId);
            if (!messageId) break;
            const reactions = Array.isArray(payload.reactions)
              ? (payload.reactions as Reaction[])
              : [];
            onReactionRef.current?.(messageId, reactions);
            break;
          }
        }
        return;
      }
      // message-insert / message-update（postgres_changes / CDC）
      const rid = asString(data.roomId);
      if (!data.row || typeof data.row !== 'object') return;
      const row = data.row as Record<string, unknown>;
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
        const id = asString(row.id);
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
      const msg = rowToMessage(row);
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
      // ⚠️ getSession() 必须包 try/catch：
      // 它内部可能走 refresh_token 请求，Supabase Auth 抖动 / JWT 被拒时会 **reject**。
      // 若不接住，connect() 这个 async 函数就以未捕获的 rejection 结束，
      // reconnect() 永远不会被调度 —— 表现为「实时彻底失联且再也不恢复」：
      // 收不到新消息、在线状态永远停在旧值，直到用户手动切换房间 / 刷新页面。
      let token = '';
      try {
        const { data } = await sb.auth.getSession();
        token = data.session?.access_token || '';
      } catch {
        reconnect();
        return;
      }
      if (!token) {
        reconnect();
        return;
      }
      currentToken = token;
      const allRooms = Array.from(new Set([roomIdRef.current, ...roomIds])).filter(Boolean);
      // 先释放旧连接：否则 onError 连续触发时会并发建立多条 SSE，
      // 而每条 SSE 在服务端都对应一条到 Supabase 的 WebSocket → 连接泄漏。
      try {
        client?.close();
      } catch {
        /* ignore */
      }
      // presence 身份不再由客户端自报（服务端从 token 解出），故这里不传 userId/guid/nickname
      client = connectRelay({
        proxyUrl,
        token,
        apikey,
        rooms: allRooms,
        onEvent: handleEvent,
        onOpen: () => {
          // 连上才复位退避计数。否则一次早期抖动会让 attempt 永久停在 5，
          // 之后所有重连都被钉死在 30s 间隔（表现为「断网恢复后很久才重连上」）。
          attempt = 0;
        },
        onError: () => reconnect(),
      });
      // 首次连上后补一次漏掉的消息（覆盖重连间隙）
      onSyncRef.current?.();
    };

    const reconnect = () => {
      if (closed) return;
      // 已有待执行的重连就不要再排一个，避免定时器堆积 → 多路并发连接
      if (reconnectTimer) return;
      attempt += 1;
      const backoff = Math.min(1000 * 2 ** Math.min(attempt, 5), 30000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, backoff);
    };

    connect();

    // 令牌刷新：一旦会话 token 变化，断开旧连接让下次重连用新 token
    heartbeatTimer = setInterval(async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (token && token !== currentToken && client) {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
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
  }, [roomId, roomIds.join(',')]);

  /**
   * 通过服务端中继发一条 broadcast。
   * @param rid 目标房间 id；传 '__global__' 则发到全局 chat-events 频道
   *            （用于 room-updated / new-dm）。
   */
  const sendBroadcast = useCallback(
    async (rid: string, event: string, payload: Record<string, unknown>) => {
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

  return { sendBroadcast };
}
