# 部署指南（Deployment）

一份从零开始的部署流程。整体架构：**Cloudflare Pages 托管前端 + Supabase 托管数据库与 Edge Function**，两边各自关联你 fork 的 GitHub 仓库，push 到 `main` 即自动上线。

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
3. 在 GitHub Integration 配置里开启 **Deploy to production**——push 到 `main` 时会自动应用迁移、并部署 `supabase/functions/` 下的 `broadcast-message` 函数。

> 关联后：push 到 `main` 时 Supabase 自动应用 `supabase/migrations/` 迁移、自动部署 `broadcast-message` 函数。**无需在仓库配置任何 `SUPABASE_*` 密钥**（`SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` 都不需要）。注意：Edge Functions 面板里**没有**单独的「Auto deploy」开关——函数的自动部署由上面的 GitHub Integration 统一控制。

### 2.5 生成并设置广播密钥 `BROADCAST_SIGNING_KEY`

> 这是**唯一需要你手动设到 Supabase** 的密钥——GitHub App 不会自动注入函数密钥。
> 广播防伪造需要一对 Ed25519 密钥：**私钥在 Supabase 签名，公钥在前端校验**，两者必须配对。

**方式 A（推荐，零安装 · 点点点）**：直接用浏览器生成，不碰终端。
1. 双击打开本仓库的 `scripts/gen-broadcast-keys.html`（较新的 Chrome / Edge / Firefox 均可；全程本地运行，私钥不上传任何服务器）。
2. 点「生成密钥对」，页面会给出两串值。
3. 复制**私钥**：Supabase 项目 → **Edge Functions → broadcast-message → Secrets**，新增 `BROADCAST_SIGNING_KEY` = 私钥（推送后函数会自动重新部署）。
4. 复制**公钥**：Cloudflare Pages → 你的项目 → **Settings → Build → Build variables**，新增 `NEXT_PUBLIC_BROADCAST_VERIFY_KEY` = 公钥（需重新构建生效）。

**方式 B（本地 node）**：`npm install` 后运行 `node scripts/gen-broadcast-keys.mjs`，它会同时打印私钥与公钥两行；私钥填 Supabase（同上步骤 3），公钥填 Cloudflare（同上步骤 4）。
（私钥也可本地用 `supabase secrets set BROADCAST_SIGNING_KEY=<私钥>` 设置。）

> ⚠️ 公钥**必须**填到 Cloudflare 的 `NEXT_PUBLIC_BROADCAST_VERIFY_KEY`——前端内联的默认公钥与你的新私钥**不匹配**，不填会导致广播校验失败、消息被丢弃。
> ⚠️ 私钥须**先于或随**前端部署生效，否则无签名的广播会被丢弃、消息暂不可见。

### 2.6 验证迁移已应用

push 一次到 `main`（或等上一步完成后），到：

- **Database → Tables** 应能看到 `rooms` / `messages` 等表；
- **Edge Functions** 里 `broadcast-message` 状态为已部署。

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

| 变量                                 | 必填 | 说明 / 取值来源                                                                      |
| ---------------------------------- | -- | ------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`         | ✅  | Supabase Project URL（见 §2.2）                                                   |
| `NEXT_PUBLIC_SUPABASE_KEY`         | ✅  | Supabase **Publishable key**（见 §2.2）                                           |
| `SUPABASE_SERVICE_ROLE_KEY`        | ✅  | Supabase **Secret key**（见 §2.2，**保密，切勿加 `NEXT_PUBLIC_` 前缀**）                   |
| `CHAT_PASSWORD`                    | ✅  | 普通聊天门禁密码（自定义随机串，建议 ≥12 位）                                                      |
| `CHAT_JWT_SECRET`                  | ✅  | 签名 httpOnly Cookie 的随机密钥（≥32 位随机串）                                             |
| `ADMIN_PASSWORD`                   | ⚪  | 管理后台密码（留空则无法登录后台）                                                              |
| `CHAT_AUTH_ENABLED`                | ⚪  | 门禁开关，默认 `true`；设 `false` 关闭普通聊天鉴权（免密进入，**不影响 `/admin`**）                       |
| `CHAT_VERSION_SALT`                | ⚪  | 密码版本盐值，用于检测密码变更后强制重新登录                                                         |
| `IMGBB_API_KEY`                    | ⚪  | ImgBB 图片代理上传 key（可选，<32MB 走 Supabase Storage）                                  |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`     | ⚪  | Web Push 公钥（前端访问，需 `NEXT_PUBLIC_`）                                             |
| `VAPID_PRIVATE_KEY`                | ⚪  | Web Push 私钥（服务端）                                                               |
| `VAPID_SUBJECT`                    | ⚪  | Web Push subject（`mailto:` 或 `https://`）                                       |
| `NEXT_DISABLE_VERSION_CHECK`       | ⚪  | 设为 `1` 关闭 Next.js 版本检查（联网受限环境）                                                 |
| `NEXT_PUBLIC_BROADCAST_VERIFY_KEY` | ✅  | **Cloudflare 构建变量（必填）**：Ed25519 公钥（SPKI base64），须与你生成的私钥配对。生成方式见 §2.5；公钥**必须**填到这里，否则前端内联的默认公钥与你的私钥不匹配，广播校验会失败、消息被丢弃 |

> 管理后台密码变量名：优先认 `ADMIN_PASSWORD`；若为空会依次兜底 `SUPER_PASSWORD` / `CHAT_SUPER_PASSWORD`。  
> ⚠️ **新增/修改环境变量后必须触发全新构建**（push 新提交或控制台 **Deploy**），只点 **Retry** 不会注入新变量。

### 3.4 触发正式构建

由于 §3.2 第 4 步是空壳构建，设好变量后：回到项目 **Deployments**，点最新一次部署的 **Redeploy**（或往 `main` 推一个空提交）。这次会带上真实变量，构建出可用前端。

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
- [ ] `GET /api/password-version` 返回 `required:true`（门禁开）或 `required:false`（关）
- [ ] 用 `CHAT_PASSWORD` 进入聊天、能发消息、实时收到
- [ ] `/admin` 用 `ADMIN_PASSWORD` 能进、能删群
- [ ] Supabase Tables 有数据、`broadcast-message` Edge Function 已部署
- [ ] 改任意环境变量后重新 Deploy 生效

---


## 7. API 端点速查

| 方法     | 路径                            | 鉴权            | 说明                                     |
| ------ | ----------------------------- | ------------- | -------------------------------------- |
| GET    | `/api/password-version`       | 公开            | 返回 `required`（门禁是否开启）+ 密码版本            |
| POST   | `/api/verify-password`        | 公开            | 普通登录（CHAT_PASSWORD）→ `chat_session`    |
| DELETE | `/api/verify-password`        | 公开            | 普通登出（清除 `chat_session`）                |
| GET    | `/api/rooms?ids=`             | chat_session  | 返回指定 ID 的房间                            |
| POST   | `/api/rooms`                  | chat_session  | 创建房间（生成 8 位短房间号）                       |
| PUT    | `/api/rooms`                  | chat_session  | 重命名房间（禁改 `default-room`）               |
| DELETE | `/api/rooms`                  | chat_session  | 删除群聊（禁删 `default-room`）                |
| GET    | `/api/messages?roomId=&...`   | chat_session  | 房间消息分页                                 |
| POST   | `/api/messages`               | chat_session  | 发送消息                                   |
| DELETE | `/api/messages`               | chat_session  | 撤回自己的消息（校验归属，清理存储文件）                   |
| POST   | `/api/upload-media`           | chat_session  | Supabase Storage 上传                    |
| POST   | `/api/upload-proxy`           | chat_session  | ImgBB 代理上传                             |
| GET    | `/api/signed-url`             | chat_session  | 私有资源签名 URL                             |
| POST   | `/api/admin/verify`           | 公开            | 管理员登录（ADMIN_PASSWORD）→ `admin_session` |
| DELETE | `/api/admin/verify`           | 公开            | 管理员登出                                  |
| GET    | `/api/admin/rooms`            | admin_session | 全部群聊 + 最新消息摘要                          |
| DELETE | `/api/admin/rooms`            | admin_session | 删除群聊（禁删 `default-room`）                |
| GET    | `/api/admin/messages?roomId=` | admin_session | 房间消息只读                                 |
| GET    | `/api/keepalive`              | 公开            | 保活 ping（无需登录）                          |

---


## 8. 故障排除

| 现象                                              | 排查                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 登录一直 401「密码错误」                                  | 检查 `CHAT_PASSWORD` / `ADMIN_PASSWORD` 是否带首尾空格（Cloudflare 控制台复制易带入）；确认对应环境变量已在新构建中注入                                              |
| `/admin` 进不去 / 返回 401                           | 确认 `ADMIN_PASSWORD` 已配置且新构建已生效；`SUPER_PASSWORD` 项目实测注入不稳，改用 `ADMIN_PASSWORD`                                                     |
| 聊天页面空白 / 一直弹密码门                                 | `GET /api/password-version` 应返回 `required:true`（门禁开）或 `required:false`（关）。若为 500，检查 `CHAT_JWT_SECRET` / `CHAT_VERSION_SALT` 是否设置 |
| 「未认证，请先登录」                                      | `chat_session` 过期（7 天）或被密码变更踢出，刷新重登                                                                                              |
| 数据库全部失败 / 实时不通                                  | 多半是 Supabase 免费项目被暂停 → 去 Dashboard **Restore** 一次                                                                                |
| `GET /api/keepalive` 返回 503 `Project is paused` | 项目已暂停，需手动 Restore；恢复后保活任务持续唤醒                                                                                                    |
| 消息发出但自己/他人收不到实时                                 | 检查 Supabase `broadcast-message` 函数是否已部署、`BROADCAST_SIGNING_KEY` 是否已在 Supabase 设好且生效（未生效时广播被丢弃）                                   |
| 新增环境变量不生效                                       | Cloudflare Pages **必须全新构建**（push 或控制台 Deploy），只点 Retry 不会注入                                                                      |
| 上传失败                                            | 检查文件类型/大小（上限 50MB）、Supabase `chat-media` 桶权限、ImgBB key（图片兜底）                                                                     |
