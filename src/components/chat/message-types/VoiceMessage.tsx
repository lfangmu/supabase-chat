'use client';

import React, { useState, useRef } from 'react';
import { Play, Square } from 'lucide-react';
import { Message } from '@/types';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { wechatSelfBubble, wechatOtherBubble } from '@/utils/chatStyles';

interface VoiceMessageProps {
  message: Message;
  isSelf: boolean;
}

const VoiceMessage: React.FC<VoiceMessageProps> = React.memo(({ message, isSelf }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resolvedUrl = useSignedUrl(message.content);

  const handlePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const formatTime = (seconds: number) => {
    return `${Math.ceil(seconds)}″`;
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`px-4 py-2 rounded-2xl ${isSelf ? wechatSelfBubble : wechatOtherBubble} min-w-[80px] max-w-[200px]`}>
        <div className="flex items-center justify-between w-full">
          <button
            onClick={handlePlayPause}
            disabled={!resolvedUrl}
            aria-label={isPlaying ? '暂停语音' : '播放语音'}
            className={`flex items-center justify-center ${isSelf ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {isPlaying ? (
              <Square className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>
          <span className="text-xs font-medium">
            {formatTime(duration || 1)}
          </span>
        </div>
        {isPlaying && duration > 0 && (
          <div className="w-full bg-white/30 rounded-full h-1 mt-1 overflow-hidden">
            <div
              className="h-full bg-white"
              style={{ width: `${(currentTime / duration) * 100}%` }}
            ></div>
          </div>
        )}
      </div>
      {resolvedUrl && (
        <audio
          ref={audioRef}
          src={resolvedUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
        />
      )}
    </div>
  );
});

VoiceMessage.displayName = 'VoiceMessage';

export default VoiceMessage;
