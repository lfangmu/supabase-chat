// Safe localStorage write with quota handling

import { Message } from '@/types';
import { MESSAGE_CONFIG, STORAGE_CONFIG_KEYS, MESSAGE_CACHE_VERSION } from '@/config';

/**
 * 估算一条消息序列化后的字节数（不真的 `JSON.stringify`，避免双倍开销）。
 *
 * 粗略按「UTF-16 字符数 × 2」计：中文字符在 JSON 里不被转义，1 个字符占 2 字节；
 * 控制字符/引号会被转义成 2 字符，但比例很低。这是**保守偏高**的估算，
 * 用于字节预算裁剪足够（宁可少缓存几条，也不要撞配额）。
 */
function estimateMessageBytes(m: Message): number {
  let size = 64; // 字段名 / 标点 / 时间戳等固定开销的粗估
  size += (m.content?.length ?? 0) * 2;
  size += (m.user?.length ?? 0) * 2;
  size += (m.file_name?.length ?? 0) * 2;
  if (m.quote) size += (m.quote.content?.length ?? 0) * 2 + 32;
  return size;
}

/**
 * 安全写消息缓存：按「条数上限 + 字节预算」从**最新**往旧裁剪，再落盘。
 *
 * P2-21 修复：此前只做 `data.slice(-MAX_MESSAGES)`（当时是 10 万）就 `JSON.stringify`，
 * 必然超 localStorage 配额、每次都白白做一次巨型同步序列化，然后回退只写 50 条。
 * 现在：
 *   1. 先用**估算字节**从尾部（最新）向前累计，直到触达 `MAX_CACHE_BYTES`；
 *   2. 再受 `MAX_MESSAGES` 条数约束；
 *   3. 只对裁剪后的结果序列化一次。
 * 兜底：真遇到 `QuotaExceededError` 时逐级降半重试，最终放弃（不抛错、不阻断主流程）。
 */
export function safeSetCache(key: string, data: Message[]): void {
  const countLimited = data.length > MESSAGE_CONFIG.MAX_MESSAGES
    ? data.slice(data.length - MESSAGE_CONFIG.MAX_MESSAGES)
    : data;

  const trimmed: Message[] = [];
  let bytes = 0;
  for (let i = countLimited.length - 1; i >= 0; i -= 1) {
    const item = countLimited[i];
    if (!item) continue;
    const size = estimateMessageBytes(item);
    if (bytes + size > MESSAGE_CONFIG.MAX_CACHE_BYTES) break;
    bytes += size;
    trimmed.push(item);
  }
  trimmed.reverse();

  // 极端情况（单条消息就超预算）也要至少留一条，否则离线缓存完全失效
  const finalData = trimmed.length > 0 ? trimmed : countLimited.slice(-1);

  try {
    localStorage.setItem(key, JSON.stringify(finalData));
    return;
  } catch {
    /* 继续降级 */
  }

  // 配额兜底：逐级减半
  let attempt = finalData;
  for (let i = 0; i < 4 && attempt.length > 1; i += 1) {
    attempt = attempt.slice(Math.ceil(attempt.length / 2));
    try {
      localStorage.setItem(key, JSON.stringify(attempt));
      return;
    } catch {
      /* 继续降级 */
    }
  }
}

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
