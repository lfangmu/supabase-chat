// 服务端权威送达（路B）：messages 落库成功后，由本 Edge Function 主动把消息
// 广播到 `chat-room:<room_id>` 频道。
//
// 为什么放在 Edge Function 而不是 Next.js edge 路由：Supabase Realtime 的 WebSocket
// 客户端在 Cloudflare Workers（next-on-pages）里开连接不稳；Edge Function 跑在
// Supabase 的 Deno 环境，实时客户端可靠。
//
// 安全加固（防伪造 / integrity）：
// 1. 仅允许持有 service_role key 的调用方触发广播（route.ts 用 SERVICE_ROLE_KEY 调用）。
//    越权直调（anon 等）一律 403，避免任何人都能借本函数向房间频道广播。
// 2. 用 Ed25519 私钥（BROADCAST_SIGNING_KEY）对 `${id}|${room_id}|${timestamp}`
//    签名并附带在 payload 上；客户端用公钥（NEXT_PUBLIC_BROADCAST_VERIFY_KEY）校验，
//    伪造 / 未签名消息在客户端被丢弃。私钥仅存在于 Supabase 函数环境变量，不下发客户端。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- base64 / base64url 工具 ---
function stdB64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  return stdB64ToBytes(b64 + '='.repeat(pad));
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// 从入站 JWT 取 role；失败返回 null（调用方据此拒绝）。
function getJwtRole(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
    return (payload.role as string) ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  try {
    // 仅服务端（service_role）可触发广播；越权直调直接拒绝。
    const role = getJwtRole(req);
    if (role !== 'service_role') {
      return new Response(JSON.stringify({ error: 'forbidden: requires service_role' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { room_id, message } = await req.json();
    if (!room_id || !message || !message.id) {
      return new Response(JSON.stringify({ error: 'missing room_id or message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: 'missing supabase env' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 广播用 anon key 即可（Broadcast 是 pub/sub，不读表、不受 RLS 约束）。
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const channel = supabase.channel(`chat-room:${room_id}`);

    // 等频道订阅成功再发；超时则放弃（消息已在 DB，客户端广播兜底）。
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('subscribe_timeout')), 5000);
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(new Error(status));
        }
      });
    });

    // 若配置了签名私钥，对消息身份串签名并附带 signature；否则保持未签名（过渡期）。
    let payload: Record<string, unknown> = message;
    const signingKeyB64 = Deno.env.get('BROADCAST_SIGNING_KEY');
    if (signingKeyB64) {
      try {
        const signingKey = await crypto.subtle.importKey(
          'pkcs8',
          stdB64ToBytes(signingKeyB64),
          { name: 'Ed25519' },
          false,
          ['sign']
        );
        const data = new TextEncoder().encode(
          `${message.id}|${room_id}|${message.timestamp}`
        );
        const sig = await crypto.subtle.sign('Ed25519', signingKey, data);
        payload = { ...message, signature: bytesToB64(new Uint8Array(sig)) };
      } catch (signErr) {
        console.error('broadcast signing failed (继续未签名广播):', signErr);
      }
    }

    await channel.send({
      type: 'broadcast',
      event: 'chat-message',
      payload,
    });

    // 给实时服务端一点时间把消息真正投递出去，再结束函数（关闭 socket）。
    await new Promise((r) => setTimeout(r, 300));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('broadcast-message failed:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
