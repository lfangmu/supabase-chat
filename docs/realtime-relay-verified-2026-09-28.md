# 实时中继（无 Durable Object）端到端验证报告

- 日期：2026-09-28
- 结论：**方案 A「SSE 服务端中继」在国内网络下端到端跑通**（CDC 与 broadcast 两类事件均已实测到达浏览器）。
- 线上 Worker：`v28-presence-global-20260928`（`supabase-proxy`，自定义域 `supabase.chat.example.com`）。
  注：本文件初稿写于 v27 阶段；v28 追加了 presence（`presence_state`/`presence_diff`）解析与全局在线频道
  （`realtime:presence:global`，浏览器用 `?guid=<uuid>` 区分），并以 `__global__` 哨兵把
  `chat-events`/`presence:global` 与真实房间 ID 区分开。

---

## 1. 架构（无 DO、无信用卡）

```
浏览器 ──SSE(GET /realtime, text/event-stream)──► Cloudflare Worker ──new WebSocket()──► Supabase Realtime
浏览器 ──POST /realtime/send(broadcast)────────► Cloudflare Worker ──短连 WS, join 后 broadcast──► Supabase Realtime
```

- 浏览器全程只碰 **HTTP**（SSE 收 + POST 发），绕开国内对「浏览器 → Cloudflare 的 WebSocket」的封锁。
- Worker 以服务端身份 `new WebSocket()` 连 Supabase Realtime（服务端出网，国内链路不影响）。
- 1 个浏览器连接 = Worker 内 1 条到 Supabase 的 WS（1:1，无扇出，故无需 Durable Object）。

## 2. 根因（决定性）

Worker 手写 Supabase Realtime 的 WS 协议时，**频道 topic 漏了 `realtime:` 前缀**。

supabase-js 会自动加前缀（源码 `RealtimeClient.channel()`：`const realtimeTopic = \`realtime:${topic}\``），
所以 app 里写的 `client.channel('chat-room:default-room')` 在**线上实际 topic 是 `realtime:chat-room:default-room`**。

Worker 之前 join 的是 `room:<id>` / `chat-events`，服务端对**每个**频道一律回：

```json
{"event":"phx_reply","payload":{"status":"error","response":{"reason":"unmatched topic"}}}
```

→ **所有订阅静默失效**：WS 是 OPEN 的、心跳 `phoenix` 回 `status:"ok"`、零报错，但永远收不到任何
`postgres_changes` / `broadcast` 事件。这正是此前「SSE 能开、keepalive 有、就是没有事件帧」的原因。

### 修复（worker.js）

| 位置 | 修复 |
|---|---|
| 房间频道 join/presence | `topic: room:<id>` → **`realtime:chat-room:<id>`** |
| 全局频道 | `chat-events` → **`realtime:chat-events`** |
| join / presence-track / broadcast | 补上 Phoenix 必需的 **`join_ref`**；broadcast 另需 **`ref`**（否则无法路由到已 join 频道） |
| `/realtime/send` | topic 同步改为 `realtime:chat-room:<id>` |

## 3. 第二个坑：`apikey`

- Worker 里的 `env.SUPABASE_ANON_KEY` **未配置**（不是自动就有）→ 不传 `?apikey=` 时 SSE 直接 400 `missing apikey`。
- 用 user access_token 冒充 `apikey` → Worker `new WebSocket()` 握手失败（`/realtime/send` 502 `ws open failed`）。
- 正确值：项目 **publishable key** `sb_publishable_...`（新版格式，**不是** legacy `eyJ` JWT）。
  浏览器端由 `NEXT_PUBLIC_SUPABASE_KEY` 提供并随请求传入，因此生产链路不依赖 Worker 的 secret。

## 4. 端到端证据

修复后，用 CDP 驱动真实浏览器 + 真实会话 JWT 验证：

| 项 | 结果 |
|---|---|
| SSE 建连 | `200`，`content-type: text/event-stream` ✅ |
| 频道 join 回执 | `realtime:chat-room:default-room` → **`status:"ok"`**，回显绑定 `postgres_changes:[{id:45609627,filter:"room_id=eq.default-room",table:"messages"}]` ✅ |
| 全局频道 join | `realtime:chat-events` → `status:"ok"` ✅ |
| **CDC 真事件** | 调应用服务端接口 `POST /api/messages`（service_role 落库）→ SSE 收到 `event: message-insert`，含完整行 `{id,content:"CDC-PROOF-…",room_id,user_id,timestamp}` ✅ |
| **broadcast 真事件** | `POST /realtime/send {event:"typing"}` → SSE 收到 `event: broadcast {event:"typing",payload:{…}}` ✅ |
| 生产流洁净度 | 诊断帧已用 `?debug=1` 收敛；默认流无 `system` 噪音 ✅ |

> 说明：浏览器直连 `POST /rest/v1/messages` 会 **403 RLS**（迁移 00019 已撤销客户端直写策略，
> 写入统一走服务端 service_role）——这是**预期设计**，不是 bug。因此 CDC 验证走应用自己的 `/api/messages`。

## 5. 复现/诊断要点（供后续排查）

- 取应用**有效**会话：cookie **`sb-app-auth-token`**（值形如 `base64-eyJ…`），
  **不是**默认命名的 `sb-<projectref>-auth-token`（后者常是已过期的僵尸 cookie）。
- 诊断开关：`GET /realtime?...&debug=1` 会把 Worker 侧 `phx_reply` 的
  `status` / `response` 透出为 `event: system` 帧，可一眼区分：
  `unmatched topic`（topic 前缀错）/ `InvalidJWTToken`（token 问题）/ `status:"ok"`（订阅成功）。

## 6. 应用侧接线（已全部完成 — 提交 `fd67820`）

上一版「仍待做」中的三项均已落地，`tsc --noEmit` 通过、单测 5 项通过、`next build` 通过、`git push` 已触发 Pages 自动部署（部署 `99afdb75`）：

| 项 | 改动 | 文件 |
|---|---|---|
| **接收侧统一** | `ChatApp` 由 `useMessageRealtime` 切到 `useRelayRealtime`（SSE 收 + 解析 `message-insert`/`message-update`/`broadcast`/`presence`/`system`） | `src/hooks/useRelayRealtime.ts`（新建）、`src/hooks/useMessages.ts` |
| **发送侧切断** | `useTypingIndicator` / `useMessageActions`（撤回/编辑/房间更新/新 DM）/ `useReadReceipts` / `toggleReaction`
  不再调 `channelRef.current?.send(...)`，统一改走 `sendBroadcast(roomId, event, payload)`（→ `POST /realtime/send`，带 `Authorization: Bearer` + `x-supabase-apikey`） | `src/hooks/useTypingIndicator.ts`、`useMessageActions.ts`、`useReadReceipts.ts`、`useMessages.ts` |
| **presence 整合** | `usePresence` / `useGlobalPresence` 不再用 `supabase.channel`，改为消费 relay 的 `presence` 事件：
  经 `applyRelayPresence`（合并 `sync`/`diff`）写入模块级 store，`getRoomPresence`/`getGlobalPresence` + `subscribePresence` 提供订阅 | `src/lib/presenceRelay.ts`（新建）、`src/hooks/usePresence.ts`、`useGlobalPresence.ts` |
| **中继客户端** | SSE 客户端 + `sendRelay`（POST 发），新增 `guid?`（`?guid=`）、`SendBroadcast` 类型；`myId` 透传为 `guid` | `src/lib/realtimeRelay.ts`（新建） |

> 兜底建议：仍推荐给 Worker 配 `SUPABASE_ANON_KEY` secret（浏览器当前显式传 `?apikey=`，生产链路不依赖它）。

## 7. 线上复测结论（提交 `fd67820` 后，CDP 真实浏览器复测）

- 打开默认房间 → 头部显示 **「1 人在线」**（SSE 收到 `presence {roomId:"default-room",event:"sync"}`）。
- 全局在线：SSE 收到 `presence {roomId:"__global__",event:"sync",state:{user-…,user-…}}`（2 人在线）。
- 通过 UI（真实 `document.execCommand('insertText')` 输入）发消息 → 服务端拉取 + DOM 扫描均确认 `persisted:true, domHit:true`。
- 测试消息已通过 `DELETE /api/messages` 清理。
- 三类链路（CDC 落库 → SSE、broadcast（typing/撤回/已读/反应/房间更新/新 DM）、presence（房间 + 全局））**端到端全通**。

**最终状态：方案 A「无 DO 服务端中继」已完整接入并上线**——收（SSE）、发（POST）、在线（presence 经 relay）三线闭环，Worker `v28` + Pages `99afdb75`，线上复测通过。
