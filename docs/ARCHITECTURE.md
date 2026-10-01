# 架构速览

> 本文档反映**当前实现**的真实架构，是项目架构的权威说明。改动代码前建议先读一遍。

---

## 1. 总体架构

```
浏览器（全程只访问你自己的域名）
  │
  ├─ 页面 / 静态资源 ────────────────▶ Cloudflare Pages（Next.js 14 静态产物）
  │
  ├─ REST / Auth / Storage ─────────▶ /api/{rest,auth,storage}/v1/*  ─┐
  │      （同源反向代理，透明透传）                                      │
  │                                                                    ├─▶ Supabase
  └─ 实时：SSE 长连接（收）+ POST（发）─▶ /api/realtime[/send] ─────────┘   （Postgres +
                                                                            Storage +
  服务端自身 → Supabase Auth 会话校验（@supabase/ssr）                        Realtime）
```

- **客户端**：React 18 Hooks + Tailwind。数据库读写一律经服务端 API 路由（持 Service Role Key）；客户端 Supabase SDK **仅用于经中继订阅实时事件**，不持有写权限。
- **服务端**：Next.js Route Handlers，统一 Edge Runtime（`runtime = 'edge'`）。
- **不依赖 Edge Functions，也不依赖 Durable Object**：实时中继是「一条浏览器连接 = 服务端一条到 Supabase 的 WebSocket」的 1:1 结构，无扇出、无共享状态。

---

## 2. 鉴权：Supabase Auth

身份由 **Supabase Auth** 统一负责：身份键 = `auth.uid()`（**UUID**）。应用层只保留展示信息（`public.users.display_name`）。

| 能力 | 方式 | 说明 |
|---|---|---|
| 匿名进入 | `signInAnonymously()` | 保留「不用注册直接聊」的体验，同样是真实 UUID |
| 邮箱注册 / 登录 | `signUp` / `signInWithPassword` | 可长期保留身份；匿名账号可用 `updateUser` 升级，UUID 不变 |
| 管理员 | `public.users.role = 'admin'` | 中间件对 `/api/admin/*` 校验 `role`，无独立后台密码 |

会话 Cookie 由 `@supabase/ssr` 维护（`createBrowserClient` 持久化，`createServerClient` 读取），**不自签 JWT**：

- `src/lib/supabase.ts` — 浏览器客户端（`createBrowserClient`，经同源代理访问 Supabase）。
- `src/lib/supabase-server.ts` — 服务端客户端（按请求 Cookie 构造，用于 `auth.getUser()`）。
- `src/lib/auth-user.ts` — `getAuthUser(request)` 取 UUID；`getDisplayName()` 按 UUID 查展示名。
- `src/lib/service-client.ts` — Service Role 客户端（服务端写操作用）。
- `src/middleware.ts` — 校验会话；`/api/admin/*` 额外校验 `users.role`。

### 2.1 前端认证流程

1. `ChatApp` 挂载时 `supabase.auth.getUser()`：
   - 有会话 → 取 `user.id`（UUID），再 `GET /api/me` 拿 `display_name` / `role`，进入主界面。
   - 无会话 → 展示 `AuthScreen`（匿名进入 / 邮箱注册登录）。
2. `AuthScreen` 匿名进入时要求填昵称，写入 `user_metadata.display_name`；迁移 `00022` 的触发器据此落成 `public.users` 资料行。
3. 登出：`supabase.auth.signOut()`。

---

## 3. middleware

`src/middleware.ts`（matcher：`/api/:path*`），按顺序：

1. **限流**（在鉴权之前，防暴力破解消耗资源）—— 滑动窗口，按 `客户端IP:路径` 计数，超限返回 `429`。
2. **公开白名单** `PUBLIC_API_ROUTES` → 直接放行：
   - `/api/keepalive` — 供外部 uptime 监控无 Cookie 访问。
   - `/api/auth/v1`、`/api/rest/v1`、`/api/storage/v1` — 同源代理的**透明透传**路由，真正的鉴权由上游 Supabase（GoTrue / PostgREST RLS）依据请求携带的 `apikey` / `Authorization` 完成，代理侧不注入任何特权密钥。
     > ⚠️ `/api/auth/v1` 必须放行：注册 / 登录 / 找回密码 / OTP 发生时用户「本来就还没有会话」，若被登录校验拦截就会出现「注册时报 401：未认证，请先登录」。
   - `/api/realtime` — SSE 长连接（鉴权在路由内部按 token 完成，见 §4）。
   - `/api/health` — 仅暴露 `build` / 目标 host / `sameOrigin`，无敏感信息。
3. **其余 `/api/*`** → 用 `createServerClient` 读请求 Cookie，`auth.getUser()` 校验会话，无用户则 401。
4. **`/api/admin/*`** → 额外查 `public.users.role`，非 `admin` 返回 403。

---

## 4. 实时链路：SSE 服务端中继（核心）

### 4.1 为什么不用 WebSocket

国内网络会**拦截浏览器直连 `*.supabase.co` 的 WebSocket 升级请求**（HTTP 能通、WS 不能）。因此本项目把「浏览器 ↔ Supabase 的 WebSocket」拆成两段 HTTP：

| 方向 | 端点 | 形态 |
|---|---|---|
| 收 | `GET /api/realtime` | SSE 长连接（HTTP，国内可通） |
| 发 | `POST /api/realtime/send` | 每次短连接，join 频道后 broadcast 再关闭 |

服务端 `new WebSocket()` 以**服务端身份**连 Supabase Realtime，订阅该用户所有房间的 `postgres_changes` / `broadcast` / `presence` 以及全局 `chat-events`，再把事件转成 SSE 帧推回浏览器。

实现见 `src/lib/realtimeProxy.ts`（中继主体）、`src/lib/presenceRelay.ts`（presence 解析）、`src/hooks/useRelayRealtime.ts`（客户端接线）。

### 4.2 消息完整性（防伪造）

- **数据库即真相源**：消息必须经 `POST /api/messages`（服务端校验 `isRoomParticipant` + `user === actor`）落入 `messages` 表，才会被推送。客户端无法凭空注入一条「已落库」的行。
- **RLS 按房间成员过滤**：中继以服务端身份订阅，但浏览器侧订阅仍受 RLS 约束；`messages` 表的 SELECT 策略仅允许房间成员读取，非成员收不到行。
- **鉴权即会话**：实时订阅的鉴权直接使用 Supabase Auth 会话，无需额外签发密钥或专用 token 端点。

### 4.3 幂等写入

消息以客户端生成的 `id` 为主键，插入使用 `onConflict:'id', ignoreDuplicates:true`（upsert-ignore）。网络超时重发、重复提交会被数据库直接忽略，不会重复推送。

### 4.4 连接数上限（SSE 并发）

`src/lib/sse-concurrency.ts`：**每用户 10 条 / 每 IP 30 条**，超限返回 429。

- 每条 SSE 会在服务端新开一条到 Supabase 的 WebSocket，若无上限，一条合法 token 就能开几百条 SSE → 放大上游 WS 与内存。
- 采用**带 TTL 的租约**（`SSE_SLOT_TTL_MS = 120s`）而非「断开回调释放」：实测在 Cloudflare Pages 上浏览器断开后 `request.signal` 的 abort、上游 WS 的 close/error **都可能不触发**，只靠回调会让槽位永久泄漏（用户开满 10 条后**再也连不上**）。改为「仅在客户端确实在消费时续租」，死连接最多 TTL 后自动过期回收。
- 计数为**每边缘实例进程内 Map**（与 `rate-limit.ts` 同策略），不跨实例共享——跨实例需要 Durable Objects，本项目明确不引入该依赖。

---

## 5. 同源反向代理（Pages Functions）

`src/app/api/{rest,auth,storage}/v1/[[...path]]` 把 REST / Auth / Storage 透传到真实 Supabase 项目（见 `src/lib/supabaseProxy.ts`），使浏览器全程只访问自己的域名。

- 代理目标 host 由 `NEXT_PUBLIC_SUPABASE_URL` 自动推导，**生产 / 预览指向不同 Supabase 项目也能正确转发**。
- 代理与前端是**同一个 Pages 项目**：`NEXT_PUBLIC_SUPABASE_PROXY_URL` 填应用自身的同源前缀 `https://<你的域名>/api`。
- **该变量是可选的**：`src/lib/supabase.ts` 取 `PROXY_URL || SUPABASE_URL`，留空时浏览器直连 `NEXT_PUBLIC_SUPABASE_URL`。只在网络会拦截 `*.supabase.co`（如中国大陆）时才需要启用代理。
- 仅服务端（`supabase-server.ts`、middleware、回调路由）直连真实的 `NEXT_PUBLIC_SUPABASE_URL`；浏览器走同源代理，两者指向**同一真实项目**。

部署后用 `curl https://<你的域名>/api/health` 验证返回 `200` 且 `sameOrigin: true`。

---

## 6. 管理后台 `/admin`

独立页面（`src/app/admin/page.tsx`）+ 独立端点（中间件按 `users.role='admin'` 放行）：

- `GET /api/admin/rooms` — 全部群聊（`type != 'dm'`）+ 最新消息摘要。
- `DELETE /api/admin/rooms` — 删除群聊：Service Role 先删该房间全部 `messages`，再删 `rooms`；`default-room` 返回 403 禁止删除。
- `GET /api/admin/messages?roomId=` — 房间消息只读。
- `GET /api/admin/audit-logs` — 审计日志。

登录走统一的 `AuthScreen`（邮箱 + 密码），由 `AdminGate` 校验 `/api/me` 返回的 `role === 'admin'`。后台为**只读审计 + 删除**，无修改消息之外的写能力。

---

## 7. 房间可见性模型

`GET /api/rooms` 必须传 `?ids=<逗号分隔房间ID>` 才返回对应房间；无参返回空（**防枚举**）。用户侧 `localStorage` 记录「已加入」房间（邀请链接 / 手动加入 / 自建自动加入），首启默认加入 `default-room`。

---

## 8. 数据模型

| 表 | 关键字段 | 用途 |
|---|---|---|
| `users` | `id`(uuid PK = `auth.users.id`), `display_name`, `avatar`, `signature`, `role`(user/admin) | 资料（身份在 `auth.users`） |
| `messages` | `id`, `room_id`, `user_id`(uuid), `user`(展示名快照), `type`(text/image/video/voice/file), `content`, `timestamp`, `quote_id`, `quote`, `edited_at`, `withdrawn_at`, `forwarded_from`, `file_name`/`file_size`/`file_mime`, `link_preview` | 消息 |
| `rooms` | `id`, `name`, `created_by`(uuid), `created_at`, `type`(group/dm), `pinned_message_id` | 房间；私聊 id 为 `dm:<uuidA>:<uuidB>` |
| `room_members` | `room_id`, `user_id`(uuid), `role`, `joined_at` | 群成员 |
| `reactions` | `id`, `message_id`(FK→messages ON DELETE CASCADE), `user_id`(uuid), `emoji` | 表情回应 |
| `message_reads` | `message_id`, `user_id`, `read_at` | 已读回执 |
| `friends` | `user_id`, `friend_id`, `status` | 好友关系 / 申请 |
| `audit_logs` | `id`, `actor_id`, `action`, `target`, `created_at` | 管理操作审计 |

**迁移**：`supabase/migrations/00001` ~ `00027`。关键节点：

- `00019` 把 `messages` 加入 `supabase_realtime` 发布（`postgres_changes` 的前提）。
- `00020` 身份列 UUID 化；`00021` RLS 改按 `auth.uid()`；`00022` 新建 auth 用户自动落资料行。
- `00023`~`00025` RLS 加固（房间成员、级联、好友）。
- `00026` 给 `realtime.messages` 涂 RLS 策略 + 频道置 `private:true`（Realtime Authorization 真正生效）。
- `00027` 清理诊断用临时表。

数据库访问统一走服务端 API 路由（Service Role），RLS 作为纵深防御。

---

## 9. 安全纵深

**限流（应用层，第一道防线）** — `src/lib/rate-limit.ts`，由 middleware 统一执行：按 `客户端IP:路径` 计数，超限返回 `429` + `Retry-After` 与 `X-RateLimit-*` 响应头。

- 敏感路径独立配额：注册 / 登录 10/min、管理后台登录 5/min、上传与房间操作 10–20/min、发消息 30/min、管理操作（含 `audit-logs`）10–20/min；其余默认 60/min。
- ⚠️ **局限**：应用层限流是**内存级、不跨 Cloudflare 边缘实例共享**，仅作第一道防线。生产环境务必在 **Cloudflare 控制台配置 Rate Limiting Rules**（按客户端 IP + 路径）作为真实边缘防线，见 `docs/cloudflare-rate-limiting.md`。

**SSE 并发上限** — 见 §4.4（每用户 10 / 每 IP 30）。

**SSRF 防护** — `src/lib/ssrf-guard.ts`：

- 服务端**不存在「用用户提供的 URL 做服务端请求」的端点**：所有出站请求（ImgBB 上传）均指向**写死的白名单主机**（`https://api.imgbb.com`、Supabase 项目域名）。
- `upload-proxy` 转发图片到 ImgBB 时出站 fetch 设 `redirect: 'manual'`，**不跟随重定向**，防止响应被劫持跳转到内网 / 任意地址（fail-closed，非 2xx 按失败处理）。
- 上传入口（`upload-media` / `upload-proxy`）均要求登录 + 房间成员校验，并校验文件大小与 MIME / 魔数，不接受任意外部 URL。

**XSS 防护** — 消息 Markdown 渲染走 `rehype-sanitize` + `hast-util-sanitize`，剥离 `embedding` / `active` 类标签。

---

## 10. 部署

- **目标**：Cloudflare Pages，`@cloudflare/next-on-pages`。
- **构建命令**：`npm run cf:build`；输出 `.vercel/output/static`。
- **环境变量**：必填 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`；可选 `NEXT_PUBLIC_SUPABASE_PROXY_URL`（仅在浏览器无法直连 `*.supabase.co` 时才需要）/ `IMGBB_API_KEY` / `NEXT_DISABLE_VERSION_CHECK`。鉴权由 Supabase Auth 承担。
- ⚠️ `NEXT_PUBLIC_*` 是**构建期内联**的：新增 / 修改环境变量后必须**全新构建**（push 或控制台 Deploy），只点 Retry 不会注入新变量。
- 完整流程见 `docs/DEPLOYMENT.md`。

---

## 11. 保活

`GET /api/keepalive`（middleware 白名单，公开）用 Service Role 对 `messages` 做一次 `count` 查询，算一次数据库活动。`.github/workflows/keepalive.yml` 每 6 小时自动 ping，防止 Supabase 免费项目约 7 天无活动被暂停。若已暂停需到 Dashboard 手动 **Restore**。

---

## 12. 关键配置（`src/config/index.ts`）

- `API_CONFIG`：`AUTH_ME_ENDPOINT` / `MESSAGES_ENDPOINT` / `FRIENDS_ENDPOINT` / `DM_LIST_ENDPOINT` / `USERS_ENDPOINT` / `ROOM_MEMBERS_ENDPOINT` / `ROOMS_MINE_ENDPOINT` / `MESSAGE_READ_ENDPOINT` / `ADMIN_ROOMS_ENDPOINT` / `ADMIN_MESSAGES_ENDPOINT` / `ADMIN_AUDIT_LOGS_ENDPOINT` 等
- `DM_CONFIG.ID_PREFIX = 'dm:'`（私聊房间 id = `dm:<uuidA>:<uuidB>`，UUID 字典序排序保证双向一致）
- `ROOM_CONFIG.DEFAULT_ROOM = 'default-room'`
- `MESSAGE_CONFIG.PAGE_SIZE = 20`
- `UPLOAD_CONFIG.MAX_FILE_SIZE = 50MB` + 允许类型 + 图片压缩参数
