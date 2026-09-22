'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Message } from '@/types';

interface ImageMessageProps {
  message: Message;
  isSelf: boolean;
}

const ImageMessage: React.FC<ImageMessageProps> = React.memo(({ message, isSelf }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <div className="relative group">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-xl">
          <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
        </div>
      )}
      
      <Image 
        src={message.content} 
        alt="图片" 
        className={`max-w-[80%] rounded-xl shadow-sm transition-all duration-300 group-hover:scale-[1.02] ${loading ? 'opacity-0' : 'opacity-100'}`}
        width={400}
        height={300}
        priority={false}
        loading="lazy"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-xl">
          <span className="text-gray-500">图片加载失败</span>
        </div>
      )}
    </div>
  );
});

ImageMessage.displayName = 'ImageMessage';

export default ImageMessage;