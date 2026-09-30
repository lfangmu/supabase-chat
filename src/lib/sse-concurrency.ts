/**
 * SSE 并发连接数上限（P1-2）。
 *
 * 背景：CODE-REVIEW-2026-09-28 指出 `/api/realtime`（SSE 长连接）缺「per-user / per-IP
 * 并发条数」上限。每条 SSE 会在服务端新开一条到 Supabase 的 WebSocket，若无上限，
 * 拿一条合法 token 就能开几百条 SSE → 放大上游 WS + 服务端内存。
 *
 * 为什么是「每边缘实例」而不是全局：
 *   Cloudflare Pages（@cloudflare/next-on-pages）是无状态边缘多实例，跨实例共享计数
 *   需要 Durable Objects / KV。next-on-pages 不负责打包自定义 DO 类（必须在独立 Worker
 *   里），且本机无法验证其部署。本项目 relay 也明确是「无 Durable Object 版」。因此这里
 *   采用与 src/lib/rate-limit.ts 一致的「进程内 Map」实现。
 *
 * 🔴 关键教训：这里的计数**不能只靠「断开回调」释放**（第一版就是这么写的，线上直接出事）。
 *   实测在 Cloudflare Pages 上，浏览器断开后 `request.signal` 的 abort、
 *   上游 WS 的 close/error **都不可靠**（可能一个都不触发）。若只在那些回调里释放，
 *   槽位会永久泄漏 ⇒ 用户开满 10 条后**再也连不上**（实测 45s 后仍是 429）。
 *   ⇒ 因此本模块改成「**带 TTL 的租约**」：
 *     - 每条连接占一个租约（connId），TTL = SSE_SLOT_TTL_MS；
 *     - 只有在「客户端确实在消费」（`controller.desiredSize > 0`）时才续租；
 *     - 死连接不再续租 ⇒ 最多 TTL 后自动过期，槽位回收，用户自愈。
 *   这样即便平台不上报断开，也不会把用户永久挡在门外（最坏情况是短暂超限，TTL 内恢复）。
 *
 * 为什么这仍然有效：
 *   长连接 SSE 在其生命周期内被钉在**同一个边缘实例**上，单个客户端（或同一出口 IP）
 *   打开的 N 条 SSE 基本都落在同一实例，所以「每实例上限」≈「对该客户端的实际上限」，
 *   足以压制上述放大攻击（攻击目标是「几百条」级别，撞 10/30 上限即被拦下）。
 *
 * 架构决定（已拍板，勿改）：**不引入 Durable Object 依赖**。
 *   跨实例全局硬上限需要独立 DO Worker + service binding，等于新增一个部署单元与一套
 *   绑定配置，复杂度与运维成本远高于收益。本项目的 SSE 中继是「一条浏览器连接 = 服务端
 *   一条 WS」的无 DO 架构，且此处只需要压制放大、不需要精确全局计数。
 */

/** 单个已登录用户允许的最大并发 SSE 数（覆盖多标签 / 多设备，同时仍压制放大） */
export const SSE_MAX_PER_USER = 10;
/** 单个客户端 IP 允许的最大并发 SSE 数（压制共享出口 / 少量 token 滥用） */
export const SSE_MAX_PER_IP = 30;
/**
 * 租约时长。连接必须靠「客户端在消费」持续续租；死连接最多占用这么久就被回收。
 * 取值需大于续租周期（keepalive 15s）的好几倍，避免正常用户被误回收。
 */
export const SSE_SLOT_TTL_MS = 120_000;

/** key -> (connId -> expiresAt) */
type SlotMap = Map<string, Map<string, number>>;

// 进程内租约表：按边缘实例隔离，实例回收即自动归零。
const userSlots: SlotMap = new Map();
const ipSlots: SlotMap = new Map();

export interface SSESlotExceeded {
  kind: 'user' | 'ip';
  limit: number;
  current: number;
}

export interface SSEAcquireResult {
  allowed: boolean;
  /** 成功时返回的租约 id，续租 / 释放都要带上它 */
  connId?: string;
  exceeded?: SSESlotExceeded;
}

function reap(map: SlotMap, now: number): void {
  for (const [key, m] of map) {
    for (const [cid, exp] of m) {
      if (exp <= now) m.delete(cid);
    }
    if (m.size === 0) map.delete(key);
  }
}

function liveCount(map: SlotMap, key: string): number {
  return map.get(key)?.size ?? 0;
}

function put(map: SlotMap, key: string, connId: string, expiresAt: number): void {
  let m = map.get(key);
  if (!m) {
    m = new Map<string, number>();
    map.set(key, m);
  }
  m.set(connId, expiresAt);
}

function drop(map: SlotMap, key: string, connId: string): void {
  const m = map.get(key);
  if (!m) return;
  m.delete(connId);
  if (m.size === 0) map.delete(key);
}

function touch(map: SlotMap, key: string, connId: string, expiresAt: number): void {
  const m = map.get(key);
  if (!m || !m.has(connId)) return; // 已过期/已释放的连接不能再续租
  m.set(connId, expiresAt);
}

function userKeyOf(userId: string): string {
  return `u:${userId}`;
}
function ipKeyOf(ip: string): string {
  return ip && ip !== 'unknown' ? `ip:${ip}` : '';
}

/**
 * 为一个 SSE 连接申请「用户」+「IP」两个租约。
 * ip 为 'unknown'（无 CF 头，如本地开发）时跳过 IP 维度，避免误伤。
 */
export function acquireSSESlots(userId: string, ip: string): SSEAcquireResult {
  const now = Date.now();
  reap(userSlots, now);
  reap(ipSlots, now);

  const userKey = userKeyOf(userId);
  const ipKey = ipKeyOf(ip);

  const current = liveCount(userSlots, userKey);
  if (current >= SSE_MAX_PER_USER) {
    return { allowed: false, exceeded: { kind: 'user', limit: SSE_MAX_PER_USER, current } };
  }
  if (ipKey) {
    const ipCurrent = liveCount(ipSlots, ipKey);
    if (ipCurrent >= SSE_MAX_PER_IP) {
      return { allowed: false, exceeded: { kind: 'ip', limit: SSE_MAX_PER_IP, current: ipCurrent } };
    }
  }

  const connId = crypto.randomUUID();
  const expiresAt = now + SSE_SLOT_TTL_MS;
  put(userSlots, userKey, connId, expiresAt);
  if (ipKey) put(ipSlots, ipKey, connId, expiresAt);

  return { allowed: true, connId };
}

/**
 * 续租：**只在确认客户端仍在消费时调用**（由 SSE 的 keepalive 周期驱动）。
 * 死连接不会再调用它 ⇒ 租约到期自动回收。
 */
export function renewSSESlot(connId: string | undefined, userId: string, ip: string): void {
  if (!connId) return;
  const expiresAt = Date.now() + SSE_SLOT_TTL_MS;
  touch(userSlots, userKeyOf(userId), connId, expiresAt);
  const ipKey = ipKeyOf(ip);
  if (ipKey) touch(ipSlots, ipKey, connId, expiresAt);
}

/** 释放一个连接的租约（幂等）。 */
export function releaseSSESlot(
  connId: string | undefined,
  userId: string,
  ip: string
): void {
  if (!connId) return;
  drop(userSlots, userKeyOf(userId), connId);
  const ipKey = ipKeyOf(ip);
  if (ipKey) drop(ipSlots, ipKey, connId);
}

/** 供健康检查 / 调试读取当前并发占用维度数（不暴露具体 key）。 */
export function sseConcurrencySnapshot(): { users: number; ips: number; ttlMs: number } {
  return { users: userSlots.size, ips: ipSlots.size, ttlMs: SSE_SLOT_TTL_MS };
}
