'use client';

import { useEffect } from 'react';
import ChatClient from "./ChatClient";
import { PasswordGate } from '@/components/PasswordGate';
import { useAuth } from '@/hooks/useAuth';

export default function Home() {
  const { isAuthenticated, handleAuthentication, handleLogout } = useAuth();

  // 检查是否有分享链接
  useEffect(() => {
    const checkShareLink = () => {
      // 解密函数（与加密函数对应）
      const decrypt = (text: string, key: string = 'supabase-chat-key') => {
        // 处理 Base64 URL 编码
        const paddedText = text.padEnd(text.length + (4 - text.length % 4) % 4, '=');
        const decoded = decodeURIComponent(escape(atob(paddedText.replace(/-/g, '+').replace(/_/g, '/'))));
        
        let result = '';
        for (let i = 0; i < decoded.length; i++) {
          const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
          result += String.fromCharCode(charCode);
        }
        
        // 移除盐值
        const parts = result.split(':');
        if (parts.length >= 3) {
          // 盐值 + 密码 + 时间戳 + 令牌
          return parts.slice(1).join(':');
        }
        return result;
      };

      // 从 URL 参数中获取 r 和 t
      const params = new URLSearchParams(window.location.search);
      const pass = params.get('t');
      
      // 如果有 t 参数，解密并验证
      if (pass) {
        try {
          // 解密合并后的字符串
          const decryptedCombined = decrypt(pass);
          
          // 分离密码、时间戳和令牌
          const [decryptedPassword, timestampStr, token] = decryptedCombined.split(':');
          const timestamp = parseInt(timestampStr, 10);
          
          // 验证时间戳（链接有效期从配置中获取，默认 24 小时）
          const currentTime = Math.floor(Date.now() / 1000);
          const timeDiff = currentTime - timestamp;
          const maxTimeDiff = parseInt(process.env.NEXT_PUBLIC_SHARE_LINK_EXPIRY || '86400', 10); // 默认 24 小时（86400 秒）
          
          if (timeDiff > maxTimeDiff) {
            console.error('链接已过期');
            return;
          }
          
          // 验证密码（这里应该与 PasswordGate 中的验证逻辑一致）
          const password = process.env.NEXT_PUBLIC_CHAT_PASSWORD || 'default';
          
          if (decryptedPassword === password) {
            // 验证通过，设置认证状态
            handleAuthentication();
          }
        } catch (err) {
          console.error('密码解密失败:', err);
        }
      }
    };

    checkShareLink();
  }, [handleAuthentication]);

  if (!isAuthenticated) {
    return <PasswordGate onAuthenticated={handleAuthentication} />;
  }

  return (
    <main>
      <ChatClient />
    </main>
  );
}
