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

/**
 * 允许跨域访问本代理的**额外**来源白名单（P2-16）。
 *
 * 此前的实现是「把请求里的 Origin 原样反射回去」+ `Allow-Credentials: true` ——
 * 这是典型的 CORS 误配置模式：等于对任意站点开放带凭据的读取权限。
 * 现在只放行两类来源：
 *   ① 与请求 URL **同 host**（同源；浏览器对同源请求本来也不会走 CORS 预检）；
 *   ② 下面显式列出的来源（Capacitor WebView 的本地 scheme，以及运维通过
 *      `ALLOWED_ORIGINS` 环境变量追加的域名，逗号分隔）。
 */
const EXTRA_ALLOWED_ORIGINS: readonly string[] = [
  // Capacitor Android WebView 的默认来源（App 内置页面走 https://localhost）
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
];

function isAllowedOrigin(request: Request, origin: string): boolean {
  // 'null'（沙箱 iframe / file://）一律拒绝
  if (!origin || origin === 'null') return false;
  try {
    if (new URL(origin).host === new URL(request.url).host) return true;
  } catch {
    return false;
  }
  return EXTRA_ALLOWED_ORIGINS.includes(origin);
}

export function corsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, apikey, x-supabase-apikey, content-type, x-client-info, x-supabase-api-version',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'content-range, x-supabase-api-version',
    // 响应随 Origin 变化，避免中间缓存把某个来源的 CORS 头复用给另一个来源
    Vary: 'Origin',
  };
  const origin = request.headers.get('origin');
  if (origin && isAllowedOrigin(request, origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

/**
 * 构造转发目标 URL：把 `/api/<service>/v1/<子路径>?<查询>` 映射到
 * `https://<SUPABASE_TARGET_HOST>/<service>/v1/<子路径>?<查询>`。
 *
 * ⚠️ 子路径**优先从请求 URL 里切**，而不是用路由的 `params.path`。
 * 原因（线上实测）：三个透传路由都是可选 catch-all `[[...path]]`，代码与形态完全相同，
 * 但只有 `/api/auth/v1/*` 正常，`/api/rest/v1/*`、`/api/storage/v1/*` 长期返回
 *
 *     {"code":"PGRST100","message":"\"failed to parse filter (<表名>)\""}
 *
 * 即 PostgREST 把**表名当成了 filter 解析** —— 说明子路径被挤进了查询串，
 * 实际转发成了 `https://<host>/rest/v1/?friends` 这种形态。
 * 也就是说 `params.path` 在 Pages（next-on-pages 产物）上不可靠、退化为空数组。
 * 直接从 `url.pathname` 切片则不依赖这套运行时行为，三个服务统一正确。
 *
 * 抽成纯函数是为了能单测——这个 bug 静默了很久，正因为没有任何断言覆盖它。
 */
export function buildProxyTargetUrl(
  requestUrl: string,
  service: 'rest' | 'auth' | 'storage',
  pathSegments: readonly string[]
): string {
  const url = new URL(requestUrl);
  const marker = `/api/${service}/v1/`;
  const at = url.pathname.indexOf(marker);
  const fromUrl = at >= 0 ? url.pathname.slice(at + marker.length) : '';
  const subPath = fromUrl || pathSegments.join('/');

  // ⚠️ 真正的根因（实测）：next-on-pages 处理可选 catch-all `[[...path]]` 时，
  // 会把捕获到的子路径**同时**以查询参数 `path=<子路径>` 注入到 URL 上 ——
  // 实测 `req.search` 末尾凭空多出 `&path=friends`（调试头 x-dbg-req-search 可证）。
  // PostgREST 把它当 filter 解析 → PGRST100 "failed to parse filter (friends)"。
  // 这也解释了为什么三个路由代码完全相同、却只有 auth 正常：GoTrue 忽略多余
  // 查询参数，PostgREST 则严格解析 filter。
  // 只删除「值与子路径完全一致」的那个，避免误伤用户真的在以 path 列做过滤。
  if (subPath && url.searchParams.get('path') === subPath) {
    url.searchParams.delete('path');
  }

  return `https://${SUPABASE_TARGET_HOST}/${service}/v1/${subPath}${url.search}`;
}

// 透传一个 Supabase 服务请求（REST / Auth / Storage）。
export async function proxySupabase(
  request: Request,
  service: 'rest' | 'auth' | 'storage',
  pathSegments: string[]
): Promise<Response> {
  const target = new URL(buildProxyTargetUrl(request.url, service, pathSegments));

  // 诊断开关：仅 `?_dbg=1` 时把「本代理看到的请求」与「实际转发目标」回显到响应头，
  // 用于定位透传路径问题（线上 PGRST100）。默认完全不输出，不改变正常请求行为。
  const dbg = new URL(request.url).searchParams.get('_dbg') === '1';
  const dbgHeaders = dbg
    ? {
        'x-dbg-req-url': request.url,
        'x-dbg-req-pathname': new URL(request.url).pathname,
        'x-dbg-req-search': new URL(request.url).search,
        'x-dbg-params-path': JSON.stringify(pathSegments),
        'x-dbg-target': target.toString(),
      }
    : {};

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('origin');
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase().startsWith('cf-')) headers.delete(key);
  }

  // `duplex: 'half'` 是流式请求体的必需项（Node/undici 要求），
  // 但 TS 的 lib.dom 版本落后于 undici，未在 RequestInit 里声明 —— 这里补上。
  const init: RequestInit & { duplex?: 'half' } = {
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
    for (const [k, v] of Object.entries(dbgHeaders)) out.set(k, v);
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
