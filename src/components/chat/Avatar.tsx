'use client';

import React from 'react';
import { useSignedUrl } from '@/hooks/useSignedUrl';

/** 由字符串生成稳定颜色（用于无头像时的色块） */
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
    '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
  ];
  return colors[Math.abs(hash) % colors.length] ?? '#3b82f6';
}

interface AvatarProps {
  name: string;
  avatar?: string | null;
  size?: number;
  className?: string;
  rounded?: 'lg' | 'xl' | 'full';
  /** 点击头像回调（如打开个人资料卡）。提供后头像变为可点击/可聚焦。 */
  onClick?: () => void;
  /** 可点击时的无障碍标签与悬停提示（默认「查看 <name> 的资料」） */
  title?: string;
}

/** 统一头像组件：有头像图显示图，否则显示昵称首字母色块（微信绿/中性风格） */
const Avatar: React.FC<AvatarProps> = ({
  name,
  avatar,
  size = 40,
  className = '',
  rounded = 'lg',
  onClick,
  title,
}) => {
  const radius = rounded === 'full' ? '9999px' : rounded === 'xl' ? '10px' : '6px';
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  // 头像可能是 Supabase Storage 路径，需要换签名 URL；完整 http(s) 链接原样返回
  const resolved = useSignedUrl(avatar || '');

  // 可点击时附加交互语义：鼠标 + 键盘（Enter/Space）都能触发，并给出可访问名称。
  const interactiveProps: React.HTMLAttributes<HTMLElement> = onClick
    ? {
        role: 'button',
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        },
        'aria-label': title || `查看 ${name} 的资料`,
        title: title || `查看 ${name} 的资料`,
      }
    : {};
  const cursor = onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : '';

  if (resolved) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolved}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover' }}
        className={`flex-shrink-0 ${cursor} ${className}`}
        {...interactiveProps}
      />
    );
  }

  return (
    <div
      className={`flex-shrink-0 flex items-center justify-center text-white font-semibold leading-none overflow-hidden ${cursor} ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: stringToColor(name || '?'),
        fontSize: Math.max(12, Math.floor(size * 0.34)),
      }}
      {...interactiveProps}
    >
      {initial}
    </div>
  );
};

export default Avatar;
