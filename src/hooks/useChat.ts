'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useMessages } from './useMessages';
import { useFileUpload } from './useFileUpload';
import { usePresence } from './usePresence';
import { useGlobalPresence } from './useGlobalPresence';
import { useDraft } from './useDraft';
import { useDM, getDMOtherUser, generateDMRoomId } from './useDM';
import { Message, Room } from '@/types';
import { showError, showSuccess } from '@/utils/errorHandler';
import { removeMentionedRoom, getMentionedRooms, notifyNewMessage, isMentioned, addMentionedRoom, notifyMention } from '@/utils/notifications';
import { generateId } from '@/utils/id';
import { getJoinedRooms, addJoinedRoom, removeJoinedRoom, getHiddenRooms, addHiddenRoom, removeHiddenRoom, getPinnedRooms, togglePinnedRoom, getServerRooms, setServerRooms, getLastRoom, setLastRoom } from '@/utils/joinedRooms';
import { ROOM_CONFIG, API_CONFIG, DM_CONFIG } from '@/config';
import type { CurrentUser } from '@/lib/identity';

export const useChat = (isChatView = true, initialUser: CurrentUser | null = null) => {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(initialUser);

  /**
   * 父组件重新探测会话后（改昵称 / 改资料）要把新身份同步进来。
   *
   * `useState(initialUser)` 只取「初始值」，之后 prop 变化**不会**自动生效。
   * 以前之所以必须让 ChatApp 整棵卸载重挂才能让新昵称生效，就是因为缺了这段同步——
   * 而重挂的代价是「页面像刷新了一样跳回消息 tab」。有了它，父组件可以静默刷新。
   *
   * 内容等价时保持原引用，避免下游依赖 currentUser 的 effect 无谓重跑。
   */
  useEffect(() => {
    if (!initialUser) return;
    setCurrentUser((prev) =>
      prev &&
      prev.userId === initialUser.userId &&
      prev.displayName === initialUser.displayName &&
      prev.email === initialUser.email &&
      prev.isAnonymous === initialUser.isAnonymous &&
      prev.role === initialUser.role
        ? prev
        : initialUser
    );
  }, [initialUser]);
  const userId = currentUser?.userId ?? '';
  const displayName = currentUser?.displayName ?? '';
  const user = displayName; // 向后兼容：组件渲染层仍用展示名
  const [message, setMessage] = useState('');
  // 上次打开的房间在挂载后（hydration 完成）从 localStorage 还原，避免 SSR 水合不一致。
  const [roomId, setRoomId] = useState(ROOM_CONFIG.DEFAULT_ROOM);
  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [mentionedRoomIds, setMentionedRoomIds] = useState<Set<string>>(new Set());
  // 微信式未读数字角标：key=roomId, value=非当前房间时收到的消息条数
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
  //
  // P3：`hiddenRoomsRef` 必须**先声明再使用**。此前它声明在第 80 行、却在下面这个
  // effect 里就被引用（运行时因 effect 在渲染后执行而安全，但极易误读为 TDZ bug）。
  const hiddenRoomsRef = useRef<Set<string>>(new Set());
  const [hiddenRooms, setHiddenRooms] = useState<Set<string>>(() => new Set(getHiddenRooms()));
  useEffect(() => { hiddenRoomsRef.current = hiddenRooms; }, [hiddenRooms]);

  // "置顶"房间集合（仅本地偏好，列表排序时排在最前）
  const [pinnedRoomIds, setPinnedRoomIds] = useState<Set<string>>(() => new Set(getPinnedRooms()));

  // === Refs for the external-message handler (DM real-time delivery fix) ===
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  const roomsRef = useRef<Room[]>(rooms);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);
  const roomIdRef = useRef(roomId);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  const fetchRoomsRef = useRef<() => void>(() => {});
  const loadDMsRef = useRef<() => void>(() => {});
  // 「上次打开的房间」是否已完成还原（门闩，见下方持久化/还原两个 effect 的注释）
  const restoredLastRoomRef = useRef(false);

  /**
   * 微信式「会话复活」：把房间从隐藏集合里摘掉，并同步内存状态 + ref。
   *
   * 「隐藏（删除会话）」只是本机列表不显示，**绝不等于永久屏蔽**。一旦对方发来新消息
   * （或本人主动点开该会话），必须取消隐藏——否则该房间会被永久排除在实时订阅之外，
   * 消息再也收不到（这正是历史 bug：隐藏私聊后对方发的消息不达、刷新页面也无法恢复）。
   *
   * 注意必须同步更新 hiddenRoomsRef：state 的更新要等下一次 render 才写入 ref，
   * 而同一 tick 内的 handleExternalMessage 可能连续判定多次，读到旧 ref 会漏判。
   */
  const reviveHiddenRoom = useCallback((id: string) => {
    if (!hiddenRoomsRef.current.has(id)) return;
    removeHiddenRoom(id);
    const next = new Set(getHiddenRooms());
    hiddenRoomsRef.current = next;
    setHiddenRooms(next);
  }, []);

  /**
   * Handle a message that arrived (via the per-DM-room subscription) for a room OTHER
   * than the one currently open. The broadcast channel only reaches subscribers of
   * that exact room, so a DM receiver must be subscribed to every DM room it
   * participates in — useMessageRealtime does that, and feeds arrivals here. This
   * handler discovers the room (if new), marks it unread, and shows a notification.
   */
  const handleExternalMessage = useCallback((roomId: string, msg: Message) => {
    const uid = userIdRef.current;

    const isMyRoom = roomsRef.current.some((r) => r.id === roomId);
    let isMyDM = false;
    if (roomId.startsWith('dm:')) {
      // 私聊房间 ID 由 UUID 构成；用 UUID 判定是否参与，绝不解析昵称
      isMyDM = !!getDMOtherUser(roomId, uid);
    }
    // Not my business — ignore (public room I'm not in, or someone else's DM)
    if (!isMyRoom && !isMyDM) return;

    // 私聊收到新消息 → 会话「复活」（微信式）：
    //   1) 取消隐藏（隐藏只是本机列表不显示，不能永久屏蔽会话）
    //   2) 若尚未在列表里 → 重新加入，使其立刻出现在侧边栏并带上未读红点
    // 历史 bug：此处对隐藏房间直接跳过（且 roomIds 也把隐藏房间排除出订阅），
    // 导致「删除会话」后对方发来的消息永远收不到，且刷新页面也无法恢复。
    if (isMyDM) {
      reviveHiddenRoom(roomId);
      if (!isMyRoom) {
        addJoinedRoom(roomId);
        loadDMsRef.current();
      }
    }

    // Refresh room list (updates last_message_at → drives unread badge).
    // 节流合并：短时间内多条后台消息只触发一次 fetchRooms，避免请求刷屏。
    scheduleFetchRoomsRef.current();

    // Notify (only for messages sent by other people). 自消息判定用发送者 UUID。
    if (msg.userId !== uid) {
      const preview =
        msg.type === 'text'
          ? msg.content
          : `[${msg.type === 'image' ? '图片' : msg.type === 'video' ? '视频' : msg.type === 'voice' ? '语音' : '文件'}]`;
      notifyNewMessage(msg.user, preview, false);
      // @提及闭环：收到 @我 的消息 → 列表红点 + 提醒（只在该消息属于「非当前房间」时）
      //
      // 历史 bug（2026-09-27 双账号复测）：这里无条件 addMentionedRoom，
      // 于是「正在房间内看着」时收到 @我 也会打上 @ 红点；而清除只在 switchRoom 里做，
      // 用户已经在该房间就不会再触发 → @ 红点永久残留。正在看的房间直接算已读。
      if (isMentioned(msg.content, displayNameRef.current)) {
        const roomName = roomsRef.current.find((r) => r.id === roomId)?.name || '';
        if (roomId === roomIdRef.current && isChatViewRef.current) {
          // 正在看这个房间 → 已读，顺手清掉可能残留的提及标记
          removeMentionedRoom(roomId);
          setMentionedRoomIds(getMentionedRooms());
        } else {
          addMentionedRoom(roomId);
          setMentionedRoomIds(getMentionedRooms());
          notifyMention(roomName, msg.user, preview);
        }
      }
      // 微信式未读计数：非当前房间收到他人消息时累加
      if (roomId !== roomIdRef.current) {
        setUnreadCounts((prev) => ({ ...prev, [roomId]: (prev[roomId] || 0) + 1 }));
      }
    }
  }, [reviveHiddenRoom]);

  // 展示名 ref（@提及匹配用，按展示名）
  const displayNameRef = useRef(displayName);
  useEffect(() => { displayNameRef.current = displayName; }, [displayName]);

  // 是否真的停留在聊天页。移动端单列布局下「列表页」和「聊天页」共用同一个 roomId，
  // 所以判断「用户是不是正在看这个房间」必须同时看 isChatView，只看 roomId 会把
  // 停在列表页（只是 roomId 仍指向该房间）误判成已读，从而吞掉该有的 @ 红点。
  const isChatViewRef = useRef(isChatView);
  useEffect(() => { isChatViewRef.current = isChatView; }, [isChatView]);

  // switchRoom is defined further below; useDM needs it for onSwitchRoom, so we
  // route through a ref to avoid a temporal-dead-zone / ordering problem.
  const switchRoomRef = useRef<(id: string) => void>(() => {});

  // ============ DM / 好友系统 ============
  const { dmRooms, loadDMs, startDM } = useDM({
    currentUserId: userId,
    onSwitchRoom: (id: string) => switchRoomRef.current(id),
  });

  // 接收方在收到 `new-dm` 广播时，可能还没订阅该私聊房间的实时频道（房间不在本地
  // 已加入列表 → 不在 roomIds → 没有该房间的后台 CDC 订阅），导致第一条消息的 INSERT
  // 已经错过（订阅建立前就发生了）。这里主动回拉最新一条消息做兜底，保证对方至少收到
  // 「新消息」通知 + 未读红点（点开后由 useMessageLoader 从 DB 拉全量历史）。
  const peekMissedDM = useCallback(
    (roomId: string) => {
      fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const msgs = data?.messages as Message[] | undefined;
          if (!msgs || msgs.length === 0) return;
          // 只把最新一条交给外部消息处理器（通知 + 未读 +1 + 列表刷新），
          // 避免多条消息引发重复通知；打开房间后会拉取完整历史。
          const newest = msgs[msgs.length - 1];
          if (!newest) return;
          handleExternalMessage(roomId, newest);
        })
        .catch(() => {});
    },
    [handleExternalMessage]
  );

  // A DM was started/continued with us (global `new-dm` signal) — discover the room
  // so it appears in the list and gets subscribed for real-time delivery.
  //
  // ⚠️ 必须校验归属：`new-dm` 是发在全局公共频道 `chat-events` 上的广播，任何客户端
  // 都能收到「任何人 ↔ 任何人」新建私聊的信号。若不校验就 addJoinedRoom，别人之间的
  // 私聊会被塞进本机 localStorage 的已加入列表 → 侧边栏出现「别人的私聊」（点开因
  // isRoomParticipant 判定不含本人而 403「无权查看该房间」）。房间号内嵌两方 UUID，
  // 用 getDMOtherUser 判定「我是否为参与方」即可（与 handleExternalMessage 同源）。
  const handleNewDM = useCallback(
    (roomId: string) => {
      if (!getDMOtherUser(roomId, userIdRef.current)) return;
      // 对方发起了私聊 → 隐藏的会话同样要「复活」（与 handleExternalMessage 语义一致）。
      reviveHiddenRoom(roomId);
      // 仅对「新发现」的私聊做兜底回拉：已加入的房间本就有后台 CDC 订阅，消息会经
      // onExternalMessage 正常送达；若这里再回拉会重复通知 / 重复 +未读。
      const alreadyKnown = roomsRef.current.some((r) => r.id === roomId);
      addJoinedRoom(roomId);
      loadDMsRef.current();
      scheduleFetchRoomsRef.current();
      if (!alreadyKnown) {
        peekMissedDM(roomId);
      }
    },
    [peekMissedDM, reviveHiddenRoom]
  );

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

  /**
   * 需要建立实时订阅的房间集合（排除当前打开的房间——由主频道负责）。
   *
   * ⚠️ 绝不按 hiddenRooms 过滤：隐藏只是「本机列表不显示」，若把隐藏会话排除出实时
   * 订阅，接收方将永久收不到该会话的新消息（历史 bug：隐藏后消息不达、刷新也无法恢复）。
   *
   * 数据源三合一，确保「接收方一定订阅着自己的每一个私聊」：
   *   1) rooms   —— 已加载房间（含隐藏的；隐藏不影响订阅）
   *   2) dmRooms —— /api/dm-list 返回的全量私聊（房间号内嵌本人 UUID，必属本人）。
   *      它不依赖容易丢失的 new-dm 广播，是接收方最可靠的兜底订阅来源。
   *   3) 本地已加入记录 —— 覆盖尚未出现在 rooms 列表里的房间
   */
  const realtimeRoomIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rooms) ids.add(r.id);
    for (const r of dmRooms) ids.add(r.id);
    for (const id of getJoinedRooms()) ids.add(id);
    ids.delete(roomId);
    return Array.from(ids).filter(Boolean);
    // hiddenRooms 故意不进入依赖：隐藏状态不改变实时订阅集合
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, dmRooms, roomId]);

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
    // currentUser 传展示名：useMessageRealtime 用它做自消息识别与 @提及检测（msg.user 是展示名）。
    // currentUserId 传 UUID：useReadReceipts 的已读回执 API 以 actor(UUID) 为准（user !== actor → 403），
    // 不能用展示名，否则所有已读回执请求都会被拒，已读功能完全失效。
    currentUser: displayName,
    currentUserId: userId,
    roomName: rooms.find((r) => r.id === roomId)?.name || '',
    onRoomUpdated: () => {
      scheduleFetchRooms();
    },
    onMessageSent: () => {
      scheduleFetchRooms();
    },
    onExternalMessage: handleExternalMessage,
    // 订阅所有相关房间（群 + 私聊，排除当前房间）的实时消息，
    // 使未打开的会话也能即时收到消息与 @提及提醒。
    // 见 realtimeRoomIds 注释：隐藏会话同样必须订阅，否则接收方永远收不到消息。
    roomIds: realtimeRoomIds,
    onNewDM: handleNewDM,
    isDM: rooms.find((r) => r.id === roomId)?.type === 'dm',
    isActive: isChatView,
    // 实时通道刚把 @我 记成未读 → 立刻刷新红点状态，不必等下面的 10s 轮询
    onMention: () => {
      setMentionedRoomIds(getMentionedRooms());
    },
  });

  const { uploading, uploadingMessages, handleFileChange, handleVoiceUpload, uploadFile } =
    useFileUpload({ user: displayName, userId, roomId, sendMessage });

  // Online presence (per-room, used for "X 人在线" header in group chats)
  const { onlineUsers } = usePresence(roomId, displayName);

  // 全局在线状态（跨房间）：私聊/通讯录据此判断对方是否在线，
  // 不再依赖对方是否正巧打开同一私聊房间。
  const { onlineIds: globalOnlineIds, onlineNicknames: globalOnlineNicknames } =
    useGlobalPresence(displayName, userId);

  // REQ-004: Drafts
  const { draftSaved, saveDraft, loadDraftForRoom, clearDraft } = useDraft();

  // Extract recent users from messages for @mentions (supplements online users)
  const recentUsers = useMemo(() => {
    const seen = new Set<string>();
    const users: { id: string; nickname: string; online_at: string }[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m) continue;
      const mId = m.userId || m.user;
      if (!seen.has(mId) && m.userId !== userId) {
        seen.add(mId);
        // id 用发送者 UUID；nickname 仍为展示名（@提及 / 渲染）
        users.push({ id: mId, nickname: m.user, online_at: '' });
        if (users.length >= 20) break;
      }
    }
    return users;
  }, [messages, userId]);

  // Prevent page scroll — handled by fixed layout container (no body mutation needed)
  // REMOVED: document.body.style.overflow = 'hidden' was conflicting with modals

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
  //
  // ⚠️ 必须等「还原上次房间」执行完再开始持久化：本 effect 声明在还原 effect 之前，
  // 首帧 roomId 还是默认大厅，若不设门闩就会先把默认大厅写回 chat_last_room，
  // 等还原 effect 去读时读到的已经是默认大厅 → **「记住上次房间」功能整体失效**
  // （刷新后永远回到默认大厅，用户观感就是「怎么又跳到默认聊天室」）。
  useEffect(() => {
    if (!restoredLastRoomRef.current) return;
    if (roomId) setLastRoom(roomId);
  }, [roomId]);

  // 若当前房间已从加载出的房间列表里消失（被删除 / 被移出群），回退默认大厅，
  // 避免停留在已不存在的房间。rooms 为空（初始/无加入房间）时不触发，避免首屏误重置。
  //
  // 关键修正：切换到「新私聊」时，handleStartDM 已经把该房间写入本地已加入记录
  // （addJoinedRoom），但 rooms 列表要等 fetchRooms 异步回来才包含它——这中间的
  // 一帧若只按 rooms 判定会把刚点开的私聊又弹回默认大厅。
  // 因此额外判断：只要房间仍在本地已加入记录里，就不回退。
  useEffect(() => {
    if (rooms.length === 0) return;
    if (roomId !== ROOM_CONFIG.DEFAULT_ROOM) {
      const stillInList = rooms.some((r) => r.id === roomId);
      const stillJoinedLocally = getJoinedRooms().includes(roomId);
      if (!stillInList && !stillJoinedLocally) {
        setRoomId(ROOM_CONFIG.DEFAULT_ROOM);
      }
    }
  }, [rooms, roomId]);

  // Mark the currently-viewed room as "read" on mount and whenever it changes.
  // Entering a room clears its unread indicator (previously only leaving a room did,
  // so rooms you simply opened then returned from stayed unread forever).
  //
  // REQ-007: 同时清掉「@提及」红点。历史 bug（2026-09-27 双账号复测）：
  // 提及标记在收到 @我 时写入，却只在 switchRoom 里清除 —— 用户若当时正停留在该房间
  // （不会再触发一次 switchRoom），@ 红点就会永久残留。进入房间即视为已读，这里兜底清掉。
  useEffect(() => {
    if (!roomId) return;
    setLastSeenTimestamps((prev) => ({ ...prev, [roomId]: new Date().toISOString() }));
    // 还停留在列表页时不能清：红点正是要在列表上显示的。
    if (!isChatView) return;
    removeMentionedRoom(roomId);
    setMentionedRoomIds(getMentionedRooms());
  }, [roomId, isChatView]);

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
    // 门闩：允许上面的持久化 effect 从此开始写入 chat_last_room
    restoredLastRoomRef.current = true;
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
      const joined = getJoinedRooms();
      if (joined.length === 0) {
        setRooms([]);
        return;
      }
      // 服务端 `?ids=` 有数量上限（见 api/rooms/route.ts MAX_ROOM_IDS），
      // 已加入房间过多时分片请求再合并，避免一次性 400 导致整个列表变空。
      const CHUNK = 200;
      const chunks: string[][] = [];
      for (let i = 0; i < joined.length; i += CHUNK) {
        chunks.push(joined.slice(i, i + CHUNK));
      }

      const collected: Room[] = [];
      for (const chunk of chunks) {
        const res = await fetch(
          `/api/rooms?ids=${encodeURIComponent(chunk.join(','))}`,
          { signal: controller.signal }
        );

        // JWT expired — notify user instead of silently failing
        if (res.status === 401) {
          showError('登录已过期，请刷新页面重新登录');
          return;
        }
        if (!res.ok) continue;
        const data = await res.json();
        if (data.success && Array.isArray(data.rooms)) {
          collected.push(...(data.rooms as Room[]));
        }
      }
      setRooms(collected);
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

  // 自愈清洗：把「不属于本人」的私聊房间从本地已加入记录里剔除。
  // 历史 bug（handleNewDM 无条件 addJoinedRoom + new-dm 全局广播）曾把别人的私聊
  // 塞进本机 localStorage；仅修新增路径不够，已污染的旧数据也要清掉，否则侧边栏
  // 会继续显示那些点开即 403 的「别人的房间」。
  useEffect(() => {
    if (!userId) return;
    let changed = false;
    for (const id of getJoinedRooms()) {
      if (id.startsWith(DM_CONFIG.ID_PREFIX) && !getDMOtherUser(id, userId)) {
        removeJoinedRoom(id);
        changed = true;
      }
    }
    if (changed) fetchRooms();
  }, [userId, fetchRooms]);

  // 加载时先做房间发现对账（补齐被拉进的群 + 刷新服务端成员快照），再拉一次房间列表。
  // 合并原「reconcile + 独立 fetchRooms」两个 effect，避免挂载时重复请求。
  useEffect(() => {
    reconcileMyRooms().then(() => fetchRooms());
  }, [reconcileMyRooms, fetchRooms]);

  // Periodic refresh for unread counts (every 30s, with recursive setTimeout to prevent stacking).
  // 同时做房间发现对账：被别人拉进的群会在周期刷新时补齐，无需手动刷新页面。
  // 并刷新私聊列表（loadDMs）：新私聊即使错过 new-dm 广播，也能在 30s 内被发现并订阅，
  // 是接收方实时投递的最终兜底。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      timer = setTimeout(async () => {
        await reconcileMyRooms();
        await fetchRooms();
        loadDMsRef.current();
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
        // 注意：created_by 必须传本人 UUID（currentUser.userId），不能传展示名。
        // 服务端 POST /api/rooms 会校验 created_by === actor(UUID) 并以其覆盖写入；
        // 若传展示名则 created_by.trim() !== actor → 403「只能以本人身份建群」，
        // 导致按名称建群对一切已设置展示名的用户彻底失效（auth 迁移后的潜伏回归）。
        body: JSON.stringify({ name, created_by: userId }),
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
  }, [userId, roomId, fetchRooms]);

  // Join a room by ID — 非公开目录模型：加入本地记录并显示
  const joinRoom = useCallback(async (rawId: string) => {
    const id = rawId.trim();
    if (!id) return;
    addJoinedRoom(id);
    setRoomId(id);
    await fetchRooms();
  }, [fetchRooms]);

  /**
   * 进入群聊时在服务端补一条 room_members 行（幂等，不降级已有角色）。
   *
   * 必须落库：实时消息走 Postgres Changes + RLS，RLS 的 is_room_participant() 只认
   * room_members 里的真实行；localStorage 的「已加入」记录对 RLS 完全无效。
   * 没有这一行 → 群聊实时推送收不到任何新消息（历史消息仍可经 API 读出）。
   */
  const ensureMembership = useCallback((rid: string) => {
    const id = (rid || '').trim();
    if (!id) return;
    if (id.startsWith(DM_CONFIG.ID_PREFIX) || id === ROOM_CONFIG.DEFAULT_ROOM) return;
    fetch(API_CONFIG.ROOM_MEMBERS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: id, join: true }),
    }).catch(() => {
      /* 非致命：失败最多影响实时推送，不影响收发消息 */
    });
  }, []);

  // 当前房间是群聊时，确保服务端有成员行（覆盖首启/切房/建房后进入）
  useEffect(() => {
    if (!userId || !roomId) return;
    ensureMembership(roomId);
  }, [roomId, userId, ensureMembership]);

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
  const handleStartDM = useCallback(async (otherUserId: string) => {
    const id = generateDMRoomId(userId, otherUserId);
    // 显式「和某人聊天」→ 取消隐藏，使被隐藏过的会话立即回到列表并重新建立实时订阅
    removeHiddenRoom(id);
    hiddenRoomsRef.current = new Set(getHiddenRooms());
    setHiddenRooms(hiddenRoomsRef.current);
    addJoinedRoom(id);
    await startDM(otherUserId);
    fetchRooms();
  }, [userId, startDM, fetchRooms]);

  // 私聊「仅从自己列表隐藏」：从本地已加入记录移除 + 写入隐藏集合（防实时订阅复活）
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
    // 旧版昵称输入入口已移除：展示名通过 /api/me + 引导设置管理。
  }, []);

  const handleEditNickname = useCallback(() => {
    // 展示名编辑改由 MePage / 引导页负责
  }, []);

  const sendText = useCallback(() => {
    const trimmedMsg = message.trim();
    if (!trimmedMsg || uploading || !user.trim() || !userId) return;

    const newMsg: Message = {
      id: generateId(),
      user: user.trim(),
      userId,
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
  }, [message, uploading, user, userId, sendMessage, quotedMessage, clearDraft, roomId]);

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
      if (!lastSeen) {
        ids.add(room.id);
        continue;
      }
      // P3 修复：此前是 `room.last_message_at > lastSeen` —— **字典序**比较两个
      // 格式不同的 ISO 字符串：DB 返回 `2026-09-28T12:00:00.123456+00:00`，
      // 本地 `toISOString()` 是 `2026-09-28T12:00:00.123Z`。
      // `'+'`(0x2B) < `'Z'`(0x5A)，同一毫秒下会判成「有未读」；反过来也会误判。
      // 改为解析成时间戳比较，并对不可解析值保守地视为「有未读」。
      const msgAt = Date.parse(room.last_message_at);
      const seenAt = Date.parse(lastSeen);
      if (!Number.isFinite(msgAt) || !Number.isFinite(seenAt) || msgAt > seenAt) {
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
    currentUser,
    user,
    userId,
    setCurrentUser,
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
    // 全局在线（跨房间）：私聊在线判定 + 通讯录在线点
    globalOnlineIds,
    globalOnlineNicknames,
    quotedMessage,
    setQuotedMessage,
    handleSetNickname,
    handleEditNickname,
    handleMessageChange,
    handleSendText,
    handleFileChange,
    handleVoiceUpload,
    uploadFile,
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
