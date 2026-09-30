'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, UserPlus, MessageCircle, Check, Loader2, Clock } from 'lucide-react';
import Avatar from './Avatar';
import { UserProfile } from '@/types';
import { formatRelativeTime } from '@/utils/labels';
import { showError } from '@/utils/errorHandler';

interface UserProfileCardProps {
  /** 目标用户 UUID（身份） */
  userId: string;
  /** 立即渲染用的展示名（资料拉回前先显示，避免空白） */
  initialName?: string;
  /** 立即渲染用的头像 */
  initialAvatar?: string | null;
  /** 是否是自己 */
  isSelf: boolean;
  /** 已是好友 */
  isFriend: boolean;
  /** 我发出的申请仍待对方通过 */
  outgoingPending: boolean;
  /** 对方发来的申请仍待我处理 */
  incomingPending: boolean;
  onClose: () => void;
  /** 发送好友申请（「添加到通讯录」） */
  onSendRequest: (userId: string) => Promise<{ success?: boolean; message?: string } | void>;
  /** 接受对方发来的好友申请 */
  onAccept: (userId: string) => Promise<{ success?: boolean; message?: string } | void>;
  /** 发消息（打开与该用户的私聊） */
  onStartDM: (userId: string) => void;
  /** 自己：跳到「我」页编辑资料 */
  onEditSelf?: () => void;
}

/**
 * 微信式「个人资料卡」。
 *
 * 点击聊天里任意头像弹出：展示头像/昵称/签名/最近活跃，并按关系给出一个主操作：
 *   - 自己        → 编辑资料
 *   - 已是好友    → 发消息
 *   - 对方已申请我 → 接受好友申请
 *   - 我已申请对方 → 等待验证（禁用）
 *   - 其他        → 添加到通讯录（发好友申请）
 */
const UserProfileCard: React.FC<UserProfileCardProps> = ({
  userId,
  initialName = '',
  initialAvatar = null,
  isSelf,
  isFriend,
  outgoingPending,
  incomingPending,
  onClose,
  onSendRequest,
  onAccept,
  onStartDM,
  onEditSelf,
}) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // 本卡内的乐观关系状态：点了「添加」/「接受」后立即切换按钮，不等父级刷新
  const [sent, setSent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const aliveRef = useRef(true);

  // 拉取权威资料（展示名/头像/签名/最近活跃）
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/users?user=${encodeURIComponent(userId)}`);
        const json = await res.json();
        if (!cancelled && json?.success && json.user) setProfile(json.user as UserProfile);
      } catch {
        /* 拉不到就用传入的 initialName/initialAvatar 兜底 */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      aliveRef.current = false;
    };
  }, [userId]);

  // Escape 关闭 + 锁定背景滚动
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const name = profile?.display_name || initialName || '未知用户';
  const avatar = profile?.avatar ?? initialAvatar;
  const signature = profile?.signature || '';

  const handleAdd = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await onSendRequest(userId);
      if (r && r.success === false) {
        showError(r.message || '发送申请失败');
      } else {
        setSent(true);
      }
    } catch {
      showError('网络错误，请稍后重试');
    } finally {
      setBusy(false);
    }
  }, [busy, onSendRequest, userId]);

  const handleAccept = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await onAccept(userId);
      if (r && r.success === false) {
        showError(r.message || '接受失败');
      } else {
        setAccepted(true);
      }
    } catch {
      showError('网络错误，请稍后重试');
    } finally {
      setBusy(false);
    }
  }, [busy, onAccept, userId]);

  const friend = isFriend || accepted;
  const pending = outgoingPending || sent;

  /** 主操作按钮（微信名片只有一个主按钮） */
  const renderAction = () => {
    if (isSelf) {
      if (!onEditSelf) return null;
      return (
        <button
          onClick={onEditSelf}
          className="w-full h-11 rounded-xl bg-muted text-foreground text-[15px] font-medium hover:opacity-90 transition-opacity"
        >
          编辑资料
        </button>
      );
    }
    if (friend) {
      return (
        <button
          onClick={() => onStartDM(userId)}
          className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-[15px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          <MessageCircle className="w-4 h-4" />
          发消息
        </button>
      );
    }
    if (incomingPending) {
      return (
        <button
          onClick={handleAccept}
          disabled={busy}
          className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-[15px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          接受好友申请
        </button>
      );
    }
    if (pending) {
      return (
        <button
          disabled
          className="w-full h-11 rounded-xl bg-muted text-muted-foreground text-[15px] font-medium flex items-center justify-center gap-2 cursor-not-allowed"
        >
          <Clock className="w-4 h-4" />
          等待验证
        </button>
      );
    }
    return (
      <button
        onClick={handleAdd}
        disabled={busy}
        className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-[15px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
        添加到通讯录
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-card rounded-t-2xl sm:rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} 的资料`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">个人资料</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="关闭"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-6 flex flex-col items-center text-center">
          <Avatar name={name} avatar={avatar} size={72} rounded="xl" />
          <h3 className="mt-3 text-lg font-semibold text-foreground max-w-full truncate">{name}</h3>
          {signature ? (
            <p className="mt-1 text-[13px] text-muted-foreground max-w-full break-words">{signature}</p>
          ) : (
            <p className="mt-1 text-[13px] text-muted-foreground/70">这个人很懒，什么都没留下</p>
          )}
          <p className="mt-3 text-[12px] text-muted-foreground">
            {loading && !profile
              ? '资料加载中…'
              : profile?.last_active_at
              ? `最近活跃：${formatRelativeTime(profile.last_active_at)}`
              : isSelf
              ? '这是你'
              : '已注册用户'}
          </p>
        </div>

        {/* Action */}
        <div className="px-5 pb-5">{renderAction()}</div>
      </div>
    </div>
  );
};

export default UserProfileCard;
