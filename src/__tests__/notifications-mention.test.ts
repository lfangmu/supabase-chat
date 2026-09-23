import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isMentioned,
  addMentionedRoom,
  removeMentionedRoom,
  getMentionedRooms,
} from '@/utils/notifications';

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

describe('notifications - mention utilities', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('isMentioned', () => {
    it('should detect exact @nickname match', () => {
      expect(isMentioned('Hello @Alice!', 'Alice')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isMentioned('Hello @alice!', 'Alice')).toBe(true);
      expect(isMentioned('Hello @ALICE!', 'alice')).toBe(true);
    });

    it('should not match substrings', () => {
      expect(isMentioned('Hello @Alicia!', 'Alice')).toBe(false);
    });

    it('should match at end of string', () => {
      expect(isMentioned('Hello @Alice', 'Alice')).toBe(true);
    });

    it('should match with trailing punctuation', () => {
      expect(isMentioned('Hello @Alice, how are you?', 'Alice')).toBe(true);
      expect(isMentioned('Hello @Alice.', 'Alice')).toBe(true);
      expect(isMentioned('Hello @Alice!', 'Alice')).toBe(true);
    });

    it('should return false for empty nickname', () => {
      expect(isMentioned('Hello @Alice!', '')).toBe(false);
      expect(isMentioned('Hello @Alice!', '  ')).toBe(false);
    });

    it('should return false for empty content', () => {
      expect(isMentioned('', 'Alice')).toBe(false);
    });

    it('should handle nicknames with special regex characters', () => {
      expect(isMentioned('Hello @test.user!', 'test.user')).toBe(true);
    });
  });

  describe('addMentionedRoom', () => {
    it('should add a room to the mentioned rooms list', () => {
      addMentionedRoom('room-1');
      const rooms = getMentionedRooms();
      expect(rooms.has('room-1')).toBe(true);
    });

    it('should not add duplicate rooms', () => {
      addMentionedRoom('room-1');
      addMentionedRoom('room-1');
      const rooms = getMentionedRooms();
      expect(rooms.size).toBe(1);
    });

    it('should add multiple rooms', () => {
      addMentionedRoom('room-1');
      addMentionedRoom('room-2');
      addMentionedRoom('room-3');
      const rooms = getMentionedRooms();
      expect(rooms.size).toBe(3);
      expect(rooms.has('room-1')).toBe(true);
      expect(rooms.has('room-2')).toBe(true);
      expect(rooms.has('room-3')).toBe(true);
    });
  });

  describe('removeMentionedRoom', () => {
    it('should remove a room from the mentioned rooms list', () => {
      addMentionedRoom('room-1');
      addMentionedRoom('room-2');
      removeMentionedRoom('room-1');
      const rooms = getMentionedRooms();
      expect(rooms.has('room-1')).toBe(false);
      expect(rooms.has('room-2')).toBe(true);
    });

    it('should handle removing non-existent room gracefully', () => {
      removeMentionedRoom('non-existent');
      const rooms = getMentionedRooms();
      expect(rooms.size).toBe(0);
    });
  });

  describe('getMentionedRooms', () => {
    it('should return empty set when no rooms are mentioned', () => {
      const rooms = getMentionedRooms();
      expect(rooms.size).toBe(0);
    });

    it('should return a Set of mentioned room IDs', () => {
      addMentionedRoom('room-1');
      addMentionedRoom('room-2');
      const rooms = getMentionedRooms();
      expect(rooms).toBeInstanceOf(Set);
      expect(rooms.size).toBe(2);
    });
  });
});
