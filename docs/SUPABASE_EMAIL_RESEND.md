# Supabase Auth 邮件发送配置指南（自定义 SMTP / Resend）

> 适用范围：supabase-chat 部署后，注册验证 / 找回密码等事务邮件的发送配置。
> 最后更新：2026-09-24

## 0. 背景：为什么必须配自定义 SMTP
Supabase **内置 SMTP** 的硬限制：
- 只发 **2 封 / 小时**，且**仅能发给项目团队成员**的邮箱（其他地址报 `Email address not authorized`）；
- 无 SLA，仅供测试。

后果：真实用户注册收不到验证邮件、测试受限。
解决：配置**自定义 SMTP**（任意支持 SMTP 的发信服务），解除以上限制。

## 1. 选型结论
- 发信服务用 **Resend**（Supabase 官方推荐的事务邮件服务，对标 SendGrid / Mailgun / AWS SES）。
- 关键决策：**认证邮件走独立子域 `mail.your-domain.com`**，与跑临时邮箱的 `ru.your-domain.com` 隔离。
  - 原因①：一个域名只能有一条 SPF 记录，隔离可避免 SPF 冲突；
  - 原因②：临时邮箱域名声誉差，发认证邮件易被判垃圾 / 拒收。
- Resend 免费档：3,000 封 / 月、**100 封 / 天**、3 域名；Pro $20 / 月取消日上限（50,000 / 月）。

## 2. 前置条件
- 一个自己拥有、可改 DNS 的域名（Cloudflare Pages 的 `*.pages.dev` 不行）。本项目 DNS 托管在 Cloudflare。
- 一个 Resend 账号（resend.com 免费注册）。

## 3. 配置步骤

### 3.1 注册 Resend
1. 打开 resend.com/signup，用你自己的邮箱（如 `you@example.com`）注册；
2. 完成邮箱验证。

### 3.2 在 Resend 添加并验证域名
1. Resend → **Domains → Add Domain**，填 `mail.your-domain.com`（用独立子域隔离，不要填根域或临时邮箱域名）；
2. Resend 生成 DKIM / SPF / DMARC 三类记录（全部落在 `mail.your-domain.com` 上）；
3. 登录 Cloudflare → 你的域名 → **DNS → Records → Add record**，把 Resend 给的记录**逐字复制**进去：

   | 类型 | 名称（示例） | 内容（示例） | 注意 |
   |---|---|---|---|
   | TXT | `resend._domainkey.mail.your-domain.com` | `p=MIGfMA0GCSqGSIb3...` | DKIM，内容以页面为准 |
   | CNAME | `resend.mail.your-domain.com` | `resend-apne1.forge.rmta.net` | **名字逐字**，常见坑：`resend` vs `rsend` |
   | CNAME | `send.mail.your-domain.com` | `send.forge.rmta.net` | |
   | TXT | `_dmarc.mail.your-domain.com` | `v=DMARC1; p=none;` | |

   - ⚠️ 这些记录的**代理状态设为「仅 DNS」（灰云）**，绝不开橙色代理；
   - ⚠️ 名称栏填 `resend.mail.your-domain.com` 或 `resend.cu` 都行（Cloudflare 自动补全），关键是最终 FQDN 与 Resend 一致。
4. 回 Resend 该域名页点 **`...` → Verify**（或等自动检测），状态从 Pending 变 **Verified**（通常几分钟 ~ 30 分钟；**超 1 小时仍 Pending = 记录名 / 目标对不上，逐字核对**）。

### 3.3 创建 API Key
- Resend → **API Keys → Create API Key**，起名后生成，**复制保存（只显示一次）** —— 这就是 SMTP 的 Password。

### 3.4 填入 Supabase SMTP
项目 `your-project-ref` → **Authentication → Emails（SMTP 设置）**：

| 字段 | 值 |
|---|---|
| Enable custom SMTP | 开 |
| Sender email address | `no-reply@mail.your-domain.com`（须在已验证域名上；`send.` / `resend.` 只是 SPF/DKIM 基础设施，不是发件地址） |
| Sender name | 你的应用名（邮件收件人看到的发件人显示名） |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | 上面的 API Key |
| Minimum interval per user | `60` |

- Save。

### 3.5 解除 Supabase 自身限流
- Supabase → **Authentication → Rate Limits** → 把 **"Email sent"** 从默认 30 / 小时调到目标值（如 100 / 小时，对应 Resend 免费日上限）。

## 4. 代码侧（已就绪，无需再改）
- `src/components/AuthScreen.tsx`：注册 `signUp` 的 `emailRedirectTo` 指向 `${当前域名}/auth/callback`，本地与线上自动适配；并把 `Failed to fetch` 等网络错误转成中文排查指引（见 §9）；
- `src/app/auth/callback/route.ts`：PKCE 回调，用 `?code=` 兑换会话 cookie（已创建）；
- `src/app/auth/auth-code-error/page.tsx`：兑换失败时落到的友好错误页（已创建）。

即：验证邮件点开后能正确跳回 app 并登录，无需额外代码改动。

## 5. 验证
1. 先用 Resend 测试地址 `onboarding@resend.dev`（只能发到你自己的注册邮箱）确认链路通；
2. 正式：让用户注册，收验证邮件 → 点链接 → 登录。

## 6. 常见坑
- **一个域名只能一条 SPF**：所以用独立子域隔离；若硬要在根域，必须把两条 SPF 合并成一条：`v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com ~all`；
- 邮件 DNS 记录必须「仅 DNS」（灰云）；
- 发件域名声誉：临时 / 一次性邮箱域名**不要**用来发认证邮件；
- 安全：不要因滥用压力关闭邮件确认；建议在 Supabase 开 Turnstile / CAPTCHA 防机器人刷注册。

## 7. 备选方案（不想买域名 / 只想快速测试）
- **个人邮箱 SMTP**：QQ 邮箱（Host `smtp.qq.com`、Port `465`、Username 完整 QQ 邮箱、Password = 授权码）或 163（`smtp.163.com`）。免域名，但有限额、易进垃圾箱，仅测试；
- **关闭邮件确认**：Supabase → Authentication → Providers → Email → 关 **Confirm email**，注册即登录、完全不需要邮件（安全性降低，开发 / 演示可用）。

## 8. 当前状态（2026-09-24）
- `mail.your-domain.com` 的 Cloudflare 记录已添加（灰云），Resend 侧仍 **Pending**，待逐字核对 CNAME 名字与等待生效；
- Supabase SMTP 字段、Rate Limits 待填写；
- 代码侧 PKCE 回调、错误页与 `emailRedirectTo` 已创建。

---

## 9. 排障：注册 / 登录报 `Failed to fetch`
现象：浏览器控制台或界面出现 `Failed to fetch`，关掉「Confirm email」也没用。

**结论先讲**：`Failed to fetch` 是**网络层**失败 —— 浏览器发往 Supabase 的请求根本没拿到 HTTP 响应
（DNS 解析失败 / TCP 连接被拒 / TLS 失败 / 项目被暂停）。它**和邮箱验证开关无关**，
所以关不关 Confirm email 都不会改变这个结果。

**为什么能排除「环境变量没配 → 客户端为 null」？**
`src/lib/supabase.ts` 在 `NEXT_PUBLIC_SUPABASE_URL/KEY` 为空时会把 `supabase` 置为 `null`，
`AuthScreen` 在调用前会拦截并提示「Supabase 未配置，无法登录」。你看到的是 `Failed to fetch` 而不是这句，
说明客户端**已经被正确构造**（变量在构建时打进了前端），只是请求打到那个 URL 上连不通。

**按概率排序的根因**：
1. **Supabase 项目被暂停**（最常见）：免费版约 7 天无活动会自动暂停，Auth / API 端点直接拒绝连接。
   → 到 Supabase 后台看项目 `your-project-ref` 是否显示 Paused，点 Restore，等 1~2 分钟再试。
2. **NEXT_PUBLIC_SUPABASE_URL 指向错误 / 占位值**：例如还是 `.env.example` 里的 `your_supabase_url`，
   或复制时少了字符 / 指向了另一个不存在的项目 ref。
   → Cloudflare Pages → Settings → Environment variables 核对，必须是
   `https://your-project-ref.supabase.co` 且 Key 是该项目 publishable key。
3. **改了环境变量没重新部署**：`NEXT_PUBLIC_*` 在 `next build` / `next-on-pages` 时内联进前端，
   构建之后再加的变量不生效。
   → 改完变量后务必在 Cloudflare Pages 触发一次新的 Deployment。

**一锤定音的排查法**：打开 DevTools → Network，点注册，看那条失败的请求：
- Request URL 是 `https://your_supabase_url/...` 之类明显不对的 → 根因 2；
- Request URL 正确但状态是 `(failed)` / `net::ERR_*` → DNS/连接问题，多半是 URL 不对或项目暂停（根因 1/2）；
- 状态是 4xx/5xx → 那不是 `Failed to fetch`，按对应状态码再查（如 401 = anon key 错）。

---

## 附：Supabase Auth 后台其余必要开关（部署联调时发现）
> 部署在 Cloudflare 时一并确认，否则注册 / 登录流程会有隐性问题。

1. **匿名登录开关在「正确项目」上开**：应用真实项目 ref 是 `your-project-ref`（不是另一个项目 `your-other-project-ref`）。
   - 路径：项目 `your-project-ref` → Authentication → Providers → Anonymous → 开启。
2. **URL Configuration**：
   - Site URL = 你的 Cloudflare 域名（如 `https://xxx.pages.dev` 或自定义域名）；
   - Redirect URLs 添加：`https://<域名>/auth/callback` 与 `http://localhost:3000/auth/callback`（本地调试）。
3. **Cloudflare Pages 环境变量**确认：
   - `NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_KEY=<publishable key>`
   - `SUPABASE_SERVICE_ROLE_KEY=<service role key>`（仅服务端）
