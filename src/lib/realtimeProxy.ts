// 服务端实时中继（无 Durable Object 版，同源 Pages Functions 版）
//
// 国内浏览器直连 Supabase Realtime 的 WebSocket 被掐，所以把"浏览器↔Supabase 的 WS"拆成两段：
//   * GET  /api/realtime       —— SSE 长连接（HTTP，国内通）。服务端 new WebSocket() 以服务端身份
//                                连 Supabase Realtime，订阅该用户所有房间的 postgres_changes /
//                                broadcast / presence + 全局 chat-events，再把事件转成 SSE 帧推回浏览器。
//   * POST /api/realtime/send  —— 浏览器→服务端的"发"动作（typing/edit/撤回/回执等）。每次短连接
//                                开一条 WS，join 房间频道后 broadcast，再关。
//
// 这样浏览器全程只碰 HTTP（SSE 收 + POST 发），绕开国内 WebSocket 封锁。
// 每个浏览器连接 = 服务端 1 条到 Supabase 的 WS（1:1，无 DO 扇出）。
//
// 移植自 supabase-proxy/worker.js（v28-presence-global-20260928）。
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_TARGET_HOST, corsHeaders } from './supabaseProxy';
import { getServiceClient } from './service-client';
import { isRoomParticipant, isDMParticipant } from './rooms';
import { getClientIp } from './rate-limit';
import {
  acquireSSESlots,
  releaseSSESlot,
  renewSSESlot,
  SSE_MAX_PER_USER,
  SSE_SLOT_TTL_MS,
} from './sse-concurrency';

const BUILD = 'v54-avatar-profile-card';

/**
 * Phoenix 协议帧（Supabase Realtime 的 WS 报文格式）。
 * 只类型化信封；`payload` 的形状随 `event` 而变，保持宽松字典由各分支自行收窄。
 */
interface PhoenixFrame {
  topic?: string;
  event?: string;
  payload?: Record<string, unknown>;
}

/**
 * 读取 SSE 队列积压量（用于背压保护）。
 * lib.dom 的 ReadableStreamDefaultController 未声明 `desiredSize`（虽然运行时必有），
 * 这里收敛成**唯一一处**窄断言并做类型判断，避免调用点散落 `as unknown as`。
 */
function queueDesiredSize(
  controller: ReadableStreamDefaultController<Uint8Array>
): number | null {
  const maybe = controller as ReadableStreamDefaultController<Uint8Array> & {
    desiredSize?: number | null;
  };
  return typeof maybe.desiredSize === 'number' ? maybe.desiredSize : null;
}

/** 全局在线频道的 presence 快照形状：key(=presence key) → { metas: [...] } */
type PresenceSnapshot = Record<string, { metas: unknown[] }>;

/** 兼容 `{ metas: [...] }` 与「直接是数组」两种形状。 */
function presenceMetas(v: unknown): unknown[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  const metas = (v as { metas?: unknown }).metas;
  return Array.isArray(metas) ? metas : null;
}

/** 取一条 meta 的 phx_ref（Phoenix 为每次 track 分配的引用）。 */
function presenceRef(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '';
  const ref = (meta as { phx_ref?: unknown }).phx_ref;
  return typeof ref === 'string' ? ref : '';
}

/** 只保留 `{ metas: [...] }` 形状的条目，过滤掉协议里的噪声键。 */
function normalizePresenceSnapshot(raw: unknown): PresenceSnapshot {
  const next: PresenceSnapshot = {};
  if (!raw || typeof raw !== 'object') return next;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const metas = presenceMetas(value);
    if (metas) next[key] = { metas };
  }
  return next;
}

/**
 * 把一条 presence 帧合并进「全局在线」的本地镜像。
 *
 * 为什么要在服务端留镜像：浏览器侧的在线列表原本完全依赖 Supabase 推下来的
 * presence_state（仅在 join 那一刻推一次全量）+ 后续 presence_diff 增量。
 * 这两个来源都不可靠 ——
 *   * 背压保护会丢弃「非消息类」帧（presence 就在其中）；
 *   * 客户端重连窗口内到达的 diff 会永久丢失（Supabase 不会补发）；
 *   * 双方几乎同时上线时，彼此的 join diff 可能都落在对方的建连窗口里。
 * 服务端→Supabase 的 WS 没有丢帧问题，所以这里的镜像是可信的；把它周期性整份
 * 推给浏览器即可让客户端自愈，无需依赖 diff 是否送达。
 *
 * ⚠️ leaves 必须**按 phx_ref 精确移除**：同一个 key 重新 track（周期性重同步 /
 * 重连 / 多标签页）时，diff 会同时带该 key 的 joins(新 ref) 与 leaves(旧 ref)，
 * 按「整键删除」处理会把刚重连回来的用户直接抹掉（客户端侧同款缺陷见
 * src/lib/presenceRelay.ts）。
 */
function mergePresenceSnapshot(
  prev: PresenceSnapshot,
  payload: unknown,
  kind: 'state' | 'diff'
): PresenceSnapshot {
  if (kind === 'state') return normalizePresenceSnapshot(payload);

  const next: PresenceSnapshot = { ...prev };
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

  const leaves = p.leaves;
  if (leaves && typeof leaves === 'object') {
    for (const [key, value] of Object.entries(leaves as Record<string, unknown>)) {
      const existing = next[key];
      const removing = presenceMetas(value);
      if (!existing || !removing) {
        delete next[key];
        continue;
      }
      const refs = new Set(removing.map(presenceRef).filter((r) => r !== ''));
      if (refs.size === 0) {
        delete next[key];
        continue;
      }
      const kept = existing.metas.filter((m) => {
        const ref = presenceRef(m);
        return ref === '' || !refs.has(ref);
      });
      if (kept.length > 0) next[key] = { metas: kept };
      else delete next[key];
    }
  }

  const joins = p.joins;
  if (joins && typeof joins === 'object') {
    for (const [key, value] of Object.entries(joins as Record<string, unknown>)) {
      const adding = presenceMetas(value);
      if (!adding) continue;
      const existing = next[key];
      if (!existing) {
        next[key] = { metas: adding };
        continue;
      }
      const byRef = new Map<string, unknown>();
      let seq = 0;
      for (const m of existing.metas) byRef.set(presenceRef(m) || `__noref_${seq++}`, m);
      for (const m of adding) byRef.set(presenceRef(m) || `__noref_${seq++}`, m);
      next[key] = { metas: Array.from(byRef.values()) };
    }
  }

  return next;
}

/**
 * 全局在线镜像的兜底推送间隔。
 *
 * 15s 是「最坏情况下对端从离线态自愈」的上界：即使所有 presence 增量帧都被丢弃、
 * 或客户端刚经历过重连，也会在这个周期内收到一份完整快照。单帧体积很小
 * （在线人数 × 一条 meta），代价可忽略。
 */
const PRESENCE_SYNC_MS = 15000;

// ============================================================
// 安全边界（P0-1 / P1-1 / P1-2）
//
// 中继是「同源 HTTP 旁路」：浏览器不再直连 Supabase Realtime，改由这里代发。
// 因此**这里就是唯一能鉴权的地方** —— 但数据库层也已加固：迁移 00026 在
// `realtime.messages` 上建了 RLS 策略，且项目已开启 Realtime Authorization
// （关闭 Allow public access），上游会按策略再卡一道「必须是我所在的房间 /
// 全局频道」，作为纵深防御。本代理仍必须自己校验，因为策略只认 JWT 里的身份，
// 且策略仅覆盖 realtime.messages（broadcast/subscribe 授权），不覆盖应用层语义
// （事件白名单、消息作者校验仍需本代理完成）。
//
// 之前本文件只校验「字段非空」，于是任意登录用户可以：
//   * 往任意房间广播 edit-message / withdraw-message → 篡改他人消息正文；
//   * 伪造 receipt / chat-reaction → 伪造已读与表情；
//   * 发 room-deleted → 把任意房间的在线用户踢出会话；
//   * 以任意 userId/guid 上报 presence → 伪造任意人在线/离线。
// 现在统一在服务端收敛：身份一律取自 token，房间一律校验成员资格。
// ============================================================

/** 允许经中继转发的 broadcast 事件白名单（不在表内的一律拒绝） */
const ALLOWED_BROADCAST_EVENTS = new Set([
  'typing-start',
  'typing-stop',
  'withdraw-message',
  'edit-message',
  'receipt',
  'chat-reaction',
  'room-deleted',
  'room-updated',
  'new-dm',
]);

/** 仅允许发往全局 chat-events 频道的事件 */
const GLOBAL_ONLY_EVENTS = new Set(['room-updated', 'new-dm']);

/** 需要「必须是消息作者本人」才能转发的事件（防篡改他人消息） */
const AUTHOR_ONLY_EVENTS = new Set(['edit-message', 'withdraw-message']);

/** 单条 SSE 允许订阅的房间数上限（防单连接放大） */
const MAX_ROOMS_PER_STREAM = 300;

/**
 * 校验 access token 并返回其真实用户 UUID。
 *
 * 走 Supabase Auth 的 /auth/v1/user 做**服务端验签**，而不是自己 base64 解 JWT——
 * 后者不验签名，等于没鉴权（任何人都能伪造 payload）。
 */
async function verifyAccessToken(token: string, apikey: string): Promise<string | null> {
  if (!token || !apikey) return null;
  try {
    const sb = createClient(`https://${SUPABASE_TARGET_HOST}`, apikey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * 计算某个用户「可读房间」的 id 集合：公共大厅 + 我加入的群 + 我创建的群 + 我参与的私聊。
 * 与 messages/search 的口径一致，用 3 次批量查询替代 N 次单房间判定。
 */
async function getActorRoomScope(actor: string): Promise<Set<string>> {
  const sb = getServiceClient();
  const [memberRes, createdRes, dmRes] = await Promise.all([
    sb.from('room_members').select('room_id').eq('user_id', actor),
    sb.from('rooms').select('id').eq('created_by', actor),
    sb
      .from('rooms')
      .select('id')
      .eq('type', 'dm')
      .or(`id.like.dm:${actor}:%,id.like.dm:%:${actor}`),
  ]);
  const scope = new Set<string>(['default-room']);
  for (const r of memberRes.data || []) scope.add(String(r.room_id));
  for (const r of createdRes.data || []) scope.add(String(r.id));
  for (const r of dmRes.data || []) scope.add(String(r.id));
  return scope;
}

// ---- SSE 接收中继 ----
export async function handleRealtimeSSE(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // 鉴权：优先 Authorization: Bearer（浏览器 fetch 流式可带头）；退路 ?token=
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : url.searchParams.get('token') || '';
  // apikey：公开可泄露，浏览器已知 NEXT_PUBLIC_SUPABASE_KEY，随请求传 ?apikey=。
  const apikey = url.searchParams.get('apikey') || '';
  const requestedRooms = (url.searchParams.get('rooms') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_ROOMS_PER_STREAM);
  // 诊断开关：仅当 ?debug=1 时才把服务端 WS 状态透出为 event: system 帧。
  const debug = url.searchParams.get('debug') === '1';

  if (!apikey) return new Response('missing apikey', { status: 400 });

  // ---- 鉴权：token 必须真实有效（服务端验签），身份一律以 token 为准 ----
  // 之前这里只判断 `!token`，于是 `?token=x` 就能建立 SSE 并在服务端新开一条到
  // Supabase 的 WebSocket（连接放大）；且 userId/guid/nickname 全部取自 query，
  // 任何人都能以别人的身份上报 presence。现在两者都收敛到 token。
  const actor = await verifyAccessToken(token, apikey);
  if (!actor) return new Response('unauthorized', { status: 401 });

  // ---- P1-2：SSE 并发连接数上限（每边缘实例）----
  // 每条 SSE 会新开一条到 Supabase 的 WS，必须先占槽再建流；否则一条 token 可开几百条 SSE 放大资源。
  // SSE 长连接被钉在单一边缘实例，故「每实例上限」≈「对该客户端的实际上限」，足以压制放大。
  //
  // ⚠️ 槽位是**带 TTL 的租约**，不是「断开才释放」。实测 Cloudflare Pages 上浏览器断开后
  // `request.signal` abort 与上游 WS 的 close/error 都不可靠；只在那些回调里释放会导致
  // 槽位永久泄漏（用户开满后永远 429）。所以改由 keepalive 周期里「客户端还在消费」续租，
  // 死连接不再续租 → TTL 到期自动回收。详见 src/lib/sse-concurrency.ts 顶部注释。
  const clientIp = getClientIp(request);
  const acquired = acquireSSESlots(actor, clientIp);
  if (!acquired.allowed) {
    return new Response(
      JSON.stringify({
        error: 'too_many_connections',
        kind: acquired.exceeded?.kind,
        limit: acquired.exceeded?.limit ?? SSE_MAX_PER_USER,
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '30',
          ...corsHeaders(request),
        },
      }
    );
  }
  const slotId = acquired.connId;
  // 释放逻辑：幂等，所有断开路径（abort / ws close / ws error / stream cancel）都会触发。
  let slotsReleased = false;
  const releaseSlots = () => {
    if (slotsReleased) return;
    slotsReleased = true;
    releaseSSESlot(slotId, actor, clientIp);
  };

  // ---- 房间范围收敛：只订阅「我确实可读」的房间 ----
  // 否则任意登录用户可以把 rooms 填成任意房间 id，向别人的房间注入 presence
  // （伪装成成员出现在对方的在线列表里）。
  let allowedRooms: string[] = [];
  try {
    const scope = await getActorRoomScope(actor);
    allowedRooms = requestedRooms.filter((id) => scope.has(id));
  } catch (err) {
    // fail-closed：拿不到权限范围就不订阅任何房间，宁可少收也不越权
    console.error('[realtime] room scope lookup failed:', err);
    allowedRooms = [];
  }
  const rooms = allowedRooms;

  // ---- presence 身份：UUID 为 key，昵称由服务端按 UUID 反查（不接受客户端自报）----
  const guid = actor;
  const userId = `user-${actor}`;
  let nickname = '';
  try {
    const { data } = await getServiceClient()
      .from('users')
      .select('display_name')
      .eq('id', actor)
      .maybeSingle();
    nickname = (data?.display_name as string) || '匿名用户';
  } catch {
    nickname = '匿名用户';
  }

  const wsUrl = `wss://${SUPABASE_TARGET_HOST}/realtime/v1/websocket?apikey=${encodeURIComponent(
    apikey
  )}&vsn=1.0.0`;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let droppedFrames = 0;
      const enqueue = (event: string, data: unknown) => {
        // 背压保护（P2-18）：ReadableStream 的默认队列没有上限。客户端读得慢
        // （弱网 / 后台标签被节流）时无限入队会让服务端内存持续增长，而
        // `controller.enqueue` 抛错时原来的实现又静默吞掉，问题完全不可见。
        // 策略：队列积压时优先丢弃**可丢弃**的增量事件（presence / broadcast /
        // 诊断帧），把有限的队列留给消息类事件（message-insert / message-update）。
        const queued = queueDesiredSize(controller);
        const isMessageEvent = event === 'message-insert' || event === 'message-update';
        if (typeof queued === 'number' && queued <= 0 && !isMessageEvent) {
          droppedFrames += 1;
          if (droppedFrames === 1) {
            console.warn('[realtime] SSE backpressure: dropping non-message frames');
          }
          return;
        }
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          /* controller closed */
        }
      };
      // P1-2：连续「客户端不再消费」的 tick 计数。
      // 客户端读不动（或已断开但平台上报不到）时 desiredSize 会持续 <= 0；
      // 连续超过 TTL 就判定为死连接，主动关流（顺带释放上游 WS 与并发槽）。
      let stalledTicks = 0;
      const PRESERVE_TICK_MS = 15000;
      const STALL_TICKS_BEFORE_CLOSE = Math.ceil(SSE_SLOT_TTL_MS / PRESERVE_TICK_MS);

      // keep-alive：防止 Cloudflare idle 断流（约 100s）
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(enc.encode(': keepalive\n\n'));
        } catch {
          /* ignore */
        }
        // 续租：只有在「队列被消费」时才认为客户端还活着。
        const pending = queueDesiredSize(controller);
        if (typeof pending === 'number' && pending > 0) {
          stalledTicks = 0;
          renewSSESlot(slotId, actor, clientIp);
        } else if (++stalledTicks >= STALL_TICKS_BEFORE_CLOSE) {
          // 长时间零消费 ⇒ 视为死连接：关上游 WS 与流，触发 cleanup() 释放槽位。
          console.warn('[realtime] SSE stalled; closing dead connection');
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      }, PRESERVE_TICK_MS);

      let wsOpen = false;
      let wsMsgCount = 0;
      let wsLastEvt = '';
      const diagTick = debug
        ? setInterval(() => {
            try {
              controller.enqueue(
                enc.encode(
                  `event: system\ndata: ${JSON.stringify({
                    diag: 'ws_tick',
                    open: wsOpen,
                    msgCount: wsMsgCount,
                    lastEvt: wsLastEvt,
                  })}\n\n`
                )
              );
            } catch {
              /* ignore */
            }
          }, 2000)
        : null;

      const ws = new WebSocket(wsUrl);
      let ref = 0;
      const nextRef = () => `${++ref}`;
      const send = (obj: unknown) => {
        try {
          ws.send(JSON.stringify(obj));
        } catch {
          /* ignore */
        }
      };

      // 线上 topic → roomId。全局频道（chat-events / presence:global）统一映射为 __global__。
      const topicRoom = (t: string) => {
        const s = t || '';
        if (s === 'realtime:chat-events' || s === 'realtime:presence:global')
          return '__global__';
        return s.replace(/^realtime:(chat-room|chat-bg|room):/, '');
      };

      let hb: ReturnType<typeof setInterval> | null = null;
      let presenceResync: ReturnType<typeof setInterval> | null = null;
      // 全局在线的本地镜像（见 mergePresenceSnapshot）：周期性整份下发，让客户端自愈。
      let globalPresence: PresenceSnapshot = {};
      let presenceSync: ReturnType<typeof setInterval> | null = null;

      ws.addEventListener('open', () => {
        wsOpen = true;
        if (debug) {
          try {
            controller.enqueue(
              enc.encode(`event: system\ndata: ${JSON.stringify({ diag: 'ws_open' })}\n\n`)
            );
          } catch {
            /* ignore */
          }
        }
        // 每个房间频道：postgres_changes(CDC) + broadcast + presence
        // ⚠️ 频道 topic 必须带 realtime: 前缀（supabase-js 会自动加），手写 WS 必须自己加。
        rooms.forEach((roomId) => {
          send({
            topic: `realtime:chat-room:${roomId}`,
            event: 'phx_join',
            payload: {
              config: {
                postgres_changes: [
                  {
                    event: '*',
                    schema: 'public',
                    table: 'messages',
                    filter: `room_id=eq.${roomId}`,
                  },
                ],
                broadcast: { self: false },
                presence: { key: userId || '' },
                private: true,
              },
              access_token: token,
            },
            ref: nextRef(),
            join_ref: '1',
          });
          if (userId) {
            send({
              topic: `realtime:chat-room:${roomId}`,
              event: 'presence',
              payload: {
                event: 'track',
                payload: {
                  id: userId,
                  nickname,
                  online_at: new Date().toISOString(),
                },
              },
              ref: nextRef(),
              join_ref: '1',
            });
          }
        });
        // 全局 chat-events 频道（room-updated / new-dm 广播）
        send({
          topic: 'realtime:chat-events',
          event: 'phx_join',
          payload: {
            config: { broadcast: { self: false }, presence: { key: '' }, private: true },
            access_token: token,
          },
          ref: nextRef(),
          join_ref: '1',
        });
        // 全局在线频道：以 Supabase Auth UUID 为 presence key，跨房间可见。
        send({
          topic: 'realtime:presence:global',
          event: 'phx_join',
          payload: {
            config: {
              presence: { key: guid ? `user-${guid}` : '' },
              broadcast: { self: false },
              private: true,
            },
            access_token: token,
          },
          ref: nextRef(),
          join_ref: '1',
        });
        if (guid) {
          send({
            topic: 'realtime:presence:global',
            event: 'presence',
            payload: {
              event: 'track',
              payload: { id: guid, nickname, online_at: new Date().toISOString() },
            },
            ref: nextRef(),
            join_ref: '1',
          });
        }
        // 周期性重发 presence track（presence 重同步）。
        //
        // 为什么需要：Supabase 只在「加入频道的那一刻」推一次全量 presence_state，
        // 之后仅靠 presence_diff 增量维护。若某个成员 join 的那一刻我们的连接恰好
        // 不在订阅态（重连窗口、上游 WS 被回收），这条 join 增量就永久丢失 ——
        // 客户端只在建连时做过一次全量同步，于是对端会**一直**显示「离线」，
        // 哪怕消息实时收发完全正常，直到我们自己重连为止。
        //
        // 修复：每 90s 重发一次自己的 track。Phoenix 会因此向频道内其他成员广播
        // 一条 `presence_diff(joins)`，对端据此把我们补回在线列表。
        // 注意这里刻意只重发 track、不发 untrack —— 避免产生 leave 而让对方
        // 界面上闪一下「离线」。
        presenceResync = setInterval(() => {
          const onlineAt = new Date().toISOString();
          rooms.forEach((roomId) => {
            if (!userId) return;
            send({
              topic: `realtime:chat-room:${roomId}`,
              event: 'presence',
              payload: { event: 'track', payload: { id: userId, nickname, online_at: onlineAt } },
              ref: nextRef(),
              join_ref: '1',
            });
          });
          if (guid) {
            send({
              topic: 'realtime:presence:global',
              event: 'presence',
              payload: { event: 'track', payload: { id: guid, nickname, online_at: onlineAt } },
              ref: nextRef(),
              join_ref: '1',
            });
          }
        }, 90000);

        // 周期性把「全局在线镜像」整份推给浏览器（自愈）。
        //
        // 与上面的 presenceResync 互补：presenceResync 是**向 Supabase 重报自己**
        // （让别的成员通过 diff 看到我们），这里是把**我们已知的全局在线列表**直接
        // 下发给本连接（让本端不再依赖 diff 是否送达）。少了这条，一次丢帧/重连
        // 就会让头部一直显示「离线」直到下一次 90s 重报。
        presenceSync = setInterval(() => {
          if (Object.keys(globalPresence).length === 0) return;
          enqueue('presence', {
            roomId: '__global__',
            event: 'sync',
            state: globalPresence,
          });
        }, PRESENCE_SYNC_MS);

        // 心跳，保持 WS 存活
        hb = setInterval(() => {
          send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
        }, 25000);
      });

      ws.addEventListener('message', (e) => {
        // Phoenix 帧：{ topic, event, payload, ref, join_ref }。payload 的形状随 event 而变，
        // 所以这里只把信封类型化，payload 保持宽松字典、由各分支自行收窄。
        let msg: PhoenixFrame;
        try {
          msg = JSON.parse(e.data as string) as PhoenixFrame;
        } catch {
          return;
        }
        wsMsgCount++;
        wsLastEvt = msg.event ?? '';
        if (debug && wsMsgCount <= 12) {
          try {
            controller.enqueue(
              enc.encode(
                `event: system\ndata: ${JSON.stringify({
                  diag: 'ws_msg',
                  evt: msg.event,
                  topic: (msg.topic || '').slice(0, 40),
                })}\n\n`
              )
            );
          } catch {
            /* ignore */
          }
        }
        const t = msg.topic ?? '';
        const evt = msg.event;
        if (evt === 'phx_reply') {
          if (debug && wsMsgCount <= 8) {
            try {
              controller.enqueue(
                enc.encode(
                  `event: system\ndata: ${JSON.stringify({
                    diag: 'ws_reply',
                    topic: (msg.topic || '').slice(0, 40),
                    status: msg.payload && msg.payload.status,
                    resp: msg.payload && msg.payload.response,
                  })}\n\n`
                )
              );
            } catch {
              /* ignore */
            }
          }
          return;
        }
        if (evt === 'postgres_changes') {
          const p = msg.payload ?? {};
          // Supabase Realtime 的 postgres_changes 负载形如：
          //   payload = { data: { schema, table, commit_timestamp, type, errors, columns, record, old_record }, ids }
          // 真正的行数据在 data.record，**不是** data 本身。
          // 若误把 data（信封）当行数据下发，下游 rowToMessage 读到的 id/user/timestamp 全是 undefined，
          // 症状就是消息时间戳变成 Invalid Date → 日期分隔线渲染出「NaN年NaN月NaN日 undefined」。
          //
          // 注意 DELETE 事件：Supabase 把 record 发成**空对象 `{}`**（不是 null），
          // 直接用 `??` 兜底会得到 `{}` → 客户端渲染出一个 id/content 全 undefined 的幽灵气泡。
          // 本应用没有「实时删除」协议（撤回/编辑都是 messages 行 UPDATE），故 DELETE 直接丢弃。
          const d: Record<string, unknown> =
            p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : {};
          const rec = d.record;
          const row =
            rec && typeof rec === 'object' && Object.keys(rec).length > 0 ? rec : null;
          if (row) {
            enqueue(d.type === 'UPDATE' ? 'message-update' : 'message-insert', {
              roomId: topicRoom(t),
              row,
            });
          }
        } else if (evt === 'broadcast') {
          enqueue('broadcast', {
            roomId: topicRoom(t),
            event: msg.payload && msg.payload.event,
            payload: msg.payload && msg.payload.payload,
          });
        } else if (evt === 'presence_state' || evt === 'presence_diff') {
          // ⚠️ chat-events 频道的 presence 必须丢弃。
          // topicRoom() 把 `realtime:chat-events` 和 `realtime:presence:global`
          // **映射到同一个 roomId `__global__`**；而 chat-events 也是带 presence 配置
          // 加入的（key 为空串）。若把它的 presence 帧一起下发，客户端 presence 仓库
          // 会把「空 key 成员」的 state/diff 合并进全局在线列表 —— 一条迟到的
          // presence_state 就会把整份 globalState 覆盖成只有空 key，症状是
          // 「双方互相显示离线」。全局在线只认 presence:global 一个频道。
          if (t !== 'realtime:chat-events') {
            // 服务端镜像：全局在线的唯一可信来源（见 mergePresenceSnapshot 注释）
            if (t === 'realtime:presence:global') {
              globalPresence = mergePresenceSnapshot(
                globalPresence,
                msg.payload,
                evt === 'presence_state' ? 'state' : 'diff'
              );
            }
            if (evt === 'presence_state') {
              enqueue('presence', {
                roomId: topicRoom(t),
                event: 'sync',
                state: msg.payload || {},
              });
            } else {
              enqueue('presence', {
                roomId: topicRoom(t),
                event: 'diff',
                joins: (msg.payload && msg.payload.joins) || {},
                leaves: (msg.payload && msg.payload.leaves) || {},
              });
            }
          }
        } else if (evt === 'system') {
          enqueue('system', msg.payload);
        }
      });

      const cleanup = () => {
        if (keepalive) clearInterval(keepalive);
        if (diagTick) clearInterval(diagTick);
        if (hb) clearInterval(hb);
        if (presenceResync) clearInterval(presenceResync);
        if (presenceSync) clearInterval(presenceSync);
        releaseSlots();
      };

      ws.addEventListener('close', (ev) => {
        cleanup();
        try {
          controller.enqueue(
            enc.encode(
              `event: system\ndata: ${JSON.stringify({ diag: 'ws_close', code: ev.code })}\n\n`
            )
          );
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
      ws.addEventListener('error', () => {
        cleanup();
        try {
          controller.enqueue(
            enc.encode(`event: system\ndata: ${JSON.stringify({ diag: 'ws_error' })}\n\n`)
          );
        } catch {
          /* ignore */
        }
        try {
          controller.error(new Error('realtime ws error'));
        } catch {
          /* ignore */
        }
      });

      // 浏览器断开 → 关 WS
      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
    },
    cancel() {
      /* abort / close 已处理清理（含释放 SSE 并发槽） */
      releaseSlots();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...corsHeaders(request),
    },
  });
}

// ---- 短连接转发 broadcast（发送）----
//
// ⚠️ 这是全项目**最需要鉴权**的端点：broadcast 的投递不受 RLS 约束，
// 一旦放行就等于把「以任意身份、向任意房间、发任意事件」的能力交给了客户端。
// 因此这里逐层校验：token 有效性 → 事件白名单 → 房间成员资格 → 消息作者本人。
export async function handleRealtimeSend(request: Request): Promise<Response> {
  const jsonError = (status: number, error: string, detail?: string) =>
    new Response(JSON.stringify(detail ? { error, detail } : { error }), {
      status,
      headers: { 'content-type': 'application/json', ...corsHeaders(request) },
    });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'bad_json');
  }
  const auth = request.headers.get('authorization') || '';
  // 请求体是外部输入：所有字段先收窄成已知类型再用，避免 `any` 把拼写错误静默放过。
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : typeof body.token === 'string'
      ? body.token
      : '';
  const apikey =
    request.headers.get('x-supabase-apikey') ||
    (typeof body.apikey === 'string' ? body.apikey : '');
  const roomId = typeof body.roomId === 'string' ? body.roomId : '';
  const event = typeof body.event === 'string' ? body.event : '';
  const payload: Record<string, unknown> =
    body.payload && typeof body.payload === 'object'
      ? (body.payload as Record<string, unknown>)
      : {};

  if (!token || !apikey || !roomId || !event) {
    return jsonError(400, 'missing_params');
  }

  // ---- 1) 身份：必须来自有效 token（服务端验签），不接受 body 自报 ----
  const actor = await verifyAccessToken(token, apikey);
  if (!actor) return jsonError(401, 'unauthorized');

  // ---- 2) 事件白名单：不在表内的一律拒绝（避免把中继当任意 topic 的广播跳板）----
  if (!ALLOWED_BROADCAST_EVENTS.has(event)) {
    return jsonError(403, 'event_not_allowed');
  }

  // ---- 3) 房间级授权 ----
  const isGlobal = roomId === '__global__';
  if (isGlobal) {
    // 全局 chat-events 只承载「列表刷新 / 新私聊发现」两类无内容信号
    if (!GLOBAL_ONLY_EVENTS.has(event)) return jsonError(403, 'global_event_not_allowed');
    // new-dm 会把 payload.roomId 加进对方侧边栏，必须确认发起方确实是该私聊的参与方
    if (event === 'new-dm' && !isDMParticipant(String(payload.roomId ?? ''), actor)) {
      return jsonError(403, 'not_dm_participant');
    }
  } else {
    if (roomId.length > 200) {
      return jsonError(400, 'invalid_room_id');
    }
    let allowed = false;
    try {
      allowed = await isRoomParticipant(roomId, actor, getServiceClient());
    } catch (err) {
      console.error('[realtime] membership check failed:', err);
      return jsonError(503, 'authz_unavailable');
    }
    if (!allowed) return jsonError(403, 'not_room_participant');
  }

  // ---- 4) 内容级授权：编辑/撤回必须是消息作者本人 ----
  // 仅校验「是房间成员」还不够：同房间的任何成员都能篡改别人的消息。
  if (AUTHOR_ONLY_EVENTS.has(event)) {
    const messageId = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!messageId || messageId.length > 100) return jsonError(400, 'invalid_message_id');
    try {
      const { data: msg } = await getServiceClient()
        .from('messages')
        .select('user_id, room_id')
        .eq('id', messageId)
        .maybeSingle();
      if (!msg) return jsonError(404, 'message_not_found');
      if (msg.user_id !== actor) return jsonError(403, 'not_message_author');
      if (!isGlobal && msg.room_id !== roomId) return jsonError(403, 'message_room_mismatch');
    } catch (err) {
      console.error('[realtime] message ownership check failed:', err);
      return jsonError(503, 'authz_unavailable');
    }
  }

  // roomId === '__global__' → 发到全局 chat-events 频道（room-updated / new-dm）
  //
  // ⚠️ REST 接口的 topic **不带** `realtime:` 前缀：`@supabase/realtime-js` 的
  // `httpSend()` 用的是 `channel.subTopic`（即 `topic.replace(/^realtime:/i, '')`），
  // 前缀由服务端补。WS 帧里的 topic 才需要带前缀（见上面的订阅侧）。
  // 已线上实测：带 `realtime:` 前缀的 topic 投递不到订阅端，不带前缀才能命中。
  const topic = isGlobal ? 'chat-events' : `chat-room:${roomId}`;

  // 广播投递改用官方 REST 通道：`POST /realtime/v1/api/broadcast`。
  //
  // 原实现是「为每条广播开一条 WS → 盲等 400ms 等 join ack → 推 broadcast 帧 → 关连接」，
  // 有两个致命问题：
  //   1) 从未真正等待 `phx_reply`：join 未完成时推帧会被 Phoenix 直接丢弃；
  //   2) 帧的 `payload` 缺 `type: 'broadcast'` —— 官方客户端推的是
  //      `{ event: 'broadcast', payload: { type: 'broadcast', event, payload } }`，
  //      服务端按 `payload.type` 分发，缺字段即静默忽略。
  // 两者叠加的结果：**所有广播都被上游丢弃**，而本接口照样返回 `{"ok":true}`
  // —— 症状是「正在输入 / 撤回 / 编辑 / 已读回执 / 表情回应」全部不实时生效，且无法从
  // 响应码察觉。REST 通道还顺带解决了性能问题：原先每次 typing 都要握手一次 WebSocket。
  const broadcastUrl = `https://${SUPABASE_TARGET_HOST}/realtime/v1/api/broadcast`;
  const controller = new AbortController();
  // 超时必须显式设置（P2-20）：上游卡住时不能把请求挂到平台超时。
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(broadcastUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [{ topic, event, payload, private: true }],
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      // 上游明确拒绝时不再谎报成功，便于客户端/日志定位。
      const detail = await upstream.text().catch(() => '');
      return jsonError(502, 'send_failed', `upstream ${upstream.status} ${detail.slice(0, 200)}`);
    }
  } catch (err) {
    return jsonError(502, 'send_failed', String(err));
  } finally {
    clearTimeout(timeout);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...corsHeaders(request) },
  });
}

// 诊断端点：确认部署版本与目标 host。
export async function handleRelayDebug(): Promise<Response> {
  return new Response(
    JSON.stringify({
      build: BUILD,
      targetHost: SUPABASE_TARGET_HOST,
      sameOrigin: true,
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    }
  );
}
