'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, MoreHorizontal, Users, LogOut, Search, X, Eraser } from 'lucide-react';
import { PresenceUser } from '@/hooks/usePresence';
import ThemeToggle from '@/components/chat/ThemeToggle';
import Avatar from '@/components/chat/Avatar';

interface ChatHeaderProps {
  roomName?: string;
  onlineUsers?: PresenceUser[];
  isDM?: boolean;
  dmOtherUser?: string | null;
  /** 私聊对方 UUID（在线判定改用全局在线集合，而非仅同房间 presence） */
  dmOtherUserId?: string | null;
  /** 全局在线用户 UUID 集合（来自 useGlobalPresence） */
  globalOnlineIds?: string[];
  dmOtherAvatar?: string | null;
  /** 群成员数（群聊标题后缀，微信风格） */
  memberCount?: number;
  /** 对方是否正在输入（私聊时替换在线状态显示） */
  otherTyping?: boolean;
  onBack: () => void;
  /** 群聊：打开群聊信息面板 */
  onOpenMembers?: () => void;
  /** 删除/退出/隐藏当前会话（群聊=退出群聊；私聊=从自己列表隐藏） */
  onDeleteRoom?: () => void;
  /** 清空聊天记录（微信语义：只清本机，不影响其他成员） */
  onClearHistory?: () => void;
  /** 消息搜索：是否展开搜索框 */
  searchOpen?: boolean;
  /** 搜索关键词 */
  searchQuery?: string;
  /** 切换搜索框展开 */
  onToggleSearch?: () => void;
  /** 搜索关键词变化 */
  onSearchChange?: (q: string) => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = React.memo(({
  roomName,
  onlineUsers = [],
  isDM = false,
  dmOtherUser = null,
  dmOtherUserId = null,
  globalOnlineIds = [],
  dmOtherAvatar = null,
  memberCount = 0,
  otherTyping = false,
  onBack,
  onOpenMembers,
  onDeleteRoom,
  onClearHistory,
  searchOpen = false,
  searchQuery = '',
  onToggleSearch,
  onSearchChange,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 菜单打开时：外部点击 / Esc 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="flex items-center justify-between px-2 h-12 flex-shrink-0 bg-card border-b border-border safe-area-inset-top">
      {/* Left: Back button (hidden on desktop where the sidebar is always visible) */}
      <div className="flex items-center gap-1 min-w-[50px] lg:hidden">
        <button
          onClick={onBack}
          className="w-11 h-11 rounded-lg flex items-center justify-center text-foreground hover:bg-muted active:bg-muted/80 transition-colors"
          aria-label="返回消息列表"
        >
          <ChevronLeft className="w-6 h-6" strokeWidth={2.5} />
        </button>
      </div>

      {/* Center: Title / Search */}
      <div className="flex-1 min-w-0 flex justify-center">
        {searchOpen ? (
          <div className="flex-1 flex items-center gap-2 px-1 min-w-0">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') onToggleSearch?.(); }}
              placeholder="搜索聊天记录"
              className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              aria-label="搜索聊天记录"
            />
            <button
              onClick={onToggleSearch}
              className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors flex-shrink-0"
              aria-label="关闭搜索"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : isDM && dmOtherUser ? (
          <div className="flex items-center gap-2 min-w-0">
            <Avatar name={dmOtherUser} avatar={dmOtherAvatar} size={32} />
            <div className="text-left min-w-0">
              <div className="text-[16px] font-semibold text-foreground truncate leading-tight">{dmOtherUser}</div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                {otherTyping
                  ? '对方正在输入…'
                  : (dmOtherUserId && globalOnlineIds.includes(dmOtherUserId))
                    ? '在线'
                    : '离线'}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center min-w-0">
            <div className="text-[16px] font-semibold text-foreground truncate">
              {roomName || '群聊'}
              {memberCount > 0 && (
                <span className="text-muted-foreground font-normal">（{memberCount}）</span>
              )}
            </div>
            {onlineUsers.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                {onlineUsers.length} 人在线
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Action buttons */}
      <div className="flex items-center gap-0.5 min-w-[50px] justify-end">
        {onToggleSearch && (
          <button
            onClick={onToggleSearch}
            className="w-11 h-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors"
            aria-label="搜索聊天记录"
          >
            <Search className="w-[18px] h-[18px]" />
          </button>
        )}
        <ThemeToggle />
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-11 h-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors"
            aria-label="更多操作"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
          {menuOpen && (
            <div className="absolute top-10 right-0 z-50 w-44 bg-card rounded-xl shadow-lg border border-border py-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
              {!isDM && onOpenMembers && (
                <button
                  onClick={() => { setMenuOpen(false); onOpenMembers(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted transition-colors text-left"
                >
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">群聊信息</span>
                </button>
              )}
              {onClearHistory && (
                <button
                  onClick={() => { setMenuOpen(false); onClearHistory(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted transition-colors text-left border-t border-border"
                >
                  <Eraser className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">清空聊天记录</span>
                </button>
              )}
              {onDeleteRoom && (
                <button
                  onClick={() => { setMenuOpen(false); onDeleteRoom(); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-destructive/10 transition-colors text-left ${!isDM || onClearHistory ? 'border-t border-border' : ''}`}
                >
                  <LogOut className="w-4 h-4 text-destructive" />
                  <span className="text-sm text-destructive">{isDM ? '删除私聊' : '退出群聊'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
});

ChatHeader.displayName = 'ChatHeader';

export default ChatHeader;
