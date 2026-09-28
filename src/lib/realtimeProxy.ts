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
import { SUPABASE_TARGET_HOST, corsHeaders } from './supabaseProxy';

const BUILD = 'v30-env-derived-host-20260928';

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
  const rooms = (url.searchParams.get('rooms') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const userId = url.searchParams.get('userId') || '';
  const nickname = url.searchParams.get('nickname') || '';
  // Supabase Auth UUID：全局在线（presence:global）以 UUID 为 key，跨设备/多标签页合并成一条
  const guid = url.searchParams.get('guid') || '';
  // 诊断开关：仅当 ?debug=1 时才把服务端 WS 状态透出为 event: system 帧。
  const debug = url.searchParams.get('debug') === '1';

  if (!token) return new Response('missing token', { status: 401 });
  if (!apikey) return new Response('missing apikey', { status: 400 });

  const wsUrl = `wss://${SUPABASE_TARGET_HOST}/realtime/v1/websocket?apikey=${encodeURIComponent(
    apikey
  )}&vsn=1.0.0`;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const enqueue = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          /* controller closed */
        }
      };
      // keep-alive：防止 Cloudflare idle 断流（约 100s）
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(enc.encode(': keepalive\n\n'));
        } catch {
          /* ignore */
        }
      }, 15000);

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
            config: { broadcast: { self: false }, presence: { key: '' } },
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
        // 心跳，保持 WS 存活
        hb = setInterval(() => {
          send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
        }, 25000);
      });

      ws.addEventListener('message', (e) => {
        let msg: any;
        try {
          msg = JSON.parse(e.data as string);
        } catch {
          return;
        }
        wsMsgCount++;
        wsLastEvt = msg.event;
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
        const t = msg.topic;
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
          const p = msg.payload || {};
          enqueue(
            p.type === 'UPDATE' ? 'message-update' : 'message-insert',
            { roomId: topicRoom(t), row: p.data }
          );
        } else if (evt === 'broadcast') {
          enqueue('broadcast', {
            roomId: topicRoom(t),
            event: msg.payload && msg.payload.event,
            payload: msg.payload && msg.payload.payload,
          });
        } else if (evt === 'presence_state') {
          enqueue('presence', {
            roomId: topicRoom(t),
            event: 'sync',
            state: msg.payload || {},
          });
        } else if (evt === 'presence_diff') {
          enqueue('presence', {
            roomId: topicRoom(t),
            event: 'diff',
            joins: (msg.payload && msg.payload.joins) || {},
            leaves: (msg.payload && msg.payload.leaves) || {},
          });
        } else if (evt === 'system') {
          enqueue('system', msg.payload);
        }
      });

      const cleanup = () => {
        if (keepalive) clearInterval(keepalive);
        if (diagTick) clearInterval(diagTick);
        if (hb) clearInterval(hb);
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
      /* abort 已处理清理 */
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
export async function handleRealtimeSend(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : body.token || '';
  const apikey =
    request.headers.get('x-supabase-apikey') || body.apikey || '';
  const { roomId, event, payload } = body;
  if (!token || !apikey || !roomId || !event) {
    return new Response('missing params', { status: 400 });
  }
  // roomId === '__global__' → 发到全局 chat-events 频道（room-updated / new-dm）
  const topic =
    roomId === '__global__' ? 'realtime:chat-events' : `realtime:chat-room:${roomId}`;

  const wsUrl = `wss://${SUPABASE_TARGET_HOST}/realtime/v1/websocket?apikey=${encodeURIComponent(
    apikey
  )}&vsn=1.0.0`;
  const ws = new WebSocket(wsUrl);
  try {
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res());
      ws.addEventListener('error', () => rej(new Error('ws open failed')));
    });
    ws.send(
      JSON.stringify({
        topic,
        event: 'phx_join',
        payload: {
          config: { broadcast: { self: false }, presence: { key: '' } },
          access_token: token,
        },
        ref: '1',
        join_ref: '1',
      })
    );
    await new Promise((r) => setTimeout(r, 400)); // 等 join ack
    // 转发 broadcast —— 必须带 ref + join_ref，否则 Phoenix 无法路由到已 join 的频道
    ws.send(
      JSON.stringify({
        topic,
        event: 'broadcast',
        payload: { event, payload },
        ref: '2',
        join_ref: '1',
      })
    );
    await new Promise((r) => setTimeout(r, 300));
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'send_failed', detail: String(err) }),
      {
        status: 502,
        headers: { 'content-type': 'application/json', ...corsHeaders(request) },
      }
    );
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
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
