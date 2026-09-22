'use client';

import React from 'react';
import { Message } from '@/types';

interface VideoMessageProps {
  message: Message;
  isSelf: boolean;
}

const VideoMessage: React.FC<VideoMessageProps> = React.memo(({ message, isSelf }) => {
  return (
    <div className="relative group">
      <video 
        src={message.content} 
        controls 
        className="max-w-[80%] rounded-xl shadow-sm transition-transform duration-300 group-hover:scale-[1.02]"
      />
    </div>
  );
});

VideoMessage.displayName = 'VideoMessage';

export default VideoMessage;