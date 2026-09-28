'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, Reaction } from '@/types';
import { AlertCircle, SmilePlus } from 'lucide-react';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import Avatar from './Avatar';
import EmojiPicker from './EmojiPicker';
import { formatClock } from '@/utils/date-utils';
import TextMessage from './message-types/TextMessage';
import ImageMessage from './message-types/ImageMessage';
import VideoMessage from './message-types/VideoMessage';
import VoiceMessage from './message-types/VoiceMessage';
import FileMessage from './message-types/FileMessage';

/** 微信撤回时限：2 分钟 */
export const WITHDRAW_WINDOW_MS = 2 * 60 * 1000;

interface MessageItemProps {
  message: Message;
  user: string;
  /** 当前用户 UUID。自消息判定优先用它：展示名会被改名改掉，而历史消息里固化的
   *  是「改名前的旧名」，只比展示名会让改名后自己以前发的消息跑到对方那一侧。 */
  currentUserId?: string;
  onWithdraw: (id: string) => void;
  onRetry: (id: string) => void;
  onQuote?: (message: Message) => void;
  onEdit?: (id: string, newContent: string) => void;
  onDelete?: (id: string) => void;
  onForward?: (message: Message) => void;
  /** 1:1 私聊隐藏每条消息顶部的昵称+时间（群聊保留） */
  isDM?: boolean;
  /** 头像 URL（按昵称查表得到） */
  avatarUrl?: string | null;
  /** REQ-001: 该消息的表情回应聚合 */
  reactions?: Reaction[];
  /** 切换某条消息的某个 emoji 回应 */
  onToggleReaction?: (messageId: string, emoji: string) => void;
  /** 全局搜索跳转后被高亮定位（短暂强调） */
  highlight?: boolean;
}

const MessageItem: React.FC<MessageItemProps> = React.memo(({
  message,
  user,
  currentUserId,
  onWithdraw,
  onRetry,
  onQuote,
  onEdit,
  onDelete,
  onForward,
  isDM = false,
  avatarUrl = null,
  reactions = [],
  onToggleReaction,
  highlight = false,
}) => {
  // 身份判定以 UUID 为准（展示名可被改，历史消息里存的是旧名）；缺 userId 的老数据才退回比展示名
  const isSelf = currentUserId && message.userId ? message.userId === currentUserId : message.user === user;
  // 微信式：私聊不重复展示对方昵称与每条时间（群聊保留昵称）
  const showName = !isDM;
  const isFailed = message.sendStatus === 'failed';
  const resolvedContentUrl = useSignedUrl(
    message.type !== 'text' ? message.content : ''
  );
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const messageRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const handleWithdraw = () => {
    onWithdraw(message.id);
    setShowMenu(false);
  };

  const handleDelete = () => {
    onDelete?.(message.id);
    setShowMenu(false);
  };

  const handleForward = () => {
    onForward?.(message);
    setShowMenu(false);
  };

  const handleQuote = () => {
    if (onQuote) {
      onQuote(message);
    }
    setShowMenu(false);
  };

  const handleStartEdit = () => {
    setEditContent(message.content);
    setIsEditing(true);
    setShowMenu(false);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const handleSaveEdit = () => {
    const trimmed = editContent.trim();
    if (trimmed && trimmed !== message.content && onEdit) {
      onEdit(message.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditContent(message.content);
    setIsEditing(false);
  };

  const handleLongPress = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    if (messageRef.current) {
      const rect = messageRef.current.getBoundingClientRect();
      let menuX = rect.left + rect.width / 2;
      let menuY = rect.top;

      const estimatedMenuWidth = 320;
      const estimatedMenuHeight = 40;
      const windowWidth = window.innerWidth;

      if (menuX - estimatedMenuWidth / 2 < 0) {
        menuX = estimatedMenuWidth / 2;
      } else if (menuX + estimatedMenuWidth / 2 > windowWidth) {
        menuX = windowWidth - estimatedMenuWidth / 2;
      }

      if (menuY - estimatedMenuHeight < 60) {
        menuY = rect.bottom;
      } else {
        menuY = rect.top - estimatedMenuHeight;
      }

      setMenuPosition({ x: menuX, y: menuY });
      setShowMenu(true);
    }
  }, []);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearLongPressTimer();
  }, [clearLongPressTimer]);

  // Click outside to close menu + keyboard support
  useEffect(() => {
    if (!showMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMenu(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showMenu]);

  // === 已撤回：渲染成微信式居中系统提示，不再展示原内容 ===
  if (message.withdrawn_at) {
    return (
      <div className="flex justify-center my-2 animate-fadeIn">
        <span className="px-2.5 py-1 rounded-md bg-muted/70 text-[11px] text-muted-foreground">
          {isSelf ? '你撤回了一条消息' : `${message.user} 撤回了一条消息`}
        </span>
      </div>
    );
  }

  // 撤回时限：超过 2 分钟不再提供撤回入口（服务端也会二次校验）
  const withinWithdrawWindow =
    Date.now() - new Date(message.timestamp).getTime() < WITHDRAW_WINDOW_MS;

  const renderQuote = () => {
    if (!message.quote) return null;
    return (
      <div className={`mb-1 px-2 py-1.5 rounded-lg border-l-2 ${
        isSelf
          ? 'bg-black/10 border-black/20'
          : 'bg-muted border-border'
      }`}>
        <div className={`text-xs font-medium ${isSelf ? 'text-[#1f1f1f] dark:text-white' : 'text-muted-foreground'}`}>
          {message.quote.user}
        </div>
        <div className="text-xs text-foreground/70 truncate">
          {message.quote.type === 'text'
            ? message.quote.content
            : `[${message.quote.type === 'image' ? '图片' : message.quote.type === 'video' ? '视频' : message.quote.type === 'file' ? '文件' : '语音'}]`}
        </div>
      </div>
    );
  };

  const renderMessageContent = () => {
    switch (message.type) {
      case 'image':
        return <ImageMessage message={message} isSelf={isSelf} />;
      case 'video':
        return <VideoMessage message={message} isSelf={isSelf} />;
      case 'voice':
        return <VoiceMessage message={message} isSelf={isSelf} />;
      case 'file':
        return <FileMessage message={message} isSelf={isSelf} />;
      case 'text':
        return <TextMessage message={message} isSelf={isSelf} />;
      default:
        return null;
    }
  };

  return (
    <div className={`flex ${isSelf ? 'justify-end' : 'justify-start'} animate-fadeIn mb-2`}>
      <div className={`flex ${isSelf ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
        {/* Avatar */}
        <Avatar name={message.user} avatar={avatarUrl} size={36} className="ring-1 ring-border" />

        {/* Message content */}
        <div className={`flex flex-col gap-1 ${isFailed ? 'opacity-60' : ''}`} style={{ maxWidth: '70%', width: '100%' }}>
          {/* Username and time (group chats only) */}
          {showName && (
          <div className={`flex items-center gap-2 ${isSelf ? 'justify-end' : 'justify-start'}`}>
            <span className={`text-xs font-medium ${isSelf ? 'text-muted-foreground' : 'text-foreground/80'}`}>
              {message.user}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatClock(new Date(message.timestamp))}
            </span>
            {message.forwardedFrom && (
              <span className="text-[10px] text-primary/70 border border-primary/30 rounded px-1 leading-tight">
                转发
              </span>
            )}
          </div>
          )}

          {/* Message bubble */}
          {isEditing ? (
            <div className="flex flex-col gap-1.5 w-full" style={{ maxWidth: '100%' }}>
              <textarea
                ref={editInputRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                  if (e.key === 'Escape') handleCancelEdit();
                }}
                className="w-full px-3 py-2 text-sm border border-primary rounded-xl bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                rows={Math.min(editContent.split('\n').length, 6)}
                style={{ minHeight: '40px' }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">Esc 取消 · Enter 保存</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={handleCancelEdit}
                    className="px-2.5 py-1 text-xs rounded-lg bg-secondary text-foreground hover:opacity-80 whitespace-nowrap"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={!editContent.trim() || editContent.trim() === message.content}
                    className="px-2.5 py-1 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              ref={messageRef}
              className={`relative ${highlight ? 'rounded-xl ring-2 ring-primary bg-primary/10 transition-colors duration-300' : ''}`}
              style={{ wordBreak: 'break-all', overflowWrap: 'break-word', whiteSpace: 'normal', width: '100%' }}
              onContextMenu={(e) => {
                e.preventDefault();
                handleLongPress(e);
              }}
              onMouseDown={(e) => {
                clearLongPressTimer();
                longPressTimerRef.current = setTimeout(() => handleLongPress(e), 500);
                const clear = () => {
                  clearLongPressTimer();
                  document.removeEventListener('mouseup', clear);
                  document.removeEventListener('mouseleave', clear);
                };
                document.addEventListener('mouseup', clear, { once: true });
                document.addEventListener('mouseleave', clear, { once: true });
              }}
              onTouchStart={(e) => {
                clearLongPressTimer();
                longPressTimerRef.current = setTimeout(() => handleLongPress(e), 500);
                const clear = () => {
                  clearLongPressTimer();
                  document.removeEventListener('touchend', clear);
                };
                document.addEventListener('touchend', clear, { once: true });
              }}
            >
              {renderQuote()}
              {renderMessageContent()}
              {/* REQ-001: 添加表情回应弹层 */}
              {showEmojiPicker && (
                <div
                  className="absolute z-50 mt-1"
                  style={{ top: '100%', [isSelf ? 'right' : 'left']: 0 } as React.CSSProperties}
                >
                  <EmojiPicker
                    onSelect={(emoji) => {
                      onToggleReaction?.(message.id, emoji);
                      setShowEmojiPicker(false);
                    }}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                </div>
              )}
            </div>
          )}

          {/* REQ-001: 表情回应聚合气泡 */}
          {reactions.length > 0 && (
            <div className={`flex flex-wrap gap-1 ${isSelf ? 'justify-end' : 'justify-start'}`}>
              {(() => {
                const groups = new Map<string, Reaction[]>();
                for (const r of reactions) {
                  const list = groups.get(r.emoji);
                  if (list) list.push(r);
                  else groups.set(r.emoji, [r]);
                }
                return Array.from(groups.entries()).map(([emoji, list]) => {
                  const mine = list.some((r) =>
                    currentUserId && r.userId ? r.userId === currentUserId : r.user === user
                  );
                  return (
                    <button
                      key={emoji}
                      onClick={() => onToggleReaction?.(message.id, emoji)}
                      aria-label={`${emoji} 回应，共 ${list.length} 人`}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                        mine ? 'bg-primary/15 border-primary text-foreground' : 'bg-muted border-border text-foreground/80'
                      }`}
                    >
                      <span className="text-sm leading-none">{emoji}</span>
                      <span>{list.length}</span>
                    </button>
                  );
                });
              })()}
            </div>
          )}

          {/* 私聊已读回执：仅自己发出的、已送达且被对方读过的消息展示 */}
          {isDM && isSelf && !isFailed && message.sendStatus !== 'sending' && (
            <span
              className={`self-end text-[10px] leading-none ${
                message.readByOther ? 'text-muted-foreground' : 'text-primary/70'
              }`}
            >
              {message.readByOther ? '已读' : '未读'}
            </span>
          )}

          {/* Failed message retry indicator */}
          {isFailed && isSelf && (
            <button
              className={`flex items-center gap-1.5 text-sm text-destructive bg-destructive/10 hover:bg-destructive/20 active:scale-95 rounded-lg px-3 py-1.5 mt-1 transition-all ${
                isSelf ? 'self-end' : 'self-start'
              }`}
              onClick={() => onRetry(message.id)}
              aria-label="消息发送失败，点击重试"
            >
              <AlertCircle className="w-4 h-4" />
              <span>发送失败，点击重试</span>
            </button>
          )}
        </div>
      </div>

      {/* Context menu */}
      {showMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-popover text-popover-foreground shadow-xl rounded-full border border-border py-2 px-4 flex items-center gap-3 whitespace-nowrap"
          style={{
            left: `${menuPosition.x}px`,
            top: `${menuPosition.y}px`,
            transform: 'translateX(-50%)',
          }}
          role="menu"
          aria-label="消息操作菜单"
        >
          <button
            className="px-3 py-1 text-sm text-foreground hover:bg-muted rounded-full cursor-pointer transition-colors"
            onClick={handleQuote}
            role="menuitem"
          >
            引用
          </button>
          <button
            className="px-3 py-1 text-sm text-foreground hover:bg-muted rounded-full cursor-pointer transition-colors flex items-center gap-1"
            onClick={() => {
              setShowEmojiPicker(true);
              setShowMenu(false);
            }}
            role="menuitem"
          >
            <SmilePlus className="w-3.5 h-3.5" />
            添加回应
          </button>
          {message.type === 'text' && (
            <button
              className="px-3 py-1 text-sm text-foreground hover:bg-muted rounded-full cursor-pointer transition-colors"
              onClick={() => {
                navigator.clipboard.writeText(message.content).catch(() => {});
                setShowMenu(false);
              }}
              role="menuitem"
            >
              复制
            </button>
          )}
          {message.type !== 'text' && (
            <button
              className="px-3 py-1 text-sm text-foreground hover:bg-muted rounded-full cursor-pointer transition-colors"
              onClick={async () => {
                if (!resolvedContentUrl) return;
                const isImage = message.type === 'image';
                // 文件名：优先用原始文件名，否则兜底
                const safeName =
                  message.file_name && message.file_name.trim()
                    ? message.file_name.trim()
                    : isImage
                    ? `image-${Date.now()}.jpg`
                    : `file-${Date.now()}`;
                try {
                  const response = await fetch(resolvedContentUrl);
                  const blob = await response.blob();
                  const blobUrl = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = blobUrl;
                  link.download = safeName;
                  document.body.appendChild(link);
                  link.click();
                  setTimeout(() => {
                    document.body.removeChild(link);
                    URL.revokeObjectURL(blobUrl);
                  }, 100);
                } catch {
                  // 跨域或被拦截时退化为直接下载（依赖浏览器对 Content-Disposition 的处理）
                  const link = document.createElement('a');
                  link.href = resolvedContentUrl;
                  link.download = safeName;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }
                setShowMenu(false);
              }}
              role="menuitem"
            >
              {message.type === 'image' ? '保存图片' : '保存文件'}
            </button>
          )}
          {onForward && (
            <button
              className="px-3 py-1 text-sm text-foreground hover:bg-muted rounded-full cursor-pointer transition-colors"
              onClick={handleForward}
              role="menuitem"
            >
              转发
            </button>
          )}
          {isSelf && message.type === 'text' && (
            <button
              className="px-3 py-1 text-sm text-foreground hover:bg-muted rounded-full cursor-pointer transition-colors"
              onClick={handleStartEdit}
              role="menuitem"
            >
              编辑
            </button>
          )}
          {isSelf && withinWithdrawWindow && (
            <button
              className="px-3 py-1 text-sm text-foreground hover:bg-muted rounded-full cursor-pointer transition-colors"
              onClick={handleWithdraw}
              role="menuitem"
            >
              撤回
            </button>
          )}
          {isSelf && onDelete && (
            <button
              className="px-3 py-1 text-sm text-destructive hover:bg-destructive/10 rounded-full cursor-pointer transition-colors"
              onClick={handleDelete}
              role="menuitem"
            >
              删除
            </button>
          )}
        </div>
      )}
    </div>
  );
});

MessageItem.displayName = 'MessageItem';

export default MessageItem;
