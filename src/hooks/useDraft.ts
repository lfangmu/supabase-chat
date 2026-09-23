'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { STORAGE_CONFIG_KEYS, DRAFT_CONFIG } from '@/config';

interface DraftData {
  content: string;
  savedAt: string;
}

/** Load a draft from localStorage for a room, checking 7-day expiry */
export function loadDraft(roomId: string): string {
  try {
    const key = `${STORAGE_CONFIG_KEYS.DRAFT_PREFIX}${roomId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return '';

    const data = JSON.parse(raw) as DraftData;
    const savedAt = new Date(data.savedAt).getTime();
    const now = Date.now();

    // Check 7-day expiry
    if (now - savedAt > DRAFT_CONFIG.EXPIRY_MS) {
      localStorage.removeItem(key);
      return '';
    }

    return data.content || '';
  } catch {
    return '';
  }
}

/** Save a draft to localStorage for a room */
export function saveDraftSync(roomId: string, content: string): void {
  try {
    if (!content.trim() || content.length > DRAFT_CONFIG.MAX_LENGTH) {
      // Clear empty or too-long drafts
      const key = `${STORAGE_CONFIG_KEYS.DRAFT_PREFIX}${roomId}`;
      if (!content.trim()) {
        localStorage.removeItem(key);
      }
      return;
    }

    const key = `${STORAGE_CONFIG_KEYS.DRAFT_PREFIX}${roomId}`;
    const data: DraftData = {
      content,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage might be full — silently ignore
  }
}

/** Clear a draft for a room */
export function clearDraftSync(roomId: string): void {
  try {
    const key = `${STORAGE_CONFIG_KEYS.DRAFT_PREFIX}${roomId}`;
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function useDraft() {
  const [draftSaved, setDraftSaved] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Save draft with 500ms debounce */
  const saveDraft = useCallback((roomId: string, content: string) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      saveDraftSync(roomId, content);
      // Show "saved" indicator briefly
      setDraftSaved(true);
      if (savedFadeTimerRef.current) clearTimeout(savedFadeTimerRef.current);
      savedFadeTimerRef.current = setTimeout(() => {
        setDraftSaved(false);
      }, 2000);
    }, DRAFT_CONFIG.DEBOUNCE_DELAY);
  }, []);

  /** Load draft for a room (synchronous) */
  const loadDraftForRoom = useCallback((roomId: string): string => {
    return loadDraft(roomId);
  }, []);

  /** Clear draft immediately (called on send) */
  const clearDraft = useCallback((roomId: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    clearDraftSync(roomId);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (savedFadeTimerRef.current) clearTimeout(savedFadeTimerRef.current);
    };
  }, []);

  return {
    draftSaved,
    saveDraft,
    loadDraftForRoom,
    clearDraft,
  };
}
