// Safe localStorage write with quota handling

import { Message } from '@/types';
import { MESSAGE_CONFIG, STORAGE_CONFIG_KEYS } from '@/config';

export function safeSetCache(key: string, data: Message[]): void {
  try {
    const trimmed = data.slice(-MESSAGE_CONFIG.MAX_MESSAGES);
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(data.slice(-50)));
    } catch {
      // Give up on caching
    }
  }
}

export const CACHE_KEY_PREFIX = STORAGE_CONFIG_KEYS.MESSAGES_PREFIX;
