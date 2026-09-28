import { STORAGE_CONFIG_KEYS } from '@/config';

/**
 * 微信式「清空聊天记录」：只在本机隐藏该房间**某一时刻之前**的全部消息，
 * 不动服务器数据，因此不会影响群里其他成员（与「删除」同语义，区别于「撤回」）。
 *
 * 为什么用「时间点」而不是「记录全部消息 id」：
 * - 一条记录就能表达整次清空，localStorage 占用恒定，不受房间消息条数影响；
 * - 不会像 `chat_deleted_messages` 那样撞上 MAX_KEEP 上限
 *   （一次清空大房间会把更早的删除标记挤出集合，导致旧消息「复活」）。
 *
 * 时间戳一律用**服务端**返回的 ISO 串（避免客户端时钟偏差）。
 */
export type ClearedRoomsMap = Record<string, string>;

export function getClearedRooms(): ClearedRoomsMap {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEYS.CLEARED_ROOMS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: ClearedRoomsMap = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 该房间「清空时刻」，未清空则返回 null。 */
export function getClearedAt(roomId: string): string | null {
  if (!roomId) return null;
  return getClearedRooms()[roomId] ?? null;
}

/** 记录「该房间已清空到 iso 时刻」，返回最新的完整映射。 */
export function setClearedAt(roomId: string, iso: string): ClearedRoomsMap {
  const map = getClearedRooms();
  map[roomId] = iso;
  try {
    localStorage.setItem(STORAGE_CONFIG_KEYS.CLEARED_ROOMS_KEY, JSON.stringify(map));
  } catch {
    /* 容量满时忽略 */
  }
  return map;
}

/**
 * 消息是否应被「清空聊天记录」隐藏。
 * 用 Date 解析而非字符串比较：服务端/客户端时间戳格式可能带不同时区后缀。
 */
export function isHiddenByClear(timestamp: string | undefined | null, clearedAt: string | null): boolean {
  if (!clearedAt || !timestamp) return false;
  const t = new Date(timestamp).getTime();
  const c = new Date(clearedAt).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(c)) return false;
  return t <= c;
}
