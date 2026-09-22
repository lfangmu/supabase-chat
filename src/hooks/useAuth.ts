'use client';

import { useState, useEffect } from 'react';
import { AuthState } from '@/types';

export const useAuth = () => {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    passwordVersion: null,
  });

  // 只在客户端检查认证状态
  useEffect(() => {
    const authStatus = sessionStorage.getItem('chat-authenticated');
    setAuthState(prev => ({
      ...prev,
      isAuthenticated: authStatus === 'true',
    }));
  }, []);

  // 如果已经认证，获取当前密码版本
  useEffect(() => {
    if (authState.isAuthenticated) {
      checkPasswordVersion();
    }
  }, []);

  // 定期检查密码版本
  useEffect(() => {
    if (!authState.isAuthenticated) return;
    
    const interval = setInterval(() => {
      checkPasswordVersion();
    }, 10000 * 6); // 每60秒检查一次
    
    return () => clearInterval(interval);
  }, [authState.isAuthenticated, authState.passwordVersion]);

  const checkPasswordVersion = async () => {
    try {
      const response = await fetch('/api/password-version');
      const data = await response.json();
      
      if (data.success) {
        // 如果有存储的版本且与当前版本不同，则退出登录
        if (authState.passwordVersion && authState.passwordVersion !== data.version) {
          handleLogout();
        }
        setAuthState(prev => ({
          ...prev,
          passwordVersion: data.version,
        }));
      }
    } catch (error) {
      console.error('检查密码版本失败:', error);
    }
  };

  const handleAuthentication = () => {
    setAuthState(prev => ({
      ...prev,
      isAuthenticated: true,
    }));
    // 认证成功后获取密码版本
    checkPasswordVersion();
  };

  const handleLogout = () => {
    // 清除认证状态
    sessionStorage.removeItem('chat-authenticated');
    setAuthState({
      isAuthenticated: false,
      passwordVersion: null,
    });
  };

  return {
    ...authState,
    handleAuthentication,
    handleLogout,
  };
};
