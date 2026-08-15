# 通电竖切实施计划 v2（修正版，废弃 v1）

> 2026-07-24 ／ 设计负责人：Fable 5 主控。执行：卡A=Opus 4.8、卡B=Sonnet 5。
> 设计文档（用户已审批）：`docs/superpowers/specs/2026-07-24-power-on-vertical-slice-design.md`
> **v1 为何废弃**：上一主控会话写到 Task 2 即截断，且含 4 处与实际代码不符的硬伤（见下）。执行者若按 v1 施工必然与真实签名对不上——这就是上会话"反复读签名死循环"的根因。

## v1 的 4 处硬伤（本版已修，执行者不得回退到 v1 写法）

1. **DeepSeek 直连接法错**。v1 写 `apiFormat:"openai"` + `baseUrl:"https://api.deepseek.com/v1"`。真相（`smoke/bridge-live.mjs` live 5/5 实证）：**`apiFormat:"anthropic"` + `baseUrl:"https://api.deepseek.com/anthropic"`**。openai 格式会走 `buildConversationEnv` 的网关分支，无 gatewayPort 直接 throw。
2. **测试位置错**。v1 把 host 测试放 `src/host/*.test.ts`。`vitest.config.ts` 的 projects 只扫 `tests/**/*.test.ts`（node）和 `src/renderer/**/*.test.{ts,tsx}`（jsdom）——src/host 下的测试**永远不会被执行**。host 测试必须放 **`tests/host/`**。
3. **sdk-adapter 不得重建 env**。v1 在适配器里自己调 buildConversationEnv+sanitizeHostEnv。真相：pool 的 `buildOptions()` 已产出完整 env（sanitize + provider env + CLAUDE_CONFIG_DIR），适配器必须**原样透传 `options.env` / `abortController` / `resume`**，只叠加 SDK extras（cwd/canUseTool/mcpServers/…）。重建会绕过密钥剥离与 per-provider CONFIG_DIR。
4. **mcpServers 是 Record 不是数组**。`sdk.d.ts:1669`：`mcpServers?: Record<string, McpServerConfig>`。正确用法：`{ "leemo-ask-user": askMcp.server }`。

## 已核实的现役签名（执行者不必重读，直接信；若发现不符，停下来报告，不许自行改契约）

- `createBridge(deps: {queryFn, dataDir}): Bridge`；`bridge.createConversation({provider, modelId, gatewayPort?}): ConversationHandle`；handle: `id`/`send(prompt):AsyncIterable<SdkMessageLike>`/`interrupt()`/`setModel(modelId)`/`dispose()`/`state`。（src/bridge/pool.ts）
- `createApprovalBroker(conversationId, transport, persistence, policy?): {canUseTool}` —— **4 参**。`ApprovalPersistence` 三方法：`getWhitelist`/`addToWhitelist`/`removeFromWhitelist`（内存版：`[]`/noop/noop）。`DEFAULT_PERMISSION_POLICY = {mode:"acceptEdits", dangerousCommandCaching:false}`。（src/bridge/interact.ts）
- `createAskUserMcp(conversationId, transport, options?): {server, handle, provideAnswer(id,answer):boolean, failAsk(id,reason):boolean}`；`AskUserTransport.ask(payload):Promise<void>`（只负责送达，不等答案——答案走 provideAnswer）。
- `normalizeSdkStream(sdkMessages, ctx: {providerId, modelId, cwd, pricing?}): AsyncIterable<LeemoEvent>`；`resolvePricing(providerId, modelId)`（src/bridge/pricing.ts）。
- 契约（src/bridge/contract.ts，**冻结，零改动**）：14 channel 见 `BRIDGE_CHANNELS`/`BridgeInvokeMap`/`BridgeEventMap`；`bridge:event` 载荷是 **`BridgeEventEnvelope{conversationId, event}`**；`bridge:createConversation` req=`{providerId, modelId, purpose?, gatewayPort?, permissionMode?}` → resp=`{conversationId}`。
- renderer 端口（src/renderer/bridge/client.ts）：`BridgeClient.invoke(channel, req)` / `subscribe(channel, cb): ()=>void`。
- **canUseTool 生效前置**（bridge-live 实证）：prompt 必须是 **AsyncIterable**（流式输入模式）。string prompt 包装成：
  `(async function*(){ yield {type:'user', message:{role:'user', content: prompt}, parent_tool_use_id:null, session_id:''} })()`
- SDK options 里没有 `signal` 字段——取消用 `abortController`（pool 已放进 options，透传即可）。

## 全局约束（两卡通用）

- 基线：66 files / **548 tests** 全绿 + `npm run typecheck` 三段 exit 0。收工时必须 ≥548+新增 全绿、三段 exit 0，执行者亲跑并在报告贴输出。
- **严禁任何 git 操作**（add/commit/stash/checkout 都不行——工作区带着大量未提交的前批次成果，一次误 add 就是事故）。主控统一收尾。
- 密钥只经 `.env`；任何代码/测试/日志不出现真 key；测试用 `test-key-…` 哨兵。
- `package.json` 主控已改好（ws/@types/ws devDeps + `bridge:dev` script），执行者**不碰** package.json/lockfile。
- 禁改清单：`src/bridge/**`、`src/gateway/**`、既有 `smoke/*`、`src/renderer/bridge/fixture-client.ts`、除本卡文件清单外的一切。发现"必须改禁改文件才能做下去"→ 停，写报告。
- 偏差纪律：任何与本计划的偏差（含"计划签名与实际不符"）必须在报告里逐条列出，不许静默变通。

## Wire 协议（两卡共同实现的唯一接缝，逐字对齐）

WebSocket 文本帧，JSON。host 绑 **127.0.0.1**（绝不 0.0.0.0），端口 **8787**（`LEEMO_BRIDGE_PORT` 可覆盖）。

```
renderer → host   {"id": <number>, "channel": "<bridge:invoke channel>", "req": <request payload>}
host → renderer   {"id": <number>, "ok": true,  "response": <response payload>}
host → renderer   {"id": <number>, "ok": false, "error": "<message, 已脱敏>"}
host → renderer   {"channel": "bridge:event"|"bridge:approvalRequest"|"bridge:askUser", "payload": <BridgeEventMap[channel]>}   // 推送帧，无 id
```

判别：有 `id` 的是应答帧，有 `channel` 无 `id` 的是推送帧。未知 channel 的 invoke → `{ok:false, error:"unknown channel"}`。

---

## 卡 A（Opus 4.8）：`src/host/` 五文件 + `tests/host/` + `smoke/host-live.mjs`

### 文件清单（只许动这些）
- 新建 `src/host/provider-catalog.ts`、`src/host/sdk-adapter.ts`、`src/host/bridge-host.ts`、`src/host/ws-server.ts`、`src/host/dev.ts`
- 新建 `tests/host/provider-catalog.test.ts`、`tests/host/sdk-adapter.test.ts`、`tests/host/bridge-host.test.ts`、`tests/host/ws-server.test.ts`
- 新建 `smoke/host-live.mjs`（只写不跑——live 验收主控亲跑）
- 报告：`docs/sdd/host-a-report.md`

注：`src/host` 落在根 tsconfig.json 的 include（`src` 减 vendor/renderer）里，strict + ES2022 + node types，无 DOM——host 代码按此写。

### A1 `provider-catalog.ts`（TDD）

```ts
import type { Provider } from "../bridge/providers";
import type { ProviderSpec } from "../bridge/contract";
export interface CatalogEntry {
  provider: Provider;           // 含真 key，process-in，绝不过线
  spec: ProviderSpec;           // key-free，bridge:listProviders 的返回物
  balanceBaseUrl?: string;      // 余额端点根（DeepSeek: "https://api.deepseek.com"）
}
export function buildCatalog(env: Record<string, string | undefined>): CatalogEntry[]
```

DeepSeek（本竖切唯一 entry；无 `DEEPSEEK_API_KEY` → `[]`）：
- provider：`{id:"deepseek", name:"DeepSeek", category:"cn_official", apiFormat:"anthropic", baseUrl:"https://api.deepseek.com/anthropic", apiKey:env.DEEPSEEK_API_KEY, models:[env.DEEPSEEK_MODEL ?? "deepseek-chat"], modelCapabilities:{[model]:{thinking:false,vision:false}}, envTemplate:{}}`
- spec：同 id/name/category/models，`kind:"deepseek"`、`apiFormat:"anthropic"`、`authMode:"api-key"`、`baseUrl` 同上、`apiKeyUrl:"https://platform.deepseek.com/api_keys"`、`capabilities:{balanceApi:true, modelDiscovery:false, subscriptionPlan:false}`
- 测试必含：`JSON.stringify(spec)` 不含 key；无 key 时空数组；默认模型回退。

### A2 `sdk-adapter.ts`（TDD）

```ts
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { QueryFn } from "../bridge/pool";
export interface ConversationExtras {
  cwd: string;                                   // 沙盒目录
  canUseTool: CanUseTool;                        // broker.canUseTool
  mcpServers: Record<string, unknown>;           // { "leemo-ask-user": askMcp.server }
  maxTurns?: number;                             // 默认 50
}
export function buildQueryFn(extras: ConversationExtras, queryImpl: typeof sdkQuery = sdkQuery): QueryFn
```

行为（逐条测）：
- **透传** pool 给的 `options.env`/`options.abortController`/`options.resume`，一个字节不改不补。
- 叠加：`cwd`、`permissionMode:"default"`、`includePartialMessages:true`、`settingSources:[]`、`maxTurns`（默认50）、`canUseTool`、`mcpServers`。
- string prompt → 包装为 AsyncIterable（形状见上"已核实签名"）；已是 AsyncIterable 则透传。
- 测试用 fake queryImpl 捕获入参断言以上各条（模式抄 v1 Task 2 的 mock 手法，但断言改为"env 透传自 options 而非重建"）。

### A3 `bridge-host.ts`（TDD，本卡核心，waiters-Map 在这）

```ts
export interface HostDeps {
  catalog: CatalogEntry[];
  dataDir: string;          // per-provider CONFIG_DIR 根（pool 用）
  sandboxDir: string;       // SDK cwd（工具落盘处）
  push: <K extends keyof BridgeEventMap>(channel: K, payload: BridgeEventMap[K]) => void;
  queryImpl?: typeof sdkQuery;   // 测试注入 fake
}
export interface BridgeHost {
  handleInvoke<K extends keyof BridgeInvokeMap>(channel: K, req: BridgeInvokeMap[K]["request"]): Promise<BridgeInvokeMap[K]["response"]>;
  dispose(): void;
  /** @internal 测试用：取该对话的 askMcp/broker 内部件 */
  inspect(conversationId: string): { askMcp: AskUserMcp } | undefined;
}
export function createBridgeHost(deps: HostDeps): BridgeHost
```

**每对话装配**（createConversation 时）：
1. 按 `req.providerId` 查 catalog，无 → throw（`{ok:false}` 由 ws 层兜）。
2. `approvalTransport = { request(r){ push("bridge:approvalRequest", r); return new Promise(res => approvalWaiters.set(r.id, {resolve: res, conversationId})); } }`
3. `broker = createApprovalBroker(cid…)` —— 注意：broker 构造需要 cid，但 cid 由 handle.id 产生（后于 broker）。解法：先 `randomUUID()` 不行——handle.id 是 pool 内部生成。**正确顺序**：pool 的 `createConversation` 先行拿 handle → 用 `handle.id` 建 broker/askMcp → 但 queryFn 在 createBridge 时就要闭包 broker……解法：**每对话一个 createBridge**，queryFn 闭包一个可变 `extras` 容器：先 `createBridge({queryFn: lazyQueryFn, dataDir})` → `handle = bridge.createConversation(...)` → 拿 `handle.id` 建 broker+askMcp → 回填容器。lazyQueryFn 内部读容器（send 永远晚于回填，安全）。或者等价方案：自生成 cid 映射表（host 层 id→handle）。二选一，报告里写清选了哪个、为什么。
4. `askTransport = { ask(p){ askOwner.set(p.id, cid); push("bridge:askUser", p); return Promise.resolve(); } }`；`askMcp = createAskUserMcp(cid, askTransport)`。
5. conversations.set(cid, {handle, bridge, broker, askMcp, entry})。

**channel 行为表**：
- `createConversation` → 上述装配，返回 `{conversationId}`
- `send` → 校验 cid；**立即返回 void**；后台 `for await (ev of normalizeSdkStream(handle.send(prompt), {providerId, modelId, cwd: sandboxDir, pricing: resolvePricing(providerId, modelId)})) push("bridge:event", {conversationId, event: ev})`；drain 整体 try/catch，catch 时 push error 事件信封（不许让异常沉默吞掉一轮）
- `interrupt`/`setModel`/`disposeConversation` → 转 handle；dispose 额外：该对话 pending approvalWaiters 全部 resolve 成 `{id, decision:"deny", message:"conversation disposed"}`、askOwner 里属于它的 askMcp.failAsk、清 Map、bridge.dispose()
- `listProviders` → `catalog.map(e => e.spec)`
- `approvalDecision` → `approvalWaiters.get(req.id)` 命中则 resolve+delete；未命中静默（可能已 dispose）
- `askUserAnswer` → `askOwner.get(req.id)` → 该对话 `askMcp.provideAnswer(req.id, req)`；返回 void
- `fetchBalance` → `import { fetchBalance } from "../bridge/balance"`，用 catalog entry 的 provider + `balanceBaseUrl`（先读 balance.ts 确认 deepseek fetcher 怎么拼 URL，喂它期望的 baseUrl 形状；bridge-live 用的是 `https://api.deepseek.com`）
- `listWhitelist` → `[]`；`revokeWhitelist` → void；`usageSummary` → `{byProvider:[], byDay:[]}`
- 未知 channel → throw

**必测清单**（fake queryImpl + 捕获 push）：
① createConversation→listProviders（spec 无 key）②send 即时 ack + 事件按 cid 装信封推送 ③ **审批往返**：fake queryImpl 捕获 options.canUseTool → 测试手动调它 → 断言收到 approvalRequest 推送 → handleInvoke approvalDecision(allow-once) → canUseTool promise resolve 成 allow ④ **问询往返**：经 inspect(cid).askMcp.handle({questions}) → 断言 askUser 推送 → handleInvoke askUserAnswer → handle promise resolve 且文本含所选 label ⑤ deny 路径 ⑥ dispose 后：pending approval 被 deny、再 send throw、事件不再推 ⑦ 两对话并发：A 的审批决定不会 resolve B 的 waiter（id 隔离）。

### A4 `ws-server.ts`（薄传输层，TDD 可用真 ws 绑 127.0.0.1:0）

```ts
export interface WsServerDeps { host: BridgeHost; port: number }
export function startWsServer(deps): Promise<{ port: number; close(): Promise<void>; push: HostDeps["push"] }>
```
- 收帧 → JSON.parse（坏帧丢弃+console.warn）→ `host.handleInvoke(channel, req)` → 回 `{id, ok:true, response}`；throw → `{id, ok:false, error: String(message)}`（**error 文本不得含 key**——host 层错误消息本就无 key，此处不额外扫）。
- `push` 广播到所有活连接（竖切单 renderer，广播即可）。
- 测试：真 ws client 连 127.0.0.1:0：invoke 往返、坏 JSON 不崩、push 到达、close 干净。

### A5 `dev.ts`（入口，`npm run bridge:dev`）

镜像 `src/gateway/dev.ts` 手法：`process.loadEnvFile()`（try/catch）→ `buildCatalog(process.env)`（空则打印指引后退出 1）→ `fs.mkdirSync` 建 `.leemo-workspace/sandbox` 与 `.leemo-workspace/data`（均已 gitignore）→ 组装 `createBridgeHost({catalog, dataDir, sandboxDir, push})` 与 ws-server（push 回环接上）→ 打印 `[bridge:dev] listening on ws://127.0.0.1:<port>`、providers（只打 id）、sandbox 路径 → SIGINT/SIGTERM 优雅关。**永不打印 key**。

### A6 `smoke/host-live.mjs`（只写不跑）

抄 `smoke/bridge-live.mjs` 的子进程手法：spawn `node node_modules/tsx/dist/cli.mjs src/host/dev.ts` → 等 stdout 端口行 → 用 `ws` 包连上 → 依次：listProviders / createConversation(deepseek) / send("读取 notes.md，把其中的暗号原样写入 answer.txt")（先在沙盒预置 `notes.md` 藏暗号）→ 收 approvalRequest 推送后自动回 allow-once → 收流至 run.finished → 断言：text.delta>0、approvalRequests≥1、沙盒 answer.txt 含暗号、usage.final 存在 → 结果 JSON 落 `smoke/results/`（复用 lib.mjs 的 redact）。DeepSeek 国内直连**不设代理**。退出码 0/2。

### 卡 A 验收命令（报告贴全输出）
```
npx vitest run tests/host
npm test          # ≥548+新增 全绿
npm run typecheck # 三段 exit 0
node --check smoke/host-live.mjs
```

---

## 卡 B（Sonnet 5）：`WsBridgeClient` + 实模式 opt-in 接线

### 文件清单（只许动这些）
- 新建 `src/renderer/bridge/ws-client.ts`、`src/renderer/bridge/ws-client.test.ts`
- 新建 `src/renderer/vite-env.d.ts`（内容一行：`/// <reference types="vite/client" />`）
- 修改 `src/renderer/app/App.tsx`、`src/renderer/bridge/context.tsx`、`src/renderer/stores/providers.ts`（及其对应 test 文件的必要断言更新）
- 报告：`docs/sdd/host-b-report.md`

### B1 `ws-client.ts`（TDD，jsdom 下测，fake WebSocket 构造注入）

```ts
import type { BridgeClient } from "./client";
type WsCtor = new (url: string) => WebSocket;
export class WsBridgeClient implements BridgeClient {
  constructor(url?: string, wsCtor: WsCtor = WebSocket) {}
}
```
- url 默认 `ws://127.0.0.1:8787`（App 层再用 env 覆盖，见 B2）。
- `invoke`：自增 id → open 前入队、open 后即发 `{id, channel, req}` → 按 wire 协议 resolve `{ok:true}.response` / reject `Error(error)`。
- `subscribe`：channel→Set<cb>；收推送帧逐个回调；返回 unsub。
- 断线：console.error + **一次** 1s 重连（不投产，Electron 里被 ipc 取代）；重连期间 invoke 继续入队。
- 测试：fake WebSocket 类（可手动触发 open/message/close）覆盖：open 前入队后 flush、id 结算不串、ok:false reject、推送分发、unsub 生效、坏帧忽略。

### B2 实模式 opt-in（改动最小化，548 基线一字不退）

- `App.tsx`：
  ```ts
  const live = import.meta.env.VITE_LEEMO_LIVE === "1";
  const client = useMemo(() => live ? new WsBridgeClient(import.meta.env.VITE_LEEMO_BRIDGE_URL) : undefined, [live]);
  <BridgeProvider client={client}>
  ```
  不传 client 时 BridgeProvider 走 fixture 默认——**默认路径零变化**。
- `context.tsx`：有 `client` prop（live）时：providers store 以空列表创建（`createProvidersStore(c, {})`），useEffect 里调 `refresh()`；`resolveDefaults` live 分支 = `providers.getState().list[0]` 映射 `{providerId, modelId: models[0]}`，列表未就绪时回退 `{providerId:"deepseek", modelId:"deepseek-chat"}`（竖切限定的兜底，报告里注明）。fixture 分支（无 client）**逐字不动**。
- `providers.ts`：`refresh()` 成功时同步 `configuredIds = list.map(p=>p.id)`（host 目录只含已配 key 的 provider，故等价）；补/改对应测试。
- 新增测试：fake client（返回一条 deepseek spec）挂 BridgeProvider → 断言 refresh 被调、providers list 来自 client、fixture 分支不受影响。

### 卡 B 验收命令（报告贴全输出）
```
npx vitest run src/renderer/bridge/ws-client.test.ts src/renderer/stores/providers.test.ts
npm test          # ≥548+新增 全绿（含全部既有 renderer 测试）
npm run typecheck # 三段 exit 0
```

---

## 集成与终验（主控亲做，执行者不管）

1. 复跑 full suite + typecheck 三段。
2. `npm run bridge:dev` + `VITE_LEEMO_LIVE=1 npm run dev` 双进程，devtools 实机目验：输一句→真流式回字→诱发 Read/Write 审批→点允许→工具执行→续流至页脚 token 数。
3. `node smoke/host-live.mjs` live PASS。
4. Opus 4.8 终审 diff。
