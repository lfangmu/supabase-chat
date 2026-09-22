'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMessages } from './useMessages';
import { useFileUpload } from './useFileUpload';
import { Message } from '@/types';
import { ROOM_CONFIG, AUTH_CONFIG } from '@/config';

export const useChat = () => {
  const [user, setUser] = useState('');
  const [showNicknameInput, setShowNicknameInput] = useState(true);
  const [message, setMessage] = useState('');
  const [roomId, setRoomId] = useState(ROOM_CONFIG.DEFAULT_ROOM);

  // 使用 useMessages hook
  const { 
    messages, 
    loadingMore, 
    hasMore, 
    loadMoreHistory, 
    sendMessage, 
    withdrawMessage 
  } = useMessages(roomId);

  // 使用 useFileUpload hook
  const { 
    uploading, 
    uploadingMessages, 
    handleFileChange,
    handleVoiceUpload
  } = useFileUpload({ user, roomId, sendMessage });

  // 禁止页面滚动，允许聊天区域滚动
  useEffect(() => {
    // 禁止页面滚动
    document.body.style.overflow = 'hidden';
    
    // 清理函数：恢复页面滚动
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // 昵称加载
  useEffect(() => {
    const saved = localStorage.getItem('chat_nickname');
    if (saved) {
      setUser(saved);
      setShowNicknameInput(false);
    }
  }, []);

  // 房间 ID
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('r') || params.get('room') || 'default-room';
    setRoomId(rid);
  }, []);

  // 自动滚动
  useEffect(() => {
    const messagesEndRef = document.querySelector('[data-testid="messages-end"]');
    if (messagesEndRef) {
      messagesEndRef.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // 设置昵称
  const handleSetNickname = useCallback(() => {
    const trimmed = user.trim();
    if (trimmed) {
      localStorage.setItem('chat_nickname', trimmed);
      setShowNicknameInput(false);
    }
  }, [user]);

  // 退出登录
  const handleLogout = useCallback(() => {
    // 清除认证状态
    sessionStorage.removeItem(AUTH_CONFIG.SESSION_KEY);
    // 刷新页面
    window.location.reload();
  }, []);

  // 修改昵称
  const handleEditNickname = useCallback(() => {
    setShowNicknameInput(true);
  }, []);

  // 分享链接
  const handleShare = useCallback(() => {
    // 更安全的加密函数（使用基于密钥的加密）
    const encrypt = (text: string, key: string = AUTH_CONFIG.ENCRYPTION_KEY) => {
      // 使用更安全的加密方式，结合时间戳和随机值
      const salt = Math.random().toString(36).substring(2, 10);
      const combinedWithSalt = `${salt}:${text}`;
      
      // 简单的加密实现，实际项目中可使用更强大的加密库
      let result = '';
      for (let i = 0; i < combinedWithSalt.length; i++) {
        const charCode = combinedWithSalt.charCodeAt(i) ^ key.charCodeAt(i % key.length);
        result += String.fromCharCode(charCode);
      }
      
      // 使用Base64 URL编码，确保链接安全且长度适中
      return btoa(unescape(encodeURIComponent(result))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    };

    // 获取密码（从环境变量或配置中读取）
    const password = process.env.NEXT_PUBLIC_CHAT_PASSWORD || 'default';
    
    // 生成时间戳
    const timestamp = Math.floor(Date.now() / 1000);
    
    // 生成随机令牌，增加安全性
    const token = Math.random().toString(36).substring(2, 15);
    
    // 合并密码、时间戳和令牌（用分隔符隔开）
    const combined = `${password}:${timestamp}:${token}`;
    
    // 加密合并后的字符串
    const encryptedCombined = encrypt(combined);
    
    // 构建分享链接
    let shareUrl = window.location.origin;
    if (roomId !== ROOM_CONFIG.DEFAULT_ROOM) {
      shareUrl += `?r=${roomId}&t=${encryptedCombined}`;
    } else {
      shareUrl += `?t=${encryptedCombined}`;
    }
    
    // 复制链接到剪贴板
    navigator.clipboard.writeText(shareUrl)
      .then(() => {
        alert('分享链接已复制到剪贴板！');
      })
      .catch(err => {
        console.error('复制失败:', err);
        alert('复制失败，请手动复制链接。');
      });
  }, [roomId]);

  // 发送文本消息
  const sendText = useCallback(() => {
    const trimmedMsg = message.trim();
    if (!trimmedMsg || uploading || !user.trim()) return;

    const newMsg: Message = {
      user: user.trim(),
      type: 'text',
      content: trimmedMsg,
      timestamp: new Date().toISOString(),
    };

    sendMessage(newMsg);
    setMessage('');
  }, [message, uploading, user, sendMessage]);



  return {
    user,
    setUser,
    showNicknameInput,
    message,
    setMessage,
    messages,
    roomId,
    uploading,
    uploadingMessages,
    loadingMore,
    hasMore,
    handleSetNickname,
    handleLogout,
    handleEditNickname,
    handleShare,
    sendText,
    handleFileChange,
    handleVoiceUpload,
    loadMoreHistory,
    withdrawMessage,
  };
};
