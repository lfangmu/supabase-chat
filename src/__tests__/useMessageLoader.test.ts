import { describe, it, expect, beforeEach } from 'vitest';
import { safeSetCache } from '@/utils/cacheUtils';
import { Message } from '@/types';
import { MESSAGE_CONFIG } from '@/config';

describe('safeSetCache', () => {
  const testKey = 'test_cache_key';

  beforeEach(() => {
    localStorage.clear();
  });

  it('should store messages in localStorage', () => {
    const messages: Message[] = [
      { id: '1', user: 'test', type: 'text', content: 'hello', timestamp: new Date().toISOString() },
    ];
    safeSetCache(testKey, messages);
    const stored = JSON.parse(localStorage.getItem(testKey)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('hello');
  });

  it('should trim messages exceeding MAX_MESSAGES', () => {
    const messages: Message[] = Array.from({ length: MESSAGE_CONFIG.MAX_MESSAGES + 50 }, (_, i) => ({
      id: `${i}`,
      user: 'test',
      type: 'text' as const,
      content: `msg ${i}`,
      timestamp: new Date().toISOString(),
    }));

    safeSetCache(testKey, messages);
    const stored = JSON.parse(localStorage.getItem(testKey)!);
    expect(stored.length).toBeLessThanOrEqual(MESSAGE_CONFIG.MAX_MESSAGES);
    // Should keep the most recent messages
    expect(stored[stored.length - 1].content).toBe(`msg ${MESSAGE_CONFIG.MAX_MESSAGES + 49}`);
  });

  it('should handle empty array', () => {
    safeSetCache(testKey, []);
    const stored = JSON.parse(localStorage.getItem(testKey)!);
    expect(stored).toEqual([]);
  });
});