'use client';

import { useCallback } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseTypingIndicatorParams {
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
}

export function useTypingIndicator({ channelRef }: UseTypingIndicatorParams) {
  const sendTypingStart = useCallback(
    (user: string) => {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'typing-start',
        payload: { user },
      });
    },
    [channelRef]
  );

  const sendTypingStop = useCallback(
    (user: string) => {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'typing-stop',
        payload: { user },
      });
    },
    [channelRef]
  );

  return { sendTypingStart, sendTypingStop };
}