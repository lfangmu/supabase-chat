# 部署指南（Deployment）

一份从零开始的部署流程。整体架构：**Cloudflare Pages 托管前端 + Supabase 托管数据库与 Realtime**；浏览器经**同源的 Pages Functions**（`src/app/api/*`，详见 §3.5）访问 Supabase，以规避国内对 `*.supabase.co` 的拦截。应用与代理**同一个 Pages 项目**部署，push 到 `main` 即自动上线。

> 推荐先完成 **Supabase（§2）** 再完成 **Cloudflare（§3）**——因为 Cloudflare 的环境变量里要用到 Supabase 的 Project URL / Publishable key，先建好 Supabase 顺手拿到密钥再填 Cloudflare。

你只需准备：一个 GitHub 账号、两个免费平台账号（Cloudflare / Supabase），按顺序走完下面 5 步即可。

## 0. 前置条件

- 一个 GitHub 账号
- Node.js 18.17+（仅本地生成密钥 / 本地开发时需要；纯云端部署不需要）
- 一个你自己的域名（可选；Cloudflare Pages 也提供 `*.pages.dev` 免费子域）

---

## 1. Fork 项目

1. 打开 `https://github.com/lfangmu/supabase-chat`，点右上角 **Fork**。
2. 选择你的账号，确认得到 `你的用户名/supabase-chat`。
3. （可选，仅本地开发）`git clone` 到本地。

> 后续所有「关联仓库」操作都指向你 fork 出来的这个仓库，不是原仓库。

---

## 2. Supabase：注册 → 建项目 → 关联仓库 → 设参数

### 2.1 注册 Supabase 账号

打开 `https://supabase.com/dashboard`，用 GitHub 登录注册（免费层即可）。

### 2.2 创建项目

1. **New project**，填名称、数据库密码（记好）、区域（选离你近的）。
2. 创建后进入项目，按下面位置记下以下信息（后面 **Cloudflare §3.3** 要用）：
   - **Project URL**（进入项目后的 **Project Overview** 首页顶部，项目名下方带 **Copy** 按钮，形如 `https://<ref>.supabase.co`）→ `NEXT_PUBLIC_SUPABASE_URL`
   - **Publishable key**（Project Settings → **API Keys**，`sb_publishable_…`，公开、可进浏览器）→ `NEXT_PUBLIC_SUPABASE_KEY`
   - **Secret key**（Project Settings → **API Keys**，`sb_secret_…`，特权、仅服务端、注意保密）→ `SUPABASE_SERVICE_ROLE_KEY`
   - **Project ID / Reference ID**（Project Settings → **General**）→ 仅本地 CLI 用，CI 不需要
   > 变量名 `SUPABASE_SERVICE_ROLE_KEY` 沿用 Supabase 约定（指 service_role 权限），对应面板里的 **Secret key**；切勿加 `NEXT_PUBLIC_` 前缀。

### 2.3 创建 Storage 桶

`Storage → New bucket`，名称 `chat-media`（存放图片/视频），权限默认即可。

### 2.4 关联 GitHub 仓库（让迁移与函数自动部署）

1. 项目 → **Project Settings → Integrations**（GitHub Integration 区）→ **Authorize GitHub**，授权你 fork 的仓库。
2. 设置 **Working directory**（仓库里 `supabase/` 所在的相对路径：仓库根目录直接填 `.`），然后点 **Enable integration**。
3. 在 GitHub Integration 配置里开启 **Deploy to production**——push 到 `main` 时会自动应用迁移（含把 `messages` 表加入实时发布、创建房间成员 RLS 策略）。

> 关联后：push 到 `main` 时 Supabase 自动应用 `supabase/migrations/` 迁移。**GitHub Integration 本身不需要任何 `SUPABASE_*` 仓库密钥**（`SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` 都不需要）。注意：Edge Functions 面板里**没有**单独的「Auto deploy」开关，函数的自动部署由上面的 GitHub Integration 统一控制（本项目已不再依赖 Edge Function）。

### 2.5 开启 Supabase Auth（仅需一次配置）

实时消息由数据库 **Postgres Changes（CDC）+ RLS** 直接推送，RLS 里的 `auth.uid()` 来自**真实的 Supabase Auth 会话**（浏览器端 `@supabase/ssr` 客户端持有），**不再需要任何 JWT 签发密钥**——`SUPABASE_JWT_SECRET` / `CHAT_JWT_SECRET` 均已废弃。

1. Supabase 项目 → **Authentication → Sign In / Providers**，开启：
   - **Email**（邮箱注册/登录）
   - **Anonymous sign-ins**（匿名登录，保留「不用注册直接聊」的体验）
2. （可选）**Authentication → URL Configuration** 里把站点地址加入 Redirect URLs，避免邮箱确认后跳回失败。
3. 管理员：在 SQL Editor 里把目标用户的 `public.users.role` 改成 `admin`：
   ```sql
   update public.users set role = 'admin' where id = '<该用户的 auth.uid()>';
   ```
   `/api/admin/*` 由中间件按 `role` 校验，不再有独立后台密码。

> 迁移 `00022` 会为新注册的 auth 用户自动创建 `public.users` 资料行（`display_name` 取注册时填的昵称 → 邮箱前缀 → `匿名用户`）。

### 2.6 验证迁移已应用

push 一次到 `main`（或等上一步完成后），到：

- **Database → Tables** 应能看到 `rooms` / `messages` 等表；
- （可选）确认 **Database → Publications** 中 `supabase_realtime` 已包含 `messages` 表（迁移 00019 会自动加入；如手动验证，可用 `select * from pg_publication_tables where pubname='supabase_realtime';`）。

---

## 3. Cloudflare：注册 → 建项目 → 关联仓库 → 设参数

### 3.1 注册 Cloudflare 账号

打开 `https://dash.cloudflare.com/sign-up`，用邮箱注册（免费层即可，无需绑卡）。

### 3.2 创建 Pages 项目并关联仓库

1. Dashboard → **Workers & Pages → Create → Pages → Connect to Git**。
2. 授权 GitHub，选择你 fork 的 `你的用户名/supabase-chat` 仓库。
3. 构建设置：
   - **Framework preset**：`None`（手动指定）
   - **Build command**：`npm run cf:build`
   - **Build output directory**：`.vercel/output/static`
4. 先点 **Save and Deploy** 让它跑一次（会因缺变量先构建出空壳，没关系，下一步补变量后重部署）。


### 3.3 设置参数（环境变量）

进入项目 **Settings → Variables and Secrets（或 Environment variables）**，逐个添加：

| 变量                             | 必填 | 说明 / 取值来源                                                                                                            |
| ------------------------------ | -- | -------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`     | ✅  | Supabase Project URL（见 §2.2）                                                                                         |
| `NEXT_PUBLIC_SUPABASE_KEY`     | ✅  | Supabase **Publishable key**（见 §2.2）                                                                                 |
| `NEXT_PUBLIC_SUPABASE_PROXY_URL` | ✅ | 同源代理前缀（见 §3.5），固定为 `https://<你的应用域名>/api`（如 `https://chat.example.com/api`）；**浏览器经此访问 Supabase**，规避国内对 `*.supabase.co` 的拦截。**必须与应用同源（同一 Pages 项目）。** |
| `SUPABASE_SERVICE_ROLE_KEY`    | ✅  | Supabase **Secret key**（见 §2.2，**保密，切勿加 `NEXT_PUBLIC_` 前缀**）                                                         |
| `IMGBB_API_KEY`                | ⚪  | ImgBB 图片代理上传 key（可选，<32MB 走 Supabase Storage）                                                                        |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | ⚪  | Web Push 公钥（前端访问，需 `NEXT_PUBLIC_`）                                                                                   |
| `VAPID_PRIVATE_KEY`            | ⚪  | Web Push 私钥（服务端）                                                                                                     |
| `VAPID_SUBJECT`                | ⚪  | Web Push subject（`mailto:` 或 `https://`）                                                                             |
| `NEXT_DISABLE_VERSION_CHECK`   | ⚪  | 设为 `1` 关闭 Next.js 版本检查（联网受限环境）                                                                                       |

> 鉴权改由 **Supabase Auth** 管理：身份 = `auth.uid()`（UUID），会话 cookie 由 `@supabase/ssr` 维护。
> 已废弃并移除的变量：`CHAT_JWT_SECRET`、`SUPABASE_JWT_SECRET`、`CHAT_PASSWORD`、`CHAT_AUTH_ENABLED`、`CHAT_VERSION_SALT`、`ADMIN_PASSWORD`（管理员改由 `public.users.role='admin'` 判定）。
> ⚠️ **新增/修改环境变量后必须触发全新构建**（push 新提交或控制台 **Deploy**），只点 **Retry** 不会注入新变量。

> **前端改完代码要生效，还有两步（否则浏览器还在跑旧包）**：① 每次重新部署前端后，若改动了客户端逻辑（含会话 cookie 名），去 DevTools → Application → Service Workers → **Unregister** + **Clear storage** + 硬刷新；或把 `public/sw.js` 的 `CACHE_NAME` 递增（如 `supabase-chat-v2`）再部署，让旧缓存自动失效。② 部署后旧登录会话失效，**需重新登录一次**。详见 §3.5。

### 3.4 触发正式构建

由于 §3.2 第 4 步是空壳构建，设好变量后：回到项目 **Deployments**，点最新一次部署的 **Redeploy**（或往 `main` 推一个空提交）。这次会带上真实变量，构建出可用前端。

---

### 3.5 同源反向代理（Pages Functions，国内可达，必选）

浏览器若直接连 `*.supabase.co` 在国内会被网络层拦截（登录/实时全部失败）。本项目把反向代理**折叠进 `supabase-chat` 同一个 Pages 项目**，以同源的 Next.js Route Handlers 部署，浏览器全程只访问你自己的应用域名：

- `src/app/api/rest/v1/[[...path]]` / `auth/v1/[[...path]]` / `storage/v1/[[...path]]` —— REST / Auth / Storage 透传到真实 Supabase 项目（见 `src/lib/supabaseProxy.ts`）；
- `src/app/api/realtime`（SSE 长连接）+ `src/app/api/realtime/send`（POST 发送）—— 实时中继，把「浏览器↔Supabase 的 WebSocket」拆成两段 HTTP，绕开国内 WebSocket 封锁（见 `src/lib/realtimeProxy.ts`）。

代理目标 host 由 `NEXT_PUBLIC_SUPABASE_URL` 自动推导，因此**生产 / 预览指向不同 Supabase 项目也能正确转发**，无需为代理单独维护 host。

> **不再需要独立的 Worker 项目**。`NEXT_PUBLIC_SUPABASE_PROXY_URL` 现在只填应用自身的同源前缀：到 Pages 项目 **Settings → Environment variables**，把该变量（prod + preview）设为 `https://<你的应用域名>/api`（例如 `https://chat.example.com/api`）。因为 `NEXT_PUBLIC_*` 是**构建期内联**的，改完变量后必须**重新部署 Pages**（push 到 `main` 或控制台 **Deploy**）才能生效。

> 仅服务端（`src/lib/supabase-server.ts`、middleware、回调路由）仍直连真实的 `NEXT_PUBLIC_SUPABASE_URL`；浏览器走同源代理。两者指向**同一真实项目**。部署完用 `curl https://<你的应用域名>/api/health` 验证返回 `200` 且 `sameOrigin: true`。

---

## 4. 保活（防止免费项目被暂停）

Supabase 免费项目约 **7 天无数据库活动**会被自动暂停（paused），表现为所有读写与实时订阅失败。

- 端点 `GET /api/keepalive`（`src/app/api/keepalive/route.ts`）用 Service Role 发一次轻量查询，已在 middleware 白名单，无需登录即可访问。
- `.github/workflows/keepalive.yml` 每 6 小时 `GET` 一次保活端点。**目标地址由 GitHub 仓库 Variable `KEEPALIVE_URL` 控制，且必填**：在仓库 `Settings → Secrets and variables → Actions → Variables` 新增 `KEEPALIVE_URL`，值设为你的部署地址（如 `https://your-chat.pages.dev`）；未设置时保活任务会失败并提示配置。
- 若已被暂停：打开 Supabase Dashboard → 对应项目 → 点 **Restore**；恢复后保活任务即可持续生效。

---

## 5. 构建 Android APK（可选）

已 `npm install` 且安装 `@capacitor/android` 后：

```bash
APP_URL=https://your-chat.pages.dev npx cap sync android
npx cap build android
```

`capacitor.config.ts` 的 `server.url` 默认取环境变量 `APP_URL`；未设置时回退占位地址 `https://your-chat.example.com`。

- 本地构建：手动传 `APP_URL=你的地址`。
- CI 构建（`build-apk.yml`）：从仓库 Variable `APP_URL` 读取，请在 `Settings → Variables` 中配置 `APP_URL` 指向你的部署地址，否则产出的 APK 会指向占位符、无法连接。

---

## 6. 验证清单

- [ ] 打开部署地址，`GET /api/keepalive` 返回 200
- [ ] `https://<你的应用域名>/api/health` 返回 `200` 且 `sameOrigin: true`
- [ ] 匿名进入（Supabase Auth anonymous sign-in）成功，能发消息、实时收到
- [ ] 邮箱注册/登录成功，且换设备登录仍能拿到同一身份
- [ ] 登录后任意 `/api/*`（如 `/api/me`）正常返回，**不再 401**（否则清 SW 缓存 + 重新登录，见 §3.5）
- [ ] `/admin` 用 role=admin 的账号能进、能删群；非 admin 账号访问 `/api/admin/*` 返回 403
- [ ] Supabase Tables 有数据；`supabase_realtime` 发布含 `messages` 表（迁移 00019 自动加入）
- [ ] 改任意环境变量后重新 Deploy 生效

---


## 7. API 端点速查

| 方法     | 路径                            | 鉴权            | 说明                                     |
| ------ | ----------------------------- | ------------- | -------------------------------------- |
| GET    | `/api/keepalive`              | 公开            | 健康检查（保活）                                |
| GET    | `/api/health`                | 公开            | 部署自检（build / targetHost / sameOrigin）     |
| GET    | `/api/realtime`              | Supabase Auth  | 实时接收中继（SSE）：postgres_changes / broadcast / presence |
| POST   | `/api/realtime/send`         | Supabase Auth  | 实时发送中继（typing / 撤回 / 编辑 / 回执等 broadcast） |
| GET    | `/api/me`                     | Supabase Auth  | 当前会话资料（`id` / `display_name` / `role` 等） |
| GET    | `/api/rooms?ids=`             | Supabase Auth  | 返回指定 ID 的房间                            |
| POST   | `/api/rooms`                  | Supabase Auth  | 创建房间（群聊生成 8 位短房间号；私聊为 `dm:<uuidA>:<uuidB>`） |
| PUT    | `/api/rooms`                  | Supabase Auth  | 重命名房间（禁改 `default-room`）               |
| DELETE | `/api/rooms`                  | Supabase Auth  | 删除群聊（禁删 `default-room`）                |
| GET    | `/api/messages?roomId=&...`   | Supabase Auth  | 房间消息分页                                 |
| POST   | `/api/messages`               | Supabase Auth  | 发送消息（写 `user_id` + 展示名 `user`）          |
| DELETE | `/api/messages`               | Supabase Auth  | 撤回自己的消息（按 `user_id` 校验归属，清理存储文件）       |
| POST   | `/api/upload-media`           | Supabase Auth  | Supabase Storage 上传                    |
| POST   | `/api/upload-proxy`           | Supabase Auth  | ImgBB 代理上传                             |
| GET    | `/api/signed-url`             | Supabase Auth  | 私有资源签名 URL                             |
| GET    | `/api/admin/rooms`            | role=admin    | 全部群聊 + 最新消息摘要                          |
| DELETE | `/api/admin/rooms`            | admin_session | 删除群聊（禁删 `default-room`）                |
| GET    | `/api/admin/messages?roomId=` | admin_session | 房间消息只读                                 |
| GET    | `/api/keepalive`              | 公开            | 保活 ping（无需登录）                          |

---


## 8. 故障排除

| 现象                                              | 排查                                                                                                                                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/*` 全 401「未认证，请先登录」、但能登录注册 | 会话 cookie 名两端不一致：浏览器走同源代理、服务端走真实域名，默认推导的 cookie 名不同 → 服务端读不到会话。**确认代码 4 处 `cookieOptions.name` 已统一；redeploy Pages + 重新登录一次。** |
| 改了代码 / 重新部署后依旧 401、旧功能没生效            | 浏览器在跑 SW 缓存里的旧 JS。把 `public/sw.js` 的 `CACHE_NAME` 递增（如 `supabase-chat-v2`）再部署，或 DevTools → Application → Service Workers → Unregister + Clear storage + 硬刷新。                                                                            |
| 登录接口能通、但实时（Realtime）收不到消息           | ① Supabase 免费项目是否被暂停（去 Dashboard **Restore**）；② `supabase_realtime` 发布是否含 `messages` 表（迁移 00019 自动加入）；③ `messages` 表 RLS 策略「Authenticated members can read messages」是否存在。本项目不再需要 `SUPABASE_JWT_SECRET` 或 `/api/realtime-token`。 |
| `/admin` 进不去 / 返回 403                           | 管理员走 Supabase Auth：由 `public.users.role='admin'` 判定。确认该账号已注册、且 `role` 已设为 `admin`（`update public.users set role='admin' where id='<uid>'`）；非 admin 访问 `/api/admin/*` 返回 403 是预期行为。            |
| 数据库全部失败 / 实时不通 / keepalive 503 `Project is paused` | 多半是 Supabase 免费项目被暂停 → 去 Dashboard **Restore** 一次；恢复后保活任务持续唤醒。                                                                                                                                              |
| 消息发出但自己/他人收不到实时（已排除上一条）           | 检查 Supabase `supabase_realtime` 发布是否含 `messages` 表（迁移 00019）、`messages` 表 RLS 策略「Authenticated members can read messages」是否存在、以及浏览器是否成功订阅 `postgres_changes`。 |
| 新增环境变量不生效                                       | Cloudflare Pages **必须全新构建**（push 或控制台 Deploy），只点 Retry 不会注入                                                                                                                                                                 |
| 上传失败                                            | 检查文件类型/大小（上限 50MB）、Supabase `chat-media` 桶权限、ImgBB key（图片兜底）                                                                                                                                                                |
