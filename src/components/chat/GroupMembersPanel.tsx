'use client';

import React, { useState, useCallback } from 'react';
import { X, UserPlus, Crown, Loader2, LogOut, Trash2 } from 'lucide-react';
import Avatar from './Avatar';
import { RoomMember } from '@/types';
import { showError, showSuccess } from '@/utils/errorHandler';

interface GroupMembersPanelProps {
  roomId: string;
  roomName: string;
  /** 当前登录者的 Supabase Auth UUID（身份键；展示名一律用 RoomMember.display_name） */
  currentUserId: string;
  members: RoomMember[];
  loading: boolean;
  onlineNicknames: string[];
  onClose: () => void;
  onInvite: () => void;
  onRemove: (target: string) => Promise<{ success: boolean; message?: string }>;
  onSetRole: (target: string, role: 'owner' | 'admin' | 'member') => Promise<{ success: boolean; message?: string }>;
  onLeft: () => void;
}

const roleLabel: Record<string, string> = { owner: '群主', admin: '管理员', member: '' };

const GroupMembersPanel: React.FC<GroupMembersPanelProps> = ({
  roomName,
  currentUserId,
  members,
  loading,
  onlineNicknames,
  onClose,
  onInvite,
  onRemove,
  onSetRole,
  onLeft,
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const onlineSet = new Set(onlineNicknames);
  const myRole = members.find((m) => m.id === currentUserId)?.role ?? 'member';
  const isOwner = myRole === 'owner';

  const handleRemove = useCallback(async (targetId: string, targetName: string) => {
    if (!confirm(`确定将「${targetName}」移出群聊？`)) return;
    setBusy(targetId);
    try {
      const r = await onRemove(targetId);
      if (r.success) showSuccess('已移出群聊');
      else showError(r.message || '操作失败');
    } finally {
      setBusy(null);
    }
  }, [onRemove]);

  const handleTransfer = useCallback(async (targetId: string, targetName: string) => {
    if (!confirm(`确定把群主转让给「${targetName}」？转让后你将变为普通成员。`)) return;
    setBusy(targetId);
    try {
      const r = await onSetRole(targetId, 'owner');
      if (r.success) {
        await onSetRole(currentUserId, 'member');
        showSuccess('群主已转让');
      } else {
        showError(r.message || '转让失败');
      }
    } finally {
      setBusy(null);
    }
  }, [onSetRole, currentUserId]);

  const handleLeave = useCallback(async () => {
    if (!confirm('确定退出该群聊？')) return;
    setBusy(currentUserId);
    try {
      const r = await onRemove(currentUserId);
      if (r.success) {
        showSuccess('已退出群聊');
        onLeft();
      } else {
        showError(r.message || '退出失败');
      }
    } finally {
      setBusy(null);
    }
  }, [onRemove, currentUserId, onLeft]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] bg-card rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground truncate">群聊信息</h2>
            <p className="text-[12px] text-muted-foreground truncate">{roomName} · {members.length} 人</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="关闭">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-4">
              {members.map((m) => (
                <div key={m.id} className="flex flex-col items-center gap-1 relative group">
                  <div className="relative">
                    <Avatar name={m.display_name} avatar={m.avatar} size={48} />
                    {onlineSet.has(m.display_name) && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-card" />
                    )}
                    {m.role === 'owner' && (
                      <Crown className="absolute -top-2 -left-1 w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    )}
                  </div>
                  <span className="text-[11px] text-foreground truncate max-w-full">{m.display_name}</span>
                  {roleLabel[m.role] && (
                    <span className="text-[9px] text-muted-foreground -mt-1">{roleLabel[m.role]}</span>
                  )}

                  {/* 群主操作 */}
                  {isOwner && m.id !== currentUserId && (
                    <div className="absolute -top-1 -right-1 hidden group-hover:flex flex-col gap-1">
                      <button
                        onClick={() => handleRemove(m.id, m.display_name)}
                        disabled={busy === m.id}
                        className="w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center"
                        aria-label={`移出 ${m.display_name}`}
                      >
                        {busy === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={() => handleTransfer(m.id, m.display_name)}
                        disabled={busy === m.id}
                        className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center"
                        aria-label={`转让群主给 ${m.display_name}`}
                      >
                        <Crown className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* 邀请入口 */}
              <button
                onClick={onInvite}
                className="flex flex-col items-center gap-1"
                aria-label="邀请好友入群"
              >
                <span className="w-12 h-12 rounded-xl border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition-colors">
                  <UserPlus className="w-5 h-5" />
                </span>
                <span className="text-[11px] text-muted-foreground">邀请</span>
              </button>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex-shrink-0">
          <button
            onClick={handleLeave}
            disabled={busy === currentUserId}
            className="w-full h-10 rounded-xl text-destructive hover:bg-destructive/10 font-medium flex items-center justify-center gap-2 transition-colors"
          >
            {busy === currentUserId ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            退出群聊
          </button>
        </div>
      </div>
    </div>
  );
};

export default GroupMembersPanel;
