import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt, timingSafeEqual, extractSession, hashPassword, verifyPassword } from '@/lib/auth';

describe('auth', () => {
  const secret = 'test-secret-key-12345';

  describe('signJwt and verifyJwt', () => {
    it('should sign and verify a valid JWT', async () => {
      const payload = { room: 'default-room', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await signJwt(payload, secret);
      const result = await verifyJwt(token, secret);
      expect(result.valid).toBe(true);
      expect(result.payload?.room).toBe('default-room');
    });

    it('should reject token with wrong secret', async () => {
      const payload = { room: 'default-room' };
      const token = await signJwt(payload, secret);
      const result = await verifyJwt(token, 'wrong-secret');
      expect(result.valid).toBe(false);
    });

    it('should reject expired token', async () => {
      const payload = { room: 'default-room', exp: Math.floor(Date.now() / 1000) - 60 };
      const token = await signJwt(payload, secret);
      const result = await verifyJwt(token, secret);
      expect(result.valid).toBe(false);
    });

    it('should reject malformed token', async () => {
      const result = await verifyJwt('not.a.valid.jwt', secret);
      expect(result.valid).toBe(false);
    });

    it('should reject empty string', async () => {
      const result = await verifyJwt('', secret);
      expect(result.valid).toBe(false);
    });
  });

  describe('timingSafeEqual', () => {
    it('should return true for equal strings', async () => {
      const result = await timingSafeEqual('hello', 'hello');
      expect(result).toBe(true);
    });

    it('should return false for different strings', async () => {
      const result = await timingSafeEqual('hello', 'world');
      expect(result).toBe(false);
    });

    it('should return false for different length strings', async () => {
      const result = await timingSafeEqual('short', 'loooooong');
      expect(result).toBe(false);
    });

    it('should return true for empty strings', async () => {
      const result = await timingSafeEqual('', '');
      expect(result).toBe(true);
    });
  });

  describe('extractSession', () => {
    it('should extract and verify session from cookie header', async () => {
      const payload = { room: 'default-room', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await signJwt(payload, secret);
      const cookieHeader = `chat_session=${token}; other_cookie=value`;
      const result = await extractSession(cookieHeader, secret);
      expect(result.valid).toBe(true);
      expect(result.payload?.room).toBe('default-room');
    });

    it('should return invalid for null cookie header', async () => {
      const result = await extractSession(null, secret);
      expect(result.valid).toBe(false);
    });

    it('should return invalid when chat_session cookie is missing', async () => {
      const result = await extractSession('other_cookie=value', secret);
      expect(result.valid).toBe(false);
    });

    it('should return invalid for tampered token', async () => {
      const result = await extractSession('chat_session=tampered_token', secret);
      expect(result.valid).toBe(false);
    });
  });

  describe('hashPassword and verifyPassword', () => {
    it('should hash a password and verify the same password', async () => {
      const hash = await hashPassword('s3cret-password');
      expect(hash).toMatch(/^pbkdf2:sha256:\d+:/);
      const ok = await verifyPassword('s3cret-password', hash);
      expect(ok).toBe(true);
    });

    it('should reject a wrong password', async () => {
      const hash = await hashPassword('s3cret-password');
      const ok = await verifyPassword('wrong-password', hash);
      expect(ok).toBe(false);
    });

    it('should produce a different hash for the same password (random salt)', async () => {
      const h1 = await hashPassword('same-password');
      const h2 = await hashPassword('same-password');
      expect(h1).not.toBe(h2);
      expect(await verifyPassword('same-password', h1)).toBe(true);
      expect(await verifyPassword('same-password', h2)).toBe(true);
    });

    it('should reject null/undefined/garbage stored hash', async () => {
      expect(await verifyPassword('x', null)).toBe(false);
      expect(await verifyPassword('x', undefined)).toBe(false);
      expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
      expect(await verifyPassword('x', 'pbkdf2:sha256:notanumber:abc:def')).toBe(false);
    });
  });
});