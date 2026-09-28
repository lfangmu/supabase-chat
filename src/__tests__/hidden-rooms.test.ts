import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getHiddenRooms,
  addHiddenRoom,
  removeHiddenRoom,
  getJoinedRooms,
  addJoinedRoom,
  removeJoinedRoom,
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

const DM_A = 'dm:aaaaaaaa-1111-1111-1111-111111111111:bbbbbbbb-2222-2222-2222-222222222222';

describe('joinedRooms - hidden room helpers', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('addHiddenRoom adds a room and getHiddenRooms returns it', () => {
    addHiddenRoom(DM_A);
    expect(getHiddenRooms()).toContain(DM_A);
  });

  it('addHiddenRoom is idempotent (no duplicates)', () => {
    addHiddenRoom(DM_A);
    addHiddenRoom(DM_A);
    expect(getHiddenRooms()).toEqual([DM_A]);
  });

  it('removeHiddenRoom removes the room from the hidden set', () => {
    addHiddenRoom(DM_A);
    removeHiddenRoom(DM_A);
    expect(getHiddenRooms()).toEqual([]);
  });

  it('removeHiddenRoom is a no-op for a room that is not hidden', () => {
    addHiddenRoom(DM_A);
    removeHiddenRoom('dm:not-hidden');
    expect(getHiddenRooms()).toEqual([DM_A]);
  });

  it('removeHiddenRoom trims the id before matching', () => {
    addHiddenRoom(DM_A);
    removeHiddenRoom(`  ${DM_A}  `);
    expect(getHiddenRooms()).toEqual([]);
  });

  it('getHiddenRooms returns empty array when nothing stored', () => {
    expect(getHiddenRooms()).toEqual([]);
  });

  it('hide then revive: joined list and hidden list stay independent', () => {
    // 「删除会话」= 写入隐藏集合 + 从已加入列表移除
    addJoinedRoom(DM_A);
    addHiddenRoom(DM_A);
    removeJoinedRoom(DM_A);
    expect(getHiddenRooms()).toContain(DM_A);
    expect(getJoinedRooms()).not.toContain(DM_A);

    // 对方发来新消息 → 会话复活：取消隐藏 + 重新加入
    removeHiddenRoom(DM_A);
    addJoinedRoom(DM_A);
    expect(getHiddenRooms()).not.toContain(DM_A);
    expect(getJoinedRooms()).toContain(DM_A);
  });
});
