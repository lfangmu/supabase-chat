'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface PresenceUser {
  id: string;
  nickname: string;
  online_at: string;
}

export function usePresence(roomId: string, nickname: string) {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [reconnectTick, setReconnectTick] = useState(0);
  // Stable userId based on nickname — prevents ghost entries on remount
  const userId = `user-${nickname.trim() || 'anonymous'}`;

  useEffect(() => {
    if (!nickname.trim() || !supabase) return;

    const channelName = `presence:${roomId}`;
    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: userId,
        },
      },
    });

    const trackPresence = async () => {
      await channel.track({
        id: userId,
        nickname: nickname.trim(),
        online_at: new Date().toISOString(),
      });
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceUser>();
        const users: PresenceUser[] = [];
        Object.values(state).forEach((presences) => {
          const latest = presences[presences.length - 1];
          if (latest) users.push(latest);
        });
        // Sort by online_at descending
        users.sort((a, b) => new Date(b.online_at).getTime() - new Date(a.online_at).getTime());
        setOnlineUsers(users);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await trackPresence();
        }
      });

    // Heartbeat: trigger full teardown+rebuild if connection drops
    const heartbeat = setInterval(() => {
      if ((channel as unknown as { state: string }).state !== 'joined') {
        setReconnectTick((t) => t + 1);
      }
    }, 25_000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if ((channel as unknown as { state: string }).state !== 'joined') {
          setReconnectTick((t) => t + 1);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', handleVisibility);
      channel.unsubscribe();
    };
  }, [roomId, nickname, userId, reconnectTick]);

  return { onlineUsers, userId };
}