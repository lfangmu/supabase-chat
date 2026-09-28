// Supabase 反向代理（同源 Pages Functions 版）
//
// 原本这是独立的 Cloudflare Worker（supabase-proxy）做的事：让浏览器只访问自己的
// 同源域名（chat.example.com），由这里把 REST / Auth / Storage 请求转发到真实 Supabase
// 项目，绕开国内对 *.supabase.co 的网络层拦截。实时（SSE 中继 + 发送）见 realtimeProxy.ts。
//
// 现在把它折叠进 supabase-chat 同一个 Pages 项目，同源部署：
//   浏览器 supabase 客户端 base = https://chat.example.com/api
//   → /api/rest/v1/*   → https://<REF>.supabase.co/rest/v1/*
//   → /api/auth/v1/*   → https://<REF>.supabase.co/auth/v1/*
//   → /api/storage/v1/*→ https://<REF>.supabase.co/storage/v1/*
//
// 目标 host 必须从「应用真实项目地址」NEXT_PUBLIC_SUPABASE_URL 推导，绝不能硬编码。
// 原因：生产 / 预览环境指向的是不同的 Supabase 项目（ref 不同）；同源代理只是把浏览器请求
// 转发到"应用本身使用的那个真实项目"，所以以 NEXT_PUBLIC_SUPABASE_URL 为准。
// （项目 ref 仍是公开信息，非密钥；保留一个 prod 值作为兜底，仅当环境变量缺失时生效。）
const TARGET_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project-ref.supabase.co';
export const SUPABASE_TARGET_HOST = TARGET_URL.replace(/^https?:\/\//, '')
  .replace(/\/.*$/, '')
  .replace(/\/$/, '');

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, apikey, x-supabase-apikey, content-type, x-client-info, x-supabase-api-version',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'content-range, x-supabase-api-version',
  };
}

// 透传一个 Supabase 服务请求（REST / Auth / Storage）。
export async function proxySupabase(
  request: Request,
  service: 'rest' | 'auth' | 'storage',
  pathSegments: string[]
): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(
    `https://${SUPABASE_TARGET_HOST}/${service}/v1/${pathSegments.join('/')}${url.search}`
  );

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('origin');
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase().startsWith('cf-')) headers.delete(key);
  }

  const init: any = {
    method: request.method,
    headers,
    redirect: 'follow',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    // 流式转发 body（含 Storage 二进制上传），必须 duplex: 'half'
    init.body = request.body;
    init.duplex = 'half';
  }

  try {
    const resp = await fetch(target.toString(), init);
    const out = new Headers(resp.headers);
    // 同源部署下，让 @supabase/ssr 从响应体自行管理会话 cookie；
    // 剥离上游 Set-Cookie（其 domain 是 supabase.co，浏览器无法为 chat.example.com 写入）。
    out.delete('set-cookie');
    for (const [k, v] of Object.entries(corsHeaders(request))) out.set(k, v);
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: out,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'proxy_failed', detail: String(err) }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(request),
        },
      }
    );
  }
}
