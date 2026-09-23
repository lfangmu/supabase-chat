'use client';

import React, { useCallback, useState, useRef, useMemo, useEffect } from 'react';
import { useChat } from '@/hooks/useChat';
import {
  Upload, X, ArrowRight, MessageCircle, Users, User as UserIcon, Plus, Search,
} from 'lucide-react';
import MessageList from '@/components/chat/MessageList';
import MessageInput from '@/components/chat/MessageInput';
import ChatHeader from '@/components/chat/ChatHeader';
import ChatListPage from '@/components/chat/ChatListPage';
import LightboxProvider from '@/components/chat/Lightbox';
import AddFriendModal from '@/components/chat/AddFriendModal';
import ContactsPage from '@/components/chat/ContactsPage';
import MePage from '@/components/chat/MePage';
import GlobalSearchModal from '@/components/chat/GlobalSearchModal';
import CreateGroupModal from '@/components/chat/CreateGroupModal';
import GroupMembersPanel from '@/components/chat/GroupMembersPanel';
import Avatar from '@/components/chat/Avatar';
import { getDMOtherUser } from '@/hooks/useDM';
import NetworkBanner from '@/components/chat/NetworkBanner';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useFriends } from '@/hooks/useFriends';
import { useProfile } from '@/hooks/useProfile';
import { useRoomMembers } from '@/hooks/useRoomMembers';
import { Message } from '@/types';
import { generateId } from '@/utils/id';
import { getDeletedMessageIds, addDeletedMessageId } from '@/utils/deletedMessages';
import { showSuccess, showError } from '@/utils/errorHandler';
import { removeJoinedRoom } from '@/utils/joinedRooms';
import { ROOM_CONFIG } from '@/config';

interface ChatAppProps {
  onLogout: () => void;
}

export default function ChatApp({ onLogout }: ChatAppProps) {
  // === View state: list (room list) <-> chat (conversation) ===
  // 放在 useChat 之前：会话是否可见决定「已读回执」是否上报
  const [viewingChat, setViewingChat] = useState(false);

  const {
    user, setUser, savedNickname, showNicknameInput,
    message, setMessage, messages,
    roomId, rooms,
    uploading, uploadingMessages,
    loadingMore, hasMore, isLoading,
    typingUsers, onlineUsers, recentUsers,
    quotedMessage, setQuotedMessage,
    handleSetNickname,
    handleMessageChange, handleSendText, handleFileChange, handleVoiceUpload,
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
  } = useChat(viewingChat);

  const trimmedUser = user.trim();
  const ready = !showNicknameInput && !!trimmedUser;

  // === 好友系统 ===
  const {
    data: friendsData,
    sendRequest,
    respond,
    load: reloadFriends,
  } = useFriends({ user: trimmedUser, enabled: ready });

  // === 用户资料（头像/签名）+ 昵称→头像映射 ===
  const { me: myProfile, avatars, ensureProfiles, saveProfile } = useProfile(ready ? trimmedUser : '');

  // 当前房间
  const currentRoom = rooms.find((r) => r.id === roomId);
  const isDM = currentRoom?.type === 'dm';
  const dmOtherUser = isDM ? getDMOtherUser(roomId, trimmedUser) : null;

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

  const visibleMessages = useMemo(
    () => (deletedIds.size === 0 ? messages : messages.filter((m) => !deletedIds.has(m.id))),
    [messages, deletedIds]
  );

  const handleDeleteMessage = useCallback((id: string) => {
    setDeletedIds(addDeletedMessageId(id));
  }, []);

  // 群聊房间（非私聊）
  const groupRooms = useMemo(() => rooms.filter((r) => r.type !== 'dm'), [rooms]);

  // 好友列表：以好友表为准，并把已有私聊的对象补进来（历史数据兼容）
  const contactList = useMemo(() => {
    const map = new Map<string, { nickname: string; avatar: string | null; signature: string }>();
    for (const f of friendsData.friends) map.set(f.nickname, f);
    for (const r of rooms) {
      if (r.type !== 'dm') continue;
      const other = getDMOtherUser(r.id, trimmedUser);
      if (other && !map.has(other)) {
        map.set(other, { nickname: other, avatar: avatars[other] ?? null, signature: '' });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh'));
  }, [friendsData.friends, rooms, trimmedUser, avatars]);

  // 补齐头像：消息发送者 + 好友 + 私聊对象 + 群成员
  useEffect(() => {
    if (!ready) return;
    const names = new Set<string>();
    for (const m of messages) names.add(m.user);
    for (const f of friendsData.friends) names.add(f.nickname);
    for (const r of rooms) {
      if (r.type === 'dm') {
        const o = getDMOtherUser(r.id, trimmedUser);
        if (o) names.add(o);
      }
      if (r.last_message_user) names.add(r.last_message_user);
    }
    ensureProfiles(Array.from(names));
  }, [ready, messages, friendsData.friends, rooms, trimmedUser, ensureProfiles]);

  // 通讯录里点好友 → 打开与该好友的私聊会话
  const handleSelectFriend = useCallback(
    (nickname: string) => {
      handleStartDM(nickname);
      setViewingChat(true);
    },
    [handleStartDM]
  );

  // Reusable hidden input for paste/drop file handling
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  if (!fileInputRef.current) {
    fileInputRef.current = document.createElement('input');
    fileInputRef.current.type = 'file';
    fileInputRef.current.style.display = 'none';
  }

  const triggerFileChange = useCallback(
    (files: FileList) => {
      const input = fileInputRef.current!;
      const dt = new DataTransfer();
      for (let i = 0; i < files.length; i++) dt.items.add(files[i]);
      input.files = dt.files;
      handleFileChange({
        target: input,
        currentTarget: input,
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    },
    [handleFileChange]
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
        body: JSON.stringify({ roomId: targetRoomId, user: trimmedUser, target: trimmedUser }),
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
  }, [roomId, trimmedUser, hideRoom, switchRoom, setRooms]);

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
  const handleLogout = useCallback(() => {
    try {
      localStorage.removeItem('chat_nickname');
    } catch { /* ignore */ }
    onLogout();
  }, [onLogout]);

  // === 转发 ===
  const pendingForwardRef = useRef<{ roomId: string; message: Message } | null>(null);

  const doForward = useCallback((src: Message) => {
    sendMessage({
      id: generateId(),
      user: trimmedUser,
      type: src.type,
      content: src.content,
      timestamp: new Date().toISOString(),
      file_name: src.file_name ?? null,
      file_size: src.file_size ?? null,
      file_mime: src.file_mime ?? null,
    });
    showSuccess('已转发');
  }, [sendMessage, trimmedUser]);

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
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          const file = items[i].getAsFile();
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

  // ==================== Onboarding / Nickname Edit Page ====================
  if (showNicknameInput) {
    return (
      <div className="fixed inset-0 flex items-stretch justify-center z-50">
        <div className="w-full max-w-2xl h-app flex flex-col items-center justify-center p-9 bg-background transition-all duration-300">
          {/* Logo */}
          <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center mb-7 shadow-lg shadow-primary/30">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-2 tracking-tight">
            {savedNickname ? '欢迎回来' : '设置你的昵称'}
          </h2>
          <p className="text-muted-foreground text-[15px] mb-7">
            {savedNickname
              ? '可直接使用上次昵称，或输入新昵称开始聊天'
              : '请输入你的昵称开始聊天'}
          </p>

          <div className="w-full max-w-[300px] space-y-4">
            <div className="relative">
              <input
                type="text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && user.trim() && handleSetNickname()}
                maxLength={20}
                className="w-full h-[52px] px-[18px] border-[1.5px] border-input rounded-[14px] bg-card text-foreground text-base outline-none transition-all duration-200 focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground"
                placeholder="输入你的昵称"
                autoFocus
              />
              {user.length > 0 && (
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {user.length}/20
                </span>
              )}
            </div>

            {savedNickname && (
              <button
                type="button"
                onClick={() => setUser(savedNickname)}
                className="w-full flex items-center justify-center gap-2 h-[44px] rounded-[14px] border border-dashed border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:border-primary transition-colors duration-200"
              >
                <span className="text-xs">上次使用</span>
                <span className="font-medium text-foreground truncate max-w-[180px]">
                  {savedNickname}
                </span>
              </button>
            )}

            <button
              onClick={handleSetNickname}
              disabled={!user.trim()}
              className={`w-full h-[52px] rounded-[14px] text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
                !user.trim()
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : 'bg-primary hover:opacity-90 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0'
              }`}
            >
              进入聊天
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>

          <div className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            昵称将公开展示给群聊成员
          </div>
        </div>
      </div>
    );
  }

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
                  currentUser={trimmedUser}
                  onSelectRoom={handleSelectRoom}
                  onCreateRoom={createRoom}
                  onLogout={handleLogout}
                  onAddFriend={() => setShowAddFriend(true)}
                  onlineNicknames={onlineNicknames}
                  pinnedRoomIds={pinnedRoomIds}
                  onTogglePin={togglePinRoom}
                  onGlobalSearch={() => setGlobalSearchOpen(true)}
                />
              )}
              {listTab === 'contacts' && (
                <ContactsPage
                  friends={contactList}
                  incoming={friendsData.incoming}
                  outgoing={friendsData.outgoing}
                  onlineNicknames={onlineNicknames}
                  onSelectFriend={handleSelectFriend}
                  onAddFriend={() => setShowAddFriend(true)}
                  onAccept={async (n) => { await respond(n, 'accept'); }}
                  onReject={async (n) => { await respond(n, 'reject'); }}
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
                  onSaveProfile={saveProfile}
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
                    dmOtherAvatar={dmOtherUser ? avatars[dmOtherUser] ?? null : null}
                    memberCount={isDM ? 0 : roomMembers.length}
                    otherTyping={isDM && otherTypingUsers.length > 0}
                    onBack={handleBackToList}
                    onOpenMembers={isDM ? undefined : () => setShowMembers(true)}
                    onDeleteRoom={() => handleDeleteRoom(roomId, isDM)}
                    searchOpen={searchOpen}
                    searchQuery={searchQuery}
                    onToggleSearch={toggleSearch}
                    onSearchChange={setSearchQuery}
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
                    onQuote={(msg) => setQuotedMessage(msg)}
                    onEdit={handleEditMessage}
                    onDelete={handleDeleteMessage}
                    onForward={(msg) => setForwardMsg(msg)}
                    isDM={isDM}
                    avatars={avatars}
                    searchQuery={searchQuery}
                    reactionsByMessage={reactionsByMessage}
                    onToggleReaction={toggleReaction}
                    highlightMessageId={highlightMessageId}
                    onLoadMessageById={loadMessageById}
                    roomId={roomId}
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
                            : `[${quotedMessage.type === 'image' ? '图片' : quotedMessage.type === 'video' ? '视频' : quotedMessage.type === 'voice' ? '语音' : '文件'}]`}
                        </div>
                      </div>
                      <button
                        onClick={() => setQuotedMessage(null)}
                        className="p-1 text-muted-foreground hover:text-foreground"
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
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendText())}
                    onFileChange={handleFileChange}
                    onVoiceRecord={handleVoiceUpload}
                    onSend={handleSendText}
                    onPaste={handlePaste}
                    draftSaved={draftSaved}
                    onInsertText={(t) => setMessage(message + t)}
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
              currentUser={trimmedUser}
              onClose={() => setShowAddFriend(false)}
              onStartDM={(nickname: string) => {
                handleStartDM(nickname);
                setViewingChat(true);
              }}
              onSendRequest={async (nickname: string) => {
                const r = await sendRequest(nickname);
                await reloadFriends();
                return r;
              }}
              friendNicknames={friendsData.friends.map((f) => f.nickname)}
              outgoingNicknames={friendsData.outgoing.map((f) => f.nickname)}
            />
          )}

          {groupModal && (
            <CreateGroupModal
              currentUser={trimmedUser}
              friends={contactList}
              mode={groupModal.mode}
              existingMembers={roomMembers.map((m) => m.nickname)}
              onClose={() => setGroupModal(null)}
              onCreated={(newRoomId) => {
                joinRoom(newRoomId);
                setViewingChat(true);
                setShowGroupList(false);
              }}
              onInvite={async (nicknames) => { await addMembers(nicknames); }}
            />
          )}

          {showMembers && !isDM && (
            <GroupMembersPanel
              roomId={roomId}
              roomName={currentRoomName || roomId}
              currentUser={trimmedUser}
              members={roomMembers}
              loading={membersLoading}
              onlineNicknames={onlineNicknames}
              onClose={() => setShowMembers(false)}
              onInvite={() => { setShowMembers(false); setGroupModal({ mode: 'invite' }); }}
              onRemove={(target) => removeMember(trimmedUser, target)}
              onSetRole={(target, role) => setRole(trimmedUser, target, role)}
              onLeft={() => {
                setShowMembers(false);
                setViewingChat(false);
                switchRoom('default-room');
              }}
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
                    : `[${forwardMsg.type === 'image' ? '图片' : forwardMsg.type === 'video' ? '视频' : forwardMsg.type === 'voice' ? '语音' : '文件'}]`}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {rooms.map((r) => {
                    const other = r.type === 'dm' ? getDMOtherUser(r.id, trimmedUser) : null;
                    const title = other || r.name || r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => handlePickForwardTarget(r.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                      >
                        <Avatar name={title} avatar={other ? avatars[other] ?? null : null} size={40} />
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
        </div>
      </div>
    </LightboxProvider>
  );
}
