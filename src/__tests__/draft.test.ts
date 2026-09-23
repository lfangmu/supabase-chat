import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadDraft, saveDraftSync, clearDraftSync } from '@/hooks/useDraft';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('useDraft utilities', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('saveDraftSync / loadDraft', () => {
    it('should save and load a draft', () => {
      saveDraftSync('room-1', 'Hello, world!');
      const loaded = loadDraft('room-1');
      expect(loaded).toBe('Hello, world!');
    });

    it('should return empty string for non-existent draft', () => {
      const loaded = loadDraft('non-existent-room');
      expect(loaded).toBe('');
    });

    it('should save separate drafts for different rooms', () => {
      saveDraftSync('room-1', 'Draft for room 1');
      saveDraftSync('room-2', 'Draft for room 2');
      expect(loadDraft('room-1')).toBe('Draft for room 1');
      expect(loadDraft('room-2')).toBe('Draft for room 2');
    });

    it('should not save empty content', () => {
      saveDraftSync('room-1', '');
      expect(loadDraft('room-1')).toBe('');
      // localStorage should not have the key
      expect(localStorageMock.getItem('chat_draft_room-1')).toBeNull();
    });

    it('should not save whitespace-only content', () => {
      saveDraftSync('room-1', '   ');
      expect(loadDraft('room-1')).toBe('');
    });
  });

  describe('clearDraftSync', () => {
    it('should clear an existing draft', () => {
      saveDraftSync('room-1', 'Hello');
      expect(loadDraft('room-1')).toBe('Hello');
      clearDraftSync('room-1');
      expect(loadDraft('room-1')).toBe('');
    });

    it('should handle clearing non-existent draft gracefully', () => {
      clearDraftSync('non-existent');
      expect(loadDraft('non-existent')).toBe('');
    });
  });

  describe('draft expiry', () => {
    it('should return empty string for expired drafts (7+ days old)', () => {
      // Create an expired draft manually (8 days old)
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const draftData = JSON.stringify({ content: 'Old draft', savedAt: eightDaysAgo });
      localStorageMock.setItem('chat_draft_room-1', draftData);

      const loaded = loadDraft('room-1');
      expect(loaded).toBe('');
    });

    it('should load valid (non-expired) drafts', () => {
      // Create a recent draft (1 day old)
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
      const draftData = JSON.stringify({ content: 'Recent draft', savedAt: oneDayAgo });
      localStorageMock.setItem('chat_draft_room-1', draftData);

      const loaded = loadDraft('room-1');
      expect(loaded).toBe('Recent draft');
    });
  });
});
