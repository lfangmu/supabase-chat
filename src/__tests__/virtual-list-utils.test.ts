import { describe, it, expect } from 'vitest';
import {
  buildVirtualList,
  estimateItemSize,
  findMessageIndexInVirtualList,
} from '@/utils/virtual-list-utils';
import { Message, VirtualListItem } from '@/types';

/** Create a test message */
function createMessage(id: string, timestamp: string, type: Message['type'] = 'text'): Message {
  return {
    id,
    user: 'testuser',
    type,
    content: `message ${id}`,
    timestamp,
  };
}

describe('virtual-list-utils', () => {
  describe('buildVirtualList', () => {
    it('should return empty array for empty messages', () => {
      expect(buildVirtualList([])).toEqual([]);
    });

    it('should insert a separator before the first message', () => {
      const messages = [createMessage('1', '2025-06-23T10:00:00.000Z')];
      const items = buildVirtualList(messages);
      expect(items).toHaveLength(2);
      expect(items[0].type).toBe('separator');
      expect(items[1].type).toBe('message');
    });

    it('should insert separators between messages on different days', () => {
      const messages = [
        createMessage('1', '2025-06-23T10:00:00.000Z'),
        createMessage('2', '2025-06-23T14:00:00.000Z'),
        createMessage('3', '2025-06-24T10:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      // Expect: sep, msg1, msg2, sep, msg3 = 5 items
      expect(items).toHaveLength(5);
      expect(items[0].type).toBe('separator');
      expect(items[1].type).toBe('message');
      expect(items[2].type).toBe('message');
      expect(items[3].type).toBe('separator');
      expect(items[4].type).toBe('message');
    });

    it('should not insert separator between messages on the same day', () => {
      const messages = [
        createMessage('1', '2025-06-23T10:00:00.000Z'),
        createMessage('2', '2025-06-23T14:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      // Expect: sep, msg1, msg2 = 3 items
      expect(items).toHaveLength(3);
    });

    it('should set correct originalIndex for message items', () => {
      const messages = [
        createMessage('1', '2025-06-23T10:00:00.000Z'),
        createMessage('2', '2025-06-24T10:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      const msgItems = items.filter((i) => i.type === 'message') as Extract<
        VirtualListItem,
        { type: 'message' }
      >[];
      expect(msgItems[0].originalIndex).toBe(0);
      expect(msgItems[1].originalIndex).toBe(1);
    });

    it('should use unique keys for separators and messages', () => {
      const messages = [
        createMessage('1', '2025-06-23T10:00:00.000Z'),
        createMessage('2', '2025-06-24T10:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      const keys = items.map((i) => i.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });

  describe('estimateItemSize', () => {
    it('should return 40 for separators', () => {
      const items = buildVirtualList([createMessage('1', '2025-06-23T10:00:00.000Z')]);
      const separator = items[0];
      expect(estimateItemSize(separator)).toBe(40);
    });

    it('should return 260 for image messages', () => {
      const msg = createMessage('1', '2025-06-23T10:00:00.000Z', 'image');
      const items = buildVirtualList([msg]);
      const msgItem = items.find((i) => i.type === 'message')!;
      expect(estimateItemSize(msgItem)).toBe(260);
    });

    it('should return 300 for video messages', () => {
      const msg = createMessage('1', '2025-06-23T10:00:00.000Z', 'video');
      const items = buildVirtualList([msg]);
      const msgItem = items.find((i) => i.type === 'message')!;
      expect(estimateItemSize(msgItem)).toBe(300);
    });

    it('should return 80 for voice messages', () => {
      const msg = createMessage('1', '2025-06-23T10:00:00.000Z', 'voice');
      const items = buildVirtualList([msg]);
      const msgItem = items.find((i) => i.type === 'message')!;
      expect(estimateItemSize(msgItem)).toBe(80);
    });

    it('should return 72 for file messages', () => {
      const msg = createMessage('1', '2025-06-23T10:00:00.000Z', 'file');
      const items = buildVirtualList([msg]);
      const msgItem = items.find((i) => i.type === 'message')!;
      expect(estimateItemSize(msgItem)).toBe(72);
    });

    it('should return 72 for text messages', () => {
      const msg = createMessage('1', '2025-06-23T10:00:00.000Z', 'text');
      const items = buildVirtualList([msg]);
      const msgItem = items.find((i) => i.type === 'message')!;
      expect(estimateItemSize(msgItem)).toBe(72);
    });
  });

  describe('findMessageIndexInVirtualList', () => {
    it('should find the virtual list index of a message by ID', () => {
      const messages = [
        createMessage('1', '2025-06-23T10:00:00.000Z'),
        createMessage('2', '2025-06-24T10:00:00.000Z'),
      ];
      const items = buildVirtualList(messages);
      // Virtual list: [sep, msg1, sep, msg2] → indices [0, 1, 2, 3]
      expect(findMessageIndexInVirtualList(items, '1')).toBe(1);
      expect(findMessageIndexInVirtualList(items, '2')).toBe(3);
    });

    it('should return -1 if message not found', () => {
      const messages = [createMessage('1', '2025-06-23T10:00:00.000Z')];
      const items = buildVirtualList(messages);
      expect(findMessageIndexInVirtualList(items, 'nonexistent')).toBe(-1);
    });

    it('should return -1 for empty virtual list', () => {
      expect(findMessageIndexInVirtualList([], 'any')).toBe(-1);
    });
  });
});
