import { describe, it, expect } from 'vitest';
import { isUrlSafe } from '@/lib/ssrf-guard';

describe('ssrf-guard', () => {
  describe('isUrlSafe', () => {
    it('should allow standard HTTPS URLs', () => {
      expect(isUrlSafe('https://example.com')).toBe(true);
      expect(isUrlSafe('https://www.google.com/search?q=test')).toBe(true);
    });

    it('should allow standard HTTP URLs', () => {
      expect(isUrlSafe('http://example.com')).toBe(true);
    });

    it('should reject non-HTTP protocols', () => {
      expect(isUrlSafe('ftp://example.com')).toBe(false);
      expect(isUrlSafe('file:///etc/passwd')).toBe(false);
      expect(isUrlSafe('javascript:alert(1)')).toBe(false);
    });

    it('should reject localhost', () => {
      expect(isUrlSafe('http://localhost')).toBe(false);
      expect(isUrlSafe('http://localhost:3000')).toBe(false);
    });

    it('should reject 127.x.x.x loopback addresses', () => {
      expect(isUrlSafe('http://127.0.0.1')).toBe(false);
      expect(isUrlSafe('http://127.0.0.1:8080')).toBe(false);
      expect(isUrlSafe('http://127.1.1.1')).toBe(false);
    });

    it('should reject 10.x.x.x private addresses', () => {
      expect(isUrlSafe('http://10.0.0.1')).toBe(false);
      expect(isUrlSafe('http://10.255.255.255')).toBe(false);
    });

    it('should reject 192.168.x.x private addresses', () => {
      expect(isUrlSafe('http://192.168.0.1')).toBe(false);
      expect(isUrlSafe('http://192.168.1.100')).toBe(false);
    });

    it('should reject 172.16-31.x.x private addresses', () => {
      expect(isUrlSafe('http://172.16.0.1')).toBe(false);
      expect(isUrlSafe('http://172.31.255.255')).toBe(false);
    });

    it('should allow 172.32.x.x (not private range)', () => {
      expect(isUrlSafe('http://172.32.0.1')).toBe(true);
    });

    it('should reject 0.0.0.0', () => {
      expect(isUrlSafe('http://0.0.0.0')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isUrlSafe('not-a-url')).toBe(false);
      expect(isUrlSafe('')).toBe(false);
    });
  });
});
