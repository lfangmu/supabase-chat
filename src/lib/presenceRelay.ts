'use client';

// 服务端中继的 presence 状态仓库。
//
// 背景：浏览器不再直连 Supabase WebSocket，presence（在线列表）也改由 Worker 侧
// 代为 track，再以 SSE `event: presence` 帧推下来。Worker 转发的是原始协议形状：
//   * { event:'sync', state:  { key: { metas: [...] } } }   —— 全量（presence_state）
//   * { event:'diff', joins:  { key: { metas: [...] } },
//                     leaves: { key: { metas: [...] } } }    —— 增量（presence_diff）
//
// 这里负责把它合并成「当前在线用户列表」，供 usePresence（按房间）与
// useGlobalPresence（全局）消费。用模块级仓库是为了避免把 presence 事件一层层
// 透传到组件（useRelayRealtime 在 useMessages 里，而 presence 在 useChat 里用）。

export interface RelayPresenceMeta {
  id?: string;
  nickname?: string;
  online_at?: string;
  [k: string]: unknown;
}

/** key(=presence key) → 该 key 的 metas 列表 */
type PresenceState = Record<string, RelayPresenceMeta[]>;

const roomStates = new Map<string, PresenceState>();
let globalState: PresenceState = {};
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* 单个订阅者出错不应影响其他订阅者 */
    }
  });
};

export function subscribePresence(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 取每个 key 的最后一条 meta（与 supabase-js presenceState() 的取值语义一致） */
function flatten(state: PresenceState): RelayPresenceMeta[] {
  const out: RelayPresenceMeta[] = [];
  for (const metas of Object.values(state)) {
    if (!Array.isArray(metas) || metas.length === 0) continue;
    const latest = metas[metas.length - 1];
    if (latest) out.push(latest);
  }
  return out;
}

/** 兼容两种形状：{metas:[...]} 或直接就是数组 */
function toMetas(v: unknown): RelayPresenceMeta[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v as RelayPresenceMeta[];
  const metas = (v as { metas?: unknown }).metas;
  if (Array.isArray(metas)) return metas as RelayPresenceMeta[];
  return null;
}

function normalize(raw: unknown): PresenceState {
  const next: PresenceState = {};
  if (!raw || typeof raw !== 'object') return next;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const metas = toMetas(v);
    if (metas) next[key] = metas;
  }
  return next;
}

/**
 * 应用一条来自 SSE 的 presence 事件。
 * @param data { roomId, event, state?, joins?, leaves? }
 *              roomId === '__global__' 表示全局在线频道。
 */
export function applyRelayPresence(data: {
  roomId?: string;
  event?: string;
  state?: unknown;
  joins?: unknown;
  leaves?: unknown;
}): void {
  if (!data) return;
  const roomId = data.roomId || '';
  if (!roomId) return;
  const isGlobal = roomId === '__global__';

  if (data.event === 'sync') {
    const next = normalize(data.state);
    if (isGlobal) globalState = next;
    else roomStates.set(roomId, next);
    notify();
    return;
  }

  // diff：在现有状态上合并
  const prev: PresenceState = (isGlobal ? globalState : roomStates.get(roomId)) || {};
  const next: PresenceState = { ...prev };

  if (data.joins && typeof data.joins === 'object') {
    for (const [key, v] of Object.entries(data.joins as Record<string, unknown>)) {
      const metas = toMetas(v);
      if (metas) next[key] = metas;
    }
  }
  if (data.leaves && typeof data.leaves === 'object') {
    for (const key of Object.keys(data.leaves as Record<string, unknown>)) {
      delete next[key];
    }
  }

  if (isGlobal) globalState = next;
  else roomStates.set(roomId, next);
  notify();
}

/** 某房间的在线用户（meta 列表） */
export function getRoomPresence(roomId: string): RelayPresenceMeta[] {
  return flatten(roomStates.get(roomId) || {});
}

/** 全站在线用户（meta 列表，id 为 Supabase Auth UUID） */
export function getGlobalPresence(): RelayPresenceMeta[] {
  return flatten(globalState);
}
