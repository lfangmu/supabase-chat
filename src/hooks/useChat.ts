'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useMessages } from './useMessages';
import { useFileUpload } from './useFileUpload';
import { usePresence } from './usePresence';
import { useDraft } from './useDraft';
import { useDM, getDMOtherUser, generateDMRoomId } from './useDM';
import { Message, Room } from '@/types';
import { showError, showSuccess } from '@/utils/errorHandler';
import { requestNotificationPermission, removeMentionedRoom, getMentionedRooms, notifyNewMessage, isMentioned, addMentionedRoom, notifyMention } from '@/utils/notifications';
import { generateId } from '@/utils/id';
import { getJoinedRooms, addJoinedRoom, removeJoinedRoom, getHiddenRooms, addHiddenRoom, getPinnedRooms, togglePinnedRoom, getServerRooms, setServerRooms, getLastRoom, setLastRoom } from '@/utils/joinedRooms';
import { ROOM_CONFIG, API_CONFIG } from '@/config';

export const useChat = (isChatView = true) => {
  const [user, setUser] = useState('');
  const [showNicknameInput, setShowNicknameInput] = useState(true);
  const [savedNickname, setSavedNickname] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  // 上次打开的房间在挂载后（hydration 完成）从 localStorage 还原，避免 SSR 水合不一致。
  const [roomId, setRoomId] = useState(ROOM_CONFIG.DEFAULT_ROOM);
  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [mentionedRoomIds, setMentionedRoomIds] = useState<Set<string>>(new Set());
  // 微信式未读数字角标：key=roomId, value=未在当前房间时收到的消息条数
  // 持久化到 localStorage，刷新页面后红点数字不再归零（与 lastSeen 高亮保持一致）
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('chat_unread_counts');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // "隐藏"房间集合（仅自己列表不可见，对方仍可见）——私聊删除语义
  const [hiddenRooms, setHiddenRooms] = useState<Set<string>>(() => new Set(getHiddenRooms()));
  useEffect(() => { hiddenRoomsRef.current = hiddenRooms; }, [hiddenRooms]);

  // "置顶"房间集合（仅本地偏好，列表排序时排在最前）
  const [pinnedRoomIds, setPinnedRoomIds] = useState<Set<string>>(() => new Set(getPinnedRooms()));

  // === Refs for the external-message handler (DM real-time delivery fix) ===
  // These let handleExternalMessage stay a stable useCallback([]) while still
  // reading the latest values of user / rooms / fetchRooms / loadDMs.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  const roomsRef = useRef<Room[]>(rooms);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);
  const roomIdRef = useRef(roomId);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  const fetchRoomsRef = useRef<() => void>(() => {});
  const loadDMsRef = useRef<() => void>(() => {});
  const hiddenRoomsRef = useRef<Set<string>>(new Set());

  /**
   * Handle a message that arrived (via the per-DM-room subscription) for a room OTHER
   * than the one currently open. The broadcast channel only reaches subscribers of
   * that exact room, so a DM receiver must be subscribed to every DM room it
   * participates in — useMessageRealtime does that, and feeds arrivals here. This
   * handler discovers the room (if new), marks it unread, and shows a notification.
   */
  const handleExternalMessage = useCallback((roomId: string, msg: Message) => {
    const trimmedUser = userRef.current.trim();

    const isMyRoom = roomsRef.current.some((r) => r.id === roomId);
    let isMyDM = false;
    if (roomId.startsWith('dm:')) {
      isMyDM = !!getDMOtherUser(roomId, trimmedUser);
    }
    // Not my business — ignore (public room I'm not in, or someone else's DM)
    if (!isMyRoom && !isMyDM) return;

    // A DM I haven't joined yet → add it to my joined rooms so it shows in the list.
    // Skip if the room is hidden (user "deleted" the private chat from their own list) —
    // otherwise a new inbound message would resurrect it.
    if (isMyDM && !isMyRoom && !hiddenRoomsRef.current.has(roomId)) {
      addJoinedRoom(roomId);
      loadDMsRef.current();
    }

    // Refresh room list (updates last_message_at → drives unread badge).
    // 节流合并：短时间内多条后台消息只触发一次 fetchRooms，避免请求刷屏。
    scheduleFetchRoomsRef.current();

    // Notify (only for messages sent by other people)
    if (msg.user !== trimmedUser) {
      const preview =
        msg.type === 'text'
          ? msg.content
          : `[${msg.type === 'image' ? '图片' : msg.type === 'video' ? '视频' : msg.type === 'voice' ? '语音' : '文件'}]`;
      notifyNewMessage(msg.user, preview, false);
      // @提及闭环：收到 @我 的消息 → 列表红点 + 提醒（即使不在当前房间）
      if (isMentioned(msg.content, trimmedUser)) {
        const roomName = roomsRef.current.find((r) => r.id === roomId)?.name || '';
        addMentionedRoom(roomId);
        setMentionedRoomIds(getMentionedRooms());
        notifyMention(roomName, msg.user, preview);
      }
      // 微信式未读计数：非当前房间收到他人消息时累加
      if (roomId !== roomIdRef.current) {
        setUnreadCounts((prev) => ({ ...prev, [roomId]: (prev[roomId] || 0) + 1 }));
      }
    }
  }, []);

  // switchRoom is defined further below; useDM needs it for onSwitchRoom, so we
  // route through a ref to avoid a temporal-dead-zone / ordering problem.
  const switchRoomRef = useRef<(id: string) => void>(() => {});

  // ============ DM / 好友系统 ============
  const { dmRooms, loadDMs, startDM } = useDM({
    currentUser: user,
    onSwitchRoom: (id: string) => switchRoomRef.current(id),
  });

  // A DM was started/continued with us (global `new-dm` signal) — discover the room
  // so it appears in the list and gets subscribed for real-time delivery.
  const handleNewDM = useCallback((roomId: string) => {
    addJoinedRoom(roomId);
    loadDMsRef.current();
    scheduleFetchRoomsRef.current();
  }, []);

  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // REQ-007: Last-seen timestamps per room (drive unread badges).
  // Stored in state (not a ref) so updates trigger re-render of the unread memo.
  const [lastSeenTimestamps, setLastSeenTimestamps] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('chat_last_seen');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const {
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
    reactionsByMessage,
    toggleReaction,
    loadMessageById,
  } = useMessages(roomId, (deletedRoomId: string) => {
    // Remote client notified that current room was deleted
    if (deletedRoomId === roomId) {
      setRoomId('default-room');
      setMessage('');
      setQuotedMessage(null);
    }
    fetchRooms();
  }, {
    currentUser: user,
    roomName: rooms.find((r) => r.id === roomId)?.name || '',
    onRoomUpdated: () => {
      scheduleFetchRooms();
    },
    onMessageSent: () => {
      scheduleFetchRooms();
    },
    onExternalMessage: handleExternalMessage,
    // 订阅所有已加入房间（群+私聊，排除当前房间）的实时消息，
    // 使未打开的群聊也能即时收到消息与 @提及提醒
    roomIds: rooms.map((r) => r.id).filter((id) => id !== roomId && !hiddenRooms.has(id)),
    onNewDM: handleNewDM,
    isDM: rooms.find((r) => r.id === roomId)?.type === 'dm',
    isActive: isChatView,
  });

  const { uploading, uploadingMessages, handleFileChange, handleVoiceUpload } =
    useFileUpload({ user, roomId, sendMessage });

  // Online presence
  const { onlineUsers } = usePresence(roomId, user);

  // REQ-004: Drafts
  const { draftSaved, saveDraft, loadDraftForRoom, clearDraft } = useDraft();

  // Extract recent users from messages for @mentions (supplements online users)
  const recentUsers = useMemo(() => {
    const seen = new Set<string>();
    const users: { id: string; nickname: string; online_at: string }[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgUser = messages[i].user;
      if (!seen.has(msgUser) && msgUser !== user.trim()) {
        seen.add(msgUser);
        users.push({ id: msgUser, nickname: msgUser, online_at: '' });
        if (users.length >= 20) break;
      }
    }
    return users;
  }, [messages, user]);

  // Prevent page scroll — handled by fixed layout container (no body mutation needed)
  // REMOVED: document.body.style.overflow = 'hidden' was conflicting with modals

  // Load nickname from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('chat_nickname');
    if (saved) {
      setUser(saved);
      setSavedNickname(saved);
      setShowNicknameInput(false);
    }
    // REQ-007: Load mentioned rooms for red dot indicators
    setMentionedRoomIds(getMentionedRooms());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist last-seen timestamps to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('chat_last_seen', JSON.stringify(lastSeenTimestamps));
    } catch { /* ignore */ }
  }, [lastSeenTimestamps]);

  // Persist unread numeric badges to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('chat_unread_counts', JSON.stringify(unreadCounts));
    } catch { /* ignore */ }
  }, [unreadCounts]);

  // 记住当前打开的房间，刷新后自动还原（?room= 已从 URL 移除，改存本地）。
  useEffect(() => {
    if (roomId) setLastRoom(roomId);
  }, [roomId]);

  // 若当前房间已从加载出的房间列表里消失（被删除 / 被移出群），回退默认大厅，
  // 避免停留在已不存在的房间。rooms 为空（初始/无加入房间）时不触发，避免首屏误重置。
  useEffect(() => {
    if (rooms.length === 0) return;
    if (roomId !== ROOM_CONFIG.DEFAULT_ROOM && !rooms.some((r) => r.id === roomId)) {
      setRoomId(ROOM_CONFIG.DEFAULT_ROOM);
    }
  }, [rooms, roomId]);

  // Mark the currently-viewed room as "read" on mount and whenever it changes.
  // Entering a room clears its unread indicator (previously only leaving a room did,
  // so rooms you simply opened then returned from stayed unread forever).
  useEffect(() => {
    if (!roomId) return;
    setLastSeenTimestamps((prev) => ({ ...prev, [roomId]: new Date().toISOString() }));
  }, [roomId]);

  // 首启兜底：本地没有任何已加入房间时，自动加入默认大厅，避免空白屏
  useEffect(() => {
    if (getJoinedRooms().length === 0) {
      addJoinedRoom(ROOM_CONFIG.DEFAULT_ROOM);
    }
  }, []);

  // 刷新后还原上次打开的房间（?room= 已从 URL 移除，房间号改存本地）。
  // 须在 hydration 之后执行，故放在 effect 而非 useState 初始化器，避免 SSR 水合不一致。
  // 仅当该房间仍是「已加入」房间时才还原，否则保持默认大厅。
  useEffect(() => {
    try {
      const last = getLastRoom();
      if (last && getJoinedRooms().includes(last)) {
        setRoomId(last);
      }
    } catch { /* ignore */ }
  }, []);

  // Fetch rooms list (with deduplication and abort support)
  const fetchRoomsAbortRef = useRef<AbortController | null>(null);
  const fetchRoomsInFlightRef = useRef(false);
  const fetchRooms = useCallback(async () => {
    // 不丢弃并发调用：若已有请求在途，中止旧的并发起新的，确保显式刷新
    // （如建群/加群后）一定能把最新房间拉进列表，避免「需刷新页面才出现」的竞态。
    // Abort any stale request
    if (fetchRoomsAbortRef.current) {
      fetchRoomsAbortRef.current.abort();
    }
    const controller = new AbortController();
    fetchRoomsAbortRef.current = controller;
    fetchRoomsInFlightRef.current = true;
    try {
      // 非公开目录模型：只请求本地已加入的房间，不暴露全部房间列表。
      // 管理后台的「查看全部房间」已拆分到独立的 /admin 页面（admin_session）。
      const joined = getJoinedRooms();
      if (joined.length === 0) {
        setRooms([]);
        return;
      }
      const res = await fetch(
        `/api/rooms?ids=${encodeURIComponent(joined.join(','))}`,
        { signal: controller.signal }
      );

      // JWT expired — notify user instead of silently failing
      if (res.status === 401) {
        showError('登录已过期，请刷新页面重新登录');
        return;
      }
      const data = await res.json();
      if (data.success && data.rooms) {
        setRooms(data.rooms);
      }
    } catch {
      // Silently ignore (including AbortError)
    } finally {
      fetchRoomsInFlightRef.current = false;
    }
  }, []);

  // 事件驱动的 rooms 刷新做节流合并：onRoomUpdated / onMessageSent / 后台消息等会在
  // 短时间内密集触发，逐个 fetchRooms 会造成请求刷屏（每次都带一次 messages 全量扫描）。
  // 把 1.5s 内的多次调用合并为一次真正执行，mount/周期刷新仍走下方的直接 fetchRooms。
  const fetchRoomsThrottleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleFetchRooms = useCallback(() => {
    if (fetchRoomsThrottleTimer.current) return;
    fetchRoomsThrottleTimer.current = setTimeout(() => {
      fetchRoomsThrottleTimer.current = null;
      fetchRooms();
    }, 1500);
  }, [fetchRooms]);
  const scheduleFetchRoomsRef = useRef<() => void>(() => {});
  useEffect(() => { scheduleFetchRoomsRef.current = scheduleFetchRooms; }, [scheduleFetchRooms]);
  useEffect(() => () => {
    if (fetchRoomsThrottleTimer.current) clearTimeout(fetchRoomsThrottleTimer.current);
  }, []);

  /**
   * 房间发现对账：让本地已加入列表与服务端 room_members 成员关系保持一致。
   *  - 新增：服务端有、本地缺失 → addJoinedRoom（修复「被拉进群但侧边栏不显示」）。
   *  - 移除：曾经是服务端成员、现在不是了 → removeJoinedRoom（实现「被移出群也同步从侧边栏移除」）。
   * 安全边界（防止误删）：
   *  1. 只动「群聊类」房间——dm: 私聊由 useDM 链路独立管理，default-room 始终保留；
   *  2. 移除仅针对「曾经出现在服务端成员关系」的房间（见 chat_server_rooms 快照）；
   *     手动输号加入的群从未进入该快照，因此绝不会被误清；
   *  3. 网络/接口异常时直接返回，不更新快照、不做任何增删，避免抖动误删。
   * @returns 本地已加入列表是否发生变化（新增或移除）
   */
  const reconcileMyRooms = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(API_CONFIG.ROOMS_MINE_ENDPOINT, { credentials: 'same-origin' });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      if (!data?.success || !Array.isArray(data.roomIds)) return false;

      const serverIds = (data.roomIds as unknown[])
        .map((x) => String(x).trim())
        .filter(Boolean);
      const serverSet = new Set(serverIds);

      // —— 1) 新增：补进本地缺失的房间（只增，跳过隐藏私聊防复活）——
      const current = new Set(getJoinedRooms());
      let changed = false;
      for (const id of serverIds) {
        if (current.has(id)) continue;
        if (hiddenRoomsRef.current.has(id)) continue;
        addJoinedRoom(id);
        current.add(id);
        changed = true;
      }

      // —— 2) 移除：曾经是服务端成员、现在被移出 → 从本地已加入列表删除 ——
      const prevServer = new Set(getServerRooms());
      const toRemove: string[] = [];
      for (const id of current) {
        if (id === ROOM_CONFIG.DEFAULT_ROOM) continue; // 默认大厅永留
        if (id.startsWith('dm:')) continue;            // 私聊不参与
        if (!prevServer.has(id)) continue;             // 从不是服务端成员 → 不动（保护手动/链接加入）
        if (serverSet.has(id)) continue;              // 仍是成员 → 不动
        toRemove.push(id);
      }
      for (const id of toRemove) {
        removeJoinedRoom(id);
        changed = true;
      }

      // 更新服务端成员关系快照（用于下一轮「被移出」判定）
      setServerRooms(serverIds);

      // 若当前打开的房间被移出 → 切回默认大厅（与删除房间处理一致）
      if (toRemove.includes(roomIdRef.current)) {
        setRoomId(ROOM_CONFIG.DEFAULT_ROOM);
      }

      return changed;
    } catch {
      // 对账失败不应阻断主流程
      return false;
    }
  }, []);

  // 加载时先做房间发现对账（补齐被拉进的群 + 刷新服务端成员快照），再拉一次房间列表。
  // 合并原「reconcile + 独立 fetchRooms」两个 effect，避免挂载时重复请求。
  useEffect(() => {
    reconcileMyRooms().then(() => fetchRooms());
  }, [reconcileMyRooms, fetchRooms]);

  // Periodic refresh for unread counts (every 30s, with recursive setTimeout to prevent stacking).
  // 同时做房间发现对账：被别人拉进的群会在周期刷新时补齐，无需手动刷新页面。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      timer = setTimeout(async () => {
        await reconcileMyRooms();
        await fetchRooms();
        scheduleNext();
      }, 30_000);
    };
    scheduleNext();
    return () => clearTimeout(timer);
  }, [fetchRooms, reconcileMyRooms]);

  // REQ-007: Periodic refresh of mentioned rooms (every 10s, for red dot indicators)
  useEffect(() => {
    const interval = setInterval(() => {
      setMentionedRoomIds(getMentionedRooms());
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Create room
  const createRoom = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, created_by: user.trim() }),
      });
      const data = await res.json();
      if (!data.success) {
        showError(data.message || '创建群聊失败');
        return;
      }
      // Auto-switch to the new room
      const newRoomId = data.room?.id;
      if (newRoomId) {
        // 先加入本地"已加入"记录，再 fetchRooms 才会把新房拉进列表（否则需刷新）
        addJoinedRoom(newRoomId);
        await fetchRooms();
        if (newRoomId !== roomId) {
          setRoomId(newRoomId);
        setMessage('');
        setQuotedMessage(null);
      }
      }
      showSuccess('群聊创建成功');
    } catch {
      showError('创建群聊失败');
    }
  }, [user, roomId, fetchRooms]);

  // Join a room by ID — 非公开目录模型：加入本地记录并显示
  const joinRoom = useCallback(async (rawId: string) => {
    const id = rawId.trim();
    if (!id) return;
    addJoinedRoom(id);
    setRoomId(id);
    await fetchRooms();
  }, [fetchRooms]);

  // Switch room — MUST be declared before deleteRoom/renameRoom to avoid TDZ
  const switchRoom = useCallback((newRoomId: string) => {
    if (newRoomId === roomId) return;

    // Stop typing indicator in current room
    const trimmedUser = user.trim();
    if (trimmedUser) {
      sendTypingStop(trimmedUser);
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    }

    // REQ-004: Save current draft before switching
    saveDraft(roomId, message);

    // REQ-007: Remove mentioned room indicator when viewing the room
    removeMentionedRoom(newRoomId);
    setMentionedRoomIds(getMentionedRooms());

    // Record last-seen time for the room we are leaving (current room)
    setLastSeenTimestamps((prev) => ({ ...prev, [roomId]: new Date().toISOString() }));

    setRoomId(newRoomId);
    // 进入房间即清零该房间未读计数（微信式数字角标）
    setUnreadCounts((prev) => ({ ...prev, [newRoomId]: 0 }));
    setQuotedMessage(null);

    // REQ-004: Load draft for the new room
    const newDraft = loadDraftForRoom(newRoomId);
    setMessage(newDraft);
  }, [roomId, user, message, sendTypingStop, saveDraft, loadDraftForRoom]);

  // Keep refs current so handleExternalMessage / handleNewDM can call them
  useEffect(() => { fetchRoomsRef.current = fetchRooms; }, [fetchRooms]);
  useEffect(() => { loadDMsRef.current = loadDMs; }, [loadDMs]);
  // Route switchRoom into the ref used by useDM's onSwitchRoom
  useEffect(() => { switchRoomRef.current = switchRoom; }, [switchRoom]);

  // Wrapper: ensure the DM room is in joined rooms before switching, so it shows
  // in the list immediately, then refresh the list.
  const handleStartDM = useCallback(async (otherUser: string) => {
    const id = generateDMRoomId(user.trim(), otherUser);
    addJoinedRoom(id);
    await startDM(otherUser);
    fetchRooms();
  }, [user, startDM, fetchRooms]);

  /**
   * 私聊「仅从自己列表隐藏」：从本地已加入记录移除 + 写入隐藏集合（防实时订阅复活）
   * + 从内存房间列表即时剔除。对方仍能看到并收发，仅本地不可见。
   */
  const hideRoom = useCallback((id: string) => {
    addHiddenRoom(id);
    removeJoinedRoom(id);
    setHiddenRooms(new Set(getHiddenRooms()));
    setRooms((prev) => prev.filter((r) => r.id !== id));
  }, []);

  /** 切换会话置顶（仅本地偏好） */
  const togglePinRoom = useCallback((id: string) => {
    togglePinnedRoom(id);
    setPinnedRoomIds(new Set(getPinnedRooms()));
  }, []);

  const handleSetNickname = useCallback(() => {
    const trimmed = user.trim();
    if (trimmed) {
      try {
        localStorage.setItem('chat_nickname', trimmed);
      } catch (e) {
        console.warn('Failed to save nickname to localStorage:', e);
      }
      setShowNicknameInput(false);
      requestNotificationPermission().catch((e) => {
        console.warn('Failed to request notification permission:', e);
      });
    }
  }, [user]);

  const handleEditNickname = useCallback(() => {
    setShowNicknameInput(true);
  }, []);

  const sendText = useCallback(() => {
    const trimmedMsg = message.trim();
    if (!trimmedMsg || uploading || !user.trim()) return;

    const newMsg: Message = {
      id: generateId(),
      user: user.trim(),
      type: 'text',
      content: trimmedMsg,
      timestamp: new Date().toISOString(),
    };

    if (quotedMessage) {
      newMsg.quoteId = quotedMessage.id;
      newMsg.quote = {
        user: quotedMessage.user,
        type: quotedMessage.type,
        content: quotedMessage.content,
      };
      setQuotedMessage(null);
    }

    sendMessage(newMsg);
    setMessage('');

    // REQ-004: Clear draft after sending
    clearDraft(roomId);
  }, [message, uploading, user, sendMessage, quotedMessage, clearDraft, roomId]);

  const handleMessageChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setMessage(newValue);
      const trimmedUser = user.trim();
      if (!trimmedUser) return;

      // REQ-004: Auto-save draft with debounce
      saveDraft(roomId, newValue);

      sendTypingStart(trimmedUser);

      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        sendTypingStop(trimmedUser);
      }, 2000);
    },
    [user, roomId, sendTypingStart, sendTypingStop, saveDraft]
  );

  const handleSendText = useCallback(() => {
    sendText();
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (user.trim()) sendTypingStop(user.trim());
  }, [sendText, user, sendTypingStop]);

  // Compute unread room IDs (multi-room group chat)
  const unreadRoomIds = useMemo(() => {
    const ids = new Set<string>();
    for (const room of rooms) {
      if (room.id === roomId) continue; // current room is always "read"
      if (!room.last_message_at) continue;
      const lastSeen = lastSeenTimestamps[room.id];
      if (!lastSeen || room.last_message_at > lastSeen) {
        ids.add(room.id);
      }
    }
    return ids;
  }, [rooms, roomId, lastSeenTimestamps]);

  const handleWithdraw = useCallback(
    (messageId: string) => {
      withdrawMessage(messageId, user.trim());
    },
    [withdrawMessage, user]
  );

  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      editMessage(messageId, user.trim(), newContent);
    },
    [editMessage, user]
  );

  // Current room name for mention notifications
  const currentRoomName = useMemo(() => rooms.find((r) => r.id === roomId)?.name || '', [rooms, roomId]);

  return {
    user,
    setUser,
    savedNickname,
    showNicknameInput,
    message,
    setMessage,
    messages,
    roomId,
    rooms,
    uploading,
    uploadingMessages,
    loadingMore,
    hasMore,
    isLoading,
    typingUsers,
    onlineUsers,
    recentUsers,
    quotedMessage,
    setQuotedMessage,
    handleSetNickname,
    handleEditNickname,
    handleMessageChange,
    handleSendText,
    handleFileChange,
    handleVoiceUpload,
    loadMoreHistory,
    refreshMessages,
    retryMessage,
    handleWithdraw,
    handleEditMessage,
    switchRoom,
    createRoom,
    joinRoom,
    unreadRoomIds,
    draftSaved,
    currentRoomName,
    mentionedRoomIds,
    unreadCounts,
    dmRooms,
    startDM,
    loadDMs,
    handleStartDM,
    hideRoom,
    setRooms,
    pinnedRoomIds,
    togglePinRoom,
    reactionsByMessage,
    toggleReaction,
    loadMessageById,
    // 直接发送一条构造好的消息（转发功能用）
    sendMessage,
    fetchRooms,
  };
};
