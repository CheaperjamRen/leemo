# 通电竖切设计（Power-On Vertical Slice）— v1.0

> 日期：2026-07-24 ／ 作者：Opus 4.8 主控会话
> 状态：**已获用户设计审批**（7/24），待用户审文档 → 转 writing-plans
> 上游：`docs/handoffs/NEXT-SESSION-power-on-vertical-slice.md`（战略/岔路）、`docs/sdd/progress.md` 末尾（权威台账，第七批 Batch 0-6 已合 main，HEAD=51adc63）
> 权威链：`CLAUDE.md` → `06-Leemo-产品设计文档` → 契约 `src/bridge/contract.ts`（v1.1 冻结面）

---

## 0. 目标（North Star）

搭子模式输入一句话 → Node host 进程调**真 SDK** → **DeepSeek 直连** → 真流式 token 回到界面。当 momo 想动工具（Read/Write/Bash）或想问用户（问询卡）时，**审批条 / 问询卡在真模型下真的弹出、用户点了才继续**。

这是"通电"：把「精致但没通电的前端」和「已验收但没挂上的后端库」用最薄的一条线接通，验证契约对得上真数据、momo 真能说话、interact 回投在真模型下成立。**不做过度装修，不上重架构。**

## 1. 用户已拍板的决策（7/24）

| 决策点 | 选择 |
|---|---|
| 架构 | **Option B** — Node bridge host 进程 + WsBridgeClient（非真 Electron 主进程；Electron 是紧随的下一里程碑） |
| 首发 provider | **DeepSeek 直连**（Phase 0 已 5/5 满血；不经网关） |
| 范围 | **通电 + 审批接线**（含 canUseTool 审批 **与** ask_user 问询卡两条 interact） |
| 传输层 | **WebSocket** |
| 工具 cwd | **专用沙盒目录**（不碰仓库根） |
| 目录命名 | **`src/host/`**（对齐未来 Electron 主进程语义；interact.ts 全程称这层为 "the host"） |
| ask_user 门槛 | **接线 + 单测覆盖，但非硬 live 验收门槛**（DeepSeek 主动调 MCP 难稳定诱发） |

用户授权：技术选型全权交主控，验收锚点是**产品体感是否符合 06 产品设计**，非代码细节。

## 2. 架构总览

```
                        VITE_LEEMO_LIVE=1 时才走这条线（默认仍 fixture）
renderer(浏览器/Vite)                     Node host 进程(tsx, npm run bridge:dev)
┌────────────────────┐   ws://127.0.0.1:8787   ┌──────────────────────────────┐
│ WsBridgeClient     │◄───────────────────────►│ ws-server (薄传输层)          │
│  implements        │  invoke 请求/响应(配 id) │   ↕                          │
│  BridgeClient      │  event/approval/ask 推送 │ bridge-host (组装+路由+回投)  │
│                    │                          │  ├ createBridge (pool.ts)    │
│ store/组件/wiring   │                          │  ├ 每对话 ApprovalBroker     │
│ 全不改，照旧读它    │                          │  ├ ask_user MCP (interact)   │
└────────────────────┘                          │  ├ sdk-adapter: 真query→QueryFn│
                                                │  └ normalizeSdkStream(events)│
                                                └──────────────────────────────┘
                                                   cwd = <沙盒>/  provider = DeepSeek(.env)
```

**护栏（最重要）**：`context.tsx` 的 `client ?? new FixtureBridgeClient()` 是干净注入缝。本竖切**不改默认**——fixture 是 548 测试的地基。实模式是 **opt-in**：仅当 `VITE_LEEMO_LIVE=1` 时 `main.tsx` 构造 `WsBridgeClient` 传入 `BridgeProvider`。默认路径（`npm run dev` + 全部测试）一字节不变。

## 3. 组件设计

### §3.1 renderer 接线（唯一的 renderer 改动，带测试）

- **`src/renderer/main.tsx`（或 App 挂载点）**：读 `import.meta.env.VITE_LEEMO_LIVE`；为真则 `new WsBridgeClient(url)` 并 `<BridgeProvider client={...}>`，否则不传（走 fixture 默认）。
- **`src/renderer/bridge/context.tsx`**：providers store 现硬塞 `FIXTURE_PROVIDERS`。改为：有真 client 时 providers 由 `bridge:listProviders` 供给；无则 fixture。小改，加测试；不动其它 store 装配。
- 其余 renderer（`wiring.ts`、conversations/approvals store、ApprovalBar、AskUserCard、所有卡片）**零改动**——它们只依赖 `BridgeClient` 接口，换实现自动接上真模型。

### §3.2 `src/host/`（全部新后端代码，严格 TDD）

命名 `host/`：interact.ts 注释始终把这层称 "the host"；未来 Electron 主进程 = host，届时只把 `ws-server` 换成 `ipcMain`/preload，其余不动。

| 文件 | 职责 | 关键点 |
|---|---|---|
| `src/host/bridge-host.ts` | 组装 `createBridge` + 每对话 broker + ask_user MCP + SDK 适配器；把 `BridgeInvokeMap` 每 channel 映射到 handle 方法；驱动每对话事件流 | **纯逻辑 + 注入式**（注入 queryFn + 抽象 push 通道 + provider 目录）→ 完全可单测，不碰真网络/真 WS |
| `src/host/sdk-adapter.ts` | 真 SDK `query()` → `pool.QueryFn`；per-provider 从 `CLAUDE_CONFIG_DIR` 派发 extras：`cwd=沙盒`、`permissionMode:'default'`、`includePartialMessages:true`、`streamingInput:true`、`canUseTool`、`mcpServers` | **直接移植 `smoke/bridge-live.mjs` 已验证 5/5 的 realQueryFn recipe** |
| `src/host/provider-catalog.ts` | 从 `.env` 解析 provider：`Provider`（含 key，process-in，喂 pool）与 `ProviderSpec`（key-free，喂 `listProviders`）。本竖切仅 DeepSeek | 扩展轴留好（[[provider-extensibility-constraint]]）；未来加 provider = 加目录数据 |
| `src/host/ws-server.ts` | WebSocket 服务：收 invoke→转 bridge-host→回 `{id,response}`；把 event/approvalRequest/askUser 推给 renderer | 薄；新增 `ws` devDep |
| `src/host/dev.ts` | 入口 `npm run bridge:dev`：`loadEnv` → 解析 DeepSeek → 建沙盒目录 → 起 ws-server（**绑固定端口 8787**，`LEEMO_BRIDGE_PORT` 可覆盖）→ 打印端口供确认 | 镜像 `src/gateway/dev.ts`；固定端口而非 ephemeral，renderer 才能用固定默认 URL 连上 |

**核心新逻辑 = 回投 waiters-Map（唯一高风险，必须 TDD）**：
`ApprovalBroker` 需 `ApprovalTransport.request(req): Promise<ApprovalDecision>`。host 实现 =「推 `bridge:approvalRequest` 给 renderer → pending Promise 按 `req.id` 停 Map → renderer 回 `bridge:approvalDecision` invoke 时 resolve」。ask_user 的 `AskUserTransport` 对称（`bridge:askUser` ↔ `bridge:askUserAnswer`）。即 interact.ts 注释所述 NewMax ~80 行 waiters-Map 模式。

⚠️ **签名纪律**：`createApprovalBroker` 现役为 **4 参** `(conversationId, transport, persistence, policy)`。`smoke/bridge-live.mjs` 用的旧 3 参是台账标注的"刻意未改"——host 必须用现役 4 参签名。persistence 本竖切用**内存版**（`getWhitelist:()=>[]`，`addToWhitelist/removeFromWhitelist` noop），SQLite 留 Phase-1。审批策略默认 `DEFAULT_PERMISSION_POLICY`（低摩擦但危险每次问，见 [[approval-ux-philosophy]]）。

### §3.3 `WsBridgeClient`（`src/renderer/bridge/ws-client.ts`，`implements BridgeClient`）

只实现两方法：
- `invoke(channel, req)`：自增 id → 发 `{id, channel, req}` → resolve 停 Map → 收 `{id, response}`（或 `{id, error}`）时结算。
- `subscribe(channel, cb)`：cb 入 `listeners[channel]`；收 server 推的 `{channel, payload}` 逐个回调；返回 unsub。
- 浏览器原生 `WebSocket`，连 `import.meta.env.VITE_LEEMO_BRIDGE_URL ?? 'ws://127.0.0.1:8787'`；断线/重连策略本竖切最小化（打印错误 + 简单一次重连即可，Electron 里由 ipc 取代，不投产）。

## 4. Channel 处理表（host 对 14 个契约 channel 的行为）

| channel | 类型 | host 行为（本竖切） |
|---|---|---|
| `bridge:createConversation` | invoke | 经 `createBridge` 建 Conversation，存 Map；建该对话 broker + ask_user transport；返回 `{conversationId}` |
| `bridge:send` | invoke | **立即 ack（void）**；后台 drain `normalizeSdkStream(handle.send(prompt), ctx)`，逐 event 推 `bridge:event` |
| `bridge:interrupt` | invoke | `handle.interrupt()` |
| `bridge:setModel` | invoke | `handle.setModel(modelId)` |
| `bridge:disposeConversation` | invoke | `handle.dispose()`；清 Map + 该对话 pending waiters |
| `bridge:listProviders` | invoke | 返回 provider-catalog 的 `ProviderSpec[]`（仅 DeepSeek，key-free） |
| `bridge:approvalDecision` | invoke | resolve 对应 `req.id` 的 approval waiter |
| `bridge:askUserAnswer` | invoke | resolve 对应 `id` 的 ask waiter |
| `bridge:fetchBalance` | invoke | **可选**（`balance.ts` 已 live 验证支持 DeepSeek）；不做则返回 `{supported:false}` |
| `bridge:listWhitelist` | invoke | 返回 `[]`（内存无持久化） |
| `bridge:revokeWhitelist` | invoke | noop |
| `bridge:usageSummary` | invoke | Phase-1 reserved：返回 `{byProvider:[],byDay:[]}` |
| `bridge:event` | push | host→renderer：`{conversationId, event}` |
| `bridge:approvalRequest` / `bridge:askUser` | push | host→renderer：waiters-Map 发起端 |

## 5. 数据流（两条验收路径）

**A. 通电快乐路径**：输"你好" → `createConversation`(DeepSeek) → `send` → host drain 流 → `text.delta` 逐个推 → conversations store 折入 → 气泡逐字冒出 → `run.finished` 折叠成页脚（显示 token 数）。

**B. 审批路径（reliably 可诱发）**：说"读一下沙盒里的文件" → 模型调 Read/Bash → SDK 回调 `canUseTool` → broker 推 `bridge:approvalRequest` → 界面弹审批条 → 点"允许一次" → `bridge:approvalDecision` 回投 → 工具执行 → 结果续流。
问询卡路径同构（`bridge:askUser` ↔ `bridge:askUserAnswer`），但 DeepSeek 主动调 ask_user 难稳定诱发 → 接线 + 单测覆盖，live 目验用引导 prompt 尝试，**非硬门槛**。

## 6. 范围边界

**做**：通电 + 审批 canUseTool + 问询卡 ask_user MCP + DeepSeek 直连 + 沙盒 cwd + WsBridgeClient + opt-in flag + host 五文件。

**不做（各留独立 Phase-1 卡）**：
- SQLite 持久化（刷新清零；broker 白名单内存版）
- costSource 修正（footer **只渲染 token 数**，金额无渲染面 → 20-50× 虚高 bug 本竖切不可见，[[bridge-batch-followups]] 留 Phase-1）
- relay2 经网关（第二条路径，DeepSeek 通了再加）
- 真 workspace IPC / 文件树接真盘（PreviewPane/FileTree 仍 fixture）
- Electron 主进程（本 host 已按其形状预留，紧随下一里程碑）

## 7. 验收门槛（铁律：主控亲验，不信执行者报告）

1. `npm test -- --run` **≥548 绿** + `npm run typecheck` **三段 exit 0**（护住地基；改类型的 Task 验证步必含 typecheck，非仅 vitest）
2. host 新代码**严格 TDD 单测**：waiters-Map 回投（approval+ask）、channel 路由、sdk-adapter 组装、provider-catalog 解析
3. `smoke/host-live.mjs`（新 live 卡，不改既有 smoke）：真 DeepSeek 端到端 + **一次真审批往返** PASS。DeepSeek 国内直连**不走代理**（VPN 三件套仅将来测 relay2/中转站才需，见 [[network-env-private-vpn]]）。
4. **主控实机 devtools 目验**：搭子输一句 → 真流式回字 → 诱发一次审批 → 点允许 → 工具跑完；`VITE_LEEMO_LIVE=1 npm run dev` + `npm run bridge:dev` 双进程

## 8. 测试策略与 TDD 边界

- **严格 TDD**（铁律 host/bridge=严格 TDD）：`bridge-host.ts`、`ws-client.ts`（消息相关/id 结算/事件分发，用 fake WS）、waiters-Map、provider-catalog。
- **注入式可测**：bridge-host 注入 `queryFn`（fake 流）+ 抽象 push 通道 + provider 目录，单测零真网络；ws-server 只做传输，集成边界测。
- **live 验证**：`smoke/host-live.mjs` 兜真流量（sdk-adapter/真审批往返/resume）。
- **用户目验**：视觉 + 产品体感（momo 手感、双模式）。

## 9. 风险与已知坑

- **执行者谎报"已接进 app"**（本项目两次教训）→ 主控必真跑 typecheck+full+devtools，不认报告。
- **typecheck 潜伏失败**（vitest 剥类型测不出）→ 每改类型 Task 验证含 typecheck。
- **DeepSeek 诱发工具轮**：用沙盒里预置文件（如 `notes.md` 藏暗号）+ 明确 prompt 诱发 Read/Write（抄 bridge-live 的 CODEWORD 手法）。
- **worktree 基点陷阱**（[[worktree-baseref-gotcha]]）：本仓库无 origin；隔离 worktree 用 `git worktree add -b <br> main` + `EnterWorktree(path)` + `npm install`，勿 `EnterWorktree(name)`。
- **契约冻结面**：`src/bridge/contract.ts` v1.1 是冻结边界；host 只**消费**契约类型，不改。若发现缺字段（如事件归属）→ 走契约加法卡，不在本竖切私改。

## 10. 未来演进（本设计为其铺路）

`src/host/` 形状即未来 Electron 主进程：Electron 里程碑 = 加 electron 依赖 + main/preload/ipcMain，把 `ws-server` 换成 ipc 通道、`WsBridgeClient` 换成 `IpcBridgeClient`，`bridge-host`/`sdk-adapter`/`provider-catalog`/broker/MCP **原样复用**。随后 relay2 经网关（第二 provider）、SQLite、成本修、真 workspace IPC 各自独立卡推进。

---

## 施工批次预判（细化交 writing-plans）

1. **卡 1（Opus，严格 TDD）**：`src/host/` 骨架 —— bridge-host + waiters-Map（approval+ask）+ channel 路由，注入式单测（fake queryFn + fake push）。高风险不可逆判断点。
2. **卡 2（Opus/Sonnet，TDD）**：sdk-adapter（移植 bridge-live recipe）+ provider-catalog + ws-server + dev.ts；`smoke/host-live.mjs`。
3. **卡 3（Sonnet，TDD）**：`WsBridgeClient` + main.tsx flag + context.tsx providers 来源切换；护 548 测试。
4. **集成 + 主控 devtools live 目验 + Opus 终审**。

> 铁律遵守：不 commit/push（除非用户要）；密钥只经 `.env`；派 subagent 显式指定 model；模型分档见 [[model-tier-discipline]]。
