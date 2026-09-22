'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Message } from '@/types';
import TextMessage from './message-types/TextMessage';
import ImageMessage from './message-types/ImageMessage';
import VideoMessage from './message-types/VideoMessage';
import VoiceMessage from './message-types/VoiceMessage';

interface MessageItemProps {
  message: Message;
  user: string;
  onWithdraw: (timestamp: string) => void;
  onQuote?: (message: Message) => void;
}

const MessageItem: React.FC<MessageItemProps> = React.memo(({ message, user, onWithdraw, onQuote }) => {
  const isSelf = message.user === user;
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const messageRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleWithdraw = () => {
    onWithdraw(message.timestamp);
    setShowMenu(false);
  };

  const handleQuote = () => {
    if (onQuote) {
      onQuote(message);
    }
    setShowMenu(false);
  };

  const handleLongPress = (e: React.MouseEvent | React.TouchEvent) => {
    if (messageRef.current) {
      const rect = messageRef.current.getBoundingClientRect();
      // 计算菜单位置，确保在可视区域内
      let menuX = rect.left + rect.width / 2;
      let menuY = rect.top;
      
      // 估算菜单宽度和高度
      const estimatedMenuWidth = 320;
      const estimatedMenuHeight = 40;
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      
      // 调整水平位置，确保菜单不超出屏幕
      if (menuX - estimatedMenuWidth / 2 < 0) {
        menuX = estimatedMenuWidth / 2;
      } else if (menuX + estimatedMenuWidth / 2 > windowWidth) {
        menuX = windowWidth - estimatedMenuWidth / 2;
      }
      
      // 调整垂直位置，确保菜单不超出屏幕
      if (menuY - estimatedMenuHeight < 60) { // 60px 为顶部安全区域
        // 显示在消息下方
        menuY = rect.bottom;
      } else {
        // 显示在消息上方
        menuY = rect.top - estimatedMenuHeight;
      }
      
      setMenuPosition({
        x: menuX,
        y: menuY
      });
      setShowMenu(true);
    }
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setShowMenu(false);
    }
  };

  useEffect(() => {
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showMenu]);

  const renderMessageContent = () => {
    switch (message.type) {
      case 'text':
        return <TextMessage message={message} isSelf={isSelf} />;
      case 'image':
        return <ImageMessage message={message} isSelf={isSelf} />;
      case 'video':
        return <VideoMessage message={message} isSelf={isSelf} />;
      case 'voice':
        return <VoiceMessage message={message} isSelf={isSelf} />;
      default:
        return <TextMessage message={message} isSelf={isSelf} />;
    }
  };

  return (
    <div key={message.timestamp} className={`flex ${isSelf ? 'justify-end' : 'justify-start'} animate-fadeIn mb-3`}>
      <div className={`flex ${isSelf ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
        {/* 头像占位 */}
        <div className={`w-8 h-8 rounded-full ${isSelf ? 'bg-green-500' : 'bg-gray-300'} flex items-center justify-center flex-shrink-0`}>
          <span className={`text-xs text-white font-medium`}>
            {message.user.charAt(0).toUpperCase()}
          </span>
        </div>
        
        {/* 消息内容 */}
        <div className="flex flex-col gap-1" style={{ maxWidth: '70%', width: '100%', display: 'grid', gridTemplateColumns: '1fr' }}>
          {/* 用户名和时间 */}
          <div className={`flex items-center gap-2 ${isSelf ? 'justify-end' : 'justify-start'}`}>
            <span className={`text-xs font-medium ${isSelf ? 'text-gray-500' : 'text-gray-600'}`}>
              {message.user}
            </span>
            <span className="text-[10px] text-gray-400">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          
          {/* 消息气泡 */}
          <div 
            ref={messageRef}
            className="relative"
            style={{
              wordBreak: 'break-all',
              overflowWrap: 'break-word',
              whiteSpace: 'normal',
              width: '100%'
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              handleLongPress(e);
            }}
            onMouseDown={(e) => {
              // 模拟长按
              const timer = setTimeout(() => {
                handleLongPress(e);
              }, 500);
              // 清除计时器的函数
              const clearTimer = () => clearTimeout(timer);
              // 添加鼠标抬起和离开事件监听器
              document.addEventListener('mouseup', clearTimer);
              document.addEventListener('mouseleave', clearTimer);
              // 清理函数
              return () => {
                document.removeEventListener('mouseup', clearTimer);
                document.removeEventListener('mouseleave', clearTimer);
              };
            }}
            onTouchStart={(e) => {
              // 模拟触摸长按
              const timer = setTimeout(() => {
                handleLongPress(e);
              }, 500);
              // 清除计时器的函数
              const clearTimer = () => clearTimeout(timer);
              // 添加触摸结束事件监听器
              document.addEventListener('touchend', clearTimer);
              // 清理函数
              return () => {
                document.removeEventListener('touchend', clearTimer);
              };
            }}
          >
            {renderMessageContent()}
          </div>
        </div>
      </div>

      {/* 弹出菜单 */}
      {showMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-white dark:bg-gray-800 shadow-lg rounded-full border border-gray-200 dark:border-gray-700 py-2 px-4 flex items-center gap-4 whitespace-nowrap"
          style={{
            left: `${menuPosition.x}px`,
            top: `${menuPosition.y}px`,
            transform: 'translateX(-50%)'
          }}
        >
          <div 
            className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full cursor-pointer"
            onClick={handleQuote}
          >
            引用
          </div>
          <div 
            className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full cursor-pointer"
            onClick={() => {
              // 实现复制功能
              if (message.type === 'text') {
                navigator.clipboard.writeText(message.content)
                  .then(() => {
                    console.log('复制成功');
                  })
                  .catch(err => {
                    console.error('复制失败:', err);
                  });
              } else if (message.type === 'image' || message.type === 'video' || message.type === 'voice') {
                navigator.clipboard.writeText(message.content)
                  .then(() => {
                    console.log('复制链接成功');
                  })
                  .catch(err => {
                    console.error('复制失败:', err);
                  });
              }
              setShowMenu(false);
            }}
          >
            复制
          </div>
          {message.type === 'image' && (
            <div 
              className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full cursor-pointer"
              onClick={async () => {
                // 实现保存图片功能
                try {
                  // 获取图片数据
                  const response = await fetch(message.content);
                  const blob = await response.blob();
                  
                  // 创建临时 URL
                  const blobUrl = URL.createObjectURL(blob);
                  
                  // 创建下载链接
                  const link = document.createElement('a');
                  link.href = blobUrl;
                  link.download = `image-${Date.now()}.jpg`;
                  
                  // 触发下载
                  document.body.appendChild(link);
                  link.click();
                  
                  // 清理
                  setTimeout(() => {
                    document.body.removeChild(link);
                    URL.revokeObjectURL(blobUrl);
                  }, 100);
                  
                  setShowMenu(false);
                } catch (error) {
                  console.error('保存图片失败:', error);
                  // 降级方案：使用原始方式
                  const link = document.createElement('a');
                  link.href = message.content;
                  link.download = `image-${Date.now()}.jpg`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  setShowMenu(false);
                }
              }}
            >
              保存图片
            </div>
          )}
          {isSelf && (
            <div 
              className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full cursor-pointer"
              onClick={handleWithdraw}
            >
              撤回
            </div>
          )}
        </div>
      )}
    </div>
  );
});

MessageItem.displayName = 'MessageItem';

export default MessageItem;
