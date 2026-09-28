# 双账号双浏览器 · 大批量 E2E 测试报告（含修复与复测）

- 日期：2026-09-27
- 目标站点：https://chat.example.com/
- 测试方式：CDP 代理（`http://localhost:3456`）驱动**用户真实 Chrome** 的两个 tab
  - T1 = `lfangmu444`（`87dd46ff-2c1c-4d32-aa9f-1e728f856557`）
  - T2 = `lfangmu22222`（`12b2c160-9a77-47c0-ac73-a782086f97b0`）
- 代码改动：`public/sw.js`、`public/offline.html`（新增）、`src/hooks/useMessageRealtime.ts`
  → **已改完并通过 tsc / eslint，尚未部署**

---

## 〇、更正说明（先纠正上一版报告）

上一版把「生产环境 `NEXT_PUBLIC_SUPABASE_PROXY_URL` 为空」列为 **P0 事故**。
**该结论作废。** 依据 `src/lib/supabase.ts:7-10`：

```ts
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_PROXY_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';
```

「代理为空 → 回退直连」是**有意设计**：代理域名用于绕过国内对 `*.supabase.co` 的网络层拦截，
当机器本身就在外网（能直连 supabase.co）时，把该变量留空、走直连是预期行为，不是配置丢失。

---

## 一、结论速览（复测后）

| # | 场景 | 上一轮 | 本轮复测 |
|---|---|---|---|
| 1 | 双账号身份识别 | ✅ | ✅ |
| 2 | 真实 UI 发送互通（双向） | ✅ ~1.6s | ✅ T1→T2 **1706ms** / T2→T1 **1646ms** |
| 3 | 输入中（typing）提示 | ❌ 双向都不显示 | ✅ **双向通过**（T1→T2 900ms / T2→T1 300ms） |
| 4 | 引用（quote） | 未测 | ✅ 回复与引用原文都能到对端 |
| 5 | 编辑（edit） | 未测 | ✅ 编辑后文本到对端，旧文本消失 |
| 6 | 表情回应（reaction） | 未测 | ✅ 作者与对端都显示「👍 回应，共 1 人」 |
| 7 | 撤回（withdraw） | 未测 | ⚠️ 作者侧 ✅；对端侧被 CDC 故障阻断，**未取得有效结论** |
| 8 | @提及 | 未测 | ✅ 输入 `@` 弹出候选（3 人全列出），消息送达对端 |
| 9 | 全局搜索 | 未测 | ✅ 跨会话命中消息 |
| 10 | 未读角标 | 未测 | ❌ **未验证**（见「四」） |
| 11 | T1 全站 `/api/*` 返回 503 | 未发现 | ❌→✅ **已定位并解决**（见 2.1） |
| 12 | Realtime CDC 静默失效 | 未发现 | ❌ **本轮最重要的发现**（见 2.2） |
| 13 | 品牌主题切换 | ✅ | ✅（未回归） |
| 14 | 已读回执 | ✅ 私聊专属 | ✅（群聊不显示属预期） |

---

## 二、本轮真正定位到的问题

### 2.1 P1：T1 的 `/api/*` 全部 503（已解决）

**现象**：T1 会话列表显示「还没有聊天」，所有需要登录态的接口返回
Cloudflare 错误页 `Worker exceeded resource limits`（`text/html`，`cf-cache-status: DYNAMIC`）。

**证据链（逐项排除）**：

| 假设 | 实验 | 结论 |
|---|---|---|
| 账号 / cookie 坏 | 把 T1 的 cookie 拿到 Node 里重放 | ❌ 200，账号没问题 |
| 请求头差异 | Node 带 T1 cookie + 完整浏览器请求头 | ❌ 200，复现不出来 |
| 边缘节点差异 | 两 tab 的 `/cdn-cgi/trace` | ❌ 同为 NRT、同出口 IP |
| 缓存 / 时间相关 | 交替压测 8 轮 | ❌ T1 8/8 503、T2 8/8 200，与时间无关 |
| 无 cookie 也 503？ | `credentials:'omit'` | ❌ 返回 **401 JSON** → Worker 本身正常，问题只在**鉴权之后**的路径 |
| Service Worker | `sw.js` 显式 `if (url.pathname.startsWith('/api/')) return` | 理论上不拦截 `/api/` |

**处置**：在 T1 里 `serviceWorker.getRegistrations() → unregister()` + `caches.delete()` + 强制重新导航。

**结果**：`/api/me`、`/api/rooms`、`/api/rooms/mine`、`/api/dm-list`、`/api/friends`
**5/5 全部 200**，会话列表恢复。

**结论**：这是**浏览器侧上下文（SW / Cache Storage）被污染**造成的，不是服务端问题；
清掉 SW + 缓存即恢复。触发它的具体路径未能 100% 复现（Node 重放无法复现），
但 `sw.js` 里确实存在一个能造成同类污染的缺陷（见 2.3），已一并修掉。

### 2.2 P1：Realtime CDC 静默失效 —— 同一 channel 上 broadcast 正常，`postgres_changes` 却停了（已修复，待部署复测）

**现象**：T2 的会话**永远不再收到新消息**，但：

- **输入中提示正常**（T1 打字，T2 500ms 内显示「正在输入」）
- **表情回应正常**（T2 收到了 `chat-reaction` broadcast）
- `channel.state === 'joined'`，**控制台零报错**
- T2 的 JS 事件循环是活的（`setInterval` 5s 内计数 5 次）
- access token **未过期**（剩余 ~16 分钟）
- 切回列表再进房间 → **所有漏掉的消息立刻补上**

**判定实验**（关键：区分「broadcast 死」还是「CDC 死」）：

```
broadcast alive: true   （typing 500ms 到达）
CDC alive:       false  （14 次轮询 × 1s 全未到）
```

再验证「消息确实进了库」：`WD4-…` 在数据库里（11:42:08），只是没推给 T2。
同一时间窗口内反向（T2→T1）投递正常（+4.5s 到达）→ **故障是单客户端、单订阅的**。

**根因判断**：`postgres_changes` 的推送要走 **RLS**，而 `broadcast` 不走。
一旦该订阅背后的 JWT 在服务端失效（token 轮换 / 过期后未重新 `setAuth`），
服务端会**静默停止推送**——不报错、不断连接。而应用的心跳只检查
`channel.state !== 'joined'`（`useMessageRealtime.ts:264`），**抓不到这种「半死」状态**，
于是用户会一直停在「看着还连着、其实再也收不到消息」的状态，直到手动切房间或刷新。

**已实施的修复**（`src/hooks/useMessageRealtime.ts`）：

1. 新增 `channel.on('system', ...)` 监听：服务端上报 `status === 'error'` 时立即重建 channel。
2. 心跳里比对 `supabase.auth.getSession()` 的 access token：
   **token 变了就 `realtime.setAuth(token)` 并立刻从 DB 补一次漏拉的消息**。
   （Realtime 只在「(重)连接」和 `setAuth` 时取新 token，长连接期间不会自己更新。）

> 说明：修复提供的是**恢复能力**（三条恢复路径：system 报错 / token 变化 / 切前台），
> 未能 100% 证明服务端丢弃订阅的触发点。因此**部署后必须专项复测**：
> 让一个 tab 挂到 token 轮换之后，确认它仍能持续收到新消息。

### 2.3 已修复的代码缺陷：Service Worker 缓存「导航响应」

`public/sw.js` 的导航分支原本是「网络优先 + 写缓存」，有三个真实缺陷：

```js
if (request.mode === 'navigate') {
  event.respondWith(
    fetch(request).then((response) => {
      const responseClone = response.clone();
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(request, responseClone);   // ← ①发出即忘 ②没有 status 判断 ③每个 URL 都写
      });
      return response;
    })
    .catch(() => caches.match('/'))
  );
}
```

1. **缓存流式文档有截断风险**：Next.js 的 HTML 是 `Transfer-Encoding: chunked`（已实测确认）。
   `cache.put` 是 fire-and-forget，SW 可能在读完 body 前被回收 → 缓存里落一份**被截断的 HTML**。
2. **没有 `status === 200` 判断** → 会把 5xx 错误页（例如上面那个 503）**当成正常文档缓存**。
3. **缓存无限膨胀**：每次带 query 的导航（`?n=` / `?cb=` / `?v=`…）都写一条。
   实测 T1 的 `supabase-chat-v3` 里堆了 **20+ 条** 这种导航条目。

**修法**：

- `CACHE_NAME` → `supabase-chat-v4`（activate 时自动清掉被污染的 v3）
- 导航请求改为**只走网络，绝不写缓存**；离线兜底改用静态 `/offline.html`
- `'/'` 从 `STATIC_ASSETS` 移除（它是按用户 SSR 的动态文档，缓存会串号）
- 新增 `public/offline.html`（纯静态、无用户数据）

---

## 三、复测通过项（含证据）

- **typing**：T1 打字 → T2 +900ms 出现「正在输入」；T2 打字 → T1 +300ms 出现。
  上一轮失败的原因是两个 tab 当时跑在**不同 bundle / 不同 realtime 入口**上；
  把两端统一到 `page-1f05e3ffd31ce1ee.js` 后即通过。
- **消息互动**（T1 侧发起，对端验证）：
  - 引用：回复 422ms 到达，且对端能看到被引用的原文
  - 编辑：编辑后文本 423ms 到达，对端旧文本消失
  - 回应：作者与对端都出现 `👍 回应，共 1 人`
- **@提及**：输入 `@` 弹出 `@lfangmu444 / @lfangmu22222 / @哈哈1`，发送后对端收到
- **全局搜索**：从会话列表点「搜索消息」→ 命中跨会话消息并显示来源会话 + 时间
- **Realtime 连接健康**：`system: Subscribed to PostgreSQL`，join 回包含
  `postgres_changes INSERT filter: room_id=eq.default-room`

---

## 四、未验证 / 受阻项

> **本节各项已在第三轮（部署后线上复测）全部结清，详见文末「八、第三轮」。**

| 项 | 第二轮状态 | 第三轮结果 |
|---|---|---|
| 撤回的**对端**表现 | 未取得有效结论 | ✅ **通过**（对端撤回提示 0→1，原文消失）。见 8.2 |
| 未读 / @提及角标 | 未验证 | ✅ **通过，并抓到一个真 bug 已修**。见 8.4 |
| 2.2（CDC）修复的线上效果 | 待部署复测 | ✅ **通过**（心跳 25s 补发 token + 真实 token 轮换后仍收消息）。见 8.3 |
| 表情回应弹层「选完自动关闭」 | 未定论 | ✅ **通过**（选完 300ms 内关闭）。上一轮的「没关」是**假阴性**。见 8.5 |
| 清空聊天记录 / 隐藏会话复活 | 未测 | 仍未测（破坏性操作，需可丢弃的房间） |

---

## 五、测试手法教训（本轮新增）

1. **「CDC 死」和「broadcast 死」必须分开测**。
   同一个 channel 上两者是**独立**的：用 typing（broadcast）验活、用发消息（CDC）验死，
   才能区分「socket 断了」和「订阅失效了」。只看消息到没到，会把「订阅失效」误判成「socket 断了」。
2. **`document.documentElement.outerHTML` 的长度不是「文档完整性」的判据**。
   本轮一度因为「T1 的 DOM 只有 6 个 `<script src>`、比 T2 少 10 个、且缺少 `app/page-*.js`」
   判定「文档被截断、React 没 hydrate」——**是错的**。
   真相是**窄视口走了移动端单栏**，T2 多的那 10 个脚本是 hydration 之后动态注入的。
   判定页面是否可用，看 `textarea[aria-label="消息输入框"]` 这类**功能性元素**，别看字节数。
3. **`setInterval` 活着 ≠ tab 没被冻结**。本轮的判定是「`__TICK.t` 5s 内涨了 5 次」→ 事件循环正常，
   从而把「收不到消息」从「tab 冻结」这个假因里摘出来。
4. **别用 `textContent` 找 emoji 按钮**：`EmojiPicker` 的**分类 tab** 用同一个 emoji 当图标
   （「手势」分类的图标就是 `👍`），`textContent === '👍'` 会先命中分类 tab。
   要用 `aria-label` 定位：`button[aria-label="👍"]`。
5. **搜索入口不止一个**：`aria-label="搜索聊天记录"` 是**会话内**搜索（在 ChatHeader，必须先进房间）；
   跨会话的全局搜索在**会话列表页**，`aria-label="搜索消息"`。

> 以上均已写入 skill `realtime-e2e-verify`。

---

## 六、测试数据清理

`default-room` 本轮新增的测试消息**已全部删除**（20 条 → 0 条残留），
其中 17 条由 T1 删除、3 条（T2 发送）由 T2 删除（DELETE 接口按 owner 校验，跨账号删会 403）。
删除前缀：`UISEND-*` / `QUOTE-*` / `QREPLY-*` / `REACT*` / `EDIT-*` / `WITHDRAW*` / `WD3-` / `WD4-` /
`FRESH-` / `CDCPROBE-` / `CDC0-` / `SCROLL*` / `REVIVE-` / `MENTION-` / `UNREAD-`。
表情回应也已确认为 0 条残留。

---

## 七、行动项

| 优先级 | 事项 | 状态 |
|---|---|---|
| ~~P1~~ | 部署 3 个文件改动后**专项复测 2.2**（跨 token 轮换仍收消息） | ✅ 已完成，见 8.3 |
| ~~P1~~ | 复测撤回的**对端**表现 | ✅ 已完成，见 8.2 |
| ~~P2~~ | 补测未读角标 | ✅ 已完成并修掉一个真 bug，见 8.4 |
| P2 | 评估是否给 CDC 加一条**兜底探测**（页面可见时低频查一次「服务端最新一条消息」，发现落后就补拉）。这是唯一能覆盖「服务端静默停推且无任何事件」的手段，代价是引入低频轮询 | 保留：心跳 + system 事件已能覆盖两条已知路径，是否需要第三条取决于产品取舍 |
| P3 | 补测：清空聊天记录、隐藏会话复活 | 未开始 |
| P3 | 清理 preview 环境残留的旧 Supabase 项目配置（`zatdanvnufdkxzfeaecj`） | 未开始 |

---

## 八、第三轮：部署后线上复测（2026-09-27 晚）

第二轮改动已推送并部署，本轮在**线上新 bundle** 上复测。
账号与浏览器上下文同第二轮：T1 = `lfangmu444`（`87dd46ff-…`），T2 = `lfangmu22222`（`12b2c160-…`），房间 `default-room`。

### 8.0 部署确认

| 轮次 | bundle | 内容 |
|---|---|---|
| 部署前 | `app/page-0ed8bcb0a254c844.js` | — |
| SW + Realtime 修复后 | `app/page-e0969924e342664a.js` | `hasSystemListener` / `hasReassert` / `hasSetAuth` 全为 true |
| @提及修复 v1/v2 后 | `app/page-479a9ec21a204536.js` | — |
| @提及修复 v3（堵住第二个写入点）后 | **`app/page-466df3bc3a8ee0f7.js`** | 最终验收版本 |

v4 缓存 `supabase-chat-v4` 中**只有静态资源与脚手架 chunk，0 条导航记录** → SW 导航缓存缺陷确认修复。

### 8.1 基础链路（6/6 通过）

| 项 | 结果 |
|---|---|
| typing 指示 T1 → T2 | ✅ 600ms |
| typing 指示 T2 → T1 | ✅ 300ms |
| 真实 UI 投递 T1 → T2 | ✅ 1595ms |
| 真实 UI 投递 T2 → T1 | ✅ 1568ms |
| 编辑（作者 / 对端都更新） | ✅ |
| 引用（写入输入框） | ✅ |

### 8.2 撤回的**对端**表现（✅ 结清）

用「计数前后对比」替代「是否出现」判定，避免第二轮的假阳性：
撤回前对端撤回提示 **0** 条 → 撤回后 **1** 条，且原文 `WD4-…` 在对端消失。
作者侧同时看到「你撤回了一条消息」。

### 8.3 CDC 修复的专项复测（✅ 结清）

**(a) 心跳真的在跑，且时序正确。** 在进入房间后打点观测 `/api/messages` 调用：

```
t=  423ms  [DBG] [Realtime] Connected to room channel: chat-room:default-room
t=  425ms  /api/messages?roomId=default-room&after=…     ← subscribe 后的 onSync
t=  432ms  [DBG] [Realtime] Connected to global chat-events channel
t=24065ms  [DBG] [Realtime] Re-asserted auth token; resyncing missed messages
t=24065ms  /api/messages?roomId=default-room&after=…     ← 心跳 #1（25s）补发 token + 补漏
（此后 56s 内无调用 → 心跳 #2 token 未变，按设计不重复同步）
```

**`Re-asserted auth token` 这行日志就是修复路径在真实环境里执行的直接证据。**

**(b) 真实 token 轮换后仍持续收消息。** 会话存在 cookie `sb-app-auth-token`（`base64-` + base64(JSON)，
由 `@supabase/ssr` 写入，**不在 localStorage**）。把 `expires_at` 改成过去再刷新页面：

- 客户端发起真实 `grant_type=refresh_token`（资源时间线 `t=560ms` 捕获到）；
- access token 由 `…fpd8D44Drhog` 变为 `…IZ5E2Sl_jNDQ`；
- 之后 T1 发消息，T2 **2106ms** 收到 → **CDC 在真实 token 轮换后依然存活**。

### 8.4 @提及角标：抓到并修掉一个真 bug

**现象**：`chat_mentioned_rooms` 长期停留在 `["default-room"]`，UI 上 `@` 角标**永不消失**。

**根因（两处无条件写入 + 只有一个清除点）**：

- 写入点 A：`useMessageRealtime.ts` 当前房间 CDC 回调里的 `addMentionedRoom(roomId)`（**无条件**）；
- 写入点 B：`useChat.ts` 的 `handleExternalMessage`（第二轮已修）；
- 清除点**只有** `switchRoom` 里的 `removeMentionedRoom`。
  → 用户正看着房间时收到 @我 也会被标记，而用户不会再触发一次 `switchRoom`，红点永久残留。
- 附带问题：写入点 A 不更新 React 状态，红点要等 `useChat` 里 **10s** 的轮询才出现（实测：localStorage 已写入、角标仍是空的）。

**修复**（3 个提交）：

1. `useChat`：收到 @我 时，若「房间相同 **且** 在聊天页」则改为 `removeMentionedRoom`（已读），否则才 `addMentionedRoom` + 通知。
2. `useChat`：进入房间（mount / `roomId` / `isChatView` 变化）即清掉该房间的提及标记，兜住历史残留。
3. `useMessageRealtime`：新增 `isActive` / `onMention` 参数，堵住**第二个**无条件写入点；
   `useMessages` 透传，`useChat` 的 `onMention` 立即刷新 `mentionedRoomIds`（红点不再滞后 10s）。

关键坑：**移动端单列布局下列表页与聊天页共用同一个 `roomId`**，
所以判断「用户是不是在看这个房间」必须同时看 `isChatView`（`useChat` 首参），
只看 `roomId` 会把「停在列表页」误判成已读，反而吞掉该有的红点。

**验收（8/8 通过，bundle `466df3bc`）**：

| 步骤 | 结果 |
|---|---|
| T2 在列表页，T1 发 `@lfangmu22222 …` | ✅ `@` 角标出现（2148ms，非 10s 轮询） |
| T2 进入房间 | ✅ 角标清除，`chat_mentioned_rooms` 变 `[]` |
| T2 **在房间内**再收到 @我 | ✅ **不**打角标（旧版会打，且永不清除） |
| 两条 @都送达 | ✅ |

### 8.5 表情回应弹层：上一轮的「没关」是假阴性（✅ 结清）

`EmojiPicker` 是**分类页签**结构，网格只渲染当前分类的 emoji，`👍` 在「手势」分类，
默认停在「表情」分类时 DOM 里根本没有 `👍`。必须先点 `button[aria-label="手势"]` 再用
`button[aria-label="👍"]` 选中。修正后：

- 选完 **300ms 内弹层关闭** ✅
- 作者 / 对端都显示 `👍 回应，共 1 人` ✅
- 再点一次可取消，双方同步清除 ✅

> 上一轮判定「没关」的真正原因：前几次测试留下的弹层**没关干净并累积**（同一时刻 DOM 里最多 3 个
> `[role="dialog"][aria-label="表情选择器"]`），而检查写的是
> `!!document.querySelector(...)`——**只要任意一个还在**就恒为 true，永远观察不到关闭。

### 8.6 本轮新增的测试手法教训

1. **弹层/DOM 断言前先做「归零」卫生**：先确认计数为 0（必要时点空白处关掉残留），
   再用**计数**而非「存在性」断言。跨步骤的状态泄漏会制造假阴性。
2. **观测心跳不要猜时间窗**：先打点记录「组件挂载时刻」，再看调用相对挂载的偏移。
   直接用绝对时间窗会因为「点击到挂载有延迟」而误判。
3. **抓 React 内部行为，优先拦截 `console.debug/warn` + `fetch`**，比猜时间窗可靠得多
   （本轮靠 `[Realtime] Re-asserted auth token` 这行日志直接证明了修复在执行）。
4. **会话可能不在 localStorage**。`@supabase/ssr` 把会话写在 cookie
   （本项目固定名 `sb-app-auth-token`，`base64-` + base64(JSON) 单块）。
   要制造「真实 token 轮换」，改 cookie 里的 `expires_at` 再刷新即可，不必等 1 小时。
5. **DELETE `/api/messages` 的 `id` 在 JSON body 里，不是 query param**。
   用 `?id=` + 空 body 会让 `request.json()` 抛错，路由 catch 成 **500「服务器内部错误」**，
   极易误判成后端故障。（本项目 401/403/404 分别是未登录 / 非 owner / 消息不存在。）
6. **分两步点击 React 驱动的弹层**：激活分类 tab 与选中 emoji 必须分成两次 eval，
   否则同一次 eval 里 React 还没重渲染，`querySelector` 拿不到新节点。

> 以上均已写入 skill `realtime-e2e-verify`。

### 8.7 第三轮测试数据清理

本轮新增测试消息 **18 条已全部删除**（T1 名下 17 条、T2 名下 1 条），`default-room` 残留 0 条，
表情回应残留 0 条。删除前缀：`V1A-` / `V1B-` / `WD4-` / `V3ROT-` / `V8ROT-` / `V9R-` / `V9E-` /
`V9Q-` / `V10P-` / `V11R-` / `V12D-` / `V13P-` / `V14U-` / `V14M-` / `V17A-` / `V17C-` / `V18A-` / `V18C-`。
