// Safe localStorage write with quota handling

import { Message } from '@/types';
import { MESSAGE_CONFIG, STORAGE_CONFIG_KEYS, MESSAGE_CACHE_VERSION } from '@/config';

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

/**
 * 消息缓存版本失效：每次执行破坏性迁移（TRUNCATE / 换库 / 改 schema）后，
 * 把 config 里的 MESSAGE_CACHE_VERSION +1，这里检测到本地版本不匹配就清掉
 * 全部 chat_messages_v1_* 缓存，避免「库已清空但旧消息仍显示」。
 * 幂等：版本一致时直接返回，不影响正常读写与离线缓存语义。
 */
export function invalidateMessageCacheIfNeeded(): void {
  try {
    const versionKey = STORAGE_CONFIG_KEYS.MESSAGE_CACHE_VERSION_KEY;
    const stored = localStorage.getItem(versionKey);
    if (stored === String(MESSAGE_CACHE_VERSION)) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith(STORAGE_CONFIG_KEYS.MESSAGES_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(versionKey, String(MESSAGE_CACHE_VERSION));
  } catch {
    // localStorage 不可用时静默忽略，不阻断主流程
  }
}
