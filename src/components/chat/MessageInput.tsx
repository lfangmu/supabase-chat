'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Keyboard, Paperclip, Smile, Check } from 'lucide-react';
import EmojiPicker from './EmojiPicker';
import MentionSuggestions from './MentionSuggestions';
import { PresenceUser } from '@/hooks/usePresence';
import { UPLOAD_CONFIG } from '@/config';
import { showError } from '@/utils/errorHandler';

/** Check if an audio blob is silent (RMS below threshold) */
async function checkAudioSilence(blob: Blob): Promise<boolean> {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const sample = data[i] ?? 0;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / data.length);
    return rms < 0.005; // Threshold: very quiet
  } catch {
    return false; // If analysis fails, assume not silent
  } finally {
    // P3 修复：此前 `await ctx.close()` 写在 try 内，一旦 `decodeAudioData` 抛错
    // （非音频 blob / 解码失败）就永远不会 close → 每次失败都泄漏一个 AudioContext，
    // 累计到浏览器硬上限后所有声音相关功能都会失效。改到 finally 里保证释放。
    if (ctx) {
      try {
        await ctx.close();
      } catch {
        /* ignore */
      }
    }
  }
}

interface MessageInputProps {
  message: string;
  uploading: boolean;
  onlineUsers?: PresenceUser[];
  onMessageChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onVoiceRecord: (blob: Blob) => void;
  onSend: () => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  onInsertText?: (text: string) => void;
  // REQ-004: Draft saved indicator
  draftSaved?: boolean;
}

const MessageInput: React.FC<MessageInputProps> = React.memo(({
  message,
  uploading,
  onlineUsers = [],
  onMessageChange,
  onKeyDown,
  onFileChange,
  onVoiceRecord,
  onSend,
  onPaste,
  onInsertText,
  draftSaved = false,
}) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);

  // Responsive placeholder: keep the full hint on desktop, shorten on mobile so
  // the gray placeholder text doesn't wrap to a second line in the narrow input.
  const [placeholder, setPlaceholder] = useState('输入消息... (Enter 发送，Shift+Enter 换行)');
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () =>
      setPlaceholder(
        mq.matches ? '输入消息...' : '输入消息... (Enter 发送，Shift+Enter 换行)'
      );
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // @mention detection — inline, no useMemo to avoid TDZ in minified builds
  const cursorPos = inputRef.current?.selectionStart ?? message.length;
  const textBeforeCursor = message.slice(0, cursorPos);
  const lastAt = textBeforeCursor.lastIndexOf('@');
  const mentionQuery =
    lastAt !== -1 &&
    (lastAt === 0 || /\s/.test(textBeforeCursor[lastAt - 1] ?? '')) &&
    !textBeforeCursor.slice(lastAt + 1).includes(' ')
      ? textBeforeCursor.slice(lastAt + 1)
      : null;
  const showMention = mentionQuery !== null && onlineUsers.length > 0;

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isPressing, setIsPressing] = useState(false);

  const isRecordingRef = useRef(false);
  const isCancelingRef = useRef(false);
  const isPressingRef = useRef(false);
  const touchStartYRef = useRef(0);
  const touchStartXRef = useRef(0);
  const touchStartTimeRef = useRef(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isCancelingRef.current = isCanceling; }, [isCanceling]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setRecordingTime(0);
      setIsRecording(true);
      setIsCanceling(false);
      isRecordingRef.current = true;
      isCancelingRef.current = false;

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (!isCancelingRef.current && audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          // Check for silence — discard if too quiet
          try {
            const isSilent = await checkAudioSilence(audioBlob);
            if (isSilent) {
              showError('未检测到有效语音，请重新录制');
              // Fall through to cleanup, skip upload
            } else {
              onVoiceRecord(audioBlob);
            }
          } catch {
            // If analysis fails, still upload (graceful degradation)
            onVoiceRecord(audioBlob);
          }
        }
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
          recordingIntervalRef.current = null;
        }
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
    } catch (error) {
      console.error('开始录音失败:', error);
      const err = error as DOMException;
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showError('请允许麦克风权限后才能使用语音功能。可在浏览器设置中开启。');
      } else {
        showError('无法启动录音，请检查麦克风是否正常。');
      }
      setIsRecording(false);
      setIsPressing(false);
      isRecordingRef.current = false;
      isPressingRef.current = false;
    }
  }, [onVoiceRecord]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsPressing(false);
    isRecordingRef.current = false;
    isPressingRef.current = false;
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const cancelRecording = useCallback(() => {
    setIsCanceling(true);
    isCancelingRef.current = true;
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsPressing(false);
    isRecordingRef.current = false;
    isPressingRef.current = false;
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (uploading) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    touchStartYRef.current = touch.clientY;
    touchStartXRef.current = touch.clientX;
    touchStartTimeRef.current = Date.now();
    isPressingRef.current = true;
    setIsPressing(true);
    startRecording();
  }, [uploading, startRecording]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPressingRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const diffY = touchStartYRef.current - touch.clientY;
    const diffX = Math.abs(touchStartXRef.current - touch.clientX);
    if (diffY > 30 && diffX < 80) {
      setIsCanceling(true);
      isCancelingRef.current = true;
    } else if (diffY < 15) {
      setIsCanceling(false);
      isCancelingRef.current = false;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    isPressingRef.current = false;
    if (isRecordingRef.current) {
      if (isCancelingRef.current) {
        cancelRecording();
      } else {
        stopRecording();
      }
    } else {
      setIsPressing(false);
    }
  }, [cancelRecording, stopRecording]);

  const handleTouchCancel = useCallback(() => {
    isPressingRef.current = false;
    if (isRecordingRef.current) {
      cancelRecording();
    }
    setIsPressing(false);
  }, [cancelRecording]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (uploading) return;
    touchStartYRef.current = e.clientY;
    touchStartXRef.current = e.clientX;
    isPressingRef.current = true;
    setIsPressing(true);
    startRecording();
  }, [uploading, startRecording]);

  const handleMouseUp = useCallback(() => {
    isPressingRef.current = false;
    if (isRecordingRef.current) {
      if (isCancelingRef.current) {
        cancelRecording();
      } else {
        stopRecording();
      }
    } else {
      setIsPressing(false);
    }
  }, [cancelRecording, stopRecording]);

  const handleMouseLeave = useCallback(() => {
    isPressingRef.current = false;
    if (isRecordingRef.current) {
      cancelRecording();
    } else {
      setIsPressing(false);
    }
  }, [cancelRecording]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPressingRef.current) return;
    const diffY = touchStartYRef.current - e.clientY;
    if (diffY > 30) {
      setIsCanceling(true);
      isCancelingRef.current = true;
    } else if (diffY < 15) {
      setIsCanceling(false);
      isCancelingRef.current = false;
    }
  }, []);

  const formatTime = (seconds: number) => {
    return `${seconds}"`;
  };

  useEffect(() => {
    if (isRecording && recordingTime >= UPLOAD_CONFIG.VOICE_RECORDING.MAX_DURATION) {
      setIsCanceling(false);
      isCancelingRef.current = false;
      stopRecording();
    }
  }, [isRecording, recordingTime, stopRecording]);

  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    };
  }, []);

  // Auto-grow textarea based on content (min 1 line, max ~4 lines)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [message]);

  const toggleVoiceMode = useCallback(() => {
    setVoiceMode(prev => !prev);
  }, []);

  const handleEmojiSelect = useCallback((emoji: string) => {
    if (onInsertText) {
      onInsertText(emoji);
    } else {
      // Fallback: create a synthetic change event
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (nativeInputValueSetter && inputRef.current) {
        const cursorPos = inputRef.current.selectionStart ?? message.length;
        const newValue = message.slice(0, cursorPos) + emoji + message.slice(cursorPos);
        nativeInputValueSetter.call(inputRef.current, newValue);
        const event = new Event('input', { bubbles: true });
        inputRef.current.dispatchEvent(event);
      }
    }
    inputRef.current?.focus();
  }, [message, onInsertText]);

  const toggleEmoji = useCallback(() => {
    setShowEmoji(prev => !prev);
  }, []);

  const handleMentionSelect = useCallback((nickname: string) => {
    const cursorPos = inputRef.current?.selectionStart ?? message.length;
    const textBeforeCursor = message.slice(0, cursorPos);
    const lastAt = textBeforeCursor.lastIndexOf('@');
    if (lastAt === -1) return;

    const before = message.slice(0, lastAt);
    const after = message.slice(cursorPos);
    const newValue = `${before}@${nickname} ${after}`;

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    if (nativeInputValueSetter && inputRef.current) {
      nativeInputValueSetter.call(inputRef.current, newValue);
      const event = new Event('input', { bubbles: true });
      inputRef.current.dispatchEvent(event);
      // Set cursor after the inserted mention
      const newCursorPos = lastAt + nickname.length + 2; // @name + space
      setTimeout(() => {
        inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
    inputRef.current?.focus();
  }, [message]);

  return (
    <footer className="bg-card border-t border-border px-4 py-2 safe-area-inset-bottom shadow-sm relative">
      <div className="flex items-center gap-2 max-w-full">
        <button
          type="button"
          className={`p-2 rounded-full transition-all duration-200 select-none touch-none ${
            voiceMode
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted'
          } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          onClick={toggleVoiceMode}
          aria-label={voiceMode ? '切换到键盘' : '切换到语音'}
        >
          {voiceMode ? (
            <Keyboard className="w-5 h-5" />
          ) : (
            <Mic className="w-5 h-5" />
          )}
        </button>

        <div className="flex-1 relative">
          {voiceMode ? (
            <button
              type="button"
              className={`w-full py-2 rounded-lg text-base font-medium transition-all duration-150 select-none touch-none ${
                isPressing || isRecording
                  ? isCanceling
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-muted text-foreground'
                  : 'bg-muted text-foreground border border-input'
              }`}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              onTouchCancel={handleTouchCancel}
              aria-label="按住说话"
            >
              {isCanceling ? '松开手指，取消发送' : isPressing ? '松开 结束' : '按住 说话'}
            </button>
          ) : (
            <>
              <textarea
                ref={inputRef}
                value={message}
                onChange={onMessageChange}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder={placeholder}
                disabled={uploading || isRecording}
                rows={1}
                className="w-full px-4 py-2 pr-10 border border-input rounded-2xl bg-muted text-base focus:ring-2 focus:ring-ring transition-all duration-200 focus:outline-none resize-none placeholder:text-muted-foreground"
                aria-label="消息输入框"
              />
              <button
                type="button"
                ref={emojiBtnRef}
                onClick={toggleEmoji}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded-full transition-colors"
                aria-label="表情"
              >
                <Smile className="w-5 h-5" />
              </button>
            </>

          )}
        </div>

        {message.trim() !== '' && !voiceMode ? (
          <button
            type="button"
            onClick={onSend}
            disabled={uploading || isRecording}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 transform hover:scale-[1.05] active:scale-[0.95] flex-shrink-0 ${
              uploading || isRecording ? 'bg-muted cursor-not-allowed text-muted-foreground' : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}
            aria-label="发送消息"
          >
            发送
          </button>
        ) : (
          <label className="cursor-pointer text-muted-foreground p-2 hover:bg-muted rounded-full transition-all select-none touch-none" aria-label="选择文件或图片">
            <input type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.txt,.csv,.json" onChange={onFileChange} className="hidden" disabled={uploading || isRecording} aria-hidden="true" />
            <Paperclip className="w-5 h-5" />
          </label>
        )}
      </div>

      {/* Emoji picker（portal 到 body，脱离 overflow:hidden 裁剪，避免「表情包只显示一半」） */}
      {showEmoji && (
        <EmojiPicker
          anchorRef={emojiBtnRef}
          placement="top"
          onSelect={handleEmojiSelect}
          onClose={() => setShowEmoji(false)}
        />
      )}

      {/* @mention suggestions */}
      {showMention && (
        <MentionSuggestions
          query={mentionQuery!}
          users={onlineUsers}
          onSelect={handleMentionSelect}
          onClose={() => {
            // 关闭建议列表，将光标移动到 @ 符号前面，让 mentionQuery 自然失效
            if (inputRef.current) {
              const cursorPos = inputRef.current.selectionStart ?? 0;
              const textBeforeCursor = message.slice(0, cursorPos);
              const lastAt = textBeforeCursor.lastIndexOf('@');
              if (lastAt !== -1) {
                inputRef.current.setSelectionRange(lastAt, lastAt);
                inputRef.current.focus();
              }
            }
          }}
        />
      )}

      {isRecording && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 select-none" role="dialog" aria-label="录音中" aria-modal="true">
          <div className="text-center text-white">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 transition-all duration-200 ${
              isCanceling ? 'bg-gray-600' : 'bg-red-600 animate-pulse'
            }`}>
              <Mic className="w-10 h-10" />
            </div>
            <div className="text-2xl font-medium mb-2">
              {isCanceling ? '松开取消' : '录音中'}
            </div>
            <div className="text-xl">
              {formatTime(recordingTime)}
            </div>
            <div className="mt-4 text-sm opacity-80">
              {isCanceling ? '↑ 已标记为取消' : '↑ 上滑取消'}
            </div>
          </div>
        </div>
      )}

      {/* REQ-004: Draft saved indicator */}
      {draftSaved && !voiceMode && (
        <div className="absolute -top-5 right-4 flex items-center gap-1 text-[10px] text-muted-foreground animate-fadeIn">
          <Check className="w-3 h-3" />
          <span>草稿已保存</span>
        </div>
      )}
    </footer>
  );
});

MessageInput.displayName = 'MessageInput';

export default MessageInput;