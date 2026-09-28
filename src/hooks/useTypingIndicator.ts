'use client';

import { useCallback } from 'react';
import type { SendBroadcast } from '@/lib/realtimeRelay';

interface UseTypingIndicatorParams {
  roomId: string;
  /** 服务端中继的广播出口（替代 supabase.channel 的 send） */
  sendBroadcast: SendBroadcast;
}

export function useTypingIndicator({ roomId, sendBroadcast }: UseTypingIndicatorParams) {
  const sendTypingStart = useCallback(
    (user: string) => {
      sendBroadcast(roomId, 'typing-start', { user });
    },
    [roomId, sendBroadcast]
  );

  const sendTypingStop = useCallback(
    (user: string) => {
      sendBroadcast(roomId, 'typing-stop', { user });
    },
    [roomId, sendBroadcast]
  );

  return { sendTypingStart, sendTypingStop };
}
