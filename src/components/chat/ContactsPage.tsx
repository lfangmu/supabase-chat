'use client';

import React, { useState, useCallback } from 'react';
import { UserPlus, Clock, X, ChevronRight, Users } from 'lucide-react';
import Avatar from './Avatar';

interface FriendItem {
  nickname: string;
  avatar: string | null;
  signature: string;
}

interface ContactsPageProps {
  friends: FriendItem[];
  incoming: { nickname: string; created_at: string }[];
  outgoing: { nickname: string; created_at: string }[];
  onlineNicknames: string[];
  onSelectFriend: (nickname: string) => void;
  onAddFriend: () => void;
  onAccept: (nickname: string) => void;
  onReject: (nickname: string) => void;
  /** 打开「群聊」列表（通讯录里的群聊入口） */
  onOpenGroups?: () => void;
  /** 群聊数量角标 */
  groupCount?: number;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
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
  onOpenGroups,
  groupCount = 0,
}) => {
  const [showNewFriends, setShowNewFriends] = useState(false);
  const onlineSet = new Set(onlineNicknames);
  const sorted = [...friends].sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh'));

  const NewFriendsPanel = useCallback(() => (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={() => setShowNewFriends(false)}>
      <div className="w-full max-w-lg max-h-[75vh] bg-card rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-base font-semibold text-foreground">新的朋友</h2>
          <button onClick={() => setShowNewFriends(false)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
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
            <div key={'in-' + r.nickname} className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
              <Avatar name={r.nickname} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-foreground">{r.nickname}</p>
                <p className="text-[11px] text-muted-foreground">{formatTime(r.created_at)} 申请添加你为好友</p>
              </div>
              <button onClick={() => onAccept(r.nickname)} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90">接受</button>
              <button onClick={() => onReject(r.nickname)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" aria-label="拒绝">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          {outgoing.map((r) => (
            <div key={'out-' + r.nickname} className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
              <Avatar name={r.nickname} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-foreground">{r.nickname}</p>
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
              const online = onlineSet.has(f.nickname);
              return (
                <button
                  key={f.nickname}
                  onClick={() => onSelectFriend(f.nickname)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                >
                  <div className="relative flex-shrink-0">
                    <Avatar name={f.nickname} avatar={f.avatar} size={44} />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${online ? 'bg-green-500' : 'bg-gray-400'}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-medium text-foreground truncate">{f.nickname}</p>
                    {f.signature && <p className="text-[12px] text-muted-foreground truncate">{f.signature}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showNewFriends && <NewFriendsPanel />}
    </div>
  );
};

export default ContactsPage;
