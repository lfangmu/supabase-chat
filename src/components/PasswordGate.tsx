'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PasswordGateProps {
  onAuthenticated: () => void;
}

export function PasswordGate({ onAuthenticated }: PasswordGateProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/verify-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const result = await response.json();

      if (result.success) {
        // 设置认证状态
        sessionStorage.setItem('chat-authenticated', 'true');
        onAuthenticated();
      } else {
        setError(result.message || '密码错误');
      }
    } catch (err) {
      setError('验证过程中出现错误');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-stretch justify-center bg-blue-50 dark:bg-gray-900 p-0">
      <div className="w-full max-w-2xl h-screen bg-white dark:bg-gray-800 rounded-none shadow-none border border-gray-100 dark:border-gray-700 transition-all duration-300 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-6 md:p-8 space-y-6 md:space-y-8 transition-all duration-300 hover:shadow-xl">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-6 bg-blue-600 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              系统访问
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              请输入访问密码
            </p>
          </div>
          <div className="space-y-6">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6 placeholder:text-gray-500 dark:placeholder:text-gray-400 transition-all duration-200"
              placeholder="输入密码"
            />
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className={`w-full py-3 rounded-lg text-white font-medium transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] ${
                isLoading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  验证中...
                </div>
              ) : '进入系统'}
            </button>
          </div>
          <div className="text-center text-xs text-gray-500 dark:text-gray-500">
            © 2026 聊天系统 - 安全访问
          </div>
        </div>
      </div>
    </div>
  );
}