import { describe, it, expect } from 'vitest';
import { isTextMessage, isImageMessage, isVideoMessage, isVoiceMessage, isUploadItem } from '@/types';

describe('type guards', () => {
  describe('isTextMessage', () => {
    it('should return true for text message', () => {
      const msg = { id: '1', user: 'a', type: 'text' as const, content: 'hi', timestamp: '' };
      expect(isTextMessage(msg)).toBe(true);
    });

    it('should return false for image message', () => {
      const msg = { id: '1', user: 'a', type: 'image' as const, content: 'url', timestamp: '' };
      expect(isTextMessage(msg)).toBe(false);
    });
  });

  describe('isImageMessage', () => {
    it('should return true for image message', () => {
      const msg = { id: '1', user: 'a', type: 'image' as const, content: 'url', timestamp: '' };
      expect(isImageMessage(msg)).toBe(true);
    });
  });

  describe('isVideoMessage', () => {
    it('should return true for video message', () => {
      const msg = { id: '1', user: 'a', type: 'video' as const, content: 'url', timestamp: '' };
      expect(isVideoMessage(msg)).toBe(true);
    });
  });

  describe('isVoiceMessage', () => {
    it('should return true for voice message', () => {
      const msg = { id: '1', user: 'a', type: 'voice' as const, content: 'url', timestamp: '' };
      expect(isVoiceMessage(msg)).toBe(true);
    });
  });

  describe('isUploadItem', () => {
    it('should return true for valid upload item', () => {
      expect(isUploadItem({ progress: 50, fileName: 'test.png' })).toBe(true);
    });

    it('should return false for invalid object', () => {
      expect(isUploadItem({})).toBe(false);
      expect(isUploadItem(null)).toBe(false);
      expect(isUploadItem('string')).toBe(false);
    });
  });
});