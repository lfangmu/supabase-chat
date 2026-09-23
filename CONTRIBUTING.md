# 参与贡献（Contributing）

感谢你考虑为 **Supabase Chat** 做贡献！这份文档说明本仓库的开发流程、质量门槛与部署约束，照着做能让 PR 顺利合入。

---

## 1. 开发环境

```bash
# 1) 安装依赖（本仓库用 npm，锁文件 package-lock.json 已提交）
npm install

# 2) 准备环境变量
cp .env.example .env.local
# 然后用编辑器填好至少以下变量（详见 README「环境变量」章节）：
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_KEY（Publishable key）
#   SUPABASE_SERVICE_ROLE_KEY（仅服务端写操作，勿暴露到客户端）
#   CHAT_JWT_SECRET
#   CHAT_PASSWORD
#   ADMIN_PASSWORD
#   CHAT_AUTH_ENABLED=true

# 3) 启动开发服务器
npm run dev            # http://localhost:3000
```

> 数据库结构通过 `supabase/migrations/*.sql` 管理。本地若装了 Supabase CLI，可用 `supabase db reset` 应用全部迁移；否则直接连远程 Supabase 项目（把仓库关联到 Supabase 项目后，推送到 `main` 会由 Supabase GitHub App 自动应用迁移）。

---

## 2. 质量门槛（本地必须先全过）

提交前请确保以下命令**全部零错误**通过——CI 也会跑同样的检查，没过会被拒绝合入：

| 命令 | 作用 | 通过标准 |
|---|---|---|
| `npx tsc --noEmit` | TypeScript 类型检查 | 0 错误（项目为 `strict` 模式） |
| `npm run lint` | ESLint（next lint） | 0 警告 / 0 错误 |
| `npx vitest run` | 单元测试 | 全部用例通过（当前约 92 个） |
| `npm run build` | 生产构建 | 构建成功，无运行时/路由错误 |

> 提示：在 Cloudflare Pages 部署的项目里，本地 `npm run build` 走的是 `next build`；`next-on-pages` 的适配在 CI/部署阶段完成，本地无需额外命令。

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
scope（可选）: auth | admin | api | ui | deploy | keepalive ...
```

示例：
- `feat(admin): 管理后台支持批量删除群聊`
- `fix(keepalive): 修复保活端点被 middleware 拦截`
- `docs: 重写 README 并新增架构速览文档`

正文（可选）说明**为什么**而不是**做了什么**，尤其是涉及鉴权、部署、数据库迁移的改动。

---

## 5. 关键架构约定（改动前必读）

改动代码前，请先读 `docs/ARCHITECTURE.md` 了解全貌。以下红线请勿破坏：

1. **双会话物理隔离**：普通聊天用 `chat_session`，管理后台用 `admin_session`，两套 cookie 各自签发/登出，互不影响。新增任何管理员接口必须走 `admin_session` 鉴权（`extractSession(cookieHeader, secret, 'admin_session')`），不可复用聊天会话。
2. **中间件白名单**：`src/middleware.ts` 拦截所有 `/api/*`。公开端点（如 `/api/verify-password`、`/api/password-version`、`/api/keepalive`、管理后台自校验的 `/api/admin/verify`）必须显式列入 `PUBLIC_API_ROUTES`，否则外部/未登录请求会被 401 挡掉——历史上保活端点就因此失效过。
3. **配置集中**：新增开关、端点路径、密钥名优先放在 `src/config/index.ts`，不要散落硬编码。
4. **API 路由走 Edge Runtime**：`src/app/api/**/route.ts` 默认 Edge Runtime，避免使用 Node 专属 API（如 `fs`、部分 Node 内置模块）；密码比较用已有的 `timingSafeEqual` 防时序攻击。
5. **服务端写操作**：删除/管理类操作需用 `SUPABASE_SERVICE_ROLE_KEY` 绕过 RLS，且务必在路由层做好鉴权（管理员会话校验）与防护（如禁止删除系统保留的 `default-room`）。
6. **房间可见性**：非公开房间不靠服务端目录暴露，普通聊天只返回本地已加入（`localStorage` 记录）的房间；管理员通过 `/api/admin/*` 查看全部。

---

## 6. 数据库迁移

- 所有表结构变更**必须**以新的 `supabase/migrations/NNNN_*.sql` 文件提交，不要手动改线上库结构。
- 迁移保持**向后兼容**：优先加列/加表，避免 `DROP`/重命名导致已部署实例出错。
- 推送到 `main` 后由 **Supabase GitHub App** 自动应用迁移（无需手动 `supabase db push`）；本地可用 `supabase db reset` 复现。

---

## 7. 部署约束（非常重要）

本项目部署在 **Cloudflare Pages**（`next-on-pages`）。两个坑务必记住：

1. **新增环境变量必须触发全新构建**：在 Cloudflare 控制台加变量后，**推送一个新的提交或点控制台 Deploy** 才能注入运行时；只点 **Retry** 会复用旧构建快照，新变量读到的全是 `undefined`。
2. **首选 `ADMIN_PASSWORD`**：历史上一度支持 `SUPER_PASSWORD` / `CHAT_SUPER_PASSWORD` 作为超级密码，但本项目在 Cloudflare 上实测 `SUPER_PASSWORD` 注入不稳定，后台统一认 `ADMIN_PASSWORD`（仍兼容另两个作为兜底）。

---

## 8. 测试指南

- 测试放在 `src/__tests__/` 或与模块同级的 `*.test.ts`，运行 `npx vitest run`。
- 鉴权/Token 相关测试重点覆盖：`signJwt` / `verifyJwt` / `extractSession`（含 `cookieName` 参数区分 admin/chat）。
- 新增 API 路由时，建议补一个用例覆盖「无会话 401」「错误凭证 401」「正常流程 200」三态。
- 涉及 Supabase 的测试使用 mock client，不要在单测里打真实库。

---

## 9. 行为准则

保持友善、就事论事。涉及安全/鉴权的改动请额外说明威胁模型与缓解措施。提交 Issue 时附上复现步骤与环境变量（**不要贴真实密钥**）。

---

再次感谢贡献！如有疑问，先读 `README.md` 与 `docs/ARCHITECTURE.md`，多数问题能在文档中找到答案。
