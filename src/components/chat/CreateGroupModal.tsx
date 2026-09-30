'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { X, Search, Check, Loader2, Users } from 'lucide-react';
import Avatar from './Avatar';
import { createGroup } from '@/hooks/useRoomMembers';
import { showError, showSuccess } from '@/utils/errorHandler';

interface FriendItem {
  /** 用户 UUID（身份） */
  id: string;
  /** 展示名 */
  display_name: string;
  avatar: string | null;
  signature: string;
}

/** 服务端 rooms.name 上限（/api/rooms/members 校验 name.length > 50 直接 400） */
const MAX_GROUP_NAME = 50;

interface CreateGroupModalProps {
  /** 当前用户的 Supabase Auth UUID */
  currentUserId: string;
  /** 当前用户的展示名（用于拼默认群名，绝不能用 UUID） */
  currentUserName?: string;
  friends: FriendItem[];
  /** 已有群时传入 → 变成「邀请成员」模式 */
  mode?: 'create' | 'invite';
  /** 已在群里的成员 UUID */
  existingMembers?: string[];
  onClose: () => void;
  onCreated: (roomId: string) => void;
  /** 入参为被邀请成员的 UUID */
  onInvite?: (userIds: string[]) => Promise<void>;
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  currentUserId,
  currentUserName,
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
      .filter((f) => f.id !== currentUserId)
      .filter((f) => (mode === 'invite' ? !existing.has(f.id) : true))
      .filter((f) => !k || f.display_name.toLowerCase().includes(k))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'zh'));
  }, [friends, keyword, currentUserId, mode, existing]);

  const toggle = useCallback((userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  /** UUID → 展示名（好友表里查；查不到返回空串，绝不用 UUID 兜底） */
  const nameOf = useCallback(
    (id: string) => friends.find((f) => f.id === id)?.display_name?.trim() || '',
    [friends]
  );

  /**
   * 默认群名：我 + 已选好友的「展示名」，最多取 3 个，超出加「等」。
   * 注意两点：
   *  1. 必须用展示名——历史实现用的是 UUID，3 个 UUID 拼起来 110 字，
   *     直接撞上服务端 name.length > 50 的校验，建群报「群名不合法」。
   *  2. 名字本身可能很长，最终再按 50 字截断，保证一定能通过校验。
   */
  const defaultName = useMemo(() => {
    const names = [currentUserName?.trim() || '', ...Array.from(selected).map(nameOf)].filter(Boolean);
    if (names.length === 0) return '群聊';
    let base = names.slice(0, 3).join('、');
    if (names.length > 3) base += '等';
    return base.length > MAX_GROUP_NAME ? base.slice(0, MAX_GROUP_NAME - 1) + '…' : base;
  }, [currentUserName, selected, nameOf]);

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
      const name = (groupName.trim() || defaultName).slice(0, MAX_GROUP_NAME);
      const json = await createGroup(name, currentUserId, Array.from(selected));
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
  }, [selected, mode, onInvite, onClose, groupName, defaultName, currentUserId, onCreated]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg h-[85vh] sm:h-[70vh] bg-card rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="创建群聊"
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
                <Avatar name={nameOf(n) || '好友'} size={18} rounded="full" />
                {nameOf(n) || '好友'}
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
              const on = selected.has(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() => toggle(f.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                >
                  <span
                    className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${
                      on ? 'bg-primary border-primary' : 'border-border'
                    }`}
                  >
                    {on && <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3} />}
                  </span>
                  <Avatar name={f.display_name} avatar={f.avatar} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] text-foreground truncate">{f.display_name}</p>
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
