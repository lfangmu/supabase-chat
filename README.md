# Supabase Chat · 微信风实时聊天

![Supabase Chat 预览](docs/preview.png)

基于 **Next.js 14 (App Router) + Supabase** 的实时聊天应用：微信风三栏界面（消息 / 通讯录 / 我），支持好友与私聊、群聊、富媒体消息、已读回执、消息编辑 / 撤回 / 转发、表情回应、全文搜索，以及独立的管理后台 `/admin`。

**零成本自托管**：前端跑 Cloudflare Pages，数据与实时跑 Supabase，全部可用免费层。

## 功能特性

**消息**

- 文本（Markdown 渲染 + 代码高亮 + XSS 净化）、图片（灯箱预览）、视频、语音、文件
- 表情回应、消息编辑、撤回、转发（带来源标注）
- 已读回执、@提及（红点提醒）、草稿自动保存
- 跨会话全文搜索（可按发送者 / 时间筛选）
- 服务端权威送达：消息先落库再推送，离线不丢

**社交**

- 好友系统：按昵称搜索添加、申请与接受、删除好友、通讯录
- 私聊 DM（与群聊共用同一会话列表）
- 群聊：创建群、群成员管理、群名
- 点击头像查看个人资料卡（加好友 / 发消息 / 编辑资料）

**体验**

- 微信风视觉，可一键切换「经典靛蓝」主题；暗色模式
- 会话置顶、隐藏、清空聊天记录
- 在线状态、打字指示
- 虚拟滚动（长会话不卡顿）
- PWA（离线兜底页）、Android APK（Capacitor）
- 网络状态横幅

**管理**

- 独立后台 `/admin`（按 Supabase Auth 的 `role` 校验）
- 全部群聊与消息审计、批量删除群聊、审计日志

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 14.2（App Router，API Routes 全 Edge Runtime） |
| 语言 | TypeScript 5（strict） |
| 样式 | Tailwind CSS 3.4 + `next-themes`（暗色模式） |
| 数据 / 存储 | Supabase（PostgreSQL + Storage） |
| 鉴权 | Supabase Auth（`@supabase/ssr` 维护会话 Cookie） |
| 实时传输 | **SSE 服务端中继**：浏览器经 `/api/realtime`（SSE 收）与 `/api/realtime/send`（POST 发），把「浏览器 ↔ Supabase 的 WebSocket」拆成两段 HTTP，绕开国内对 WebSocket 的封锁 |
| 部署 | Cloudflare Pages（`@cloudflare/next-on-pages`）+ 同源反向代理（Pages Functions） |
| 移动端 | Capacitor 8（Android APK） |
| 测试 | Vitest 4 + Testing Library（240 个用例） |

## 架构一览

```
浏览器（全程只访问你自己的域名）
  │
  ├─ 页面 / 静态资源 ─────────────▶ Cloudflare Pages
  │
  ├─ REST / Auth / Storage ──────▶ /api/{rest,auth,storage}/v1/*  ──▶ Supabase
  │    （同源反向代理，规避国内对 *.supabase.co 的网络层拦截）
  │
  └─ 实时 ── SSE 长连接（收）+ POST（发）──▶ /api/realtime[/send] ──▶ Supabase Realtime
```

- **客户端**：React Hooks + Tailwind。数据库读写一律经服务端 API 路由（持 Service Role Key）；客户端 Supabase SDK **仅用于实时订阅**，不持有写权限。
- **服务端**：Next.js Route Handlers，统一 Edge Runtime。
- **消息完整性**：消息必须经 `POST /api/messages` 鉴权落库后才会推送，客户端无法凭空注入；RLS 按 `auth.uid()` 过滤，非房间成员收不到。
- **为什么不用 WebSocket**：国内网络会拦截浏览器直连 `*.supabase.co` 的 WebSocket 升级请求。本项目把实时链路改为 **SSE 收 + POST 发** 两段 HTTP，并对 REST / Auth / Storage 做同源反向代理。

细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 快速开始

```bash
git clone <your-repo-url> supabase-chat
cd supabase-chat
npm install
cp .env.example .env.local      # 填入 Supabase 凭证（见「配置参数获取」）
npm run dev                     # http://localhost:3000
```

打开 `/`：填个昵称即可**匿名进入**聊天，也可用邮箱注册 / 登录长期保留身份。
打开 `/admin`：用 `public.users.role = 'admin'` 的账号登录，可查看全部房间 / 消息并删除群聊。

> 需在 Supabase 后台 **Authentication → Sign In / Providers** 开启 **Email** 与 **Anonymous sign-ins**。

常用命令：

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发 |
| `npm run test` | 单元测试（Vitest） |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run build` | 生产构建 |
| `npm run cf:build` | Cloudflare Pages 构建（`next-on-pages`） |

## 部署

本项目部署到 **Cloudflare Pages**，构建命令 `npm run cf:build`，输出目录 `.vercel/output/static`。国内访问 `*.supabase.co` 会被拦截，应用内置**同源反向代理**（Pages Functions，`src/app/api/*`）规避——与前端同一个 Pages 项目部署，**无需额外部署 Worker**，详见 [docs/DEPLOYMENT.md §3.5](docs/DEPLOYMENT.md)。

完整流程（准备 Supabase、配置环境变量、同源反向代理、应用迁移、配置保活、构建 Android APK、API 参考、故障排除）见 **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**。

## 免费层（Free tier）

本项目可完全跑在各大平台的免费层上，**零成本自托管**：

- **Cloudflare Pages**：免费托管前端，含构建、请求量与带宽额度，无需信用卡。
- **Supabase Free**：免费 Postgres + Realtime + Storage。
  - ⚠️ 免费项目约 **7 天无数据库活动会被自动暂停**（所有读写与实时订阅失败）。仓库内的 `keepalive.yml` 每 6 小时 ping 一次保活端点来规避——你需要在仓库 `Settings → Variables` 设 `KEEPALIVE_URL`（你的部署地址），否则保活任务会失败。
- **ImgBB**：图片上传代理可用免费方案，非必需。

> 只要 Supabase 用免费层，就务必保留 keepalive 定时任务并正确配置 `KEEPALIVE_URL`，否则隔一阵子站点会「冻住」。

## 配置参数获取

部署与 CI 所需的密钥 / 变量，获取位置如下（完整说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)）：

| 参数 | 获取位置 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 → **Project Overview** 首页顶部（项目名下方带 Copy 按钮的 URL，形如 `https://<ref>.supabase.co`） |
| `NEXT_PUBLIC_SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | 同项目 → **Project Settings → API Keys**：**Publishable key**（`sb_publishable_…`，公开、可进浏览器）与 **Secret key**（`sb_secret_…`；保密，仅服务端用，切勿加 `NEXT_PUBLIC_` 前缀） |
| `NEXT_PUBLIC_SUPABASE_PROXY_URL` | **可选**。同源反向代理前缀，填 `https://<你的应用域名>/api`（见 [docs/DEPLOYMENT.md §3.5](docs/DEPLOYMENT.md)）。**能直连 `*.supabase.co` 时可留空**，浏览器会直连项目地址；仅当网络会拦截 `*.supabase.co`（如中国大陆）时才需要配 |
| `IMGBB_API_KEY` | ImgBB 图片代理上传 key（可选） |
| `SUPABASE_PROJECT_REF` | Supabase Dashboard → **Project Settings → General** → Project ID / Reference ID（仅本地 `supabase` CLI 使用） |
| `SUPABASE_ACCESS_TOKEN` | Supabase 头像菜单 → **Account → Access Tokens** → 新建（仅本地 `supabase` CLI 使用） |
| `KEEPALIVE_URL` / `APP_URL` | 你自己的部署域名，设为仓库 **Variables**（非 Secrets） |

> 鉴权由 **Supabase Auth** 承担，无需密码或 JWT 密钥变量。

> 标记 **Secrets** 的项在 GitHub 仓库 `Settings → Secrets and variables → Actions → Secrets` 配置；标记 **Variables** 的项在同级 **Variables** 页配置。

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构速览（鉴权、实时中继、数据模型、消息送达、安全纵深）
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 完整部署指南（环境变量 / Cloudflare Pages / 同源代理 / 迁移 / 保活 / APK / API 速查 / 故障排除）
- [docs/SUPABASE_EMAIL_RESEND.md](docs/SUPABASE_EMAIL_RESEND.md) — 用 Resend 发送 Supabase 验证 / 重置邮件
- [docs/cloudflare-rate-limiting.md](docs/cloudflare-rate-limiting.md) — Cloudflare 边缘限流配置（应用层限流之外的第二道防线）
- [CONTRIBUTING.md](CONTRIBUTING.md) — 贡献指南（开发约定、质量门禁、提交规范）

## 许可证

采用 MIT 许可证。
