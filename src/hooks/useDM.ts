'use client';

import { useState, useCallback, useEffect } from 'react';
import { DMRoom } from '@/types';
import { DM_CONFIG, API_CONFIG } from '@/config';

interface UseDMParams {
  currentUser: string;
  onSwitchRoom: (roomId: string) => void;
}

/** Generate a DM room ID from two usernames (bidirectionally unique) */
export function generateDMRoomId(userA: string, userB: string): string {
  const a = userA.trim();
  const b = userB.trim();
  const sorted = [a, b].sort((x, y) => x.localeCompare(y));
  return `${DM_CONFIG.ID_PREFIX}${sorted.join(':')}`;
}

/** Extract the other user's name from a DM room ID given the current user */
export function getDMOtherUser(roomId: string, currentUser: string): string | null {
  if (!roomId.startsWith(DM_CONFIG.ID_PREFIX)) return null;
  const rest = roomId.slice(DM_CONFIG.ID_PREFIX.length); // e.g. "alice:bob"
  const parts = rest.split(':');
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  const user = currentUser.trim();
  if (user === a) return b;
  if (user === b) return a;
  return null;
}

export function useDM({ currentUser, onSwitchRoom }: UseDMParams) {
  const [dmRooms, setDmRooms] = useState<DMRoom[]>([]);

  /** Load DM rooms for the current user */
  const loadDMs = useCallback(async () => {
    const user = currentUser.trim();
    if (!user) return;

    try {
      const params = new URLSearchParams({ user });
      const res = await fetch(`${API_CONFIG.DM_LIST_ENDPOINT}?${params}`);
      const data = await res.json();
      if (data.success && data.rooms) {
        setDmRooms(data.rooms as DMRoom[]);
      }
    } catch {
      // Non-fatal
    }
  }, [currentUser]);

  // Load DMs when user changes
  useEffect(() => {
    loadDMs();
  }, [loadDMs]);

  /** Start a DM with another user (creates room if not exists, then switches to it) */
  const startDM = useCallback(
    async (otherUser: string): Promise<string | null> => {
      const user = currentUser.trim();
      const other = otherUser.trim();

      if (!user || !other || user === other) return null;

      const dmRoomId = generateDMRoomId(user, other);

      try {
        // Create DM room (idempotent — upsert with ON CONFLICT DO NOTHING)
        await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'dm',
            id: dmRoomId,
            created_by: user,
            participants: [user, other],
          }),
        });

        // Refresh DM list
        await loadDMs();

        // Switch to the DM room
        onSwitchRoom(dmRoomId);

        return dmRoomId;
      } catch {
        return null;
      }
    },
    [currentUser, loadDMs, onSwitchRoom]
  );

  return {
    dmRooms,
    loadDMs,
    startDM,
  };
}
