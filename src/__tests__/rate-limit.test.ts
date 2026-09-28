import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, getRateLimitConfig, getClientIp } from '@/lib/rate-limit';

describe('rate-limit', () => {
  describe('checkRateLimit', () => {
    beforeEach(() => {
      // 每个测试前重置限流状态（通过使用不同的 key 来避免互相影响）
    });

    it('should allow requests under the limit', () => {
      const key = 'test-allow-under-limit';
      const config = { windowMs: 60000, max: 5 };

      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit(`${key}-${i}`, config);
        expect(result.limited).toBe(false);
        expect(result.remaining).toBeGreaterThanOrEqual(0);
      }
    });

    it('should block requests over the limit', () => {
      const key = 'test-block-over-limit';
      const config = { windowMs: 60000, max: 3 };

      // 前 3 次应该通过
      for (let i = 0; i < 3; i++) {
        const result = checkRateLimit(key, config);
        expect(result.limited).toBe(false);
      }

      // 第 4 次应该被限制
      const result = checkRateLimit(key, config);
      expect(result.limited).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should reset after the window expires', async () => {
      const key = 'test-window-reset';
      const config = { windowMs: 100, max: 2 }; // 100ms 窗口

      // 耗尽限额
      checkRateLimit(key, config);
      checkRateLimit(key, config);
      const result1 = checkRateLimit(key, config);
      expect(result1.limited).toBe(true);

      // 等待窗口过期
      await new Promise((resolve) => setTimeout(resolve, 150));

      // 应该重置
      const result2 = checkRateLimit(key, config);
      expect(result2.limited).toBe(false);
    });

    it('should return correct reset time', () => {
      const key = 'test-reset-time';
      const config = { windowMs: 60000, max: 10 };

      const result = checkRateLimit(key, config);
      expect(result.resetTime).toBeGreaterThan(Date.now());
      expect(result.resetTime).toBeLessThanOrEqual(Date.now() + config.windowMs);
    });
  });

  describe('getRateLimitConfig', () => {
    it('should return correct config for rooms', () => {
      const config = getRateLimitConfig('/api/rooms');
      expect(config.max).toBe(20);
      expect(config.windowMs).toBe(60000);
    });

    it('should return correct config for admin messages', () => {
      const config = getRateLimitConfig('/api/admin/messages');
      expect(config.max).toBe(20);
    });

    it('should return correct config for admin audit logs', () => {
      const config = getRateLimitConfig('/api/admin/audit-logs');
      expect(config.max).toBe(10);
    });

    it('should return correct config for upload', () => {
      const config = getRateLimitConfig('/api/upload-media');
      expect(config.max).toBe(10);
    });

    it('should return correct config for messages', () => {
      const config = getRateLimitConfig('/api/messages');
      expect(config.max).toBe(30);
    });

    it('should return default config for unknown paths', () => {
      const config = getRateLimitConfig('/api/some-unknown-endpoint');
      expect(config.max).toBe(60); // 默认值
    });

    it('should match path prefix correctly', () => {
      const config = getRateLimitConfig('/api/admin/rooms');
      expect(config.max).toBe(10); // admin rooms 限流
    });
  });

  describe('getClientIp', () => {
    it('should extract CF-Connecting-IP header', () => {
      const request = new Request('http://localhost', {
        headers: {
          'CF-Connecting-IP': '1.2.3.4',
          'X-Forwarded-For': '5.6.7.8',
        },
      });
      const ip = getClientIp(request);
      expect(ip).toBe('1.2.3.4');
    });

    it('should fall back to X-Forwarded-For', () => {
      const request = new Request('http://localhost', {
        headers: {
          'X-Forwarded-For': '5.6.7.8, 9.10.11.12',
        },
      });
      const ip = getClientIp(request);
      expect(ip).toBe('5.6.7.8');
    });

    it('should fall back to the "unknown" bucket when no IP headers', () => {
      const request = new Request('http://localhost');
      const ip = getClientIp(request);
      // 返回固定字符串而非 null：限流 key 必须是字符串，缺失 IP 时统一归入 unknown 桶
      expect(ip).toBe('unknown');
    });
  });
});
