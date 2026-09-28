# Realtime WebSocket 1006 — 根因定位报告（2026-09-26）

## 结论（一句话）

**问题不在 Worker 代码，也不在 Cloudflare 配置，而在网络路径：本机到 Cloudflare 的 WebSocket 升级请求在到达 Worker 之前就被丢弃。**
HTTP 能通（浏览器会重试 / 复用连接），WebSocket 不能（必须新建 TLS 连接且无法重试）。
因此**「用 Cloudflare Worker 反代 Supabase Realtime 的 WebSocket」这条路在本网络环境下走不通**，改代码或改 CF 配置都无法解决。

## 关键证据链

### 1. Worker 代码正确、部署正常
- `git push` → Cloudflare Workers Builds 自动 `wrangler deploy`，已多次验证生效
  （`/__debug` 的 `build` 字段随提交变化：v16 → v17 → v18 → v19）。
- ⚠️ **踩坑**：`/__debug` 会被 Chrome 启发式缓存，必须带 `?cb=<时间戳>` 才能看到新版本，否则一直读到旧 build。

### 2. Cloudflare 配置全部正确（经 Dashboard API 实读）
| 项 | 值 | 判定 |
|---|---|---|
| 通用证书 | `[example.com, *.example.com]` **active**（Let's Encrypt） | ✅ 覆盖 `supabase.example.com` |
| 高级证书 | `[example.com, supabase.chat.example.com, *.supabase.chat.example.com]` active | ✅ |
| zone 设置 `websockets` | **on** | ✅ |
| `bot_management.fight_mode` | **false**（Bot Fight Mode 关闭） | ✅ 排除 |
| Page Rules | 空 | ✅ 排除 |
| Rulesets | 仅 `http_request_sanitize` / `http_request_firewall_managed` / `ddos_l7`（默认） | ✅ 无自定义拦截 |
| Worker Custom Domain | `supabase.chat.example.com` → `supabase-proxy` (production) | ✅ 已绑定 |
| Worker Route | `supabase.example.com/*` → `supabase-proxy` | ✅ 存在 |

→ 配置侧没有任何可改的「漏项」。

### 3. 同一主机名：HTTP 通、WS 不通
- `https://supabase.chat.example.com/__debug` → **200 + JSON**（Worker 正常响应）
- `wss://supabase.chat.example.com/?bare=1` → **onerror + close 1006，约 450ms**（`onopen` 从未触发）

### 4. 决定性证据：WS 升级请求根本没到达 Worker
在 Worker 里加了一层「可读日志」：用 **Cache API** 当作跨请求可读的存储
（Workers 无状态、又拿不到 `wrangler tail` 权限）：

- `logReq()` 记录**每一个**到达 Worker 的请求（含 `upgrade` / `connection` /
  `sec-websocket-key` 等头）到 `https://wslog.internal/all`，环形缓冲保留最近 10 条；
- `GET /__wslog` 读回；
- **自检**：`/__wslog?w=1` 会先写一条 `t` 记录再读，**实测能读回自己写的记录** → 日志通道本身有效。

实测结果：日志里**只有 HTTP 对照请求**（`/health`），
**WS 升级请求（`/?bare=1`）一条都没有出现** —— 连「Upgrade 头被剥掉、走了 HTTP 分支」的情况都不是。

### 5. 不是「全局 WS 不通」，是「到 Cloudflare 的 WS 不通」
同一浏览器、同一页面实测：

| WS 目标 | 承载方 | 结果 |
|---|---|---|
| `ws.postman-echo.com/raw` | nginx | **OPEN** ✅ |
| `echo.websocket.org` | Fly.io（`via: 1.1 fly.io`） | **OPEN** ✅（且收到回显消息） |
| `supabase.chat.example.com/?bare=1` | Cloudflare Worker | 1006 ❌ |
| `ws.fangmu.dpdns.org` | Cloudflare（`server: cloudflare`） | 1006 ❌ |
| `ws.kraken.com` / `gateway.discord.gg` | Cloudflare | 1006 ❌（注：这两个 HTTP 也超时，属被墙） |

### 6. 与端口无关
WS 在 443 / 8443 / 2053 / 2083 / 2096 **全部 1006**；
而对同主机名用 HTTP 走**新连接**（8443/2053）也失败（156ms）。
→ 说明「新建 TLS 连接」这件事本身不可靠。

### 7. Supabase 直连也不通
- `https://your-project-ref.supabase.co/rest/v1/` → FAIL（731ms）
- `wss://your-project-ref.supabase.co/realtime/v1/websocket` → 1006

→ 所以代理是必要的；但代理只能承载 HTTP。

### 8. 反证：HTTP 走 Worker 代理端到端可用
- `https://supabase.chat.example.com/rest/v1/`（带 apikey）→ **401，464ms**
  = Worker 成功转发到 Supabase，Supabase 正常应答。**HTTP 代理链路完好。**

### 9. Route 方案的主机名完全不可达
`supabase.example.com`（纯 DNS + Route）**HTTP 3/3 全失败**（265–1047ms）
→ 「Route 边缘做 WS handoff」这条路连 HTTP 都进不去，无法使用。

### 10. 旁证
沙箱侧对 `*.example.com` 的 TLS 连接一律 `ECONNRESET`（SNI 层被掐）。
说明该环境存在针对这些域名的网络层干扰。

## 建议的修复方向

### A. 推荐：Realtime 放弃 WebSocket，改用 HTTP 轮询
既然 HTTP 代理链路完好（证据 8），把实时消息改成轮询即可，且**改动可控**：
- `useMessageRealtime.ts` 里把 `postgres_changes` 订阅替换为定时轮询：
  `GET /rest/v1/messages?room_id=eq.{roomId}&created_at=gt.{lastCreatedAt}&order=created_at.asc`
  （走已可用的 Worker HTTP 代理），复用现有的 `rowToMessage` + `setMessagesRef` 去重逻辑；
- presence / typing / read-receipts 降级为低频轮询或暂时关闭；
- 保留 WS 尝试（若网络恢复可自动用回 WS）。

### B. 换一个非 Cloudflare 的 WebSocket 中继
已实测 Fly.io / 普通 nginx 的 WS **可达**。可把 WS 中继放在 VPS / Fly.io 上，
由它转发到 Supabase Realtime；Cloudflare Worker 继续只做 HTTP 反代。

### C. 换网络路径
若该干扰是 ISP / GFW 层面（旁证 10），换网络/出口是根本解法。

## 本次已完成的修复

- ✅ **Pages 生产环境变量 `NEXT_PUBLIC_SUPABASE_PROXY_URL` 已从失效的
  `https://supabase.example.com` 改回 `https://supabase.chat.example.com`**
  （经 Dashboard 保存并用 API 复核确认）。此前线上 App 的 REST/Auth 因此失效，
  改回后 HTTP 链路恢复。**需等 Pages 重新构建部署后生效。**

## 待办 / 清理

- 临时 Route `chat.example.com/sb/*` → `supabase-proxy`（诊断用，无害，建议删除）。
- `worker.js` 中的诊断日志（`logReq` / `logStage` / `/__wslog` / `/__wsprobe` / `?bare=1`）
  可在确认方案后清理；当前保留以便后续复验。
