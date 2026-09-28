# 架构速览（当前实现）

> 本文档反映 **2026-07 鉴权重构后**的真实架构，作为项目架构的权威速览。
> 早期的 `docs/ARCHITECTURE-12-features.md` / `docs/PRD-12-features.md` 为 2025-06 的 12 项增强设计，部分鉴权描述已过时，仅供历史参考。

---

## 1. 总体架构

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  浏览器（React 客户端）   │         │   Next.js 14（Edge Runtime）   │
│  ├─ /           聊天门    │  HTTP   │  ├─ API Routes（鉴权/房间/消息/ │
│  ├─ /admin      后台      │ ──────▶ │  │   上传/保活）               │
│  └─ Supabase JS           │         │  ├─ middleware.ts（API 鉴权）  │
│     (Realtime/Presence)   │         │  └─ lib/auth.ts（JWT）        │
└─────────────────────────┘         └───────────────┬──────────────┘
                                                     │ Service Role / Publishable
                                                     ▼
                                          ┌────────────────────────┐
                                          │   Supabase（Postgres +  │
                                          │   Realtime + Storage）  │
                                          └────────────────────────┘
```

- **客户端**：React Hooks + Tailwind。所有数据库读写经服务端 API 路由（Service Role Key）；客户端 Supabase SDK **仅用于 Realtime（postgres_changes 消息推送 + 控制类 broadcast 事件）**，不持有写权限。
- **服务端**：Next.js API Routes，统一使用 Edge Runtime（`runtime = 'edge'`）。（注：Web Push 尚未接入，当前无 Node Runtime 路由。）
- **鉴权**：Supabase Auth（`@supabase/ssr` 维护会话 Cookie），浏览器经反向代理 Worker 访问 Supabase；`auth.uid()` 为真实 UUID，不再自建 JWT 或双会话。

---

## 2. Supabase Auth 鉴权（核心）

身份由 **Supabase Auth** 统一负责：身份键 = `auth.uid()`（**UUID**）。应用层只保留展示信息（`public.users.display_name`）。

| 能力 | 方式 | 说明 |
|---|---|---|
| 匿名进入 | `supabase.auth.signInAnonymously()` | 保留「不用注册直接聊」的体验，同样是真实 UUID |
| 邮箱注册/登录 | `signUp` / `signInWithPassword` | 可长期保留身份；匿名账号可用 `updateUser` 升级，UUID 不变 |
| 管理员 | `public.users.role = 'admin'` | 中间件对 `/api/admin/*` 校验 role，无独立后台密码 |

会话 cookie 由 `@supabase/ssr` 维护（`createBrowserClient` 持久化，`createServerClient` 读取），不再自签 JWT：

- `src/lib/supabase.ts` — 浏览器客户端（`createBrowserClient`）。
- `src/lib/supabase-server.ts` — 服务端客户端（按请求 cookie 构造，用于 `auth.getUser()`）。
- `src/lib/auth-user.ts` — `getAuthUser(request)` 取 UUID；`getDisplayName()` 按 UUID 查展示名。
- `src/middleware.ts` — 校验会话；`/api/admin/*` 额外校验 `users.role`。

迁移要点见 `docs/SUPABASE_AUTH_MIGRATION.md`（迁移 00020 / 00021 / 00022）。

### 2.1 前端认证流程

1. `ChatClient` 挂载时 `supabase.auth.getUser()`：
   - 有会话 → 取 `user.id`（UUID），再 `GET /api/me` 拿 `display_name` / `role`，进入主界面。
   - 无会话 → 展示 `AuthScreen`（匿名进入 / 邮箱注册登录）。
2. `AuthScreen` 匿名进入时要求填昵称，写入 `user_metadata.display_name`；迁移 00022 的触发器据此落成 `public.users.display_name`。
3. 登出：`supabase.auth.signOut()`。

---

## 3. middleware

`src/middleware.ts`（matcher：`/api/:path*`）：

1. 公开白名单 `PUBLIC_API_ROUTES`：`/api/keepalive` → 放行。
2. 其余 `/api/*` → 用 `createServerClient` 读请求 cookie，`auth.getUser()` 校验会话，无用户则 401。
3. `/api/admin/*` → 额外查 `public.users.role`，非 `admin` 返回 403。
4. 保留原有的按 IP 限流。

---

## 4. 管理后台 `/admin`

独立页面（`src/app/admin/page.tsx`）+ 独立端点（中间件按 `users.role='admin'` 放行）：

- `GET /api/admin/rooms` — 全部群聊（`type != 'dm'`）+ 最新消息摘要。
- `DELETE /api/admin/rooms` — 删除群聊：Service Role 先删该房间全部 `messages`，再删 `rooms`；`default-room` 返回 403 禁止删除。
- `GET /api/admin/messages?roomId=` — 房间消息只读。
- `GET /api/admin/audit-logs` — 审计日志。

登录走统一的 `AuthScreen`（邮箱 + 密码），由 `AdminGate` 校验 `/api/me` 返回的 `role === 'admin'`。

前端：单删带二次确认弹窗；批量模式可勾选多房间并发删除并刷新列表。后台为**只读审计 + 删除**，无修改消息/创建房间之外的写能力。

---

## 5. 房间可见性模型

`GET /api/rooms` 必须传 `?ids=<逗号分隔房间ID>` 才返回对应房间；无参返回空（防枚举）。用户侧 `localStorage` 记录「已加入」房间（邀请链接 / 手动加入 / 自建自动加入），首启默认加入 `default-room`。

---

## 6. 数据模型

| 表 | 关键字段 | 用途 |
|---|---|---|
| `users` | `id`(uuid PK = `auth.users.id`), `display_name`, `avatar`, `signature`, `role`(user/admin) | 资料（身份在 auth.users） |
| `messages` | `id`, `room_id`, `user_id`(uuid), `user`(展示名，冗余), `type`(text/image/video/voice), `content`, `timestamp`, `quote_id`, `quote`, `edited_at` | 消息 |
| `rooms` | `id`, `name`, `created_by`(uuid), `created_at`, `type`(group/dm) | 房间；私聊 id 为 `dm:<uuidA>:<uuidB>` |
| `room_members` | `room_id`, `user_id`(uuid), `role`, `joined_at` | 群成员 |
| `reactions` | `id`, `message_id`(FK→messages ON DELETE CASCADE), `user_id`(uuid), `emoji` | 表情回应 |
| `push_subscriptions` | `id`, `user_id`(uuid), `endpoint`, `p256dh`, `auth` | Web Push |

迁移：`supabase/migrations/00001`~`00022`（`00020` 身份列 UUID 化、`00021` RLS 改按 `auth.uid()`、`00022` 新建 auth 用户自动落资料行）。数据库访问统一走服务端 API 路由（Service Role），RLS 作为纵深防御。

## 6.1 消息送达机制（Postgres Changes + RLS + 幂等 + 防伪造）

- **发送方本地乐观展示**：浏览器把消息本地插入（乐观更新），并 `POST /api/messages` 落库。
- **服务端权威送达（CDC 直接推送）**：`POST /api/messages` 真实落库后，不再经由任何中间广播层——Supabase 的 **Postgres Changes（逻辑复制 / CDC）** 在 `messages` 表发生 INSERT 时，自动把完整新行推送给订阅了该表的实时客户端。订阅由 `supabase.channel(...).on('postgres_changes', ...)` 建立，按 `room_id=eq.<房间>` 过滤。

> 为什么用 Postgres Changes 而非客户端广播：Supabase Realtime Broadcast 是 pub/sub、不受 RLS 约束，原本任何房间参与者都能向 `chat-room:<id>` 注入假 `chat-message` 事件（渲染但不落库，刷新即消失）——这是完整性（integrity）漏洞。改为读数据库真实变更后，只有「经服务端 API 鉴权落库」的行才会被发布，天然防伪造。

### 防伪造（integrity 加固）

- **数据库即真相源**：消息必须经 `POST /api/messages`（服务端校验 `isRoomParticipant` + `user===actor`）落入 `messages` 表，才会触发实时推送。攻击者无法凭空注入一条「已落库」的行。
- **RLS 按房间成员过滤**：浏览器实时客户端以真实的 Supabase Auth 会话订阅 `postgres_changes`，RLS 里的 `auth.uid()` 就是该用户的 UUID。`messages` 表的 SELECT 策略仅允许「房间成员」读取——非成员即使订阅也收不到行。不再需要 `/api/realtime-token`，也不再需要任何签名密钥。
- **撤销了 anon 读取**：迁移 00016 曾撤销 anon 对 `messages` 的 SELECT（防止拿匿名 key 直连 `/rest/v1/messages` dump 全表）；方案 A 复用同一思路——`postgres_changes` 同样受该 RLS 约束，匿名角色一条消息都收不到。
- **零密钥**：不再需要 Ed25519 签名私钥 / 前端公钥两把密钥，也不再有 `broadcast-message` Edge Function 与密钥生成脚本；实时鉴权直接用 Supabase Auth 会话。

**幂等写入**：消息以客户端生成的 `id` 为主键，插入使用 `onConflict:'id', ignoreDuplicates:true`（upsert-ignore）。网络超时重发、重复提交会被直接忽略；不需要「仅在真实插入时触发广播」的判断，因为落库本身即唯一真相源，重复写入被数据库忽略、不会重复推送。

> - `messages` 必须加入 `supabase_realtime` 发布（迁移 00019 的 `ALTER PUBLICATION supabase_realtime ADD TABLE public.messages`），否则 `postgres_changes` 不会触发。
> - 代码见 `src/hooks/useMessageRealtime.ts`（postgres_changes 订阅）、`src/lib/supabase.ts`（经反向代理访问 Supabase 的浏览器客户端）；部署见 `docs/DEPLOYMENT.md` §3.5。

## 6.2 安全纵深（限流 / SSRF 防护）

**限流（第一道防线，应用层）**

- 所有 `/api/*` 请求经 `middleware.ts` 的滑动窗口限流（`src/lib/rate-limit.ts`）：按 `客户端IP:路径` 计数，超限返回 `429` + `Retry-After` 与 `X-RateLimit-*` 响应头。
- 敏感路径独立配额：注册/登录 10/min、管理后台登录 5/min、上传与房间操作 10–20/min、发消息 30/min、管理操作（含 `audit-logs`）10–20/min；其余默认 60/min。
- ⚠️ 局限：应用层限流是**内存级、不跨 Cloudflare 边缘实例共享**，仅作第一道防线。生产环境务必在 **Cloudflare 控制台配置 Rate Limiting Rules**（按客户端 IP + 路径）作为真实边缘防线——这是纵深防御的关键一层。

**SSRF 防护**

- 服务端**不存在"用用户提供的 URL 做服务端请求"的端点**：所有出站请求（ImgBB 上传）均指向**写死的白名单主机**（`https://api.imgbb.com`、Supabase 项目域名）。
- `upload-proxy` 转发图片到 ImgBB 时，出站 fetch 设 `redirect: 'manual'`，**不跟随重定向**，防止响应被劫持跳转到内网/任意地址（fail-closed，非 2xx 按失败处理）。
- 上传入口（`upload-media` / `upload-proxy`）均要求登录 + 房间成员校验，并校验文件大小与 MIME 类型，不接受任意外部 URL。

---

## 7. 部署

- **目标**：Cloudflare Pages，`@cloudflare/next-on-pages`。
- **构建命令**：`npm run cf:build`（`npx @cloudflare/next-on-pages`）；输出 `.vercel/output/static`。
- **环境变量**：必填 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`；可选 `IMGBB_API_KEY` / `NEXT_DISABLE_VERSION_CHECK`。鉴权不再需要任何密码或 JWT 密钥（由 Supabase Auth 承担）。（注：文档历史版本提及的 VAPID 系列变量对应未实现的 Web Push，暂不使用。）
- ⚠️ 新增/修改环境变量后必须**全新构建**（push 或控制台 Deploy），只点 Retry 不会注入新变量。

---

## 8. 保活

`GET /api/keepalive`（middleware 白名单，公开）用 Service Role 对 `messages` 做一次 `count` 查询，算一次数据库活动。`.github/workflows/keepalive.yml` 每 6 小时自动 ping，防止 Supabase 免费项目 ~7 天无活动被暂停。若已暂停需到 Dashboard 手动 Restore。

---

## 9. 关键配置（`src/config/index.ts`）

- `API_CONFIG`：`AUTH_ME_ENDPOINT` / `MESSAGES_ENDPOINT` / `FRIENDS_ENDPOINT` / `DM_LIST_ENDPOINT` / `ADMIN_ROOMS_ENDPOINT` / `ADMIN_MESSAGES_ENDPOINT` 等
- `DM_CONFIG.ID_PREFIX='dm:'`（私聊房间 id = `dm:<uuidA>:<uuidB>`，UUID 字典序排序保证双向一致）
- `ROOM_CONFIG.DEFAULT_ROOM='default-room'`
- `MESSAGE_CONFIG.PAGE_SIZE=20`
- `UPLOAD_CONFIG.MAX_FILE_SIZE=50MB` + 允许类型 + 图片压缩参数
