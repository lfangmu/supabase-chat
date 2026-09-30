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

import type { RelayPayload } from './realtimeRelay';

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

/**
 * 房间 presence 状态的上界（P3 修复）。
 *
 * 此前 `roomStates` 是「只增不删」的 Map —— 每访问一个房间就多一个条目，
 * 长会话（尤其是不断在通讯录里点开不同私聊）会随访问房间数无限增长。
 * 这里加上界 + 淘汰最久未更新的房间（Map 迭代顺序 = 插入顺序，
 * 每次写入前先 delete 再 set，即近似 LRU）。
 */
const MAX_ROOM_STATES = 50;

function setRoomState(roomId: string, state: PresenceState): void {
  // 先删再插 → 刷新插入顺序（近似 LRU）
  roomStates.delete(roomId);
  roomStates.set(roomId, state);
  while (roomStates.size > MAX_ROOM_STATES) {
    const oldest = roomStates.keys().next();
    if (oldest.done) break;
    roomStates.delete(oldest.value);
  }
}

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
export function applyRelayPresence(data: RelayPayload): void {
  if (!data) return;
  const roomId = typeof data.roomId === 'string' ? data.roomId : '';
  if (!roomId) return;
  const isGlobal = roomId === '__global__';

  if (data.event === 'sync') {
    const next = normalize(data.state);
    if (isGlobal) globalState = next;
    else setRoomState(roomId, next);
    notify();
    return;
  }

  // diff：在现有状态上合并
  //
  // ⚠️ 顺序与粒度都关键 —— 这是「明明在线却显示离线」的真正根因。
  // Supabase/Phoenix 在**同一个 key 重新 track** 时（周期性重同步、重连、
  // 同账号多标签页），会发一条**同时包含**该 key 的 joins（新 phx_ref）与
  // leaves（旧 phx_ref）的 diff。若把 leaves 当成「整键删除」，重同步一到就把
  // 该用户从在线列表里抹掉 —— 每 90s 抹一次，双方于是长期互相显示「离线」，
  // 而消息实时收发一切正常。正确做法：先按 phx_ref 精确移除 leaves，再并入 joins。
  const prev: PresenceState = (isGlobal ? globalState : roomStates.get(roomId)) || {};
  const next: PresenceState = { ...prev };

  if (data.leaves && typeof data.leaves === 'object') {
    for (const [key, v] of Object.entries(data.leaves as Record<string, unknown>)) {
      const removing = toMetas(v);
      const existing = next[key];
      // 拿不到 metas（老形状）或本地没有该 key → 退回整键删除
      if (!existing || !removing) {
        delete next[key];
        continue;
      }
      const refs = new Set(
        removing
          .map((m) => m.phx_ref)
          .filter((r): r is string => typeof r === 'string' && r !== '')
      );
      // 没有 phx_ref 可对 → 只能整键删除
      if (refs.size === 0) {
        delete next[key];
        continue;
      }
      const kept = existing.filter(
        (m) => typeof m.phx_ref !== 'string' || !refs.has(m.phx_ref)
      );
      if (kept.length > 0) next[key] = kept;
      else delete next[key];
    }
  }
  if (data.joins && typeof data.joins === 'object') {
    for (const [key, v] of Object.entries(data.joins as Record<string, unknown>)) {
      const metas = toMetas(v);
      if (!metas) continue;
      const existing = next[key];
      if (!existing) {
        next[key] = metas;
        continue;
      }
      // 同一 key 可有多条 meta（多标签页 / 重连残留旧 ref）：按 phx_ref 去重合并。
      // 新增的 meta 必须排在**后面**（flatten 取最后一条 = 最新）。
      const byRef = new Map<string, RelayPresenceMeta>();
      let seq = 0;
      for (const m of existing) {
        byRef.set(typeof m.phx_ref === 'string' && m.phx_ref ? m.phx_ref : `__noref_${seq++}`, m);
      }
      for (const m of metas) {
        byRef.set(typeof m.phx_ref === 'string' && m.phx_ref ? m.phx_ref : `__noref_${seq++}`, m);
      }
      next[key] = Array.from(byRef.values());
    }
  }

  if (isGlobal) globalState = next;
  else setRoomState(roomId, next);
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
