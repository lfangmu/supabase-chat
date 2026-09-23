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

- **客户端**：React Hooks + Tailwind。所有数据库读写经服务端 API 路由（Service Role Key）；客户端 Supabase SDK **仅用于 Realtime Broadcast / Presence**，不持有写权限。
- **服务端**：Next.js API Routes，默认 Edge Runtime（`runtime = 'edge'`），仅 Web Push 发送等少数场景用 Node Runtime。
- **鉴权**：自研 HS256 JWT（Web Crypto API），httpOnly Cookie 存储，双会话物理隔离。

---

## 2. 双会话鉴权（核心）

两套会话完全独立，靠 Cookie 名区分（都设在 `path=/`，因 `/api/admin/*` 不以 `/admin` 为前缀，无法用 path 隔离）：

| 会话 | Cookie | 签发端点 | 密码变量 | payload | 能力 |
|---|---|---|---|---|---|
| 普通聊天 | `chat_session` | `POST /api/verify-password` | `CHAT_PASSWORD` | `isAdmin:false` | 聊天、收发消息 |
| 管理后台 | `admin_session` | `POST /api/admin/verify` | `ADMIN_PASSWORD`（兜底 `SUPER_PASSWORD`/`CHAT_SUPER_PASSWORD`） | `isAdmin:true` | 查看全部房间/消息、删除群聊 |

`src/lib/auth.ts`：
- `signJwt` / `verifyJwt` — HS256，Edge 兼容（Web Crypto）。
- `timingSafeEqual` — 常量时间比较，防时序攻击。
- `extractSession(cookieHeader, secret, cookieName='chat_session')` — 按 cookie 名抽取并校验 JWT；admin 传 `'admin_session'`。

JWT 有效期 7 天（`AUTH_CONFIG.JWT_EXPIRY`），`secure` 在 production 强制为 true，`sameSite: 'lax'`，`httpOnly: true`。

### 2.1 前端认证流程（探测门禁）

1. `ChatClient` 挂载时请求 `GET /api/password-version`。
   - 返回 `required: false` → 门禁关闭，直接进入聊天。
   - 返回 `401 + required: true` → 弹出 `PasswordGate` 让用户输入 `CHAT_PASSWORD`。
2. `POST /api/verify-password` 用 timing-safe 比较密码，成功后下发 `chat_session` httpOnly Cookie（7 天，`isAdmin:false`）。
3. 密码变更检测：`password-version` 返回 `salt:CHAT_PASSWORD` 的 SHA-256；前端每 60 秒轮询，版本变化则强制清除会话、重新登录。
4. 管理后台：`POST /api/admin/verify` 认 `ADMIN_PASSWORD`，签发独立 `admin_session`（`isAdmin:true`）。
5. 登出：`DELETE /api/verify-password`（清 `chat_session`）/ `DELETE /api/admin/verify`（清 `admin_session`）。

---

## 3. 门禁开关与 middleware

`src/middleware.ts`（matcher：`/api/:path*`）：

1. `/api/admin/verify`（登录/登出）自身校验密码 → 放行。
2. 公开白名单 `PUBLIC_API_ROUTES`：`/api/verify-password`、`/api/password-version`、`/api/keepalive` → 放行。
3. `/api/admin/*` → 校验 `admin_session`（`isAdmin:true`），否则 401。
4. 其余 `/api/*`：
   - `CHAT_AUTH_ENABLED !== 'false'`（默认开启）→ 校验 `chat_session`，否则 401。
   - `CHAT_AUTH_ENABLED === 'false'` → 免密放行（仅影响普通聊天，**不影响 `/admin`**）。
5. 开发模式缺失 `CHAT_JWT_SECRET` 时放行，便于本地联调。

`GET /api/password-version` 返回 `{ required, version }`：
- 门禁关 → `{ required:false }`。
- 门禁开且无有效会话 → `401 { required:true }`。
- 门禁开且有效 → `{ required:true, version: sha256(salt:CHAT_PASSWORD) }`，前端轮询比对版本变化以强制重登。

---

## 4. 管理后台 `/admin`

独立页面（`src/app/admin/page.tsx`）+ 独立端点：

- `GET /api/admin/rooms` — 全部群聊（`type != 'dm'`）+ 最新消息摘要；端点内再次校验 `admin_session`。
- `DELETE /api/admin/rooms` — 删除群聊：Service Role 先删该房间全部 `messages`，再删 `rooms`；`default-room` 返回 403 禁止删除。
- `GET /api/admin/messages?roomId=` — 房间消息只读。
- `POST /api/admin/verify` / `DELETE /api/admin/verify` — 登录/登出（`admin_session`）。

前端：单删带二次确认弹窗；批量模式可勾选多房间并发删除并刷新列表。后台为**只读审计 + 删除**，无修改消息/创建房间之外的写能力。

---

## 5. 房间可见性模型

`GET /api/rooms` 必须传 `?ids=<逗号分隔房间ID>` 才返回对应房间；无参返回空（防枚举）。用户侧 `localStorage` 记录「已加入」房间（邀请链接 / 手动加入 / 自建自动加入），首启默认加入 `default-room`。

---

## 6. 数据模型

| 表 | 关键字段 | 用途 |
|---|---|---|
| `messages` | `id`, `room_id`, `user`, `type`(text/image/video/voice), `content`, `timestamp`, `quote_id`, `quote`, `edited_at` | 消息 |
| `rooms` | `id`, `name`, `created_by`, `created_at`, `type`(group/dm) | 房间 |
| `reactions` | `id`, `message_id`(FK→messages ON DELETE CASCADE), `user`, `emoji` | 表情回应 |
| `push_subscriptions` | `id`, `user`, `endpoint`, `p256dh`, `auth` | Web Push |
| `user_profiles` | `id`, `email`, `password_hash`, `nickname`, `avatar` | 预留账号体系 |

迁移：`supabase/migrations/00001`~`00012`。数据库访问统一走服务端 API 路由（Service Role），RLS 作为纵深防御。

## 6.1 消息送达机制（双路广播 + 幂等 + 防伪造）

- **发送方本地乐观展示**：浏览器把消息本地插入（乐观更新），并 `POST /api/messages` 落库。
- **服务端权威送达（唯一广播源）**：`POST /api/messages` 真实落库后，服务端用 Service Role Key 调用 Supabase **Edge Function `broadcast-message`**，由 it（Deno 环境，WebSocket 稳定）把消息广播到 `chat-room:<room_id>` 频道，推给在线接收方。这条路径不依赖发送方客户端 WS 是否在线——即使发方断网，消息也已落库，服务端照样送达。

> 为什么不再由客户端广播消息内容：Supabase Realtime Broadcast 是 pub/sub、不受 RLS 约束，原本任何房间参与者都能向 `chat-room:<id>` 注入假 `chat-message` 事件（渲染但不落库，刷新即消失）——这是完整性（integrity）漏洞。现已改为**只由服务端签名广播**，客户端不再广播消息内容。

### 防伪造（integrity 加固）

- **服务端签名**：Edge Function 用 Ed25519 私钥（`BROADCAST_SIGNING_KEY`）对消息身份串 `${id}|${room_id}|${timestamp}` 签名，把 `signature` 附带在广播 payload 上。
- **客户端校验**：前端用内联公钥（`src/lib/broadcastSignature.ts` 的 `FALLBACK_VERIFY_KEY`，构建进 bundle）校验每个 `chat-message` 广播；**未签名 / 签名无效直接丢弃**，伪造消息无法渲染。
- **私钥永不下发**：只有持有 `SUPABASE_SERVICE_ROLE_KEY` 的服务端能调用该 Edge Function（`route.ts` 调用），函数内校验入站 JWT 的 `role==='service_role'`，越权直调一律 403；攻击者拿不到私钥、也调不动函数，无法伪造合法签名。
- **公钥须随私钥一起配**：前端默认用内联公钥（`FALLBACK_VERIFY_KEY`）校验，但那是仓库原作者的密钥——**你自己部署时必须生成自己的 Ed25519 密钥对**：私钥（`BROADCAST_SIGNING_KEY`，Ed25519 PKCS8）设到 **Supabase 项目函数密钥**（Dashboard → Edge Functions → 对应函数 → Secrets，或本地 `supabase secrets set`），公钥（SPKI）设到 **Cloudflare 构建变量 `NEXT_PUBLIC_BROADCAST_VERIFY_KEY`**（覆盖内联默认值）。不配公钥会导致公私钥不匹配、广播校验失败、消息被丢弃。私钥不走 CI、不进 GitHub Secret。**注意**：前端部署后即默认强制校验，而消息送达只走广播、无 DB 兜底，因此私钥须**先于或随**前端部署在 Supabase 生效——先设好再 push，避免生效前出现无签名广播被丢弃、消息暂不可见。
- **密钥轮换**：改设 Cloudflare 构建变量 `NEXT_PUBLIC_BROADCAST_VERIFY_KEY` 为新的 SPKI 公钥（覆盖内联常量），并在 Supabase 改 `BROADCAST_SIGNING_KEY` 为新 PKCS8 私钥即可，免改代码。
- **密钥生成**：用 `node scripts/gen-broadcast-keys.mjs` 或双击 `scripts/gen-broadcast-keys.html`（浏览器本地生成、零安装）生成 Ed25519 密钥对——**私钥**设到 Supabase 函数密钥 `BROADCAST_SIGNING_KEY`，**公钥**设到 Cloudflare 构建变量 `NEXT_PUBLIC_BROADCAST_VERIFY_KEY`（非 GitHub Secret）。

**幂等写入**：消息以客户端生成的 `id` 为主键，插入使用 `onConflict:'id', ignoreDuplicates:true`（upsert-ignore）。网络超时重发、重复提交会被直接忽略并返回 `duplicate` 标志；**仅在「真实插入」时触发广播**，重试不会造成重复消息或重复广播。这避免了「服务端已落库但客户端误判失败 → 消息卡在 failed 且永不广播」的孤儿消息。

> - Edge Function 用 **Publishable key** 广播（Broadcast 是 pub/sub，不读表、不受 RLS 约束，无需改动鉴权 / RLS）；调用失败不影响消息落库，未实时收到的客户端会在 onSync / 刷新时从数据库补偿（兜底）。
> - 代码见 `supabase/functions/broadcast-message/index.ts`，部署见 `docs/DEPLOYMENT.md` 第 3 节。

## 6.2 安全纵深（限流 / SSRF 防护）

**限流（第一道防线，应用层）**

- 所有 `/api/*` 请求经 `middleware.ts` 的滑动窗口限流（`src/lib/rate-limit.ts`）：按 `客户端IP:路径` 计数，超限返回 `429` + `Retry-After` 与 `X-RateLimit-*` 响应头。
- 敏感路径独立配额：注册/登录 10/min、管理后台登录 5/min、上传与房间操作 10–20/min、发消息 30/min、管理操作（含 `audit-logs`）10–20/min；其余默认 60/min。
- ⚠️ 局限：应用层限流是**内存级、不跨 Cloudflare 边缘实例共享**，仅作第一道防线。生产环境务必在 **Cloudflare 控制台配置 Rate Limiting Rules**（按客户端 IP + 路径）作为真实边缘防线——这是纵深防御的关键一层。

**SSRF 防护**

- 服务端**不存在"用用户提供的 URL 做服务端请求"的端点**：所有出站请求（ImgBB 上传、Supabase Edge Function 广播）均指向**写死的白名单主机**（`https://api.imgbb.com`、Supabase 项目域名）。
- `upload-proxy` 转发图片到 ImgBB 时，出站 fetch 设 `redirect: 'manual'`，**不跟随重定向**，防止响应被劫持跳转到内网/任意地址（fail-closed，非 2xx 按失败处理）。
- 上传入口（`upload-media` / `upload-proxy`）均要求登录 + 房间成员校验，并校验文件大小与 MIME 类型，不接受任意外部 URL。

---

## 7. 部署

- **目标**：Cloudflare Pages，`@cloudflare/next-on-pages`。
- **构建命令**：`npm run cf:build`（`npx @cloudflare/next-on-pages`）；输出 `.vercel/output/static`。
- **环境变量**：必填 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `CHAT_PASSWORD` / `CHAT_JWT_SECRET`；可选 `CHAT_AUTH_ENABLED` / `ADMIN_PASSWORD` / `CHAT_VERSION_SALT` / `IMGBB_API_KEY` / VAPID 系列。
- ⚠️ 新增/修改环境变量后必须**全新构建**（push 或控制台 Deploy），只点 Retry 不会注入新变量。

---

## 8. 保活

`GET /api/keepalive`（middleware 白名单，公开）用 Service Role 对 `messages` 做一次 `count` 查询，算一次数据库活动。`.github/workflows/keepalive.yml` 每 6 小时自动 ping，防止 Supabase 免费项目 ~7 天无活动被暂停。若已暂停需到 Dashboard 手动 Restore。

---

## 9. 关键配置（`src/config/index.ts`）

- `AUTH_CONFIG.JWT_EXPIRY = 7天`，`SESSION_COOKIE='chat_session'`
- `API_CONFIG`：`VERIFY_PASSWORD_ENDPOINT` / `PASSWORD_VERSION_ENDPOINT` / `ADMIN_VERIFY_ENDPOINT` / `ADMIN_ROOMS_ENDPOINT` / `ADMIN_MESSAGES_ENDPOINT` 等
- `ROOM_CONFIG.DEFAULT_ROOM='default-room'`
- `MESSAGE_CONFIG.PAGE_SIZE=20`
- `UPLOAD_CONFIG.MAX_FILE_SIZE=50MB` + 允许类型 + 图片压缩参数
