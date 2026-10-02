# 通话功能方案（规划中）

> 状态：**规划 / 方案阶段**，尚未实现。本文档描述 1:1 语音通话的设计，按"外网先、内网后"分阶段落地。
> 讨论结论先行：范围 = 1:1 私聊语音；路线 = 自建 WebRTC（信令复用现有 SSE 中继）；媒体 = 语音优先；通话记录落库。

---

## 1. 目标与范围

- **1:1 私聊语音通话**：从 DM 会话发起，点对点。
- **自建 WebRTC**：媒体浏览器直连（P2P），信令走现有实时通道，不引入新基础设施（环境一）或仅加一个同源端点（环境二）。
- **语音优先**：先做音频；视频只是多加一路 track，留到 Phase 2。
- **通话记录落库**：`calls` 表持久化，DM 内可看历史。

不在本期：群聊（需 SFU）、视频（Phase 2）。

---

## 2. 网络环境拆分（外网先 / 内网后）

通话的**媒体**（WebRTC P2P）在任何网络下都一样，只有**信令传输**因"浏览器能否直连 `*.supabase.co` WebSocket"而不同。因此把信令抽象成统一接口、两套实现，并沿用项目现有的 `NEXT_PUBLIC_SUPABASE_PROXY_URL` 开关（配了 = 国内/被拦路径，没配 = 外网直连路径）——与现有实时链路切换逻辑一致。

### 环境一：外网（浏览器可直连 `*.supabase.co`）— 先做

- 信令：浏览器直接用 `@supabase/supabase-js` 的 Realtime 广播频道 `call:<userId>`，走原生 WebSocket。标准做法，最简单。
- 此阶段把整套通话跑通：状态机、WebRTC、来电/接拒/挂断 UI、通话记录落库、公共 STUN。

### 环境二：内网 / 国内（被拦，需中继）— 再做

- 信令：复用现有 SSE 中继。
  - 新增 `POST /api/call/signal`：服务端用 service-role 客户端在 Supabase Realtime 广播 `call:<目标userId>`。
  - 中继每条连接订阅 `call:<userId>` 频道，转成 SSE `call-signal` 事件推给浏览器。
  - 浏览器全程不碰 `*.supabase.co` 的 WS，国内可达。
- 媒体仍是 P2P，不变。
- 切换：由 `NEXT_PUBLIC_SUPABASE_PROXY_URL` 是否配置决定走哪条信令路径。

---

## 3. 信令抽象（关键设计）

统一接口，上层（UI / 状态机 / WebRTC）不感知差异：

```ts
interface CallSignaling {
  connect(): void;
  send(to: string, type: SignalType, payload: unknown): Promise<void>;
  onSignal(cb: (from: string, type: SignalType, payload: unknown) => void): void;
  disconnect(): void;
}
```

- `SupabaseCallSignaling`（环境一）：直接 `supabase.channel('call:' + me).on('broadcast', …)`。
- `RelayCallSignaling`（环境二）：`POST /api/call/signal` + 监听 SSE `call-signal` 事件。
- `useCallSignaling` 按 proxy 配置选择实现。

---

## 4. WebRTC 媒体（P2P，不经服务器）

- `getUserMedia({ audio: true })` 取麦克风；浏览器之间直连 `RTCPeerConnection`。
- **媒体流不经过我们的服务器**，只过信令——契合"自托管 / 隐私"卖点。
- STUN 默认用公共 Google STUN（免费）；TURN 留给对称 NAT（见 §5）。
- `ontrack` → 接到隐藏 `<audio autoplay>` 元素播放远端声音。

---

## 5. TURN 是什么，为什么国内必谈

- **STUN**：帮浏览器查出自己的公网地址，用于 P2P 互联。
- **对称 NAT / 运营商级 NAT（CGNAT，国内小区宽带、企业网常见）**：两端都藏在这种 NAT 后，STUN 打不通，两浏览器无法直接互联。
- **TURN** = "P2P 直连失败时，媒体改走一台中转服务器"（类比：两人找不到彼此，就通过共同信任的朋友转接通话）。代价是要托管/付费这台服务器（占带宽）。
- 本项目取舍：**默认免费公共 STUN**（多数情况能通）；**对称 NAT 下必须配 TURN** → 提供可选 `ICE_SERVERS` 环境变量（填 coturn 或 TURN 服务）。这样既保住"常见情况零成本"，也不掩盖限制。

---

## 6. 通话状态机与流程（1:1）

状态：`idle → ringing（呼出/呼入）→ connecting → active → ended`，外加 `declined / busy / missed / failed`。

1. 发起方 A 在 DM 头部点电话图标 → 发 `invite`（带 offer）给 B，本地 `ringing-out`。
2. B 收到 → 弹来电弹窗（响铃），本地 `ringing-in`，可接 / 拒。
3. B 接 → `setRemote(offer)` + 创建 answer 发回 → 双方 `connecting` → `connected` → `active`。
4. 任意一方挂断 → `hangup` → 双方 `ended`，关 PC、`stop()` 轨道。
5. B 已在通话 → 回 `busy`；A 邀请 30s 无应答 → `missed`。

信令类型：`invite / answer / ice / hangup / decline / busy`。

---

## 7. 数据模型（落库）

新增 `calls` 表：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `room_id` | text | DM 房间 id（`dm:<uuidA>:<uuidB>`） |
| `caller_id` | uuid | 发起方（`auth.users.id`） |
| `callee_id` | uuid | 接收方 |
| `type` | text | `'voice'`（预留 `'video'`） |
| `status` | text | `missed` / `declined` / `completed` / `busy` / `failed` |
| `started_at` | timestamptz | |
| `ended_at` | timestamptz | |
| `duration_seconds` | int | |

RLS：仅 `caller_id` / `callee_id` 双方可读可写自己的行。迁移：`supabase/migrations/00028_calls.sql`。

---

## 8. 改动文件清单

**前端**
- `src/hooks/useWebRTC.ts` — 封装 `RTCPeerConnection`、`getUserMedia`、ICE trickle、`ontrack`、清理、ICE 重启。
- `src/hooks/useCallSignaling.ts` — `CallSignaling` 接口 + 两套实现 + 状态机编排。
- `src/components/CallOverlay.tsx` — 通话中 UI（静音 / 挂断 / 计时 / 重连提示）。
- `src/components/IncomingCallModal.tsx` — 来电响铃（接 / 拒）。
- DM 头部组件 — 加电话按钮。
- 中继客户端 — 识别并分发新的 SSE 事件 `call-signal`。

**后端 / 中继（仅环境二）**
- `src/app/api/call/signal/route.ts`（Edge）— token 鉴权 + 校验"是 DM 双方"（fail-closed）+ 用 service-role 发布广播；校验 payload 体积 / 形状。
- `src/lib/realtimeProxy.ts` — 每条中继连接订阅 `call:<userId>` 广播频道，转成 SSE `call-signal`。

**配置 / DB / 测试**
- `src/config/index.ts` 加 `CALL_CONFIG`（ICE servers、响铃超时）。
- env：可选 `ICE_SERVERS`（JSON，含 STUN/TURN）。
- 迁移 `00028_calls.sql` + RLS。
- vitest：补信令状态机 + 端点鉴权用例（沿用现有模式）。

---

## 9. 稳定性与已知限制（诚实说明）

- **信令链路稳**：走托管的 Supabase Realtime 广播 / 同源中继；连接建好后信令中断不影响已建立的媒体流。
- **媒体 P2P 在对称 NAT 下直连必挂**，必须靠 TURN 中转。不配 TURN，国内相当一部分用户无法建立连接。
- **代码层保障**（实现时落实）：
  - ICE trickle + 多 STUN + 可选 TURN；
  - 监听 `iceconnectionstate`：`disconnected` 自动 ICE 重启，`failed` 自动回退 TURN（若已配），UI 显示"重连中…"；
  - 来电 30s 超时判 `missed`，挂断 / 异常都干净拆连接，避免幽灵通话；
  - 记录每次连接用的候选类型（host / srflx / relay），可观测多少通话靠 TURN 兜底。
- **结论**：配好 TURN（国内推荐）可做到可靠可用；不配 TURN 无法保证对称 NAT 下稳定。企业级"零失败"属 Phase 2 托管 RTC（Agora / TRTC）范畴，不在自托管 P2P 内。

---

## 10. 分期

- **Phase A（先做）**：环境一（外网直连）1:1 语音全链路 + 通话记录落库 + 公共 STUN。
- **Phase B（再做）**：环境二（中继）信令路径。
- **Phase 1.5**：TURN（`ICE_SERVERS`）配置 + 文档。
- **Phase 2（以后）**：视频轨、群聊（届时需 SFU 或托管 RTC）。
