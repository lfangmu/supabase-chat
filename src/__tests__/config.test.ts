import { describe, it, expect } from 'vitest';
import {
  STORAGE_CONFIG,
  UPLOAD_CONFIG,
  MESSAGE_CONFIG,
  AUTH_CONFIG,
  ROOM_CONFIG,
  DM_CONFIG,
  API_CONFIG,
  DRAFT_CONFIG,
  SEARCH_CONFIG,
} from '@/config';

describe('config', () => {
  describe('STORAGE_CONFIG', () => {
    it('should have bucket name', () => {
      expect(STORAGE_CONFIG.BUCKET_NAME).toBeTruthy();
      expect(typeof STORAGE_CONFIG.BUCKET_NAME).toBe('string');
    });

    it('should have signed url expiry', () => {
      expect(STORAGE_CONFIG.SIGNED_URL_EXPIRY).toBeGreaterThan(0);
    });
  });

  describe('UPLOAD_CONFIG', () => {
    it('should have max file size', () => {
      expect(UPLOAD_CONFIG.MAX_FILE_SIZE).toBeGreaterThan(0);
    });

    it('should have allowed image types', () => {
      expect(UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES.length).toBeGreaterThan(0);
    });

    it('should have allowed video types', () => {
      expect(UPLOAD_CONFIG.ALLOWED_VIDEO_TYPES.length).toBeGreaterThan(0);
    });

    it('should have allowed voice types', () => {
      expect(UPLOAD_CONFIG.ALLOWED_VOICE_TYPES.length).toBeGreaterThan(0);
    });

    it('should have image compression config', () => {
      expect(UPLOAD_CONFIG.IMAGE_COMPRESSION.QUALITY).toBeGreaterThan(0);
      expect(UPLOAD_CONFIG.IMAGE_COMPRESSION.QUALITY).toBeLessThanOrEqual(1);
    });
  });

  describe('MESSAGE_CONFIG', () => {
    it('should have page size', () => {
      expect(MESSAGE_CONFIG.PAGE_SIZE).toBeGreaterThan(0);
    });

    it('should have max content length', () => {
      expect(MESSAGE_CONFIG.MAX_CONTENT_LENGTH).toBeGreaterThan(0);
    });
  });

  describe('AUTH_CONFIG', () => {
    it('should have session cookie name', () => {
      expect(AUTH_CONFIG.SESSION_COOKIE).toBeTruthy();
    });

    it('should have jwt expiry', () => {
      expect(AUTH_CONFIG.JWT_EXPIRY).toBeGreaterThan(0);
    });
  });

  describe('ROOM_CONFIG', () => {
    it('should have default room', () => {
      expect(ROOM_CONFIG.DEFAULT_ROOM).toBeTruthy();
    });
  });

  describe('DM_CONFIG', () => {
    it('should have id prefix', () => {
      expect(DM_CONFIG.ID_PREFIX).toBeTruthy();
    });
  });

  describe('API_CONFIG', () => {
    it('should have all required endpoints', () => {
      expect(API_CONFIG.MESSAGES_ENDPOINT).toBeTruthy();
      expect(API_CONFIG.UPLOAD_MEDIA_ENDPOINT).toBeTruthy();
      expect(API_CONFIG.AUTH_LOGIN_ENDPOINT).toBeTruthy();
      expect(API_CONFIG.AUTH_REGISTER_ENDPOINT).toBeTruthy();
      expect(API_CONFIG.AUTH_LOGOUT_ENDPOINT).toBeTruthy();
      expect(API_CONFIG.AUTH_ME_ENDPOINT).toBeTruthy();
      expect(API_CONFIG.ADMIN_VERIFY_ENDPOINT).toBeTruthy();
      expect(API_CONFIG.ADMIN_ROOMS_ENDPOINT).toBeTruthy();
      expect(API_CONFIG.ADMIN_AUDIT_LOGS_ENDPOINT).toBeTruthy();
    });
  });

  describe('DRAFT_CONFIG', () => {
    it('should have debounce delay', () => {
      expect(DRAFT_CONFIG.DEBOUNCE_DELAY).toBeGreaterThan(0);
    });

    it('should have expiry', () => {
      expect(DRAFT_CONFIG.EXPIRY_MS).toBeGreaterThan(0);
    });
  });

  describe('SEARCH_CONFIG', () => {
    it('should have debounce delay', () => {
      expect(SEARCH_CONFIG.DEBOUNCE_DELAY).toBeGreaterThan(0);
    });

    it('should have max results', () => {
      expect(SEARCH_CONFIG.MAX_RESULTS).toBeGreaterThan(0);
    });
  });
});
