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
  return colors[Math.abs(hash) % colors.length];
}

interface AvatarProps {
  name: string;
  avatar?: string | null;
  size?: number;
  className?: string;
  rounded?: 'lg' | 'xl' | 'full';
}

/** 统一头像组件：有头像图显示图，否则显示昵称首字母色块（微信绿/中性风格） */
const Avatar: React.FC<AvatarProps> = ({ name, avatar, size = 40, className = '', rounded = 'lg' }) => {
  const radius = rounded === 'full' ? '9999px' : rounded === 'xl' ? '14px' : '12px';
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  // 头像可能是 Supabase Storage 路径，需要换签名 URL；完整 http(s) 链接原样返回
  const resolved = useSignedUrl(avatar || '');

  if (resolved) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolved}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover' }}
        className={`flex-shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex-shrink-0 flex items-center justify-center text-white font-semibold leading-none overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: stringToColor(name || '?'),
        fontSize: Math.max(12, Math.floor(size * 0.34)),
      }}
    >
      {initial}
    </div>
  );
};

export default Avatar;
