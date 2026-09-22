'use client';

import React from 'react';
import { useChat } from '@/hooks/useChat';
import MessageList from '@/components/chat/MessageList';
import MessageInput from '@/components/chat/MessageInput';
import ChatHeader from '@/components/chat/ChatHeader';

export default function ChatClient() {
  const {
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
  } = useChat();

  if (showNicknameInput) {
    return (
      <div className="fixed inset-0 bg-blue-50 dark:bg-gray-900 flex items-stretch justify-center z-50 p-0">
        <div className="w-full max-w-2xl h-screen bg-white dark:bg-gray-800 rounded-none shadow-none border border-gray-100 dark:border-gray-700 transition-all duration-300 flex flex-col items-center justify-center p-8">
          <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-6 md:p-8 space-y-6 md:space-y-8 transition-all duration-300 hover:shadow-xl">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-6 bg-blue-600 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                欢迎进入聊天
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                请输入你的昵称开始聊天
              </p>
            </div>
            <div className="space-y-6">
              <input
                type="text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSetNickname()}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6 placeholder:text-gray-500 dark:placeholder:text-gray-400 transition-all duration-200"
                placeholder="输入你的昵称"
              />
              <button
                onClick={handleSetNickname}
                disabled={!user.trim()}
                className={`w-full py-3 rounded-lg text-white font-medium transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] ${
                  !user.trim()
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                进入聊天
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-blue-50 dark:bg-gray-900 flex items-stretch justify-center p-0">
      <div className="flex flex-col h-full w-full max-w-2xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-none shadow-none overflow-hidden border border-gray-100 dark:border-gray-700 transition-all duration-300">
        <ChatHeader roomId={roomId} onLogout={handleLogout} onEditNickname={handleEditNickname} onShare={handleShare} />
        
        <MessageList
          messages={messages}
          user={user}
          uploadingMessages={uploadingMessages}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadMore={loadMoreHistory}
          onWithdraw={withdrawMessage}
          onQuote={(quotedMessage) => {
            // 实现引用功能
            if (quotedMessage.type === 'text') {
              setMessage(`@${quotedMessage.user}: ${quotedMessage.content}\n`);
            } else {
              setMessage(`@${quotedMessage.user}: [${quotedMessage.type === 'image' ? '图片' : quotedMessage.type === 'video' ? '视频' : '语音'}]\n`);
            }
          }}
        />
        
        <MessageInput
          message={message}
          uploading={uploading}
          onMessageChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendText())}
          onFileChange={handleFileChange}
          onVoiceRecord={handleVoiceUpload}
          onSend={sendText}
        />
        
        <div data-testid="messages-end" />
      </div>
    </div>
  );
}