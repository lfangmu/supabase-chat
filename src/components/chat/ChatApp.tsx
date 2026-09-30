'use client';

import React, { useCallback, useState, useRef, useMemo, useEffect } from 'react';
import { useChat } from '@/hooks/useChat';
import {
  Upload, X, MessageCircle, Users, User as UserIcon, Plus, Search,
} from 'lucide-react';
import MessageList from '@/components/chat/MessageList';
import MessageInput from '@/components/chat/MessageInput';
import ChatHeader from '@/components/chat/ChatHeader';
import ChatListPage from '@/components/chat/ChatListPage';
import LightboxProvider from '@/components/chat/Lightbox';
import AddFriendModal from '@/components/chat/AddFriendModal';
import ContactsPage from '@/components/chat/ContactsPage';
import MePage from '@/components/chat/MePage';
import UserProfileCard from '@/components/chat/UserProfileCard';
import GlobalSearchModal from '@/components/chat/GlobalSearchModal';
import CreateGroupModal from '@/components/chat/CreateGroupModal';
import GroupMembersPanel from '@/components/chat/GroupMembersPanel';
import Avatar from '@/components/chat/Avatar';
import { getDMOtherUser } from '@/hooks/useDM';
import NetworkBanner from '@/components/chat/NetworkBanner';
import { useFriends } from '@/hooks/useFriends';
import { useProfile } from '@/hooks/useProfile';
import { useRoomMembers } from '@/hooks/useRoomMembers';
import { Message } from '@/types';
import { generateId } from '@/utils/id';
import { getDeletedMessageIds, addDeletedMessageId } from '@/utils/deletedMessages';
import { getClearedRooms, setClearedAt, isHiddenByClear } from '@/utils/clearedRooms';
import { showSuccess, showError } from '@/utils/errorHandler';
import { removeJoinedRoom } from '@/utils/joinedRooms';
import { ROOM_CONFIG, STORAGE_CONFIG_KEYS } from '@/config';
import type { CurrentUser } from '@/lib/identity';
import { mediaPlaceholder } from '@/utils/labels';

interface ChatAppProps {
  /** Supabase Auth 会话身份（UUID + 展示名），由 ChatClient 探测会话后传入 */
  currentUser: CurrentUser;
  onLogout: () => void;
  /** 改了展示名后，让父组件重新探测会话（拿回新的 display_name） */
  onIdentityRefresh?: () => void;
}

export default function ChatApp({ currentUser, onLogout, onIdentityRefresh }: ChatAppProps) {
  // === View state: list (room list) <-> chat (conversation) ===
  // 放在 useChat 之前：会话是否可见决定「已读回执」是否上报
  const [viewingChat, setViewingChat] = useState(false);

  const {
    message, setMessage, messages,
    roomId, rooms,
    uploading, uploadingMessages,
    loadingMore, hasMore, isLoading,
    typingUsers, onlineUsers, recentUsers,
    globalOnlineIds,
    globalOnlineNicknames,
    quotedMessage, setQuotedMessage,
    handleMessageChange, handleSendText, handleFileChange, handleVoiceUpload, uploadFile,
    loadMoreHistory, refreshMessages, retryMessage, handleWithdraw, handleEditMessage,
    switchRoom, createRoom, joinRoom,
    unreadRoomIds, draftSaved,
    mentionedRoomIds,
    currentRoomName,
    handleStartDM,
    unreadCounts,
    sendMessage,
    hideRoom,
    setRooms,
    pinnedRoomIds,
    togglePinRoom,
    reactionsByMessage,
    toggleReaction,
    loadMessageById,
  } = useChat(viewingChat, currentUser);

  /** 我的 Supabase Auth UUID（身份） */
  const myId = currentUser.userId;
  /** 我的展示名（仅用于展示；绝不作为身份键） */
  const trimmedUser = (currentUser.displayName || '').trim();
  // 已登录（有 Supabase Auth UUID）即视为就绪；展示名为空时由「我」页面引导设置
  const ready = !!myId;

  // === 好友系统 ===
  const {
    data: friendsData,
    sendRequest,
    respond,
    removeOrBlock,
    load: reloadFriends,
  } = useFriends({ user: myId, enabled: ready });

  // === 用户资料（头像/签名）+ 昵称→头像映射 ===
  const { me: myProfile, avatars, namesById, ensureProfiles, saveProfile } = useProfile(
    ready ? myId : '',
    trimmedUser
  );

  /** UUID → 展示名（好友表 + 资料批量查询拼出来的兜底表） */
  const displayNameOf = useCallback(
    (uuid: string): string => namesById[uuid] || '',
    [namesById]
  );

  /** 保存资料；改了展示名要让父组件重新探测会话，否则界面上的名字还是旧的 */
  const handleSaveProfile = useCallback(
    async (patch: { avatar?: string | null; signature?: string; display_name?: string }) => {
      const saved = await saveProfile(patch);
      if (saved && patch.display_name) onIdentityRefresh?.();
      return saved;
    },
    [saveProfile, onIdentityRefresh]
  );

  /** 删除好友：只解除好友关系（微信语义：聊天记录留在本机，房间不删） */
  const handleRemoveFriend = useCallback(
    async (targetId: string) => {
      const r = await removeOrBlock(targetId, 'remove');
      if (r?.success) showSuccess('已删除好友');
      else showError(r?.message || '删除失败');
      await reloadFriends();
    },
    [removeOrBlock, reloadFriends]
  );

  // 当前房间
  const currentRoom = rooms.find((r) => r.id === roomId);
  const isDM = currentRoom?.type === 'dm';
  // 私聊对象：getDMOtherUser 返回对方 UUID，展示名从资料表解析
  const dmOtherUserId = isDM ? getDMOtherUser(roomId, myId) : null;
  const dmOtherUser = dmOtherUserId ? displayNameOf(dmOtherUserId) || null : null;

  // === 群成员 ===
  const {
    members: roomMembers,
    loading: membersLoading,
    addMembers,
    setRole,
    removeMember,
  } = useRoomMembers(roomId, ready && !isDM);

  // Add-friend (DM) modal state
  const [showAddFriend, setShowAddFriend] = useState(false);
  // 个人资料卡（点击头像打开）：{ userId, name }
  const [profileCard, setProfileCard] = useState<{ userId: string; name: string } | null>(null);
  // 建群 / 邀请入群
  const [groupModal, setGroupModal] = useState<null | { mode: 'create' | 'invite' }>(null);
  // 群聊信息面板
  const [showMembers, setShowMembers] = useState(false);
  // 通讯录里的「群聊」列表
  const [showGroupList, setShowGroupList] = useState(false);
  // 转发目标选择
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  // 房间内消息搜索
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const toggleSearch = useCallback(() => {
    setSearchOpen((v) => {
      if (v) setSearchQuery('');
      return !v;
    });
  }, []);

  // 全局跨会话消息搜索
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  // 搜索结果跳转：需要高亮定位的具体消息 id（由 MessageList 滚动+高亮，2.5s 后淡出）
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);

  // 微信式底部 Tab：消息 | 通讯录 | 我
  const [listTab, setListTab] = useState<'messages' | 'contacts' | 'me'>('messages');

  // 视口：窄屏（移动端，<lg=1024px）进入聊天时左侧列表隐藏，
  // 因此底部 tab 必须常驻，点击 tab 时也负责退出聊天视图。
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // === 本地删除的消息（微信语义：只对自己隐藏） ===
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => { setDeletedIds(getDeletedMessageIds()); }, []);

  // === 已「清空聊天记录」的房间：roomId -> 清空时刻（ISO），早于该时刻的消息本机隐藏 ===
  const [clearedRooms, setClearedRooms] = useState<Record<string, string>>(() => ({}));
  useEffect(() => { setClearedRooms(getClearedRooms()); }, []);

  const visibleMessages = useMemo(() => {
    const clearedAt = clearedRooms[roomId] ?? null;
    const noClear = !clearedAt;
    if (deletedIds.size === 0 && noClear) return messages;
    return messages.filter(
      (m) => !deletedIds.has(m.id) && !isHiddenByClear(m.timestamp, clearedAt)
    );
  }, [messages, deletedIds, clearedRooms, roomId]);

  const handleDeleteMessage = useCallback((id: string) => {
    setDeletedIds(addDeletedMessageId(id));
  }, []);

  // === P3：把传给 <MessageList>/<MessageInput> 的回调全部 useCallback 化 ===
  // 这两个组件都用 React.memo 包裹；此前传的是内联箭头函数（每次 render 都是新引用），
  // 等于把 memo 完全击穿 —— **每敲一个字都会重渲染整个虚拟化消息列表**。
  const handleQuoteMessage = useCallback((msg: Message) => {
    setQuotedMessage(msg);
    // setQuotedMessage 是 useState 的稳定 setter（React 保证引用恒定），无需列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleForwardMessage = useCallback((msg: Message) => {
    setForwardMsg(msg);
  }, []);

  /**
   * 输入框 Enter 发送。
   *
   * P3 修复：必须过滤**输入法组合态**（`isComposing`）—— 中文/日文输入法下，
   * 按 Enter 是「确认候选词」，此前会被当成发送，导致消息被半截内容误发出去。
   * 同时兼容 `keyCode === 229`（部分旧版浏览器/输入法在组合期只报这个）。
   */
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
      if (native.isComposing || native.keyCode === 229) return;
      e.preventDefault();
      handleSendText();
    },
    [handleSendText]
  );

  const handleInsertText = useCallback((text: string) => {
    // 用函数式更新，避免闭包里拿到过期的 message
    setMessage((prev) => prev + text);
    // setMessage 同上：useState setter 引用恒定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 清空当前会话的聊天记录（微信语义：只清本机，不动服务器，不影响其他成员）。
   * 服务端只负责鉴权 + 返回权威时间戳，客户端据此隐藏历史并清掉本地缓存。
   */
  const handleClearHistory = useCallback(async () => {
    if (!roomId) return;
    if (!window.confirm('确定清空聊天记录？\n\n只清除本机记录，其他成员的聊天记录不受影响；清空后新消息仍会正常显示。')) return;
    try {
      const res = await fetch('/api/messages/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success || typeof json.clearedAt !== 'string') {
        showError(json?.message || '清空失败，请稍后重试');
        return;
      }
      setClearedRooms(setClearedAt(roomId, json.clearedAt));
      // 本房间的本地消息缓存一并清掉，避免下次进房先闪一下旧消息
      try {
        localStorage.removeItem(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`);
      } catch {
        /* localStorage 不可用时忽略 */
      }
      showSuccess('已清空聊天记录');
    } catch {
      showError('网络异常，清空失败');
    }
  }, [roomId]);

  // 群聊房间（非私聊）
  const groupRooms = useMemo(() => rooms.filter((r) => r.type !== 'dm'), [rooms]);

  // 好友列表：以好友表为准，并把已有私聊的对象补进来（历史数据兼容）
  const contactList = useMemo(() => {
    // key = 用户 UUID（身份）；展示名单独存 display_name
    const map = new Map<string, { id: string; display_name: string; avatar: string | null; signature: string }>();
    for (const f of friendsData.friends) {
      map.set(f.id, {
        id: f.id,
        display_name: f.display_name || '',
        avatar: f.avatar ?? null,
        signature: f.signature || '',
      });
    }
    for (const r of rooms) {
      if (r.type !== 'dm') continue;
      const other = getDMOtherUser(r.id, myId);
      if (other && !map.has(other)) {
        const name = displayNameOf(other);
        map.set(other, { id: other, display_name: name, avatar: name ? avatars[name] ?? null : null, signature: '' });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.display_name.localeCompare(b.display_name, 'zh'));
  }, [friendsData.friends, rooms, myId, avatars, displayNameOf]);

  // 补齐头像：消息发送者 + 好友 + 私聊对象 + 群成员
  useEffect(() => {
    if (!ready) return;
    // 注意：/api/users 按 UUID 批量查资料，所以这里收集的全部是 UUID
    const ids = new Set<string>();
    for (const m of messages) if (m.userId) ids.add(m.userId);
    for (const f of friendsData.friends) ids.add(f.id);
    for (const r of rooms) {
      if (r.type === 'dm') {
        const o = getDMOtherUser(r.id, myId);
        if (o) ids.add(o);
      }
    }
    for (const m of roomMembers) ids.add(m.id);
    ensureProfiles(Array.from(ids));
  }, [ready, messages, friendsData.friends, rooms, roomMembers, myId, ensureProfiles]);

  // 通讯录里点好友 → 打开与该好友的私聊会话
  const handleSelectFriend = useCallback(
    (userId: string) => {
      handleStartDM(userId);
      setViewingChat(true);
    },
    [handleStartDM]
  );

  // 点击头像 → 打开个人资料卡（微信式）。
  // 依赖为空以保持引用稳定：该回调会一路透传到 MessageItem，若每次 render 都变新引用会击穿 memo。
  const handleAvatarClick = useCallback((info: { userId?: string; name: string }) => {
    // 老数据可能没有 UUID（无法定位资料），此时忽略
    if (!info.userId) return;
    setProfileCard({ userId: info.userId, name: info.name });
  }, []);

  // 粘贴 / 拖拽投递文件。
  //
  // P3 修复（两处）：
  //  1. 此前用 `document.createElement('input')` + 伪造 ChangeEvent（`as unknown as
  //     React.ChangeEvent<HTMLInputElement>` 双重断言）来复用「选择文件」的逻辑 ——
  //     既在渲染期产生副作用（StrictMode 下泄漏一个游离 DOM 节点），又脆弱难读。
  //     现在直接调用 `useFileUpload` 暴露的 `uploadFile(file)`。
  //  2. 保留 FileList 语义：多文件时依次投递（历史上只取第一个，此处保持一致行为）。
  const triggerFileChange = useCallback(
    (files: FileList | File[]) => {
      const first = Array.from(files)[0];
      if (!first) return;
      void uploadFile(first);
    },
    [uploadFile]
  );

  const otherTypingUsers = typingUsers.filter((u) => u !== trimmedUser);

  // === Handlers ===
  const handleSelectRoom = useCallback((newRoomId: string) => {
    if (newRoomId !== roomId) {
      switchRoom(newRoomId);
    }
    setViewingChat(true);
  }, [switchRoom, roomId]);

  // 全局搜索结果点击：跳转到该条消息并高亮定位（不靠房间内搜索过滤，避免隐藏上下文）
  const handleGlobalSearchSelect = useCallback((targetRoomId: string, messageId: string) => {
    if (targetRoomId !== roomId) {
      switchRoom(targetRoomId);
    }
    // 清掉房间内搜索过滤态，确保目标消息周围的上下文可见
    setSearchQuery('');
    setSearchOpen(false);
    setHighlightMessageId(messageId);
    setGlobalSearchOpen(false);
    setViewingChat(true);
  }, [roomId, switchRoom]);

  const handleBackToList = useCallback(() => {
    setViewingChat(false);
    if (window.history.state?.chatView) {
      window.history.back();
    }
  }, []);

  /** 删除/退出/隐藏当前会话
   *  - 私聊：仅从自己列表隐藏（hideRoom，对方仍可见）
   *  - 群聊：调用退群接口真实退出，并从自己列表移除 */
  const handleDeleteRoom = useCallback(async (targetRoomId: string, dm: boolean) => {
    if (dm) {
      if (!window.confirm('确定删除该私聊？仅从你的列表隐藏，对方仍可见聊天记录。')) return;
      hideRoom(targetRoomId);
      if (targetRoomId === roomId) {
        switchRoom(ROOM_CONFIG.DEFAULT_ROOM);
        setViewingChat(false);
      }
      return;
    }

    if (!window.confirm('确定退出该群聊？退出后你将不再接收其消息。')) return;
    try {
      const res = await fetch('/api/rooms/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: targetRoomId, user: myId, target: myId }),
      });
      const data = await res.json();
      if (!data.success) {
        showError(data.message || '退出群聊失败');
        return;
      }
    } catch {
      showError('退出群聊失败');
      return;
    }
    removeJoinedRoom(targetRoomId);
    setRooms((prev) => prev.filter((r) => r.id !== targetRoomId));
    if (targetRoomId === roomId) {
      switchRoom(ROOM_CONFIG.DEFAULT_ROOM);
      setViewingChat(false);
    }
  }, [roomId, myId, hideRoom, switchRoom, setRooms]);

  // Android back button: push a history state when entering chat, intercept popstate
  useEffect(() => {
    if (viewingChat) {
      if (!window.history.state?.chatView) {
        window.history.pushState({ chatView: true }, '');
      }
    }

    const handlePopState = () => {
      if (viewingChat) setViewingChat(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [viewingChat]);

  // Logout: clear localStorage + call parent logout
  // 登出：Supabase Auth 会话由父级（AuthScreen / ChatClient）统一处理
  const handleLogout = useCallback(() => {
    onLogout();
  }, [onLogout]);

  // === 转发 ===
  const pendingForwardRef = useRef<{ roomId: string; message: Message } | null>(null);

  const doForward = useCallback((src: Message) => {
    sendMessage({
      id: generateId(),
      user: trimmedUser,
      userId: myId,
      type: src.type,
      content: src.content,
      timestamp: new Date().toISOString(),
      file_name: src.file_name ?? null,
      file_size: src.file_size ?? null,
      file_mime: src.file_mime ?? null,
      forwardedFrom: src.id,
    });
    showSuccess('已转发');
  }, [sendMessage, trimmedUser, myId]);

  const handlePickForwardTarget = useCallback((targetRoomId: string) => {
    const msg = forwardMsg;
    setForwardMsg(null);
    if (!msg) return;
    if (targetRoomId === roomId) {
      doForward(msg);
      setViewingChat(true);
      return;
    }
    pendingForwardRef.current = { roomId: targetRoomId, message: msg };
    switchRoom(targetRoomId);
    setViewingChat(true);
  }, [forwardMsg, roomId, doForward, switchRoom]);

  // 切到目标房间且频道订阅就绪后再发出转发消息
  useEffect(() => {
    const pending = pendingForwardRef.current;
    if (!pending || pending.roomId !== roomId) return;
    pendingForwardRef.current = null;
    const timer = setTimeout(() => doForward(pending.message), 700);
    return () => clearTimeout(timer);
  }, [roomId, doForward]);

  // Paste handler for clipboard images
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const dt = new DataTransfer();
            dt.items.add(file);
            triggerFileChange(dt.files);
          }
          break;
        }
      }
    },
    [triggerFileChange]
  );

  // Drag-drop upload
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      dragCounterRef.current = 0;
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      triggerFileChange(files);
    },
    [triggerFileChange]
  );

  // Merge online + recent users for @mention suggestions
  const mergedOnlineUsers = useMemo(() => {
    const seen = new Set(onlineUsers.map(u => u.nickname));
    const merged = [...onlineUsers];
    for (const u of recentUsers) {
      if (!seen.has(u.nickname)) {
        seen.add(u.nickname);
        merged.push(u);
      }
    }
    return merged;
  }, [onlineUsers, recentUsers]);

  // Image URLs for the current room — feeds the lightbox gallery navigation
  const imageUrls = useMemo(
    () =>
      visibleMessages
        .filter((m) => m.type === 'image' && m.content && !m.withdrawn_at)
        .map((m) => m.content as string),
    [visibleMessages]
  );

  const onlineNicknames = useMemo(() => onlineUsers.map((u) => u.nickname), [onlineUsers]);

  // 未处理的好友申请总数（通讯录 Tab 红点）
  const pendingFriendCount = friendsData.incoming.length;

  // ==================== Desktop two-column / mobile single-column ====================
  return (
    <LightboxProvider images={imageUrls}>
      <NetworkBanner />
      <div className="fixed inset-0 bg-background flex items-stretch justify-center">
        <div className="flex flex-col h-full w-full max-w-2xl lg:max-w-6xl bg-card overflow-hidden relative">
          {/* Main area: left list + right conversation */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left: list sidebar */}
            <aside
              className={`${viewingChat ? 'hidden' : 'flex'} flex-col lg:flex lg:flex-col lg:w-80 lg:shrink-0 lg:border-r lg:border-border h-full w-full`}
            >
              {listTab === 'messages' && (
                <ChatListPage
                  rooms={rooms}
                  currentRoomId={roomId}
                  unreadRoomIds={unreadRoomIds}
                  mentionedRoomIds={mentionedRoomIds}
                  unreadCounts={unreadCounts}
                  currentUserId={myId}
                  resolveUserName={displayNameOf}
                  onOpenMe={() => setListTab('me')}
                  onSelectRoom={handleSelectRoom}
                  onCreateRoom={createRoom}
                  onAddFriend={() => setShowAddFriend(true)}
                  onlineNicknames={globalOnlineNicknames}
                  pinnedRoomIds={pinnedRoomIds}
                  onTogglePin={togglePinRoom}
                  onGlobalSearch={() => setGlobalSearchOpen(true)}
                  clearedRooms={clearedRooms}
                />
              )}
              {listTab === 'contacts' && (
                <ContactsPage
                  friends={contactList}
                  incoming={friendsData.incoming}
                  outgoing={friendsData.outgoing}
                  onlineNicknames={globalOnlineNicknames}
                  onSelectFriend={handleSelectFriend}
                  onAddFriend={() => setShowAddFriend(true)}
                  onAccept={async (n) => { await respond(n, 'accept'); }}
                  onReject={async (n) => { await respond(n, 'reject'); }}
                  onRemoveFriend={handleRemoveFriend}
                  onOpenGroups={() => setShowGroupList(true)}
                  groupCount={groupRooms.length}
                />
              )}
              {listTab === 'me' && (
                <MePage
                  currentUser={trimmedUser}
                  profile={myProfile}
                  friendCount={contactList.length}
                  groupCount={groupRooms.length}
                  onSaveProfile={handleSaveProfile}
                  onLogout={handleLogout}
                />
              )}
            </aside>

            {/* Right: conversation */}
            <section
              className={`${viewingChat ? 'flex' : 'hidden'} lg:flex lg:flex-col lg:flex-1 h-full flex-col min-w-0 w-full relative`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {viewingChat ? (
                <>
                  <ChatHeader
                    roomName={currentRoomName}
                    onlineUsers={onlineUsers}
                    isDM={isDM}
                    dmOtherUser={dmOtherUser}
                    dmOtherUserId={dmOtherUserId}
                    globalOnlineIds={globalOnlineIds}
                    dmOtherAvatar={dmOtherUser ? avatars[dmOtherUser] ?? null : null}
                    memberCount={isDM ? 0 : roomMembers.length}
                    otherTyping={isDM && otherTypingUsers.length > 0}
                    onBack={handleBackToList}
                    onOpenMembers={isDM ? undefined : () => setShowMembers(true)}
                    onDeleteRoom={() => handleDeleteRoom(roomId, isDM)}
                    onClearHistory={handleClearHistory}
                    searchOpen={searchOpen}
                    searchQuery={searchQuery}
                    onToggleSearch={toggleSearch}
                    onSearchChange={setSearchQuery}
                    onOpenDmProfile={
                      dmOtherUserId
                        ? () => handleAvatarClick({ userId: dmOtherUserId, name: dmOtherUser || '' })
                        : undefined
                    }
                  />

                  <MessageList
                    messages={visibleMessages}
                    user={trimmedUser}
                    typingUsers={isDM ? [] : otherTypingUsers}
                    uploadingMessages={uploadingMessages}
                    loadingMore={loadingMore}
                    isLoading={isLoading}
                    hasMore={hasMore}
                    onLoadMore={loadMoreHistory}
                    onRefresh={refreshMessages}
                    onWithdraw={handleWithdraw}
                    onRetry={retryMessage}
                    onQuote={handleQuoteMessage}
                    onEdit={handleEditMessage}
                    onDelete={handleDeleteMessage}
                    onForward={handleForwardMessage}
                    isDM={isDM}
                    avatars={avatars}
                    searchQuery={searchQuery}
                    reactionsByMessage={reactionsByMessage}
                    onToggleReaction={toggleReaction}
                    highlightMessageId={highlightMessageId}
                    onLoadMessageById={loadMessageById}
                    roomId={roomId}
                    currentUserId={myId}
                    onAvatarClick={handleAvatarClick}
                  />

                  {/* Quote preview */}
                  {quotedMessage && (
                    <div className="px-4 py-2 bg-primary/10 border-t border-border flex items-center gap-2 flex-shrink-0">
                      <div className="w-[3px] self-stretch rounded-full bg-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-primary font-semibold mb-0.5">
                          引用 @{quotedMessage.user}
                        </div>
                        <div className="text-sm text-foreground truncate">
                          {quotedMessage.type === 'text'
                            ? quotedMessage.content
                            : mediaPlaceholder(quotedMessage.type)}
                        </div>
                      </div>
                      <button
                        onClick={() => setQuotedMessage(null)}
                        className="p-1 text-muted-foreground hover:text-foreground"
                        aria-label="取消引用"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <MessageInput
                    message={message}
                    uploading={uploading}
                    onlineUsers={mergedOnlineUsers}
                    onMessageChange={handleMessageChange}
                    onKeyDown={handleInputKeyDown}
                    onFileChange={handleFileChange}
                    onVoiceRecord={handleVoiceUpload}
                    onSend={handleSendText}
                    onPaste={handlePaste}
                    draftSaved={draftSaved}
                    onInsertText={handleInsertText}
                  />

                  {/* Drag-drop overlay */}
                  {isDragging && (
                    <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary rounded-xl flex flex-col items-center justify-center gap-3 pointer-events-none">
                      <Upload className="w-12 h-12 text-primary" />
                      <span className="text-lg font-medium text-primary/80">
                        松开上传文件
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="hidden lg:flex flex-1 flex-col items-center justify-center text-muted-foreground gap-3">
                  <MessageCircle className="w-14 h-14 opacity-30" />
                  <p className="text-sm">选择一个会话开始聊天</p>
                </div>
              )}
            </section>
          </div>

          {/* === Bottom tab bar: 消息 | 通讯录 | 我（常驻；移动端进入聊天后可由此返回列表） === */}
          <nav className="flex-shrink-0 h-14 bg-card border-t border-border flex items-stretch">
            {([
              { key: 'messages' as const, label: '消息', Icon: MessageCircle, badge: 0 },
              { key: 'contacts' as const, label: '通讯录', Icon: Users, badge: pendingFriendCount },
              { key: 'me' as const, label: '我', Icon: UserIcon, badge: 0 },
            ]).map(({ key, label, Icon, badge }) => (
              <button
                key={key}
                onClick={() => {
                  setListTab(key);
                  if (isMobile) setViewingChat(false);
                }}
                className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  listTab === key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{label}</span>
                  {badge > 0 && (
                    <span className="absolute top-1.5 right-[28%] min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>

          {/* === Overlays === */}
          {showAddFriend && (
            <AddFriendModal
              currentUserId={myId}
              onClose={() => setShowAddFriend(false)}
              onStartDM={(userId: string) => {
                handleStartDM(userId);
                setViewingChat(true);
              }}
              onSendRequest={async (userId: string) => {
                const r = await sendRequest(userId);
                await reloadFriends();
                return r;
              }}
              friendIds={friendsData.friends.map((f) => f.id)}
              outgoingIds={friendsData.outgoing.map((f) => f.id)}
            />
          )}

          {groupModal && (
            <CreateGroupModal
              currentUserId={myId}
              currentUserName={myProfile?.display_name || trimmedUser}
              friends={contactList}
              mode={groupModal.mode}
              existingMembers={roomMembers.map((m) => m.id)}
              onClose={() => setGroupModal(null)}
              onCreated={(newRoomId) => {
                joinRoom(newRoomId);
                setViewingChat(true);
                setShowGroupList(false);
              }}
              onInvite={async (userIds) => { await addMembers(userIds); }}
            />
          )}

          {showMembers && !isDM && (
            <GroupMembersPanel
              roomId={roomId}
              roomName={currentRoomName || roomId}
              currentUserId={myId}
              members={roomMembers}
              loading={membersLoading}
              onlineNicknames={onlineNicknames}
              onClose={() => setShowMembers(false)}
              onInvite={() => { setShowMembers(false); setGroupModal({ mode: 'invite' }); }}
              onRemove={(target) => removeMember(myId, target)}
              onSetRole={(target, role) => setRole(myId, target, role)}
              onLeft={() => {
                setShowMembers(false);
                setViewingChat(false);
                // P3：同文件其它处都用 ROOM_CONFIG.DEFAULT_ROOM，这里此前硬编码字面量
                switchRoom(ROOM_CONFIG.DEFAULT_ROOM);
              }}
              onOpenProfile={(m) => handleAvatarClick({ userId: m.id, name: m.name })}
            />
          )}

          {/* 通讯录 → 群聊列表 */}
          {showGroupList && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={() => setShowGroupList(false)}>
              <div className="w-full max-w-lg max-h-[75vh] bg-card rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                  <h2 className="text-base font-semibold text-foreground">我的群聊（{groupRooms.length}）</h2>
                  <button onClick={() => setShowGroupList(false)} className="p-1.5 rounded-lg hover:bg-muted" aria-label="关闭">
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                </div>
                <button
                  onClick={() => { setShowGroupList(false); setGroupModal({ mode: 'create' }); }}
                  className="flex items-center gap-3 px-4 py-3 border-b border-border hover:bg-muted transition-colors"
                >
                  <span className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
                    <Plus className="w-5 h-5" />
                  </span>
                  <span className="text-[15px] text-foreground">发起群聊</span>
                </button>
                <div className="flex-1 overflow-y-auto">
                  {groupRooms.length === 0 ? (
                    <div className="py-14 text-center text-sm text-muted-foreground">还没有群聊</div>
                  ) : (
                    groupRooms.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => { setShowGroupList(false); handleSelectRoom(r.id); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                      >
                        <Avatar name={r.name || r.id} size={40} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[15px] text-foreground truncate">{r.name || r.id}</p>
                          <p className="text-[12px] text-muted-foreground truncate">群号 {r.id}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 全局跨会话消息搜索 */}
          {globalSearchOpen && (
            <GlobalSearchModal
              onClose={() => setGlobalSearchOpen(false)}
              onSelect={handleGlobalSearchSelect}
            />
          )}

          {/* 转发目标选择 */}
          {forwardMsg && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={() => setForwardMsg(null)}>
              <div className="w-full max-w-lg max-h-[75vh] bg-card rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                  <h2 className="text-base font-semibold text-foreground">转发到</h2>
                  <button onClick={() => setForwardMsg(null)} className="p-1.5 rounded-lg hover:bg-muted" aria-label="关闭">
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                </div>
                <div className="px-4 py-2 text-[12px] text-muted-foreground border-b border-border/60 truncate flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" />
                  {forwardMsg.type === 'text'
                    ? forwardMsg.content
                    : mediaPlaceholder(forwardMsg.type)}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {rooms.map((r) => {
                    // 私聊：other 是对方 UUID，标题/头像回退到服务端写入的房间名
                    const otherId = r.type === 'dm' ? getDMOtherUser(r.id, myId) : null;
                    const title = (otherId ? displayNameOf(otherId) : '') || r.name || r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => handlePickForwardTarget(r.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                      >
                        <Avatar name={title} avatar={avatars[title] ?? null} size={40} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[15px] text-foreground truncate">{title}</p>
                          <p className="text-[12px] text-muted-foreground truncate">
                            {r.type === 'dm' ? '私聊' : '群聊'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {/* 个人资料卡（点击头像打开，微信式）：按关系给出「发消息 / 接受 / 等待验证 / 添加到通讯录」 */}
          {profileCard && (
            <UserProfileCard
              userId={profileCard.userId}
              initialName={profileCard.name}
              isSelf={profileCard.userId === myId}
              isFriend={friendsData.friends.some((f) => f.id === profileCard.userId)}
              outgoingPending={friendsData.outgoing.some((o) => o.id === profileCard.userId)}
              incomingPending={friendsData.incoming.some((i) => i.id === profileCard.userId)}
              onClose={() => setProfileCard(null)}
              onSendRequest={async (id) => {
                const r = await sendRequest(id);
                await reloadFriends();
                return r;
              }}
              onAccept={async (id) => {
                const r = await respond(id, 'accept');
                await reloadFriends();
                return r;
              }}
              onStartDM={(id) => {
                setProfileCard(null);
                handleStartDM(id);
                setViewingChat(true);
              }}
              onEditSelf={() => {
                setProfileCard(null);
                setListTab('me');
                if (isMobile) setViewingChat(false);
              }}
            />
          )}

        </div>
      </div>
    </LightboxProvider>
  );
}
