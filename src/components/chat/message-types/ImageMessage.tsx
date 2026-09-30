'use client';

import React, { useState, useCallback } from 'react';
import Image from 'next/image';
import { ZoomIn } from 'lucide-react';
import { Message } from '@/types';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { useLightbox } from '@/components/chat/Lightbox';

interface ImageMessageProps {
  message: Message;
}

const ImageMessage: React.FC<ImageMessageProps> = React.memo(({ message }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const resolvedUrl = useSignedUrl(message.content);
  const { open } = useLightbox();

  const handleOpen = useCallback(() => {
    open(message.content);
  }, [open, message.content]);

  if (!resolvedUrl) {
    return (
      <div className="max-w-[80%] h-32 bg-muted rounded-xl flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="relative group cursor-pointer"
      onClick={handleOpen}
      role="button"
      tabIndex={0}
      aria-label="点击查看大图"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted rounded-xl z-10">
          <div className="w-8 h-8 border-4 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      <div className="relative overflow-hidden rounded-xl shadow-sm max-w-[280px]" style={{ aspectRatio: '16/10' }}>
        <Image
          src={resolvedUrl}
          alt="聊天图片"
          fill
          sizes="280px"
          className={`object-contain rounded-xl shadow-sm transition-all duration-300 group-hover:scale-[1.02] ${loading ? 'opacity-0' : 'opacity-100'}`}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
        />
        {/* 悬停放大提示 */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/20 rounded-xl">
          <ZoomIn className="w-6 h-6 text-white" />
        </div>
      </div>

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted rounded-xl">
          <span className="text-muted-foreground">图片加载失败</span>
        </div>
      )}
    </div>
  );
});

ImageMessage.displayName = 'ImageMessage';

export default ImageMessage;
