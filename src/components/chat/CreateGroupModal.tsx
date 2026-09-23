'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { X, Search, Check, Loader2, Users } from 'lucide-react';
import Avatar from './Avatar';
import { createGroup } from '@/hooks/useRoomMembers';
import { showError, showSuccess } from '@/utils/errorHandler';

interface FriendItem {
  nickname: string;
  avatar: string | null;
  signature: string;
}

interface CreateGroupModalProps {
  currentUser: string;
  friends: FriendItem[];
  /** 已有群时传入 → 变成「邀请成员」模式 */
  mode?: 'create' | 'invite';
  existingMembers?: string[];
  onClose: () => void;
  onCreated: (roomId: string) => void;
  onInvite?: (nicknames: string[]) => Promise<void>;
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  currentUser,
  friends,
  mode = 'create',
  existingMembers = [],
  onClose,
  onCreated,
  onInvite,
}) => {
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const existing = useMemo(() => new Set(existingMembers), [existingMembers]);

  const list = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return friends
      .filter((f) => f.nickname !== currentUser)
      .filter((f) => (mode === 'invite' ? !existing.has(f.nickname) : true))
      .filter((f) => !k || f.nickname.toLowerCase().includes(k))
      .sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh'));
  }, [friends, keyword, currentUser, mode, existing]);

  const toggle = useCallback((nickname: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nickname)) next.delete(nickname);
      else next.add(nickname);
      return next;
    });
  }, []);

  const defaultName = useMemo(() => {
    const names = [currentUser, ...Array.from(selected)].slice(0, 3);
    return names.join('、') + (selected.size + 1 > 3 ? '等' : '');
  }, [currentUser, selected]);

  const handleSubmit = useCallback(async () => {
    if (selected.size === 0) {
      showError(mode === 'create' ? '请至少选择 1 位好友' : '请选择要邀请的好友');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'invite') {
        await onInvite?.(Array.from(selected));
        showSuccess('已邀请入群');
        onClose();
        return;
      }
      const name = groupName.trim() || defaultName;
      const json = await createGroup(name, currentUser, Array.from(selected));
      if (json.success && json.roomId) {
        showSuccess('群聊创建成功');
        onCreated(json.roomId);
        onClose();
      } else {
        showError(json.message || '创建群聊失败');
      }
    } catch {
      showError('创建群聊失败');
    } finally {
      setSubmitting(false);
    }
  }, [selected, mode, onInvite, onClose, groupName, defaultName, currentUser, onCreated]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg h-[85vh] sm:h-[70vh] bg-card rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-base font-semibold text-foreground">
            {mode === 'create' ? '发起群聊' : '邀请好友入群'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="关闭">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* 群名（仅建群） */}
        {mode === 'create' && (
          <div className="px-4 pt-3 flex-shrink-0">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={50}
              placeholder={`群聊名称（默认「${defaultName}」）`}
              className="w-full h-10 px-3 rounded-xl border border-input bg-background text-foreground text-sm outline-none focus:border-primary"
            />
          </div>
        )}

        {/* 搜索 */}
        <div className="px-4 py-3 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索好友"
              className="w-full h-9 pl-9 pr-3 rounded-xl bg-muted text-foreground text-sm outline-none"
            />
          </div>
        </div>

        {/* 已选 chips */}
        {selected.size > 0 && (
          <div className="px-4 pb-2 flex gap-2 overflow-x-auto flex-shrink-0">
            {Array.from(selected).map((n) => (
              <button
                key={n}
                onClick={() => toggle(n)}
                className="flex-shrink-0 flex items-center gap-1 pl-1 pr-2 py-1 rounded-full bg-primary/10 text-primary text-xs"
              >
                <Avatar name={n} size={18} rounded="full" />
                {n}
                <X className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}

        {/* 好友列表 */}
        <div className="flex-1 overflow-y-auto">
          {list.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <Users className="w-10 h-10 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {friends.length === 0 ? '你还没有好友，先去添加朋友吧' : '没有匹配的好友'}
              </p>
            </div>
          ) : (
            list.map((f) => {
              const on = selected.has(f.nickname);
              return (
                <button
                  key={f.nickname}
                  onClick={() => toggle(f.nickname)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                >
                  <span
                    className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${
                      on ? 'bg-primary border-primary' : 'border-border'
                    }`}
                  >
                    {on && <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3} />}
                  </span>
                  <Avatar name={f.nickname} avatar={f.avatar} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] text-foreground truncate">{f.nickname}</p>
                    {f.signature && <p className="text-[12px] text-muted-foreground truncate">{f.signature}</p>}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* 底部提交 */}
        <div className="px-4 py-3 border-t border-border flex-shrink-0">
          <button
            onClick={handleSubmit}
            disabled={submitting || selected.size === 0}
            className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'create' ? `创建群聊${selected.size > 0 ? `（${selected.size + 1}）` : ''}` : `邀请（${selected.size}）`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateGroupModal;
