'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Plus, MessageCircle, Hash, Users, LogOut, ShieldCheck, Pin, Search } from 'lucide-react';
import { Room } from '@/types';
import { loadDraft } from '@/hooks/useDraft';
import { getDMOtherUser } from '@/hooks/useDM';
import ThemeToggle from '@/components/chat/ThemeToggle';
import Avatar from '@/components/chat/Avatar';
import { formatClock } from '@/utils/date-utils';

interface ChatListPageProps {
  rooms: Room[];
  currentRoomId: string;
  isAdmin?: boolean;
  unreadRoomIds: Set<string>;
  mentionedRoomIds: Set<string>;
  unreadCounts?: Record<string, number>;
  currentUser: string;
  onSelectRoom: (roomId: string) => void;
  onCreateRoom: (name: string) => void;
  onLogout: () => void;
  onAddFriend?: () => void;
  onlineNicknames?: string[];
  /** 已置顶的房间 ID 集合（仅本地偏好） */
  pinnedRoomIds?: Set<string>;
  /** 切换置顶 */
  onTogglePin?: (roomId: string) => void;
  /** 打开全局跨会话消息搜索 */
  onGlobalSearch?: () => void;
}

/** Format timestamp to short display */
function formatTime(ts?: string | null): string {
  if (!ts) return '';
  const date = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const oneDay = 86400000;

  if (diff < oneDay && now.getDate() === date.getDate()) {
    return formatClock(date);
  }
  if (diff < oneDay * 2) return '昨天';
  if (diff < oneDay * 7) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[date.getDay()];
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

const ChatListPage: React.FC<ChatListPageProps> = React.memo(({
  rooms,
  currentRoomId,
  isAdmin,
  unreadRoomIds,
  mentionedRoomIds,
  unreadCounts,
  currentUser,
  onSelectRoom,
  onCreateRoom,
  onLogout,
  onAddFriend,
  onlineNicknames = [],
  pinnedRoomIds = new Set<string>(),
  onTogglePin,
  onGlobalSearch,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  // 长按 / 右键 置顶菜单
  const [pinMenuRoomId, setPinMenuRoomId] = useState<string | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // Close dropdown on Escape
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMenu(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showMenu]);

  // Close pin menu on Escape (backdrop handles click-close)
  useEffect(() => {
    if (!pinMenuRoomId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinMenuRoomId(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pinMenuRoomId]);

  const handleCreateRoom = () => {
    const name = newRoomName.trim();
    if (name) {
      onCreateRoom(name);
      setNewRoomName('');
      setShowCreateForm(false);
    }
  };

  // Split into 1:1 DM conversations and group chats (WeChat-style grouping)
  // Pinned rooms are pulled out into a dedicated top section.
  const pinnedRooms = useMemo(
    () => rooms.filter((r) => pinnedRoomIds.has(r.id)),
    [rooms, pinnedRoomIds]
  );
  const dmRooms = useMemo(
    () => rooms.filter((r) => r.type === 'dm' && !pinnedRoomIds.has(r.id)),
    [rooms, pinnedRoomIds]
  );
  const groupRooms = useMemo(
    () => rooms.filter((r) => r.type !== 'dm' && !pinnedRoomIds.has(r.id)),
    [rooms, pinnedRoomIds]
  );

  // Precompute draft content for all rooms (avoids N localStorage reads during render)
  const draftMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const room of rooms) {
      const draft = loadDraft(room.id);
      if (draft) map.set(room.id, draft);
    }
    return map;
  }, [rooms]);

  /** Render a single chat list item */
  const renderRoomItem = (room: Room) => {
    const hasUnread = unreadRoomIds.has(room.id) || (unreadCounts?.[room.id] || 0) > 0;
    const unreadNum = unreadCounts?.[room.id] || 0;
    const hasMention = mentionedRoomIds.has(room.id);
    const isPinned = pinnedRoomIds.has(room.id);
    const isActive = room.id === currentRoomId;
    const draftContent = draftMap.get(room.id) ?? '';
    // DM room name is stored from the creator's perspective, so derive the other
    // party's name symmetrically from the room ID for both participants.
    const isItemDM = room.type === 'dm';
    const otherUser = isItemDM ? (getDMOtherUser(room.id, currentUser) ?? room.name) : null;
    const displayName = isItemDM ? (otherUser ?? room.name) : room.name;
    const otherOnline = isItemDM && otherUser ? onlineNicknames.includes(otherUser) : false;

    return (
      // 用 div + role=button：避免行内交互元素嵌套（保持语义化可点击行）
      <div
        key={room.id}
        role="button"
        tabIndex={0}
        onClick={() => {
          // 长按已触发菜单时，抑制随后冒泡的 click，避免误打开会话
          if (longPressFiredRef.current) {
            longPressFiredRef.current = false;
            return;
          }
          onSelectRoom(room.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectRoom(room.id);
          }
        }}
        onContextMenu={(e) => {
          // 桌面右键 → 置顶菜单
          e.preventDefault();
          longPressFiredRef.current = true;
          setPinMenuRoomId(room.id);
        }}
        onPointerDown={(e) => {
          // 移动端长按 500ms → 置顶菜单（鼠标左键才计时，右键交给 onContextMenu）
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          longPressFiredRef.current = false;
          if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
          pressTimerRef.current = window.setTimeout(() => {
            longPressFiredRef.current = true;
            setPinMenuRoomId(room.id);
          }, 500);
        }}
        onPointerUp={() => {
          if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
          }
        }}
        onPointerLeave={() => {
          if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
          }
        }}
        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left cursor-pointer ${
          isActive
            ? 'bg-accent'
            : 'hover:bg-muted'
        } border-b border-border`}
      >
        {/* Avatar — 微信式圆角方块 */}
        <div className="relative flex-shrink-0">
          <Avatar name={displayName} size={48} />
          {isItemDM && (
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-card ${
                otherOnline ? 'bg-green-500' : 'bg-gray-400'
              }`}
            />
          )}
          {hasUnread && !hasMention && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-semibold flex items-center justify-center ring-2 ring-card">
              {unreadNum > 99 ? '99+' : unreadNum > 0 ? unreadNum : ''}
            </span>
          )}
          {hasMention && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center ring-2 ring-card">
              @
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className={`text-[15px] font-medium truncate ${
              isActive ? 'text-accent-foreground font-semibold' : 'text-foreground'
            }`}>
              {displayName}
            </span>
            <span className="flex items-center gap-1 flex-shrink-0 ml-2">
              {isPinned && (
                <Pin className="w-3.5 h-3.5 text-muted-foreground" aria-label="已置顶" />
              )}
              <span className="text-[11px] text-muted-foreground">
                {formatTime(room.last_message_at)}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-muted-foreground truncate flex-1">
              {draftContent ? (
                <>
                  <span className="text-destructive font-medium">[草稿] </span>
                  {draftContent}
                </>
              ) : room.last_message_content ? (
                <>
                  <span className="text-foreground/70 font-medium">{room.last_message_user}: </span>
                  {room.last_message_type === 'image' ? '[图片]'
                    : room.last_message_type === 'video' ? '[视频]'
                    : room.last_message_type === 'voice' ? '[语音]'
                    : room.last_message_type === 'file' ? '[文件]'
                    : room.last_message_content}
                </>
              ) : room.id === 'default-room' ? (
                '默认大厅'
              ) : (
                <span className="flex items-center gap-1">
                  <Hash className="w-3 h-3" />
                  {room.name}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const hasAnyRooms = rooms.length > 0;

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Nav bar */}
      <header className="flex items-center justify-between px-4 h-12 flex-shrink-0 bg-card">
        {/* 左侧：退出登录（从右上移至左上，对应把 + 放到右上角，对齐微信） */}
        <div className="flex items-center gap-1 min-w-[60px]">
          <button
            onClick={onLogout}
            className="w-11 h-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors"
            aria-label="退出登录"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <h1 className="text-[17px] font-semibold text-foreground">消息</h1>
          {isAdmin && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
              <ShieldCheck className="w-3 h-3" />
              管理员
            </span>
          )}
        </div>
        {/* 右侧：搜索 / 主题 / 操作菜单(+) —— + 移到右上角，对齐微信 */}
        <div className="relative flex items-center gap-1 min-w-[60px] justify-end" ref={menuRef}>
          {onGlobalSearch && (
            <button
              onClick={onGlobalSearch}
              className="w-11 h-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors"
              aria-label="搜索消息"
            >
              <Search className="w-5 h-5" />
            </button>
          )}
          <ThemeToggle />
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="w-11 h-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors"
            aria-label="操作菜单"
          >
            <Plus className="w-5 h-5" />
          </button>
          {showMenu && (
            <div className="absolute top-10 right-0 z-50 w-48 bg-card rounded-xl shadow-lg border border-border py-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
              <button
                onClick={() => { setShowMenu(false); setShowCreateForm(true); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted transition-colors text-left"
              >
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">发起群聊</span>
              </button>
              {onAddFriend && (
                <button
                  onClick={() => { setShowMenu(false); onAddFriend(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted transition-colors text-left"
                >
                  <MessageCircle className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">添加好友</span>
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Inline create room form */}
      {showCreateForm && (
        <div className="px-4 py-2 flex items-center gap-2 bg-muted/50 border-b border-border flex-shrink-0">
          <input
            type="text"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateRoom();
              if (e.key === 'Escape') { setShowCreateForm(false); setNewRoomName(''); }
            }}
            placeholder="输入群聊名称"
            maxLength={30}
            autoFocus
            className="flex-1 h-11 bg-card border border-input rounded-lg px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleCreateRoom}
            disabled={!newRoomName.trim()}
            className="h-11 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity flex-shrink-0"
          >
            创建
          </button>
          <button
            onClick={() => { setShowCreateForm(false); setNewRoomName(''); }}
            className="h-11 px-2 rounded-lg text-muted-foreground hover:bg-muted text-sm transition-colors flex-shrink-0"
          >
            取消
          </button>
        </div>
      )}

      {/* Chat list — WeChat-style grouping: 置顶 / 私聊 / 群聊 */}
      {hasAnyRooms ? (
        <div className="flex-1 overflow-y-auto">
          {pinnedRooms.length > 0 && (
            <>
              <div className="px-4 pt-2.5 pb-1 text-[12px] font-medium text-muted-foreground">置顶</div>
              {pinnedRooms.map((room) => renderRoomItem(room))}
            </>
          )}
          {dmRooms.length > 0 && (
            <>
              <div className="px-4 pt-2.5 pb-1 text-[12px] font-medium text-muted-foreground">私聊</div>
              {dmRooms.map((room) => renderRoomItem(room))}
            </>
          )}
          {groupRooms.length > 0 && (
            <>
              <div className="px-4 pt-2.5 pb-1 text-[12px] font-medium text-muted-foreground">群聊</div>
              {groupRooms.map((room) => renderRoomItem(room))}
            </>
          )}
        </div>
      ) : (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center px-10 text-center">
          <div className="w-24 h-24 rounded-2xl bg-accent flex items-center justify-center mb-5">
            <MessageCircle className="w-12 h-12 text-primary" strokeWidth={1.5} />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">还没有聊天</h3>
          <p className="text-sm text-muted-foreground max-w-[240px]">
            去「通讯录」添加好友发起私聊，或点左上角「+」发起群聊
          </p>
        </div>
      )}

      {/* 置顶菜单（长按 / 右键触发）——移动端底部抽屉，桌面端居中卡片 */}
      {pinMenuRoomId && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center sm:justify-center"
          onClick={() => setPinMenuRoomId(null)}
          role="dialog"
          aria-modal="true"
          aria-label="会话操作"
        >
          <div
            className="w-full sm:w-72 bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl border border-border py-1.5 animate-in fade-in slide-in-from-bottom-2 sm:slide-in-from-bottom-0 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                const id = pinMenuRoomId;
                setPinMenuRoomId(null);
                onTogglePin?.(id);
              }}
              className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-muted transition-colors text-left"
            >
              <Pin className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-foreground">
                {pinnedRoomIds.has(pinMenuRoomId) ? '取消置顶' : '置顶'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

ChatListPage.displayName = 'ChatListPage';

export default ChatListPage;
