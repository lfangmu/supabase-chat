'use client';

import React, { useState, useCallback } from 'react';
import { X, UserPlus, Crown, Loader2, LogOut, Trash2, AlertTriangle } from 'lucide-react';
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
  /** 点击成员头像：打开个人资料卡 */
  onOpenProfile?: (member: { id: string; name: string }) => void;
}

const roleLabel: Record<string, string> = { owner: '群主', admin: '管理员', member: '' };

/**
 * 待确认的操作（P3 可访问性修复）。
 *
 * 此前三处操作都用阻塞式原生 `confirm()` —— 它会冻结主线程、无法被无障碍工具读取、
 * 在 PWA/WebView 里样式与文案不可控，且移动端 Safari 对其有节流限制。
 * 现在改为组件内自绘的确认弹层。
 */
interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  run: () => Promise<void>;
}

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
  onOpenProfile,
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const onlineSet = new Set(onlineNicknames);
  const myRole = members.find((m) => m.id === currentUserId)?.role ?? 'member';
  const isOwner = myRole === 'owner';

  const runConfirmed = useCallback(async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    try {
      await pendingConfirm.run();
    } finally {
      setConfirmBusy(false);
      setPendingConfirm(null);
    }
  }, [pendingConfirm]);

  const handleRemove = useCallback((targetId: string, targetName: string) => {
    setPendingConfirm({
      title: '移出群聊',
      message: `确定将「${targetName}」移出群聊？`,
      confirmLabel: '移出',
      destructive: true,
      run: async () => {
        setBusy(targetId);
        try {
          const r = await onRemove(targetId);
          if (r.success) showSuccess('已移出群聊');
          else showError(r.message || '操作失败');
        } finally {
          setBusy(null);
        }
      },
    });
  }, [onRemove]);

  const handleTransfer = useCallback((targetId: string, targetName: string) => {
    setPendingConfirm({
      title: '转让群主',
      message: `确定把群主转让给「${targetName}」？转让后你将变为普通成员。`,
      confirmLabel: '转让',
      run: async () => {
        setBusy(targetId);
        try {
          const r = await onSetRole(targetId, 'owner');
          if (r.success) {
            // 服务端已原子完成「旧群主降级 + 新群主上位」；这次调用是幂等的兼容兜底
            await onSetRole(currentUserId, 'member');
            showSuccess('群主已转让');
          } else {
            showError(r.message || '转让失败');
          }
        } finally {
          setBusy(null);
        }
      },
    });
  }, [onSetRole, currentUserId]);

  const handleLeave = useCallback(() => {
    setPendingConfirm({
      title: '退出群聊',
      message: '确定退出该群聊？',
      confirmLabel: '退出',
      destructive: true,
      run: async () => {
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
      },
    });
  }, [onRemove, currentUserId, onLeft]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] bg-card rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="群聊信息"
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
                    <Avatar
                      name={m.display_name}
                      avatar={m.avatar}
                      size={48}
                      onClick={onOpenProfile ? () => onOpenProfile({ id: m.id, name: m.display_name }) : undefined}
                    />
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

      {/* 自绘确认弹层（替代阻塞式原生 confirm()，见上方 PendingConfirm 注释） */}
      {pendingConfirm && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-6"
          onClick={(e) => {
            e.stopPropagation();
            if (!confirmBusy) setPendingConfirm(null);
          }}
        >
          <div
            className="w-full max-w-xs bg-card rounded-2xl p-5 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label={pendingConfirm.title}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle
                className={`w-5 h-5 flex-shrink-0 ${pendingConfirm.destructive ? 'text-destructive' : 'text-amber-500'}`}
              />
              <h3 className="text-sm font-semibold text-foreground">{pendingConfirm.title}</h3>
            </div>
            <p className="text-[13px] text-muted-foreground leading-relaxed">{pendingConfirm.message}</p>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setPendingConfirm(null)}
                disabled={confirmBusy}
                className="flex-1 h-9 rounded-xl bg-muted text-foreground text-sm font-medium disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={runConfirmed}
                disabled={confirmBusy}
                className={`flex-1 h-9 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60 ${
                  pendingConfirm.destructive ? 'bg-destructive' : 'bg-primary'
                }`}
              >
                {confirmBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {pendingConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupMembersPanel;
