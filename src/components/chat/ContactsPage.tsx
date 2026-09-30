'use client';

import React, { useState, useCallback } from 'react';
import { UserPlus, Clock, X, ChevronRight, Users, MoreHorizontal, Trash2, Loader2, MessageCircle } from 'lucide-react';
import Avatar from './Avatar';
import { formatRelativeTime } from '@/utils/labels';

interface FriendItem {
  /** 用户 UUID（身份） */
  id: string;
  /** 展示名 */
  display_name: string;
  avatar: string | null;
  signature: string;
}

interface RequestItem {
  /** 用户 UUID（身份） */
  id: string;
  /** 展示名 */
  display_name: string;
  created_at: string;
}

interface ContactsPageProps {
  friends: FriendItem[];
  incoming: RequestItem[];
  outgoing: RequestItem[];
  /** 在线用户的展示名（presence 以展示名为标识） */
  onlineNicknames: string[];
  /** 入参为好友 UUID */
  onSelectFriend: (userId: string) => void;
  onAddFriend: () => void;
  /** 入参为对方 UUID */
  onAccept: (userId: string) => void;
  onReject: (userId: string) => void;
  /** 删除好友（入参为对方 UUID）；不传则不显示删除入口 */
  onRemoveFriend?: (userId: string) => Promise<void> | void;
  /** 打开「群聊」列表（通讯录里的群聊入口） */
  onOpenGroups?: () => void;
  /** 群聊数量角标 */
  groupCount?: number;
}

// P3：相对时间格式化改为调用共享实现（此前与 AddFriendModal 各抄一份）
function formatTime(ts: string): string {
  return formatRelativeTime(ts);
}

const ContactsPage: React.FC<ContactsPageProps> = ({
  friends,
  incoming,
  outgoing,
  onlineNicknames,
  onSelectFriend,
  onAddFriend,
  onAccept,
  onReject,
  onRemoveFriend,
  onOpenGroups,
  groupCount = 0,
}) => {
  const [showNewFriends, setShowNewFriends] = useState(false);
  // 好友操作面板（「⋯」触发）：发消息 / 删除好友
  const [menuFor, setMenuFor] = useState<FriendItem | null>(null);
  // 删除二次确认（破坏性操作，必须确认）
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const onlineSet = new Set(onlineNicknames);
  const sorted = [...friends].sort((a, b) => a.display_name.localeCompare(b.display_name, 'zh'));

  const closeMenu = useCallback(() => {
    setMenuFor(null);
    setConfirming(false);
  }, []);

  const handleRemove = useCallback(async () => {
    if (!menuFor) return;
    setRemoving(true);
    try {
      await onRemoveFriend?.(menuFor.id);
    } finally {
      setRemoving(false);
      closeMenu();
    }
  }, [menuFor, onRemoveFriend, closeMenu]);

  const NewFriendsPanel = useCallback(() => (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={() => setShowNewFriends(false)}>
      <div className="w-full max-w-lg max-h-[75vh] bg-card rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-base font-semibold text-foreground">新的朋友</h2>
          <button
            onClick={() => setShowNewFriends(false)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="关闭新的朋友"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {incoming.length === 0 && outgoing.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <Clock className="w-10 h-10 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">暂无好友申请</p>
            </div>
          )}
          {incoming.map((r) => (
            <div key={'in-' + r.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
              <Avatar name={r.display_name} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-foreground">{r.display_name}</p>
                <p className="text-[11px] text-muted-foreground">{formatTime(r.created_at)} 申请添加你为好友</p>
              </div>
              <button onClick={() => onAccept(r.id)} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90">接受</button>
              <button onClick={() => onReject(r.id)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" aria-label="拒绝">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          {outgoing.map((r) => (
            <div key={'out-' + r.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
              <Avatar name={r.display_name} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-foreground">{r.display_name}</p>
                <p className="text-[11px] text-muted-foreground">{formatTime(r.created_at)} 已发送申请</p>
              </div>
              <span className="text-xs text-muted-foreground">等待验证</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  ), [incoming, outgoing, onAccept, onReject]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 新的朋友 + 添加好友入口 */}
      <div className="px-3 py-2 border-b border-border bg-card flex-shrink-0">
        <button
          onClick={() => setShowNewFriends(true)}
          className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-muted transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-500 flex items-center justify-center text-white flex-shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <span className="flex-1 text-left text-[15px] text-foreground">新的朋友</span>
          {incoming.length > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-medium flex items-center justify-center">
              {incoming.length}
            </span>
          )}
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
        {onOpenGroups && (
          <button
            onClick={onOpenGroups}
            className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center text-white flex-shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <span className="flex-1 text-left text-[15px] text-foreground">群聊</span>
            {groupCount > 0 && (
              <span className="text-xs text-muted-foreground">{groupCount}</span>
            )}
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={onAddFriend}
          className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-muted transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-primary-foreground flex-shrink-0">
            <UserPlus className="w-5 h-5" />
          </div>
          <span className="flex-1 text-left text-[15px] text-foreground">添加朋友</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* 好友列表 */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <UserPlus className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">你还没有好友</p>
            <p className="text-xs text-muted-foreground mt-1">点击上方「添加朋友」搜索昵称发起私聊</p>
          </div>
        ) : (
          <div className="py-1">
            <div className="px-4 py-1.5 text-[12px] font-medium text-muted-foreground">好友（{sorted.length}）</div>
            {sorted.map((f) => {
              const online = onlineSet.has(f.display_name);
              return (
                <div key={f.id} className="flex items-center pr-2 hover:bg-muted transition-colors">
                  <button
                    onClick={() => onSelectFriend(f.id)}
                    className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2.5 text-left"
                  >
                    <div className="relative flex-shrink-0">
                      <Avatar name={f.display_name} avatar={f.avatar} size={44} />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${online ? 'bg-green-500' : 'bg-gray-400'}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-medium text-foreground truncate">{f.display_name}</p>
                      {f.signature && <p className="text-[12px] text-muted-foreground truncate">{f.signature}</p>}
                    </div>
                  </button>
                  {onRemoveFriend && (
                    <button
                      onClick={() => setMenuFor(f)}
                      aria-label={`更多操作：${f.display_name}`}
                      className="flex-shrink-0 p-2 rounded-lg text-muted-foreground hover:bg-muted-foreground/10 transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 好友操作面板：发消息 / 删除好友 */}
      {menuFor && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
          onClick={closeMenu}
        >
          <div
            className="w-full max-w-lg bg-card rounded-t-2xl sm:rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Avatar name={menuFor.display_name} avatar={menuFor.avatar} size={40} />
              <p className="flex-1 min-w-0 text-[15px] font-medium text-foreground truncate">{menuFor.display_name}</p>
            </div>
            {!confirming ? (
              <div className="py-1">
                <button
                  onClick={() => {
                    const id = menuFor.id;
                    closeMenu();
                    onSelectFriend(id);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-[15px] text-foreground hover:bg-muted transition-colors"
                >
                  <MessageCircle className="w-4 h-4 text-muted-foreground" />
                  发消息
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-[15px] text-red-500 hover:bg-muted transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  删除好友
                </button>
                <button
                  onClick={closeMenu}
                  className="w-full px-4 py-3 text-[15px] text-muted-foreground hover:bg-muted transition-colors border-t border-border"
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="px-4 py-4">
                <p className="text-sm text-foreground">确定删除好友「{menuFor.display_name}」？</p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  删除后对方会从你的好友列表消失，聊天记录仍保留在本机。若对方再发消息，需要重新添加好友。
                </p>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => setConfirming(false)}
                    className="flex-1 h-10 rounded-xl bg-muted text-foreground text-sm font-medium"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleRemove}
                    disabled={removing}
                    className="flex-1 h-10 rounded-xl bg-red-500 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {removing && <Loader2 className="w-4 h-4 animate-spin" />}
                    删除
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showNewFriends && <NewFriendsPanel />}
    </div>
  );
};

export default ContactsPage;
