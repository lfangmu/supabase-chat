# PRD：Supabase Chat 12 项功能增强

> **文档版本**：v1.0  
> **创建日期**：2025-06-23  
> **项目路径**：`F:\supabase-chat`  
> **技术栈**：Next.js 14 (App Router) + Supabase + TypeScript + Tailwind CSS

---

## 一、产品目标

本次迭代围绕**消息表达力**、**信息组织能力**和**触达可靠性**三个维度，为现有实时聊天应用增加 12 项功能，整体目标如下：

1. **丰富消息交互维度**：通过 Emoji 回应、链接预览、消息转发等功能，让消息不再局限于"发送-接收"的单向流，提升表达的丰富度和上下文的连续性。
2. **提升信息组织与检索效率**：通过全局搜索、日期分隔线、房间公告/置顶、房间分组等功能，帮助用户在消息量增长后仍能快速定位和组织信息。
3. **增强消息触达的可靠性**：通过 @强提醒、离线 Web Push 等功能，确保重要消息在用户离开页面后仍能被及时感知，降低遗漏风险。
4. **完善基础聊天体验**：通过草稿自动保存、文件类型扩展、1:1 私聊等功能，补齐用户日常使用中的高频痛点。

---

## 二、用户故事

### 高频刚需

| # | 功能 | 用户故事 |
|---|------|---------|
| 1 | Emoji Reactions | 作为聊天参与者，我想对任何消息添加 emoji 回应（如👍😂❤️），这样我无需打字就能快速表达态度，同时看到其他人的回应汇总。 |
| 2 | 链接预览 | 作为聊天参与者，我想消息中的链接自动显示标题和缩略图预览，这样我不用点开链接就能快速了解内容是否值得关注。 |
| 3 | 全局搜索 | 作为聊天参与者，我想跨所有房间搜索消息并按发送人/类型/日期过滤，这样我能在大量历史消息中快速找到需要的内容。 |
| 4 | 草稿自动保存 | 作为聊天参与者，我想切换房间或刷新页面后输入框的未发送内容自动恢复，这样我不会因为误操作丢失正在编辑的消息。 |

### 体验加分

| # | 功能 | 用户故事 |
|---|------|---------|
| 5 | 消息日期分隔线 | 作为聊天参与者，我想消息列表中按日期显示分隔线，这样我能快速判断消息的时间归属，不需要逐条查看时间戳。 |
| 6 | 房间公告/置顶消息 | 作为房间创建者，我想置顶一条重要消息，这样所有进入房间的用户都能第一时间看到关键信息。 |
| 7 | @提及强提醒 | 作为聊天参与者，我想被 @提及 时收到浏览器通知（不管页面是否在前台），这样我不会错过别人专门发给我的消息。 |
| 8 | 1:1 私聊 | 作为聊天参与者，我想与另一个在线用户发起 1:1 私聊，这样我们可以在不干扰公共房间的情况下进行私人交流。 |

### 中期可做

| # | 功能 | 用户故事 |
|---|------|---------|
| 9 | 离线推送 | 作为聊天参与者，我想关闭浏览器后仍能收到消息的系统通知，这样我离开应用后也不会错过重要消息。 |
| 10 | 文件类型扩展 | 作为聊天参与者，我想发送 PDF/Word/Excel/ZIP 等通用文件，这样我可以分享文档而不仅限于图片和视频。 |
| 11 | 消息转发 | 作为聊天参与者，我想将一条消息转发到其他房间，这样我可以在不同群组间分享重要信息而无需复制粘贴。 |
| 12 | 房间分类/分组 | 作为聊天参与者，我想将房间按自定义分组（如"工作/摸鱼/家人"）分类显示，这样房间数量多时能更有条理地管理。 |

---

## 三、需求池

### P0 — 必须实现

#### REQ-001：Emoji Reactions（消息回应）

**功能描述**  
用户可对任何消息添加 emoji 回应。同一条消息下方显示所有回应及计数。同一用户对同一消息的同一 emoji 只能添加一次，再次点击则取消。回应实时同步给所有在线用户。

**验收标准**
- [ ] 消息气泡下方显示一行回应区，每个回应格式为 `emoji 计数`，按计数降序排列
- [ ] 点击已有回应：若当前用户已添加该 emoji，则取消（计数 -1，计数归零时移除该 emoji）；否则添加（计数 +1）
- [ ] 长按消息上下文菜单中新增"回应"入口，弹出精简 emoji 选择器（常用 8-12 个 emoji）
- [ ] 回应操作通过 Supabase Broadcast 实时同步，延迟 < 500ms
- [ ] 撤回的消息同时清除其所有回应
- [ ] 回应数据持久化到数据库，刷新页面后恢复

**数据库变更**
```sql
-- 新增 reactions 表
CREATE TABLE IF NOT EXISTS public.reactions (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    "user"      TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, "user", emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON public.reactions (message_id);

ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read on reactions"
    ON public.reactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert on reactions"
    ON public.reactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated delete on reactions"
    ON public.reactions FOR DELETE TO authenticated USING (true);
```

**API 变更**
- `POST /api/reactions` — 添加/取消回应（toggle 语义，基于 UNIQUE 约束做 upsert/delete）
- `GET /api/reactions?messageIds=id1,id2` — 批量获取多条消息的回应列表（用于消息分页加载时附带）

**实时事件**
- Broadcast event `reaction-toggle`：payload `{ message_id, user, emoji, action: 'add'|'remove' }`

---

#### REQ-002：链接预览（Link Unfurl）

**功能描述**  
文本消息中包含 HTTP/HTTPS URL 时，自动抓取目标页面的 Open Graph 标签，在消息气泡下方显示标题 + 缩略图 + 简介卡片。卡片可点击展开/收起。

**验收标准**
- [ ] 消息发送后，客户端检测到 URL（正则匹配 `https?://` 开头的连续字符串），自动调用预览 API
- [ ] 预览卡片显示：标题（最多 2 行截断）、缩略图（如有）、简介（最多 3 行截断）
- [ ] 卡片默认收起状态仅显示标题 + 缩略图，点击展开显示完整简介
- [ ] 同一 URL 在 5 分钟内只抓取一次，结果缓存在客户端内存（LRU，上限 100 条）
- [ ] 抓取失败（超时 5s / 非 HTML / 无 OG 标签）时静默不显示卡片，不影响消息正常显示
- [ ] 预览卡片点击跳转到原 URL（新标签页打开）
- [ ] 支持 Markdown 链接 `[text](url)` 和裸 URL 两种形式

**数据库变更**
```sql
-- messages 表新增 link_preview 列（缓存抓取结果，避免重复抓取）
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS link_preview JSONB;
-- 结构: { url, title, description, image, fetched_at }
```

**API 变更**
- `POST /api/link-preview` — 接收 `{ url }`，服务端抓取 OG 标签并返回 `{ title, description, image }`
  - 服务端使用 `fetch` + 正则解析 `<meta property="og:*">` 标签
  - 设置 5s 超时，User-Agent 伪装为浏览器
  - 返回结果同时写入 `messages.link_preview` 列（通过 UPDATE）

---

#### REQ-003：全局搜索

**功能描述**  
跨所有房间搜索消息内容，支持按发送人昵称、消息类型、日期范围过滤。搜索结果列表展示匹配消息摘要，点击可跳转到原消息所在房间和位置。

**验收标准**
- [ ] 顶部搜索栏新增"全局搜索"入口（与现有房间内搜索并列），点击打开搜索面板/模态框
- [ ] 搜索输入框支持 300ms 防抖，输入关键词后自动搜索
- [ ] 过滤器：发送人（文本输入）、消息类型（下拉选择：全部/文本/图片/视频/语音）、日期范围（起止日期选择器）
- [ ] 搜索结果列表显示：消息内容摘要（关键词高亮）、发送人、房间名、时间
- [ ] 点击搜索结果：切换到对应房间 → 滚动到目标消息位置 → 高亮显示（黄色边框，3s 后消失）
- [ ] 结果按时间倒序排列，最多返回 100 条
- [ ] 搜索结果中若目标消息已被撤回，显示"该消息已被撤回"提示
- [ ] 跳转到目标消息时，若消息不在当前已加载的页内，自动触发分页加载直到找到

**数据库变更**
```sql
-- 跨房间搜索索引（已有 content trgm 索引，新增 user 列索引用于按发送人过滤）
CREATE INDEX IF NOT EXISTS idx_messages_user ON public.messages ("user");
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON public.messages (timestamp DESC);
```

**API 变更**
- 扩展 `GET /api/messages`：
  - 新增参数 `global=true`（不传 roomId 时跨房间搜索）
  - 新增参数 `sender`（按发送人过滤）、`type`（按消息类型过滤）、`startDate`/`endDate`（日期范围）
  - 当 `global=true` 时返回结果包含 `room_id` 和 `room_name`（需 JOIN rooms 表）

---

#### REQ-004：草稿自动保存

**功能描述**  
用户在输入框中输入未发送的内容后，切换房间或刷新页面时自动保存草稿。再次进入对应房间时自动恢复草稿到输入框。按房间维度独立存储。

**验收标准**
- [ ] 输入框内容变化时，以 500ms 防抖写入 localStorage，key 格式 `chat_draft_{roomId}`
- [ ] 切换房间时，当前输入内容立即保存到当前房间草稿
- [ ] 进入房间时，从 localStorage 读取该房间草稿并恢复到输入框
- [ ] 消息发送后，清除该房间草稿
- [ ] 草稿内容超过 10000 字符时不保存（与消息长度限制一致）
- [ ] localStorage 空间不足时静默降级（try-catch），不影响正常使用
- [ ] 草稿存储包含时间戳，超过 7 天的草稿自动清除

**数据库变更**  
无（纯客户端 localStorage 实现）

**API 变更**  
无

---

### P1 — 重要

#### REQ-005：消息日期分隔线

**功能描述**  
消息列表中按日期插入分隔线。当相邻两条消息的日期不同时，在它们之间显示日期分隔线（如"6月23日 星期二"）。今天的消息显示"今天"，昨天的消息显示"昨天"。

**验收标准**
- [ ] 分隔线居中显示，样式为 `—— 6月23日 星期二 ——` 或类似视觉
- [ ] 当天消息显示"今天"，前一天显示"昨天"，更早的显示"X月X日 星期X"
- [ ] 分隔线作为虚拟列表中的特殊行插入，不影响现有虚拟滚动性能
- [ ] 加载更多历史消息时，新加载的消息与已有消息之间正确判断是否需要分隔线
- [ ] 分隔线不参与消息计数，不影响未读数等逻辑
- [ ] 年份不同时显示完整日期"2024年12月31日 星期二"

**数据库变更**  
无

**API 变更**  
无

**技术要点**
- 在 `MessageList` 组件中构建"消息+分隔线"的混合虚拟列表
- 分隔线项的 `estimateSize` 返回固定值（如 36px）
- 需要修改 `useVirtualizer` 的 `count` 和 `getItemKey` 逻辑以包含分隔线条目

---

#### REQ-006：房间公告/置顶消息

**功能描述**  
每个房间可设置一条置顶消息。进入房间时在消息列表顶部显示置顶消息卡片。房间创建者可设置/取消置顶。

**验收标准**
- [ ] 长按消息上下文菜单中，房间创建者可见"置顶"选项（已置顶时显示"取消置顶"）
- [ ] 置顶消息在消息列表顶部以独立卡片显示，带有置顶图标和"置顶消息"标签
- [ ] 卡片显示消息内容摘要、发送人、时间，点击可跳转到原消息位置
- [ ] 进入房间时自动加载并显示置顶消息
- [ ] 置顶/取消置顶操作通过 Broadcast 实时同步给所有在线用户
- [ ] 置顶消息被撤回时自动取消置顶
- [ ] 每个房间最多一条置顶消息，设置新置顶时自动替换旧置顶

**数据库变更**
```sql
-- rooms 表新增 pinned_message_id 列
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS pinned_message_id TEXT;
```

**API 变更**
- 扩展 `PUT /api/rooms`：新增 `pinned_message_id` 字段（传 null 表示取消置顶）
  - 需验证操作者为房间创建者（`rooms.created_by === user`）
- `GET /api/rooms` 返回结果包含 `pinned_message_id`

**实时事件**
- Broadcast event `pin-message`：payload `{ roomId, messageId | null }`

---

#### REQ-007：@提及强提醒

**功能描述**  
被 @提及 的用户收到浏览器 Notification（不管页面是否在前台），侧边栏对应房间显示红点指示。@提及 的消息在消息列表中高亮显示。

**验收标准**
- [ ] 消息内容中包含 `@我的昵称` 时，触发强提醒
- [ ] 不管页面在前台还是后台，都显示浏览器 Notification（标题：房间名，正文：发送人 + 消息内容）
- [ ] 前台时同时播放提示音（与现有 `playNotificationSound` 复用）
- [ ] 侧边栏中被 @提及 的房间显示红点（区别于普通未读蓝点）
- [ ] 用户查看该房间后，红点消除
- [ ] @提及 在消息气泡中以高亮样式显示被提及的昵称（如蓝色背景）
- [ ] 昵称匹配规则：精确匹配当前用户昵称（trim 后比较），大小写不敏感
- [ ] 不对自己发的消息触发提醒

**数据库变更**  
无（客户端实时处理）

**API 变更**  
无

**技术要点**
- 在 `useMessageRealtime` 的 `chat-message` 事件处理中，检测 payload.content 是否包含 `@{currentUser}`
- 使用 `showBrowserNotification`（需移除现有的 `document.visibilityState === 'visible'` 前置检查，或新增一个不受可见性限制的通知函数）
- 侧边栏红点状态存储在 localStorage（`chat_mentioned_rooms`），key 为 roomId

---

#### REQ-008：1:1 私聊（DM）

**功能描述**  
用户可发起与另一在线用户的 1:1 私聊。私聊在侧边栏中以独立入口（头像 + 对方昵称）显示，与普通房间列表分开。私聊消息不显示在公共房间中。

**验收标准**
- [ ] 在线用户列表（Presence）中，点击某用户可发起私聊
- [ ] 私聊房间 ID 格式为 `dm:{userA}:{userB}`（两个昵称按字母序排列，保证双向唯一）
- [ ] 侧边栏中私聊入口与普通房间分组显示，带有用户首字母头像 + 对方昵称
- [ ] 私聊房间支持所有现有消息功能（文本、图片、视频、语音、引用、编辑、撤回）
- [ ] 私聊房间不支持重命名/删除/置顶（简化逻辑）
- [ ] 私聊房间不显示在公共房间列表中，不参与全局搜索
- [ ] 对方离线时仍可发送消息，对方上线后可查看
- [ ] 私聊房间在 `rooms` 表中 `created_by` 记录为发起者，`name` 记录为对方昵称

**数据库变更**
```sql
-- rooms 表新增 type 列区分房间类型
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'public'
    CHECK (type IN ('public', 'dm'));

-- DM 房间创建时 type='dm'，普通房间 type='public'
-- 现有房间默认为 'public'（DEFAULT 子句处理）
```

**API 变更**
- 扩展 `GET /api/rooms`：新增 `type` 过滤参数，返回结果包含 `type` 字段
- 扩展 `POST /api/rooms`：支持 `type: 'dm'` 和 `participants` 参数
- 新增 `GET /api/dm-list?user={nickname}` — 返回当前用户参与的所有 DM 房间列表

**技术要点**
- DM 房间 ID 生成：`dm:` + 两个昵称 trim 后按 `localeCompare` 排序拼接，用 `:` 分隔
- Presence channel 中追踪用户 nickname，点击在线用户时发起 DM
- 侧边栏 UI 分为"私聊"和"房间"两个区域

---

### P2 — 可选

#### REQ-009：离线推送（Web Push）

**功能描述**  
使用 Web Push API + Service Worker，用户关闭页面后仍可收到系统通知。需要 VAPID 密钥对和推送订阅管理。

**验收标准**
- [ ] 用户在设置中可开启/关闭离线推送
- [ ] 开启时，通过 `serviceWorkerRegistration.pushManager.subscribe()` 创建推送订阅
- [ ] 订阅信息（endpoint + keys）保存到服务端
- [ ] 用户关闭页面后，新消息触发服务端发送 Web Push 通知
- [ ] 通知点击后聚焦/打开应用并跳转到对应房间
- [ ] 关闭推送时取消订阅并从服务端删除订阅记录
- [ ] 仅在用户已授权 Notification 权限时允许开启推送
- [ ] 支持 @提及 消息优先推送（非 @消息可配置是否推送）

**数据库变更**
```sql
-- 新增 push_subscriptions 表
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id          TEXT PRIMARY KEY,
    "user"      TEXT NOT NULL,           -- 昵称（无真实账户模型）
    endpoint    TEXT NOT NULL,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE("user", endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions ("user");

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated all on push_subscriptions"
    ON public.push_subscriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

**API 变更**
- `POST /api/push/subscribe` — 保存推送订阅 `{ user, endpoint, keys: { p256dh, auth } }`
- `DELETE /api/push/subscribe` — 取消订阅 `{ user, endpoint }`
- `POST /api/push/send` — 内部调用（由消息发送逻辑触发），向目标用户的所有订阅发送推送
  - 使用 `web-push` npm 包，配置 VAPID 公私钥对
  - 推送 payload：`{ title, body, url }`（url 包含 roomId 用于点击跳转）

**环境变量变更**
```env
# Web Push VAPID 密钥对（通过 npx web-push generate-vapid-keys 生成）
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
VAPID_SUBJECT=mailto:your@email.com
```

**Service Worker 变更**
- 扩展 `public/sw.js`，新增 `push` 事件监听器：
  ```js
  self.addEventListener('push', (event) => {
    const data = event.data?.json();
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: data.url },
        tag: 'chat-push',
      })
    );
  });
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(clients.openWindow(event.notification.data.url || '/'));
  });
  ```

**技术约束**
- 需要安装 `web-push` npm 包
- Service Worker 必须通过 HTTPS 注册（localhost 例外）
- VAPID 密钥对需提前生成并配置到环境变量
- 推送发送逻辑需要服务端持有 VAPID 私钥
- 因"共享密码 + 自由昵称"模型无真实用户认证，推送订阅按昵称关联，用户更换昵称需重新订阅

---

#### REQ-010：文件类型扩展

**功能描述**  
支持 PDF/Word/Excel/ZIP 等通用文件上传。非媒体文件在消息列表中显示文件名 + 文件大小 + 下载按钮。

**验收标准**
- [ ] 文件上传支持类型：PDF、Word(.doc/.docx)、Excel(.xls/.xlsx)、PPT(.ppt/.pptx)、ZIP、RAR、TXT、CSV
- [ ] 单文件大小限制 50MB（与现有配置一致）
- [ ] 上传后消息类型为 `file`，content 存储文件在 Supabase Storage 的路径
- [ ] 消息气泡显示：文件图标（根据类型区分）+ 文件名 + 文件大小 + 下载按钮
- [ ] 点击下载按钮触发文件下载（通过 signed URL）
- [ ] 文件上传时显示进度条（复用现有上传进度 UI）
- [ ] 支持在消息上下文菜单中"保存文件"（与现有"保存图片"并列）
- [ ] 文件消息支持撤回（同时删除 Storage 文件）

**数据库变更**
```sql
-- messages 表 type CHECK 约束新增 'file'
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'voice', 'file'));

-- 新增 file metadata 列（文件名、大小、MIME 类型）
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_mime TEXT;
```

**API 变更**
- 扩展 `POST /api/messages`：`type` 验证新增 `'file'`，新增 `file_name`、`file_size`、`file_mime` 字段
- 扩展 `POST /api/upload-media`：支持 `file` 类型文件上传（非压缩处理）
- 扩展 `GET /api/signed-url`：对 `file` 类型生成下载用 signed URL，设置 `Content-Disposition: attachment`

**配置变更**
```typescript
// src/config/index.ts UPLOAD_CONFIG 新增
ALLOWED_FILE_TYPES: [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-rar-compressed',
  'text/plain',
  'text/csv',
  'application/json',
],
```

---

#### REQ-011：消息转发

**功能描述**  
长按消息 → 上下文菜单中选择"转发" → 选择目标房间 → 将消息内容转发到目标房间，附带来源引用标记。

**验收标准**
- [ ] 长按消息上下文菜单新增"转发"选项
- [ ] 点击后弹出房间选择器（列表展示所有可用房间 + DM）
- [ ] 选择目标房间后，在该房间创建一条新消息，内容与原消息相同
- [ ] 转发的消息带有"转发自 @{原发送人}"标记（在消息气泡顶部或引用区域显示）
- [ ] 转发的文本消息保持原文格式；图片/视频/语音消息转发时复制引用（不重新上传文件）
- [ ] 转发操作不修改原消息
- [ ] 转发后自动切换到目标房间并滚动到转发消息
- [ ] 转发消息的 `user` 为当前操作者（非原发送人）

**数据库变更**
```sql
-- messages 表新增 forwarded_from 列
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS forwarded_from JSONB;
-- 结构: { user, room_id, room_name, message_id }
```

**API 变更**
- 扩展 `POST /api/messages`：新增 `forwarded_from` 字段
- 转发逻辑在客户端实现：读取原消息 → 构造新消息（附带 forwarded_from）→ 发送到目标房间

---

#### REQ-012：房间分类/分组

**功能描述**  
用户可自定义房间分组（如"工作/摸鱼/家人"），将房间拖入或分配到分组中。侧边栏按分组折叠显示。

**验收标准**
- [ ] 侧边栏房间列表上方新增"分组管理"入口
- [ ] 可创建/重命名/删除分组（分组名最长 20 字符）
- [ ] 每个房间可分配到一个分组（或不分组，显示在"未分组"区域）
- [ ] 分组在侧边栏中可折叠/展开，折叠状态持久化
- [ ] 分组内房间按最后消息时间排序
- [ ] 未分组房间显示在所有分组下方或顶部"全部"区域
- [ ] 分组配置存储在 localStorage（纯客户端，因无用户账户）
- [ ] DM 私聊不受分组管理影响（始终在独立区域）

**数据库变更**  
无（纯客户端 localStorage 实现，因"共享密码 + 自由昵称"模型无用户账户，分组为本地偏好）

**API 变更**  
无

**技术要点**
- localStorage key: `chat_room_groups`，结构 `{ groups: [{ id, name, roomIds: [] }], expanded: { groupId: bool } }`
- RoomSidebar 组件重构为分组渲染逻辑
- 房间拖拽分组可使用 HTML5 Drag and Drop API 或简单的"分配到分组"操作菜单

---

## 四、UI/UX 设计要点

### REQ-001：Emoji Reactions
- 回应显示在消息气泡正下方，与气泡左/右对齐（跟随消息方向）
- 每个回应为圆角胶囊形：`👍 3`，当前用户已添加的 emoji 胶囊高亮（蓝色边框）
- 常用 emoji 快捷栏（8-12 个）：👍 ❤️ 😂 🎉 🔥 😮 😢 🙏
- 回应区无回应时不占位（不显示空区域）

### REQ-002：链接预览
- 预览卡片在消息文本下方，最大宽度与消息气泡一致
- 收起态：缩略图（48x48）+ 标题（单行截断）
- 展开态：缩略图 + 标题 + 描述（3 行截断）
- 卡片有浅色背景 + 圆角 + 左侧色条强调
- 加载中显示骨架屏（灰色占位）

### REQ-003：全局搜索
- 搜索入口在顶部 ChatHeader 中，图标为放大镜（全局）与现有搜索（房间内）区分
- 点击打开全屏搜索面板（移动端）或右侧抽屉（桌面端）
- 过滤器折叠在"高级筛选"展开区域
- 结果列表每项：内容摘要（高亮关键词）+ 发送人头像首字母 + 房间名标签 + 时间

### REQ-004：草稿自动保存
- 输入框右下角显示极小的"已保存"指示器（仅在有草稿时显示，2s 后淡出）
- 恢复草稿时不自动聚焦输入框（避免打扰用户浏览消息）
- 无额外 UI，行为透明

### REQ-005：消息日期分隔线
- 分隔线为全宽水平线 + 居中日期文本
- 样式：`——— 今天 ———`，线条颜色 `text-gray-300 dark:text-gray-600`
- 分隔线有上下各 8px 间距

### REQ-006：房间公告/置顶消息
- 置顶卡片在消息列表顶部、加载更多指示器下方
- 卡片样式：浅黄色背景 + 左侧图钉图标 + "置顶消息"标签 + 内容摘要（2行截断）
- 卡片右上角有关闭按钮（仅收起当前显示，不取消置顶）

### REQ-007：@提及强提醒
- 消息中 @昵称 文本以蓝色背景 + 白色文字高亮显示
- 被提及的消息气泡带有左侧橙色竖线强调
- 侧边栏红点比普通蓝点更大（4px vs 2px）且颜色为红色

### REQ-008：1:1 私聊
- 侧边栏顶部新增"私聊"区域（在"创建新房间"按钮上方）
- 每个私聊入口：圆形首字母头像（与对方昵称首字母一致）+ 昵称 + 在线状态绿点
- 私聊区域和房间区域之间有分隔线
- 在线用户列表中点击用户头像弹出"发起私聊"操作

### REQ-009：离线推送
- 设置入口在 ChatHeader 菜单中（齿轮图标）
- 推送开关在设置面板中，附带说明文字"关闭页面后仍可收到消息通知"
- 开启时若未授权 Notification 权限，先请求权限

### REQ-010：文件类型扩展
- 文件消息气泡为横向布局：左侧文件类型图标（32x32）+ 右侧文件名 + 大小 + 下载按钮
- 文件图标按类型着色：PDF 红色、Word 蓝色、Excel 绿色、ZIP 橙色、其他灰色
- 文件大小显示友好格式（如 2.3 MB）

### REQ-011：消息转发
- 转发房间选择器为底部弹出面板（移动端）或居中弹窗（桌面端）
- 列表展示所有房间 + DM，支持搜索过滤
- 转发消息的"转发自"标记为浅灰色小字，在消息内容上方

### REQ-012：房间分类/分组
- 分组标题行：折叠箭头 + 分组名 + 房间数量
- 折叠/展开有高度过渡动画
- 分组管理入口为侧边栏底部的"管理分组"按钮
- 房间项右侧长按或 hover 显示"移到分组"操作

---

## 五、技术约束与依赖

| # | 功能 | 技术约束与依赖 |
|---|------|--------------|
| 1 | Emoji Reactions | 新增 `reactions` 表 + RLS 策略；Broadcast event 需在现有 `chat-room:{roomId}` channel 上新增监听 |
| 2 | 链接预览 | 服务端需 `fetch` 外部 URL（Edge Runtime 限制需确认）；OG 标签解析需正则或轻量 HTML parser；需考虑 SSRF 防护（限制内网 IP、仅允许 http/https 协议） |
| 3 | 全局搜索 | 跨房间搜索需移除 `roomId` 必填校验；JOIN rooms 表获取房间名；现有 pg_trgm GIN 索引可复用 |
| 4 | 草稿自动保存 | 纯客户端实现，无服务端依赖；需注意 localStorage 容量限制（通常 5-10MB） |
| 5 | 日期分隔线 | 需重构 `MessageList` 虚拟列表逻辑，将分隔线作为虚拟项插入；`estimateSize` 和 `getItemKey` 需适配混合列表 |
| 6 | 置顶消息 | `rooms` 表新增列；需验证操作者权限（`created_by`）；Broadcast 实时同步 |
| 7 | @强提醒 | 需修改 `notifications.ts` 中 `showBrowserNotification` 的可见性检查逻辑；红点状态 localStorage 持久化 |
| 8 | 1:1 私聊 | `rooms` 表新增 `type` 列 + CHECK 约束；DM 房间 ID 生成算法需保证双向唯一；Presence channel 复用现有实现 |
| 9 | Web Push | **需安装 `web-push` npm 包**；需生成 VAPID 密钥对并配置环境变量；需扩展 `sw.js` 添加 `push` 和 `notificationclick` 事件；**Edge Runtime 不支持 `web-push`（依赖 Node.js crypto），推送发送 API 需使用 Node.js runtime** |
| 10 | 文件类型扩展 | `messages` 表 type CHECK 约束变更（需 ALTER）；新增 file metadata 列；上传 API 需扩展文件类型验证 |
| 11 | 消息转发 | `messages` 表新增 `forwarded_from` JSONB 列；纯客户端构造转发消息 |
| 12 | 房间分组 | 纯客户端 localStorage 实现；`RoomSidebar` 组件需重构为分组渲染 |

### 关键技术风险

1. **Edge Runtime 限制**：现有 API 路由均使用 `export const runtime = 'edge'`。链接预览的 `fetch` 外部 URL 在 Edge Runtime 中可用，但 Web Push 的 `web-push` 包依赖 Node.js API，推送发送路由需改为 `runtime = 'nodejs'`。

2. **虚拟列表重构**：日期分隔线（REQ-005）需要修改 `@tanstack/react-virtual` 的虚拟化逻辑，将分隔线作为虚拟项插入。这会影响 `count`、`getItemKey`、`estimateSize` 和渲染逻辑，需确保不影响现有滚动性能和搜索高亮跳转。

3. **"共享密码 + 自由昵称"模型适配**：
   - REQ-008（1:1 DM）和 REQ-009（Web Push）在无真实用户账户模型下，按昵称关联数据。用户更换昵称后，DM 历史和推送订阅需重新关联。
   - REQ-007（@强提醒）按昵称匹配，存在同名昵称时所有同名用户都会收到提醒（可接受，因为共享密码模型本身不区分用户身份）。

4. **SSRF 防护**：链接预览（REQ-002）服务端抓取外部 URL 时，需防止 SSRF 攻击：
   - 禁止访问内网 IP（10.x、172.16-31.x、192.168.x、127.x、localhost）
   - 仅允许 http/https 协议
   - 设置 5s 超时 + 响应体大小限制（1MB）

5. **Service Worker 更新**：扩展 `sw.js` 后，已注册的旧 SW 不会自动更新。需在 `register-sw.js` 中监听 `controllerchange` 事件或使用 `skipWaiting()` + `clients.claim()`（现有代码已有 `skipWaiting` 和 `clients.claim`）。

---

## 六、待确认问题

| # | 问题 | 影响范围 | 建议 |
|---|------|---------|------|
| 1 | **Emoji Reactions 的 emoji 范围**：是否限制为预设的 8-12 个常用 emoji，还是允许用户从完整 emoji 选择器中选择任意 emoji？ | REQ-001 | 建议 P0 阶段仅提供预设快捷栏（降低复杂度），P1 阶段可接入现有 EmojiPicker 支持任意 emoji |
| 2 | **链接预览的触发范围**：是否对所有包含 URL 的消息都抓取预览，还是仅对"纯 URL"消息（消息内容仅为一个 URL）抓取？ | REQ-002 | 建议对所有包含 URL 的消息都检测并预览，但一条消息最多显示一个预览卡片（取第一个 URL） |
| 3 | **全局搜索的权限范围**：用户是否可以搜索自己未加入的房间中的消息？ | REQ-003 | 当前模型所有用户共享密码，建议所有房间消息均可搜索（无房间级权限隔离） |
| 4 | **草稿保存的清除策略**：草稿是否在消息发送后立即清除，还是保留一段时间作为历史草稿？ | REQ-004 | 建议发送后立即清除，不保留历史草稿（避免 localStorage 膨胀） |
| 5 | **置顶消息的权限模型**：当前只有房间创建者可置顶，是否允许所有用户置顶？ | REQ-006 | 建议仅创建者可置顶（与现有 rename/delete 权限一致），后续可扩展为"管理员"角色 |
| 6 | **@强提醒的触发条件**：是否仅 @当前用户昵称触发，还是 @all / @全体 也触发？ | REQ-007 | 建议 P1 阶段仅支持 @具体昵称，@all 作为 P2 后续需求 |
| 7 | **1:1 DM 的历史保留**：DM 房间是否可以被删除？删除后对方是否还能看到历史消息？ | REQ-008 | 建议 DM 房间不可主动删除，但支持"清空聊天记录"（删除该 DM 房间所有消息，保留房间壳） |
| 8 | **Web Push 的触发条件**：是否所有消息都推送，还是仅 @提及 的消息推送？全量推送可能造成通知轰炸。 | REQ-009 | 建议默认仅推送 @提及 消息，用户可在设置中开启"全部消息推送" |
| 9 | **文件上传的存储策略**：文件是否上传到现有 `chat-media` Storage bucket，还是新建 `chat-files` bucket？ | REQ-010 | 建议复用 `chat-media` bucket（简化配置），通过 `file_mime` 列区分类型 |
| 10 | **消息转发的次数限制**：是否限制单条消息的转发次数（防止刷屏）？ | REQ-011 | 建议不做次数限制（与现有发送逻辑一致），但单次操作只能转发到一个房间 |
| 11 | **房间分组的同步问题**：因无用户账户，分组配置仅存 localStorage。用户换设备后分组丢失是否可接受？ | REQ-012 | 建议可接受（与现有"昵称存 localStorage"策略一致），后续若有用户账户可迁移到服务端 |
| 12 | **12 项功能的实施顺序**：是否按 P0→P1→P2 顺序串行开发，还是允许并行？ | 全局 | 建议 P0 四项可并行开发（互不依赖），P1 四项中 REQ-005 和 REQ-007 可并行，REQ-006 和 REQ-008 可并行 |

---

## 七、附录：数据库变更汇总

以下为本次 12 项功能涉及的所有数据库变更，按迁移文件顺序排列：

### Migration 00006: Reactions 表
```sql
CREATE TABLE IF NOT EXISTS public.reactions (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    "user"      TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, "user", emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON public.reactions (message_id);
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
-- RLS policies...
```

### Migration 00007: Messages 表扩展
```sql
-- 链接预览缓存
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS link_preview JSONB;
-- 文件元数据
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_mime TEXT;
-- 转发来源
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS forwarded_from JSONB;
-- type CHECK 约束扩展（新增 'file'）
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'voice', 'file'));
-- 跨房间搜索辅助索引
CREATE INDEX IF NOT EXISTS idx_messages_user ON public.messages ("user");
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON public.messages (timestamp DESC);
```

### Migration 00008: Rooms 表扩展
```sql
-- 置顶消息
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS pinned_message_id TEXT;
-- 房间类型（普通/私聊）
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'public'
    CHECK (type IN ('public', 'dm'));
```

### Migration 00009: Push Subscriptions 表
```sql
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id          TEXT PRIMARY KEY,
    "user"      TEXT NOT NULL,
    endpoint    TEXT NOT NULL,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE("user", endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions ("user");
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
-- RLS policies...
```

---

## 八、附录：环境变量变更汇总

```env
# .env.example 新增

# Web Push VAPID 密钥对（通过 npx web-push generate-vapid-keys 生成）
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
VAPID_SUBJECT=mailto:your@email.com
```

> **注意**：`VAPID_PUBLIC_KEY` 需要前端访问，应加 `NEXT_PUBLIC_` 前缀：
> ```env
> NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_public_key
> VAPID_PRIVATE_KEY=your_private_key
> VAPID_SUBJECT=mailto:your@email.com
> ```

---

## 九、附录：npm 依赖变更

```bash
# Web Push（REQ-009）
npm install web-push
npm install -D @types/web-push
```

> 其余功能均使用现有依赖实现，无需新增 npm 包。

---

## 十、实施结论（2026-09-28 定稿）

12 项功能全部结项：**8 项已实现，4 项明确不做**。本节记录不做项的决策与依据，
避免后续重复讨论。

### 已实现（8 项）

| # | 功能 | 落地位置 |
|---|---|---|
| REQ-001 | 表情回应 | `reactions` 表 + `/api/messages/reactions` + `chat-reaction` 广播 |
| REQ-003 | 全局搜索 | `GlobalSearchModal.tsx` + `/api/messages/search`（含发送人/类型/日期过滤） |
| REQ-004 | 草稿自动保存 | `useDraft.ts` |
| REQ-005 | 消息日期分隔线 | `DateSeparator.tsx`（已并入虚拟列表） |
| REQ-007 | @提及强提醒 | `notifications.ts` + `chat_mentioned_rooms` 红点（2026-09-27 修复"红点永久残留"） |
| REQ-008 | 1:1 私聊 | `useDM.ts` + `/api/dm-list` + `rooms.type='dm'` |
| REQ-010 | 文件类型扩展 | `file_name/file_size/file_mime` + `FileMessage.tsx` |
| REQ-011 | 消息转发 | `forwarded_from` 列 + 上下文菜单「转发」 |

### 明确不做（4 项）

| # | 功能 | 决策 | 依据 |
|---|---|---|---|
| REQ-002 | 链接预览 | **不做** | 产品取舍。注：`messages.link_preview` 列已随迁移 00007 建好；`src/lib/ssrf-guard.ts` 已实现且有 11 条单测，但**未被任何代码引用**（死代码）。若日后要做，SSRF 防护可直接复用。 |
| REQ-006 | 置顶消息 | **不做** | 产品取舍。注：现有「置顶」是**置顶房间**（本地偏好 `pinnedRoomIds`），与消息级置顶是两回事，勿混淆。`rooms.pinned_message_id` 列已随迁移 00008 建好但前端未用。 |
| REQ-012 | 房间分组 | **不做** | 产品取舍。侧边栏保留内建的「置顶 / 私聊 / 群聊」三段即可。 |
| REQ-009 | 离线推送 Web Push | **不做** | **技术前提不成立**，见下。 |

### REQ-009 为什么不做：目标设备上到达率不成立

Web Push 完全依赖浏览器厂商的推送通道，而本项目的**目标用户是国内手机网页**：

| 场景 | 支持情况 |
|---|---|
| 桌面 Chrome / Edge / Firefox | ✅ 可靠 |
| iOS Safari | ⚠️ 需 iOS 16.4+ **且必须先「添加到主屏幕」**，否则完全不可用 |
| **国内 Android Chrome** | ❌ 依赖 GMS/FCM，国内普遍缺失 → 收不到 |
| 微信内置 / UC / QQ 等国产内核 | ❌ 不支持 |

即：做了之后绝大多数目标用户**依然收不到**，且会出现"别人有通知我没有"的困惑，
比不做更糟。

**它只多覆盖一个场景**：浏览器整个关掉 / 手机锁屏后进程被杀。页面在前台或后台
（浏览器仍存活）时，现有 realtime + `notifyMention` 已经能弹系统通知。

**若"离开也能收到"是硬需求**，国内场景的可行路径是原生 App 推送（极光/个推/厂商通道）
或微信服务号订阅消息——那是**产品形态变更**（网页 → App/公众号），不是加一个功能，
需单独立项评估，不在本 PRD 范围内。

### 已落地但未接线的残留（不做清理，留档）

- `src/lib/ssrf-guard.ts`：已实现 + 已测，无人引用（为 REQ-002 准备）。
- `public/sw.js` 的 `push` / `notificationclick` 监听器（144-185 行）：已实现，
  无订阅则永不触发，留着无害。
- 迁移 00007 的 `link_preview` 列、00008 的 `pinned_message_id` 列、
  00009 的 `push_subscriptions` 表：空置，不影响现有功能。

### 数据库迁移说明

上述 4 项对应的列/表**已在迁移里建好**，属于空置状态，不影响现有功能，
也**不需要回滚**（回滚反而要写新迁移，收益为负）。
