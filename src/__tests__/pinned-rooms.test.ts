import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getPinnedRooms,
  addPinnedRoom,
  removePinnedRoom,
  togglePinnedRoom,
} from '@/utils/joinedRooms';

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

describe('joinedRooms - pin helpers', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('addPinnedRoom adds a room and getPinnedRooms returns it', () => {
    addPinnedRoom('room-1');
    expect(getPinnedRooms()).toContain('room-1');
  });

  it('addPinnedRoom is idempotent (no duplicates)', () => {
    addPinnedRoom('room-1');
    addPinnedRoom('room-1');
    expect(getPinnedRooms()).toEqual(['room-1']);
  });

  it('removePinnedRoom removes a room', () => {
    addPinnedRoom('room-1');
    addPinnedRoom('room-2');
    removePinnedRoom('room-1');
    expect(getPinnedRooms()).toEqual(['room-2']);
  });

  it('togglePinnedRoom adds when not pinned, removes when pinned', () => {
    togglePinnedRoom('room-1');
    expect(getPinnedRooms()).toContain('room-1');
    togglePinnedRoom('room-1');
    expect(getPinnedRooms()).not.toContain('room-1');
  });

  it('togglePinnedRoom ignores empty id', () => {
    togglePinnedRoom('   ');
    expect(getPinnedRooms()).toEqual([]);
  });

  it('getPinnedRooms returns empty array when nothing stored', () => {
    expect(getPinnedRooms()).toEqual([]);
  });
});
