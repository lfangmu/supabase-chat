'use client';

// 服务端中继的浏览器客户端。
// 替代 supabase.channel() 的 WebSocket 实时链路：浏览器全程只走 HTTP——
//   * 接收：fetch 流式读 SSE（可带 Authorization 头，token 不进 URL）
//   * 发送：POST /realtime/send（由 Worker 开短连接 WS 转发 broadcast）
//
// 用法见 src/hooks/useRelayRealtime.ts。

export type RelayEventType =
  | 'message-insert'
  | 'message-update'
  | 'broadcast'
  | 'presence'
  | 'system';

export interface RelayEvent {
  type: RelayEventType;
  // message-insert / message-update: { roomId, row }
  // broadcast:                { roomId, event, payload }
  // presence:                 { roomId, event, state?, joins?, leaves? }
  // system:                   payload
  data: any;
}

export interface ConnectRelayOptions {
  proxyUrl: string; // NEXT_PUBLIC_SUPABASE_PROXY_URL
  token: string; // 浏览器会话 access_token
  apikey: string; // NEXT_PUBLIC_SUPABASE_KEY（公开）
  rooms: string[]; // 已加入房间 id 列表
  userId?: string;
  nickname?: string;
  /** Supabase Auth UUID：全局在线（presence:global）以它为 key */
  guid?: string;
  onEvent: (ev: RelayEvent) => void;
  onError?: (err: unknown) => void;
}

export interface RelayClient {
  close: () => void;
}

export function connectRelay(opts: ConnectRelayOptions): RelayClient {
  const base = opts.proxyUrl.replace(/\/$/, '');
  const qs = new URLSearchParams();
  qs.set('apikey', opts.apikey);
  if (opts.rooms.length) qs.set('rooms', opts.rooms.join(','));
  if (opts.userId) qs.set('userId', opts.userId);
  if (opts.nickname) qs.set('nickname', opts.nickname);
  if (opts.guid) qs.set('guid', opts.guid);

  const ctrl = new AbortController();
  const url = `${base}/realtime?${qs.toString()}`;

  (async () => {
    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'text/event-stream',
        },
        signal: ctrl.signal,
      });
      if (!resp.ok || !resp.body) {
        opts.onError?.(new Error(`relay connect failed: ${resp.status}`));
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = parseSSEFrame(frame);
          if (ev) opts.onEvent(ev);
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) opts.onError?.(err);
    }
  })();

  return {
    close: () => ctrl.abort(),
  };
}

function parseSSEFrame(frame: string): RelayEvent | null {
  let type: RelayEventType = 'message-insert';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      type = line.slice(6).trim() as RelayEventType;
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
    // 以 ':' 开头的注释行（keepalive）忽略
  }
  if (dataLines.length === 0) return null;
  try {
    const data = JSON.parse(dataLines.join('\n'));
    return { type, data };
  } catch {
    return null;
  }
}

/**
 * 「发」动作的广播函数（由 useRelayRealtime 暴露的 sendBroadcast）。
 * roomId 传 '__global__' 表示发到全局 chat-events 频道。
 */
export type SendBroadcast = (
  roomId: string,
  event: string,
  payload: any
) => Promise<void> | void;

export interface SendRelayOptions {
  proxyUrl: string;
  token: string;
  apikey: string;
  roomId: string;
  event: string;
  payload: any;
}

export async function sendRelay(opts: SendRelayOptions): Promise<void> {
  const base = opts.proxyUrl.replace(/\/$/, '');
  const resp = await fetch(`${base}/realtime/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
      'x-supabase-apikey': opts.apikey,
    },
    body: JSON.stringify({
      roomId: opts.roomId,
      event: opts.event,
      payload: opts.payload,
    }),
  });
  if (!resp.ok) {
    throw new Error(`relay send failed: ${resp.status}`);
  }
}
