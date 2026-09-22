'use client';

import React, { useState, useRef, useEffect } from 'react';
import { UPLOAD_CONFIG } from '@/config';

interface MessageInputProps {
  message: string;
  uploading: boolean;
  onMessageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onVoiceRecord: (blob: Blob) => void;
  onSend: () => void;
}

const MessageInput: React.FC<MessageInputProps> = React.memo(({ 
  message, 
  uploading, 
  onMessageChange, 
  onKeyDown, 
  onFileChange, 
  onVoiceRecord, 
  onSend 
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isCanceling, setIsCanceling] = useState(false);
  const [touchStartY, setTouchStartY] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = async (e: React.MouseEvent | React.TouchEvent) => {
    try {
      if (e.type === 'touchstart') {
        const touchEvent = e as React.TouchEvent;
        setTouchStartY(touchEvent.touches[0].clientY);
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setRecordingTime(0);
      setIsRecording(true);
      setIsCanceling(false);

      // 开始计时
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (!isCanceling) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          onVoiceRecord(audioBlob);
        }
        // 停止计时
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
        }
        // 停止所有音轨
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
    } catch (error) {
      console.error('开始录音失败:', error);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    // 无论如何都重置状态
    setIsRecording(false);
    // 清理计时器
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    // 停止所有音轨
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const cancelRecording = () => {
    setIsCanceling(true);
    // 直接停止媒体录制器，不触发 onstop 回调
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    // 清理状态和资源
    setIsRecording(false);
    // 清理计时器
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    // 停止所有音轨
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isRecording) return;
    
    const touchY = e.touches[0].clientY;
    const diffY = touchStartY - touchY;
    
    if (diffY > 50) {
      setIsCanceling(true);
    } else {
      setIsCanceling(false);
    }
  };

  const formatTime = (seconds: number) => {
    return `${seconds}″`;
  };

  // 监听录音时长，超过最大时长自动停止
  useEffect(() => {
    if (isRecording && recordingTime >= UPLOAD_CONFIG.VOICE_RECORDING.MAX_DURATION) {
      // 确保 isCanceling 为 false，这样录音会被发送
      setIsCanceling(false);
      stopRecording();
    }
  }, [isRecording, recordingTime]);

  // 清理函数
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-2 safe-area-inset-bottom shadow-sm relative">
      <div className="flex items-center gap-2 max-w-full">
        {/* 左侧语音按钮 */}
        {message.trim() === '' && (
          <button
            className={`p-2 ${isRecording ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}
            onClick={(e) => {
              e.preventDefault();
              if (isRecording) {
                stopRecording();
              } else {
                startRecording(e);
              }
            }}
            disabled={uploading}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              {isRecording ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              )}
            </svg>
          </button>
        )}
        
        {/* 中间输入框 */}
        <div className="flex-1">
          <input
            type="text"
            value={message}
            onChange={onMessageChange}
            onKeyDown={onKeyDown}
            placeholder="输入消息..."
            disabled={uploading || isRecording}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-full bg-gray-50 dark:bg-gray-700 text-base focus:ring-2 focus:ring-blue-500 transition-all duration-200 focus:outline-none"
          />
        </div>
        
        {/* 右侧按钮区域 */}
        {message.trim() !== '' ? (
          /* 有消息时显示发送按钮 */
          <button
            onClick={onSend}
            disabled={uploading || isRecording}
            className={`px-5 py-2 rounded-full text-white text-sm font-medium transition-all duration-200 transform hover:scale-[1.05] active:scale-[0.95] flex-shrink-0 ${ 
              uploading || isRecording ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            发送
          </button>
        ) : (
          /* 无消息时显示文件上传按钮 */
          <label className="cursor-pointer text-gray-500 dark:text-gray-400 p-2">
            <input type="file" accept="image/*,video/*" onChange={onFileChange} className="hidden" disabled={uploading || isRecording} />
            <span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </span>
          </label>
        )}
      </div>

      {/* 录音状态 */}
      {isRecording && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="text-center text-white">
            <div className="w-20 h-20 rounded-full bg-red-600 flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-2xl font-medium mb-2">
              录音中
            </div>
            <div className="text-xl">
              {formatTime(recordingTime)}
            </div>
            <div className="mt-8 flex justify-center gap-4">
              <button
                onClick={stopRecording}
                className="px-8 py-3 bg-white text-gray-900 rounded-full text-base font-medium transition-all duration-200 transform hover:scale-[1.05] active:scale-[0.95]"
              >
                停止
              </button>
              <button
                onClick={cancelRecording}
                className="px-8 py-3 bg-white text-gray-900 rounded-full text-base font-medium transition-all duration-200 transform hover:scale-[1.05] active:scale-[0.95]"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

    </footer>
  );
});

MessageInput.displayName = 'MessageInput';

export default MessageInput;