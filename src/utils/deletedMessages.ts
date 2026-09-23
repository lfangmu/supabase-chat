import { STORAGE_CONFIG_KEYS } from '@/config';

/**
 * 本地「删除」的消息 ID（微信语义：删除只对自己生效，不影响对方）。
 * 与「撤回」区分：撤回是双方都看到「X 撤回了一条消息」。
 */
const MAX_KEEP = 5000;

export function getDeletedMessageIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEYS.DELETED_MESSAGES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function addDeletedMessageId(id: string): Set<string> {
  const set = getDeletedMessageIds();
  set.add(id);
  // 防止无限增长
  const arr = Array.from(set).slice(-MAX_KEEP);
  try {
    localStorage.setItem(STORAGE_CONFIG_KEYS.DELETED_MESSAGES_KEY, JSON.stringify(arr));
  } catch {
    /* 容量满时忽略 */
  }
  return new Set(arr);
}
