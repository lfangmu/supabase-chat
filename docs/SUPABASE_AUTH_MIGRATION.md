# Supabase Auth 迁移设计文档（方案三：基于 Supabase Auth 重建鉴权）

> 适用范围：把当前「自建昵称 + HS256 会话 Cookie + 自建实时 JWT（SUPABASE_JWT_SECRET）」体系，整体替换为 **Supabase Auth**。
> 本文是设计文档（**先给文档，未落地代码**）。是否进入实现待文档评审通过。

---

## 0. 决策前提（来自用户确认）

| 项 | 结论 |
|---|---|
| 方案 | 方案三：全面改用 Supabase Auth，**放弃自建鉴权** |
| 历史数据 | **不考虑迁移、不考虑历史数据兼容**——从零重建，旧行可丢弃 |
| 实时签名密钥 | 随自建体系一并移除，**不再依赖 Legacy JWT Secret / ECC P-256 任一形态** |
| 产出顺序 | 先出设计文档 → 评审 → 再动手实现 |

---

## 1. 背景与动机

当前鉴权链路（approach-A 已落地）存在一条「为了实时投递而绕路」的设计：

1. 浏览器经 `/api/realtime-token` 用 `SUPABASE_JWT_SECRET` 签发一张 **`sub=nickname, role=authenticated`** 的 Supabase JWT；
2. 该 JWT 作为 `accessToken` 喂给浏览器 `supabase` 客户端，使 `postgres_changes` 的 RLS 能通过 `auth.uid()` 拿到身份；
3. 因为 `auth.uid()` 实际被「昵称」顶替，所以 `is_room_participant(room_id, auth.uid())` 里的 `p_actor` 比较的是昵称字符串。

这带来三个长期负担：

- **多一套密钥与信任链**：`CHAT_JWT_SECRET`（会话 Cookie）、`SUPABASE_JWT_SECRET`（实时 JWT）、`signJwt/verifyJwt`、PBKDF2 哈希全部自建，安全面自己扛；
- **实时身份是「伪装的 uid」**：用昵称冒充 `auth.uid()`，一旦 Supabase 后台切换为 ECC P-256 非对称签名、或撤销 Legacy Secret，链路立刻失效（这正是此前部署文档反复纠结的点）；
- **身份模型分裂**：数据库里 `room_members.user`、`rooms.created_by`、`messages."user"`、`friends.*`、`dm:A:B` 命名，全以「昵称」为身份锚点，与 Supabase 原生的 UUID 身份天然错位。

改用 Supabase Auth 后，`auth.uid()` 就是**真正的 UUID**，上述三处负担一次性消除，且实时投递的 RLS 鉴权由 Supabase 原生签名保证，**实时密钥问题从根上消失**。

---

## 2. 身份模型转变（核心）

| 维度 | 现在（自建） | 目标（Supabase Auth） |
|---|---|---|
| 身份主键 | 昵称字符串（`users.nickname` 是 PK） | `auth.users.id`（UUID） |
| 展示名 | 昵称即账号 | 独立字段 `users.display_name`（可改、不唯一） |
| 会话载体 | `chat_session` HS256 Cookie（自签） | Supabase Auth Session（由 `@supabase/ssr` 管理 Cookie） |
| 实时身份 | `/api/realtime-token` 伪装的 `auth.uid()=昵称` | Supabase Auth 会话直接作为实时 JWT，`auth.uid()`=真 UUID |
| 密码/找回 | 自建 PBKDF2 + `/api/auth/recover` | Supabase Auth 原生（含密码重置邮件） |
| 管理员 | `admin_session` JWT（`isAdmin:true`） | Supabase Auth 账号 + `profiles.role='admin'`（见 §7） |

> **关键认知**：当前 `is_room_participant(room_id, auth.uid())` 能跑，是因为 `auth.uid()` 被昵称顶替。迁移后 `auth.uid()` 变回真 UUID，**所有「昵称耦合」的列都必须改为 UUID**——这是本次工作量最大的部分（§5.2）。

---

## 3. 删除清单（整体移除）

### 3.1 文件 / 目录
- `src/lib/auth.ts` —— 整个文件删除（`signJwt`/`verifyJwt`/`getSessionUser`/`extractSession`/`issueSessionToken`/`hashPassword`/`verifyPassword`/`needsRehash`/`timingSafeEqual` + PBKDF2 全部不再需要）。
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/recover/route.ts`
- `src/app/api/auth/logout/route.ts`
- `src/app/api/realtime-token/route.ts` —— 实时 JWT 签发点，**整个删除**，实时身份改由 Supabase Auth 会话提供。
- `src/lib/supabase.ts` 中的 `accessToken` 回调、`fetchRealtimeToken`、token 缓存逻辑 —— 改为纯浏览器客户端（见 §6.4）。
- `src/components/AuthScreen.tsx` —— 自建昵称/密码表单，替换为 Supabase Auth UI（§6.5）。

### 3.2 环境变量
- `CHAT_JWT_SECRET` —— 删除（会话 Cookie 不再自建）。
- `SUPABASE_JWT_SECRET` —— 删除（实时 JWT 不再自建）。
- `ADMIN_PASSWORD` / `SUPER_PASSWORD` / `CHAT_SUPER_PASSWORD` —— 删除（管理员改走 Supabase Auth，见 §7）。
- 保留：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_KEY`（anon key，浏览器鉴权用，安全）、`SUPABASE_SERVICE_ROLE_KEY`（服务端特权写入，保留）。

### 3.3 受影响调用点（需改写，非删除）
`getSessionUser` 当前被约 **14 个路由文件 / 18+ 处调用**，迁移后统一替换为 `getAuthUser(request)`：
`dm-list`、`upload-media`、`friends`、`users`、`me`、`rooms`(×3)、`rooms/members`(×4)、`signed-url`、`messages/by-id`、`messages/search`、`rooms/mine`、`messages`(×4)、`messages/reactions`(×2)、`messages/read`(×2)、`auth/recover`（连同文件删除）。
`extractSession` 调用点：`me`、`admin/verify`、`rooms`、`auth/recover` —— 一并改为 `getAuthUser`。

---

## 4. 新增 / 修改清单

| 新增 | 作用 |
|---|---|
| `src/lib/supabase-server.ts` | 服务端 `@supabase/ssr` 客户端（读写 request/response cookie），供 middleware + API 路由取身份 |
| `src/lib/auth-user.ts` 的 `getAuthUser(request)` | 统一身份解析：`const { data:{user} } = await serverClient.auth.getUser(); return user?.id ?? null` |
| `src/middleware.ts` 改造 | 用 Supabase Auth 会话取代 `extractSession(CHAT_JWT_SECRET)` |
| 前端登录/注册 UI | 基于 `@supabase/ssr` 浏览器客户端或 Supabase Auth UI |
| 数据库迁移（见 §5） | 列类型 nickname→uuid、`is_room_participant` 重写、RLS 重写 |

依赖新增：`@supabase/ssr`（Edge + Node 通用，官方推荐用于 Next.js）。

---

## 5. 数据模型与 RLS 迁移

> 因「不考虑历史数据」，可**直接 TRUNCATE 相关表 + 执行 ALTER**，不写任何 nickname→uuid 回填逻辑。
> 下列 DDL 为「目标形态」，命名以可读为先；可进一步拆成多个迁移文件（建议 `00020_*` ~ `00022_*`）。

### 5.1 `users`（资料表）改为以 auth.uid() 为主键
```sql
-- 资料表：主键改为 auth.users.id，昵称降级为可改的展示名
CREATE TABLE IF NOT EXISTS public.users (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  avatar        text,
  signature     text DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz
);
-- 展示名索引（搜索/通讯录用）
CREATE INDEX IF NOT EXISTS idx_users_display_name_lower ON public.users (lower(display_name));
```

### 5.2 关系列：nickname → uuid
所有曾存「昵称」的列改为 `uuid` 并外键到 `users.id`：
```sql
-- messages."user" 改 user_id
ALTER TABLE public.messages RENAME COLUMN "user" TO user_id;
ALTER TABLE public.messages ALTER COLUMN user_id TYPE uuid USING user_id::uuid; -- 历史数据已丢弃，无需 USING 转换逻辑
ALTER TABLE public.messages ADD CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES public.users(id);

-- room_members."user" 改 user_id
ALTER TABLE public.room_members RENAME COLUMN "user" TO user_id;
ALTER TABLE public.room_members ALTER COLUMN user_id TYPE uuid;
ALTER TABLE public.room_members ADD CONSTRAINT fk_room_members_user FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE public.room_members DROP CONSTRAINT room_members_pkey;
ALTER TABLE public.room_members ADD PRIMARY KEY (room_id, user_id);

-- rooms.created_by 改 uuid
ALTER TABLE public.rooms ALTER COLUMN created_by TYPE uuid;
ALTER TABLE public.rooms ADD CONSTRAINT fk_rooms_created_by FOREIGN KEY (created_by) REFERENCES public.users(id);

-- friends.user_a / user_b 改 uuid
ALTER TABLE public.friends ALTER COLUMN user_a TYPE uuid;
ALTER TABLE public.friends ALTER COLUMN user_b TYPE uuid;
ALTER TABLE public.friends ADD CONSTRAINT fk_friends_a FOREIGN KEY (user_a) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.friends ADD CONSTRAINT fk_friends_b FOREIGN KEY (user_b) REFERENCES public.users(id) ON DELETE CASCADE;

-- reactions / push_subscriptions / message_reads 的 "user" 同理改为 user_id uuid
```

### 5.3 私聊（DM）房间命名解耦
当前 DM 房间 ID 形如 `dm:昵称A:昵称B`（昵称耦合）。改为 UUID 后：
- **房间 ID**：`dm:{uuidA}:{uuidB}`，两个 UUID 按字典序排序后拼接（保持幂等，避免 A→B 与 B→A 生成两个房间）。
- **房间展示名**：不再存对方昵称到 `rooms.name`，改为**前端按 `dm:{uuidA}:{uuidB}` 解析出「对方 uuid」→ 查 `users.display_name` 动态显示**。
- `is_room_participant` 的 DM 分支相应改为 UUID 比较（见 5.4）。

> 注：`rooms.name` 对 DM 房间可置空或存占位；群聊房间的 `name` 仍是人类可读的群名，无影响。

### 5.4 `is_room_participant` 重写（签名 `p_actor` 由 text → uuid）
```sql
CREATE OR REPLACE FUNCTION public.is_room_participant(p_room text, p_actor uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by uuid;
  v_member     uuid;
BEGIN
  IF p_room IS NULL OR p_actor IS NULL THEN RETURN false; END IF;

  IF p_room = 'default-room' THEN RETURN true; END IF;

  -- 私聊：dm:<uuidA>:<uuidB>
  IF p_room LIKE 'dm:%' THEN
    RETURN p_actor = ANY (string_to_array(split_part(p_room, 'dm:', 2), ':')::uuid[]);
  END IF;

  SELECT created_by INTO v_created_by FROM rooms WHERE id = p_room;
  IF FOUND AND v_created_by = p_actor THEN RETURN true; END IF;

  SELECT user_id INTO v_member FROM room_members WHERE room_id = p_room AND user_id = p_actor LIMIT 1;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_room_participant(text, uuid) TO authenticated, anon;
```

### 5.5 RLS 重写（全部基于 `auth.uid()`）
```sql
-- messages：读按房间成员；写仅本人
DROP POLICY IF EXISTS "Authenticated members can read messages" ON public.messages;
CREATE POLICY "Authenticated members can read messages"
  ON public.messages FOR SELECT TO authenticated
  USING (public.is_room_participant(room_id, auth.uid()));

DROP POLICY IF EXISTS "Insert own messages" ON public.messages;
CREATE POLICY "Insert own messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- room_members：仅本人能增删自己的成员行
CREATE POLICY "Manage own membership"
  ON public.room_members FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- users（资料）：本人可改自己；所有人可读展示名（供搜索/通讯录）
CREATE POLICY "Read profiles" ON public.users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Update own profile" ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- rooms / friends / reactions / push_subscriptions / message_reads 同理，全部用 auth.uid() 替代昵称比较
```

> 服务端写入仍走 `SUPABASE_SERVICE_ROLE_KEY`（绕过 RLS），`src/lib/service-client.ts` **保持不变**。区别在于「身份是谁」现在由 Supabase Auth 的真 UUID 决定，而不是自建 Cookie 里的昵称。

---

## 6. 服务端鉴权改造

### 6.1 统一身份解析 `getAuthUser(request)`
取代所有 `getSessionUser(cookie)`：
```ts
// src/lib/auth-user.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers'; // 或直接从 request 取，取决于运行时

export async function getAuthUser(request: Request): Promise<string | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_KEY!,
    { cookies: { /* 从 request/response 读写的适配器 */ } }
  );
  const { data: { user } } = await supabase.auth.getUser(); // 服务端用 getUser（验签），不用 getSession
  return user?.id ?? null;
}
```
各路由把 `const actor = await getSessionUser(request.headers.get('cookie'));` 改成 `const actor = await getAuthUser(request);`，后续 `actor` 语义从「昵称」变为「UUID」——所有下游比较列已同步改为 uuid（§5.2），逻辑无需再改。

### 6.2 Middleware 改造
`src/middleware.ts` 当前用 `extractSession(cookieHeader, process.env.CHAT_JWT_SECRET)` 判会话。改为：
```ts
import { createServerClient } from '@supabase/ssr';
// ...
const supabase = createServerClient(url, anonKey, { cookies });
const { data: { user } } = await supabase.auth.getUser();
if (!user) return 401;
// 管理后台：进一步校验 profiles.role='admin'（见 §7）
```
`PUBLIC_API_ROUTES` 相应调整（登录/注册端点不再存在，公开端点仅保留 `/api/keepalive` 与少数无需登录的查询）。

### 6.3 管理员鉴权（§7）在 middleware 内的落点
`/api/admin/*` 在拿到 `user` 后，额外查 `profiles.role='admin'`（或 `users` 表加 `role` 列）再放行；不再依赖 `admin_session` Cookie。

### 6.4 实时（Realtime）客户端简化
`src/lib/supabase.ts` 当前为：
```ts
export const supabase = createClient(url, key, { auth:{persistSession:false}, accessToken: fetchRealtimeToken, ... });
```
改为浏览器客户端（由 `@supabase/ssr` 管理会话，自动把登录态作为实时 JWT）：
```ts
import { createBrowserClient } from '@supabase/ssr';
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);
// 注意：不要设 persistSession:false——我们要让会话持久化到 cookie，实时订阅才不会因为刷新掉线
```
`fetchRealtimeToken` / `/api/realtime-token` 全删。`postgres_changes` 订阅代码（`useMessageRealtime.ts`）**无需改**——它只关心「订阅后拿到行」，身份由客户端会话提供。

### 6.5 前端登录/注册 UI（AuthScreen 替换）
- 用 Supabase Auth UI（`@supabase/auth-ui-react` + `@supabase/ssr` 主题）或自建表单调用 `supabase.auth.signInWithPassword / signUp / signInAnonymously`。
- 应用内身份状态从 `{ nickname }` 改为 `{ id: uuid, displayName }`，来源为 `supabase.auth.getUser()` + `users.display_name`。
- `chat_nickname` localStorage 用途移除，改为从会话+资料表读取。
- `useChat` / `useDM` 的 `currentUser` 语义由「昵称」改为「UUID」；`useDM.getDMOtherUser(roomId, currentUser)` 解析 `dm:` 后的对方 UUID 后，再查 `display_name` 显示。

---

## 7. 管理后台鉴权映射（待确认项 A）

选项 A（**推荐**）：Supabase Auth 指定管理员账号 + `profiles.role`
- 创建普通 Supabase Auth 账号（邮箱+密码）作为管理员；
- `users` 表加 `role text DEFAULT 'user' CHECK (role IN ('user','admin'))`；
- `/api/admin/verify` 改为 `supabase.auth.signInWithPassword`，成功后即持有正常会话，middleware 据 `role` 放行；
- 删除 `admin_session` Cookie 与 `ADMIN_PASSWORD` 类变量，彻底摆脱自建 JWT。

选项 B（简单保留）：保留「管理员密码」概念，但改为 Supabase Auth 账号 + 一个环境变量里的管理员邮箱白名单校验。实现更轻，但不如 A 统一。

> 无论 A/B，`role` 字段**绝不允许客户端写入**，必须靠 RLS `WITH CHECK (id = auth.uid())` + 服务端仅有 `service_role` 才能改 `role`，防越权提权。

---

## 8. 保留「免注册」体验：匿名登录（待确认项 B）

当前「输入昵称即进」的零门槛体验，可用 **Supabase 匿名登录（Anonymous Sign-In）** 保留：
- 首次访问自动 `supabase.auth.signInAnonymously()` → 立即拿到一个 UUID，可立刻聊天；
- 该 UUID 写入 `users.id`，所有关系（DM/群/消息）以 UUID 锚定，**后续「升级账号」（绑定邮箱/手机）不会改变 UUID**，历史关系不丢；
- 升级入口：提供「绑定邮箱/密码」表单，调用 `supabase.auth.updateUser` / `linkIdentity`。

权衡：匿名 UUID 可能被滥用（垃圾消息）。缓解：对匿名用户加发消息频率限制 / 强制进群验证码 / 可选要求绑定邮箱才可私聊。

> 若决定「必须邮箱注册，不做匿名」，则跳过匿名、直接 `signUp`/`signInWithPassword`，体验从「免注册」变为「注册后使用」，但实现更简单。

---

## 9. 环境变量清理对照

| 变量 | 现状 | 迁移后 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 保留 | 保留 |
| `NEXT_PUBLIC_SUPABASE_KEY` | 保留（Publishable/Anon） | 保留（浏览器鉴权用） |
| `SUPABASE_SERVICE_ROLE_KEY` | 保留 | 保留（服务端特权写入） |
| `CHAT_JWT_SECRET` | 自建会话密钥 | **删除** |
| `SUPABASE_JWT_SECRET` | 实时 JWT 密钥 | **删除** |
| `ADMIN_PASSWORD` / `SUPER_PASSWORD` / `CHAT_SUPER_PASSWORD` | 管理后台密码 | **删除**（改 Supabase Auth，§7） |
| `CHAT_AUTH_ENABLED` | 无（仅在注释提及，实际未配置） | 删除引用 |

---

## 10. 实施阶段建议（评审通过后再执行）

1. **Phase 0 — 数据层**：新建迁移，TRUNCATE 相关表 → ALTER 列 nickname→uuid（§5.1–5.2）→ 重写 `is_room_participant`（§5.4）→ 重写 RLS（§5.5）。
2. **Phase 1 — Supabase Auth 接入**：装 `@supabase/ssr`；新增 `supabase-server.ts` + `getAuthUser`；改造 `middleware.ts`。
3. **Phase 2 — 删自建鉴权**：删 §3.1 文件；清理 §3.2 环境变量；改 §3.3 所有调用点为 `getAuthUser`。
4. **Phase 3 — 前端**：`AuthScreen` → Supabase Auth UI；`currentUser` 语义改 UUID；`display_name` 解析。
5. **Phase 4 — 实时简化**：`supabase.ts` 改 `createBrowserClient`，删 `realtime-token`。
6. **Phase 5 — 管理后台**：按 §7 选项落地 `role` 鉴权，删 `admin_session`。
7. **Phase 6 — 文档**：更新 `ARCHITECTURE.md` / `DEPLOYMENT.md` / `README.md` / `.env.example`，移除所有 `CHAT_JWT_SECRET` / `SUPABASE_JWT_SECRET` / Legacy JWT Secret 相关描述。

> 每阶段独立可回滚：Phase 1–2 与 Phase 0 解耦（先接 Auth 不改表，靠双写过渡亦可），但本项目「不做历史迁移」，建议**直接整段切换**而非双写，复杂度更低。

---

## 11. 收益总结

- **实时密钥问题从根上消失**：不再有 Legacy/ECC 之争，`postgres_changes` 的 RLS 由 Supabase 原生签名担保。
- **攻击面收窄**：自建 PBKDF2、HS256 签发、Cookie 会话校验全部移交 Supabase（密码哈希、暴力防护、密码重置邮件、MFA 现成可用）。
- **身份模型统一**：数据库关系列全部 UUID 化，与 Supabase 生态（RLS、`auth.uid()`）天然一致，未来接 OAuth/手机号零摩擦。
- **运维减负**：部署文档不再需要讲解「JWT Keys 页 → Legacy JWT Secret → Copy」这种易错步骤。

## 12. 待确认事项（需你拍板）

| # | 问题 | 推荐默认 |
|---|---|---|
| A | 管理后台鉴权方案 | §7 选项 A（Supabase Auth 账号 + `role`） |
| B | 是否启用匿名登录（保留免注册体验） | 启用（匿名 + 可升级） |
| C | 部署文档是否同步删除「JWT Keys / Legacy Secret」整节 | 是 |
| D | `users` 表是否保留 `role` 列（管理员用） | 保留，默认 `'user'` |

> 确认后我将把本文转为实现任务清单并逐阶段落地。

---

## 13. 实现后补充：部署前必知（复核得出）

设计之外、在落地复核中发现的三个要点，部署前务必确认：

### 13.1 群成员关系必须落库（否则群聊实时全哑）

实时消息走 **Postgres Changes + RLS**，RLS 的 `is_room_participant()` 只认 `room_members` 里的真实数据行。
前端 `localStorage` 的「已加入房间」记录对 RLS **完全不可见**；而迁移 `00020` 会 `TRUNCATE room_members`，
等于部署后没有任何人是任何群的成员 —— **历史消息仍能经 API 读出，但新消息一条都推不进来**（症状很隐蔽）。

解决：`POST /api/rooms/members` 新增 `{ roomId, join: true }` 自助入群（幂等 upsert，`ignoreDuplicates`
不降级已有 owner/admin）；前端 `useChat.ensureMembership()` 在 `roomId`/`userId` 变化时调用，
覆盖「首启 / 切房 / 建群后进入」，跳过 `dm:` 前缀与 `default-room`。

### 13.2 两处 RLS 加固（避免提权与信息泄露）

| 表 | 风险写法 | 加固后 |
|---|---|---|
| `room_members` | `FOR ALL ... WITH CHECK (user_id = auth.uid())` —— 客户端可把自己插成**任意房间的 owner** | 拆成 INSERT/UPDATE 均强制 `role = 'member'`；DELETE 仅自己；角色变更只走服务端 |
| `rooms` | `SELECT USING (true)` —— 拿 publishable key 即可 `GET /rest/v1/rooms` 枚举全部房间 | `USING (is_room_participant(id, auth.uid()))` |

`rooms` 那条尤其重要：私聊房间 id 是 `dm:<uuidA>:<uuidB>`，放开读等于直接泄露「谁在跟谁聊」。
房间发现统一走服务端 `/api/rooms?ids=`（service_role），收紧不影响任何现有功能。

### 13.3 RLS 与客户端直连的边界

前端**零直连**数据库：所有读写都经 `/api/*`（service_role），RLS 只服务于实时订阅的 `messages`
以及「万一有人拿 publishable key 直接打 PostgREST」的纵深防御。因此收紧 RLS 不会破坏现有功能。

