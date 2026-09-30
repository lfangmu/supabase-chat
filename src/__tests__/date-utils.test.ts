import { describe, it, expect } from 'vitest';
import {
  formatDateSeparator,
  getDateKey,
  isSameDay,
  formatDateSeparatorFromTimestamp,
} from '@/utils/date-utils';

describe('date-utils', () => {
  describe('getDateKey', () => {
    it('should return YYYY-MM-DD format', () => {
      const key = getDateKey('2025-06-23T10:30:00.000Z');
      // Use the actual local date to avoid timezone issues
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return same key for same day timestamps', () => {
      // Use timestamps close together to avoid timezone boundary issues
      const key1 = getDateKey('2025-06-23T12:30:00.000Z');
      const key2 = getDateKey('2025-06-23T14:30:00.000Z');
      expect(key1).toBe(key2);
    });

    // 回归：realtime 负载若丢失 timestamp（历史上 relay 误传 CDC 信封导致），
    // 不能产出 "NaN-NaN-NaN"，必须返回空串以便上层跳过该分隔线。
    it('should return empty string for invalid timestamp', () => {
      expect(getDateKey('invalid')).toBe('');
      expect(getDateKey('')).toBe('');
      expect(getDateKey(undefined as unknown as string)).toBe('');
    });
  });

  describe('isSameDay', () => {
    it('should return true for same-day timestamps', () => {
      // Use timestamps close together to avoid timezone boundary issues
      expect(isSameDay('2025-06-23T12:30:00.000Z', '2025-06-23T14:30:00.000Z')).toBe(true);
    });

    it('should return false for different-day timestamps', () => {
      expect(isSameDay('2025-06-23T10:30:00.000Z', '2025-06-24T10:30:00.000Z')).toBe(false);
    });
  });

  describe('formatDateSeparator', () => {
    it('should return "今天" for today', () => {
      const now = new Date();
      expect(formatDateSeparator(now)).toBe('今天');
    });

    it('should return "昨天" for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(formatDateSeparator(yesterday)).toBe('昨天');
    });

    it('should include month and day for same-year dates', () => {
      const date = new Date();
      date.setDate(date.getDate() - 10);
      const result = formatDateSeparator(date);
      // Should contain "月" and "日" and a weekday
      expect(result).toContain('月');
      expect(result).toContain('日');
      expect(result).toMatch(/星期[日一二三四五六]/);
    });

    it('should include year for different-year dates', () => {
      const date = new Date(2020, 5, 15);
      const result = formatDateSeparator(date);
      expect(result).toContain('2020');
      expect(result).toContain('年');
    });

    // 回归：Invalid Date 绝不能渲染出「NaN年NaN月NaN日 undefined」。
    it('should return empty string for Invalid Date', () => {
      expect(formatDateSeparator(new Date('invalid'))).toBe('');
      expect(formatDateSeparator(new Date(NaN))).toBe('');
      expect(formatDateSeparator(undefined as unknown as Date)).toBe('');
    });
  });

  describe('formatDateSeparatorFromTimestamp', () => {
    it('should format a timestamp string', () => {
      const now = new Date().toISOString();
      const result = formatDateSeparatorFromTimestamp(now);
      expect(result).toBe('今天');
    });

    it('should handle invalid timestamp gracefully', () => {
      // Invalid date should not throw
      const result = formatDateSeparatorFromTimestamp('invalid');
      expect(typeof result).toBe('string');
    });

    // 回归：非字符串 / 缺失 timestamp 也必须返回空串，而不是含 NaN 的脏字符串。
    it('should return empty string for invalid/missing timestamps', () => {
      expect(formatDateSeparatorFromTimestamp('invalid')).toBe('');
      expect(formatDateSeparatorFromTimestamp('')).toBe('');
      expect(formatDateSeparatorFromTimestamp(undefined as unknown as string)).toBe('');
      expect(formatDateSeparatorFromTimestamp('invalid')).not.toContain('NaN');
    });
  });
});
