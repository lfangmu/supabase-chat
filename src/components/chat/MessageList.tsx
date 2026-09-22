'use client';

import React, { useRef } from 'react';
import { Message } from '@/types';
import MessageItem from './MessageItem';

interface MessageListProps {
  messages: Message[];
  user: string;
  uploadingMessages: Map<string, { progress: number; fileName: string }>;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onWithdraw: (timestamp: string) => void;
  onQuote?: (message: Message) => void;
}

const MessageList: React.FC<MessageListProps> = React.memo(({ 
  messages, 
  user, 
  uploadingMessages, 
  loadingMore, 
  hasMore, 
  onLoadMore, 
  onWithdraw, 
  onQuote 
}) => {
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // 观察顶部哨兵，触发加载更多
  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && messages.length > 0) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (topSentinelRef.current) observer.observe(topSentinelRef.current);

    return () => observer.disconnect();
  }, [hasMore, loadingMore, messages.length, onLoadMore]);

  // 当消息列表更新时，自动滚动到底部
  React.useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <main className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
      <div ref={topSentinelRef} className="h-1" />

      {loadingMore && (
        <div className="flex items-center justify-center py-4">
          <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="ml-2 text-gray-500">加载更多历史...</span>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <div className="w-16 h-16 bg-gray-200 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-gray-400">还没有消息，开始聊天吧！</p>
        </div>
      ) : (
        <>
          {messages.map((message) => (
            <MessageItem 
              key={message.timestamp} 
              message={message} 
              user={user} 
              onWithdraw={onWithdraw} 
              onQuote={onQuote}
            />
          ))}
          
          {/* 显示上传中的消息 */}
          {Array.from(uploadingMessages.entries()).map(([uploadId, uploadData]) => (
            <div key={uploadId} className="flex flex-col items-end mb-4 animate-fadeIn">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  {user}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="relative group inline-block">
                <div className="inline-flex flex-col items-center px-4 py-3 rounded-2xl bg-blue-100 dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm min-w-[200px]">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-gray-600 dark:text-gray-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span className="text-sm font-medium">上传中</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-2">
                    <div 
                      className="bg-blue-600 dark:bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${uploadData.progress}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 text-center">
                    {uploadData.fileName}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    {uploadData.progress}%
                  </div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {!hasMore && messages.length > 0 && (
        <div className="text-center text-gray-400 text-sm py-4">已加载全部历史</div>
      )}

      <div ref={endRef} />
    </main>
  );
});

MessageList.displayName = 'MessageList';

export default MessageList;
