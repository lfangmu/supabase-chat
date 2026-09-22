'use client';

import React, { useState, useRef } from 'react';
import { Message } from '@/types';

interface VoiceMessageProps {
  message: Message;
  isSelf: boolean;
}

const VoiceMessage: React.FC<VoiceMessageProps> = React.memo(({ message, isSelf }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      <div className={`px-4 py-2 rounded-2xl ${isSelf ? 'bg-green-500 text-white' : 'bg-white text-gray-900'} min-w-[80px] max-w-[200px] shadow-sm`}>
        <div className="flex items-center justify-between w-full">
          <button
            onClick={handlePlayPause}
            className={`flex items-center justify-center ${isSelf ? 'text-white' : 'text-gray-600'}`}
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
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
      <audio
        ref={audioRef}
        src={message.content}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />
    </div>
  );
});

VoiceMessage.displayName = 'VoiceMessage';

export default VoiceMessage;