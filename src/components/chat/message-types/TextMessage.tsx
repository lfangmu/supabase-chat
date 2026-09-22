'use client';

import React from 'react';
import { Message } from '@/types';

interface TextMessageProps {
  message: Message;
  isSelf: boolean;
}

const TextMessage: React.FC<TextMessageProps> = React.memo(({ message, isSelf }) => {
  return (
    <div 
      className={`px-4 py-2 rounded-2xl transition-all duration-200 ${isSelf ? 'bg-green-500 text-white' : 'bg-white text-gray-900'} shadow-sm`}
      style={{
        width: '100%',
        wordBreak: 'break-all',
        overflowWrap: 'break-word',
        whiteSpace: 'normal',
        display: 'block'
      }}
    >
      {message.content}
    </div>
  );
});

TextMessage.displayName = 'TextMessage';

export default TextMessage;