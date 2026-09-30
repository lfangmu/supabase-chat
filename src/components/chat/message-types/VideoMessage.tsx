'use client';

import React from 'react';
import { Message } from '@/types';
import { useSignedUrl } from '@/hooks/useSignedUrl';

interface VideoMessageProps {
  message: Message;
}

const VideoMessage: React.FC<VideoMessageProps> = React.memo(({ message }) => {
  const resolvedUrl = useSignedUrl(message.content);

  if (!resolvedUrl) {
    return (
      <div className="max-w-[80%] h-32 bg-muted rounded-xl flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative group">
      <video
        src={resolvedUrl}
        controls
        playsInline
        preload="metadata"
        className="max-w-[80%] rounded-xl shadow-sm transition-transform duration-300 group-hover:scale-[1.02]"
      />
    </div>
  );
});

VideoMessage.displayName = 'VideoMessage';

export default VideoMessage;
