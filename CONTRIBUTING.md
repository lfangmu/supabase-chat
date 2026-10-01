# 参与贡献（Contributing）

感谢你考虑为 **Supabase Chat** 做贡献！这份文档说明本仓库的开发流程、质量门槛与部署约束，照着做能让 PR 顺利合入。

---

## 1. 开发环境

**Node.js ≥ 22**（本仓库 `package.json` 的 `engines` 要求）。

```bash
# 1) 安装依赖（本仓库用 npm，锁文件 package-lock.json 已提交）
npm install

# 2) 准备环境变量
cp .env.example .env.local
# 然后用编辑器填好至少以下变量（详见 README「配置参数获取」章节）：
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_KEY（Publishable key）
#   NEXT_PUBLIC_SUPABASE_PROXY_URL（本地开发可留空/指向自身）
#   SUPABASE_SERVICE_ROLE_KEY（仅服务端写操作，勿暴露到客户端）
#
# 鉴权走 Supabase Auth：需在 Supabase 后台（Authentication → Sign In / Providers）
# 开启 Email 与 Anonymous sign-ins。本地无需任何密码 / JWT 密钥变量。

# 3) 启动开发服务器
npm run dev            # http://localhost:3000
```

> 数据库结构通过 `supabase/migrations/*.sql` 管理。本地若装了 Supabase CLI，可用 `supabase db reset` 应用全部迁移；否则直接连远程 Supabase 项目（把仓库关联到 Supabase 项目后，推送到 `main` 会由 Supabase GitHub App 自动应用迁移）。

---

## 2. 质量门槛（本地必须先全过）

提交前请确保以下命令**全部零错误**通过——CI（`.github/workflows/ci.yml`）会跑同样的检查，没过会被拒绝合入：

| 命令 | 作用 | 通过标准 |
|---|---|---|
| `npx tsc --noEmit` | TypeScript 类型检查 | 0 错误（项目为 `strict` 模式） |
| `npm run lint` | ESLint（next lint） | 0 警告 / 0 错误 |
| `npx vitest run` | 单元测试 | 全部用例通过（当前 **240** 个） |
| `npm run build` | 生产构建 | 构建成功，无运行时 / 路由错误 |

> 提示：在 Cloudflare Pages 部署的项目里，本地 `npm run build` 走的是 `next build`；`next-on-pages` 的适配在部署阶段完成，本地无需额外命令。CI 的构建步骤不依赖 Supabase 环境变量（代码均以 `?? ''` 兜底）。

---

## 3. 分支与 PR 流程

- **主分支 `main`**：受保护，CI 在每次 push / PR 上运行（类型检查、lint、测试、构建）。合入 `main` 后，由 **Supabase GitHub App** 自动应用数据库迁移、**Cloudflare Pages Git 集成**自动构建部署前端——均不经过 CI。
- **不要在 `main` 上直接开发**：从 `main` 切出功能分支（如 `feat/admin-batch-delete`、`fix/keepalive-middleware`）。
- **开 PR 到 `main`**：CI 通过 + 至少一次 review 后再合并。合并采用 **squash merge** 保持主干线性。

```bash
git checkout main && git pull
git checkout -b feat/your-branch
# ... 改代码 ...
npm run lint && npx vitest run && npx tsc --noEmit && npm run build
git commit -m "feat(scope): 简洁描述"
git push -u origin feat/your-branch
# 然后在 GitHub 开 PR
```

---

## 4. 提交信息规范

采用 Conventional Commits 风格，便于生成变更日志与快速回看：

```
<type>(<scope>): <一句话描述>

type: feat | fix | docs | refactor | test | chore | ci
scope（可选）: auth | admin | api | ui | deploy | realtime | keepalive ...
```

示例：
- `feat(admin): 管理后台支持批量删除群聊`
- `fix(keepalive): 修复保活端点被 middleware 拦截`
- `docs: 重写 README 并新增架构速览文档`

正文（可选）说明**为什么**而不是**做了什么**，尤其是涉及鉴权、实时链路、部署、数据库迁移的改动。

---

## 5. 关键架构约定（改动前必读）

改动代码前，请先读 `docs/ARCHITECTURE.md` 了解全貌。以下红线请勿破坏：

1. **身份一律用 UUID**：身份键是 Supabase Auth 的 `auth.uid()`，用 `getAuthUser(request)` 获取。**绝不要把展示名（`display_name`）当身份键**——展示名可重复、可修改。消息表里的 `user` 列只是发送时的展示名快照，判归属请用 `user_id`。
2. **管理员判定**：`/api/admin/*` 由中间件按 `public.users.role === 'admin'` 校验（403）；前端登录走统一的 `AuthScreen`。
3. **中间件白名单**：`src/middleware.ts` 拦截所有 `/api/*`。公开端点（`/api/keepalive`、`/api/health`、以及 `/api/{auth,rest,storage}/v1` 与 `/api/realtime` 这些**透传/中继**路由）必须显式列入 `PUBLIC_API_ROUTES`，否则外部 / 未登录请求会被 401 挡掉。
4. **配置集中**：新增开关、端点路径、密钥名优先放在 `src/config/index.ts`，不要散落硬编码。
5. **API 路由走 Edge Runtime**：`src/app/api/**/route.ts` 默认 Edge Runtime，避免使用 Node 专属 API（如 `fs`、部分 Node 内置模块）。
6. **服务端写操作**：删除 / 管理类操作需用 `SUPABASE_SERVICE_ROLE_KEY` 绕过 RLS，且务必在路由层做好鉴权与防护（如禁止删除系统保留的 `default-room`）。
7. **房间可见性**：非公开房间不靠服务端目录暴露，普通聊天只返回本地已加入（`localStorage` 记录）的房间；管理员通过 `/api/admin/*` 查看全部。
8. **实时链路不要改回浏览器直连 WebSocket**：国内网络会拦截浏览器到 `*.supabase.co` 的 WS 升级。实时统一走 `/api/realtime`（SSE 收）+ `/api/realtime/send`（POST 发）的服务端中继；`src/lib/sse-concurrency.ts` 的并发租约机制也不要退回「靠断开回调释放」（平台不上报断开会导致槽位永久泄漏）。

---

## 6. 数据库迁移

- 所有表结构变更**必须**以新的 `supabase/migrations/NNNN_*.sql` 文件提交，不要手动改线上库结构。
- 迁移保持**向后兼容**：优先加列 / 加表，避免 `DROP` / 重命名导致已部署实例出错。
- 推送到 `main` 后由 **Supabase GitHub App** 自动应用迁移（无需手动 `supabase db push`）；本地可用 `supabase db reset` 复现。
- 涉及 `realtime.messages` 的 RLS 改动要格外小心：策略、频道 `private:true`、以及项目级「Allow public access to channels」三者必须一致，否则会自锁（合法成员被拒）。

---

## 7. 部署约束（非常重要）

本项目部署在 **Cloudflare Pages**（`next-on-pages`）。两个坑务必记住：

1. **新增环境变量必须触发全新构建**：在 Cloudflare 控制台加变量后，**推送一个新的提交或点控制台 Deploy** 才能注入运行时；只点 **Retry** 会复用旧构建快照，新变量读到的全是 `undefined`。
2. **环境变量是「Supabase 三件套 + 可选」**：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`；可选的 `NEXT_PUBLIC_SUPABASE_PROXY_URL`（只在浏览器无法直连 `*.supabase.co` 时才需要，`src/lib/supabase.ts` 取 `PROXY_URL || SUPABASE_URL` 自动回退）与 `IMGBB_API_KEY`。

---

## 8. 测试指南

- 测试放在 `src/__tests__/`，运行 `npx vitest run`。
- 鉴权相关测试重点覆盖：`getAuthUser` 的身份解析、middleware 的公开白名单与 401 / 403 分支、以及透传路由不被登录校验拦截。
- 新增 API 路由时，建议补一个用例覆盖「无会话 401」「错误凭证 401」「正常流程 200」三态。
- 涉及 Supabase 的测试使用 mock client，不要在单测里打真实库。

---

## 9. 行为准则

保持友善、就事论事。涉及安全 / 鉴权的改动请额外说明威胁模型与缓解措施。提交 Issue 时附上复现步骤与环境变量（**不要贴真实密钥**）。

---

再次感谢贡献！如有疑问，先读 `README.md` 与 `docs/ARCHITECTURE.md`，多数问题能在文档中找到答案。
