# Task B1 报告：Bridge 会话池核心

> BASE=073170e。执行者=Opus4.8。零 live 调用（fake queryFn 注入）。

## 1. sdk.d.ts 核实结论（实名签名摘录）

开卡第一动作，读 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`（v0.3.210，锁定）。实名摘录：

- **query 签名**（L2535）：
  ```ts
  export declare function query(_params: {
      prompt: string | AsyncIterable<SDKUserMessage>;
      options?: Options;
  }): Query;
  ```
- **Query 返回**（L2231）：`export declare interface Query extends AsyncGenerator<SDKMessage, void>` —— 即计划所述 AsyncGenerator。含 `interrupt(): Promise<...>`、`setModel(model?): Promise<void>`、`setPermissionMode(...)`（仅 streaming-input 模式可用）。
- **中断机制**（L1288）：`abortController?: AbortController;` —— **`Options` 上无 `signal` 字段**（全量 grep `signal?:` 只命中 `OnElicitation`/`OnUserDialog` 回调的入参，非 query option）。∴ 简报"abortController 或 signal——以 d.ts 为准"的分歧**判定为 `abortController`**。pool 用 `new AbortController()` 挂到 `options.abortController`，`interrupt()`/`dispose()` 调 `.abort()`。
- **resume**（L1764）：`resume?: string;`（"Session ID to resume"）。与 `continue` 互斥。
- **env**（L1412）：`env?: { [envVar: string]: string | undefined; };` —— d.ts 明写 **"REPLACES the subprocess environment entirely — spread process.env yourself"**。∴ pool 在 `buildOptions()` 里 `...process.env` 先铺底再叠加。
- **cwd**（L1350）/ **model**（L1674）/ **sessionId**（L1770）/ **maxTurns**（L1639）/ **permissionMode**（L1700）/ **mcpServers**（L1669）/ **canUseTool**（L1341）均如计划所述存在（本卡只用 env/abortController/resume）。
- **SDKMessage**（L3916）判别联合含 `SDKSystemMessage`（subtype `init`，携 `session_id`/`model`）、`SDKAssistantMessage`（携 `session_id`）、`SDKResultMessage`（`SDKResultSuccess`：`session_id`/`result`/`usage: NonNullableUsage`/`total_cost_usd`）。pool 只读 `type`+`session_id`（结构子集 `SdkMessageLike`），其余透传给 B2。

**无与简报冲突之处。** 唯一需拍板的分歧（abort 字段名）已由 d.ts 实名确定为 `abortController`。

## 2. 实现摘要

两个自研模块（根 tsconfig 严格区，ES2022+严格 catch）：

### src/bridge/providers.ts
- `Provider` 类型（06 §3.1 形状：id/name/category/apiFormat/baseUrl/apiKey/models/modelCapabilities/envTemplate）+ `ModelCapabilities`/`EnvTemplate`/`ConversationEnv`。
- **`buildConversationEnv(provider, modelId, gatewayPort?)` 纯函数**（不读 process.env/.env/磁盘，不改入参，每次返新对象）：
  - direct（apiFormat=anthropic）：`ANTHROPIC_BASE_URL`=provider.baseUrl、`ANTHROPIC_AUTH_TOKEN`=真 key、4 槽位（ANTHROPIC_MODEL / _DEFAULT_SONNET / _DEFAULT_HAIKU / CLAUDE_CODE_SUBAGENT）缺省全指 modelId，envTemplate 可覆盖单槽。
  - gateway（apiFormat=openai）：`ANTHROPIC_BASE_URL`=`http://127.0.0.1:<port>`、`ANTHROPIC_AUTH_TOKEN`=`leemo-gw:<providerId>`、4 槽位=`claude-<modelId>`（对齐 G3 /v1/models）；**gatewayPort 缺失即抛错**（不静默产出 `:undefined`）。
  - 两模式均 `ANTHROPIC_API_KEY=""`（防环境里的 ANTHROPIC_API_KEY 盖过 AUTH_TOKEN，承 Phase 0 buildEnv）。

### src/bridge/pool.ts
- `createBridge(deps:{queryFn,dataDir,registryFactory?})` → `{createConversation(cfg), dispose()}`。
- `ConversationHandle<TMessage=SdkMessageLike>`：`{id, send(prompt), interrupt(), setModel(id), dispose(), state}`。**泛型 `TMessage` 是 B2 的包装点**（B1 产 `SdkMessageLike` 原料，B2 重定为 `LeemoEvent`）。
- 每对话持 `{provider, modelId, sessionId?, currentAbort?, state}`。
- `send()`：同步 `buildOptions()`（新建 AbortController、`mkdirSync(configDir,{recursive})`、`...process.env`+`buildConversationEnv`+`CLAUDE_CONFIG_DIR=<dataDir>/providers/<id>/`、有 sessionId 则带 resume），再返回 async generator：迭代 queryFn 流、逐条捕获 `session_id` 存 sessionId、透传消息；disposed 时 send 抛错。
- `interrupt()`=`currentAbort.abort()`（之后可再 send）；`setModel()`=改 modelId（下轮 env 生效，非回溯）；`dispose()`=置 disposed+abort，bridge.dispose() 级联全对话。
- state 机 `idle|running|disposed`；state 写经 `setState()` 走一层方法，避免 TS 把字段 CFA 窄化成字面量（见 §4 typecheck 记录）。

CONFIG_DIR 隔离粒度=provider：同 provider 两对话共享 `providers/<id>/`，不同 provider 必不同目录。

## 3. RED / GREEN 证据

严格 TDD，先失败后实现：

| 步骤 | RED | GREEN |
|------|-----|-------|
| providers.ts | `Cannot find module '../../src/bridge/providers'`（写测试时模块不存在） | 13 passed |
| pool.ts | `Cannot find module '../../src/bridge/pool'` | 11→12 passed（补 running/mid-stream-dispose 用例后 12） |

- 全量：`npx vitest run` → **18 files / 110 passed**（85 基线 + 25 新：13 providers + 12 pool）。
- typecheck：`npm run typecheck`（`tsc -p tsconfig.vendor.json && tsc -p tsconfig.json`）→ **两条全过**。
- pool.test.ts 连跑 3 次均 11/11（并发排序断言不 flaky）。

### 卡片要求断言逐条落位（值断言，非 truthiness）
- 双接线 env 正确性：direct `ANTHROPIC_BASE_URL`=`https://api.deepseek.com/anthropic`、AUTH_TOKEN=真 key、MODEL=modelId；gateway BASE_URL=`http://127.0.0.1:61340`、AUTH_TOKEN=`leemo-gw:relay2`、MODEL=`claude-gpt-5.6-luna`。
- **网关模式 env 无真 key**：遍历 env 全值断言 `not.toContain(relay2.apiKey)`（fixture 特意给 relay2 带 `sk-test-relay-SHOULD-NEVER-LEAK-...` 使之为真泄漏测试）。
- CONFIG_DIR 按 provider 隔离 + 并发两对话互不串：断言 `providers/deepseek` vs `providers/glm` 落盘存在且不等、resume 各归各 session、AUTH_TOKEN 各归各 key（非空转：四次 call 的 env 逐一核对）。
- resume 传递：首轮 `resume===undefined`、次轮 `resume==='sess-777'`。
- interrupt 触发 abort：`abortController.signal.aborted===true`、流收束 done；且 interrupt 后可再 send（次轮带 resume）。
- dispose 清理：dispose 后 `state==='disposed'`、send 抛 `/dispos/i`；bridge.dispose 级联。
- 换模型下轮生效：轮1 env MODEL=v4pro，setModel(v4flash) 后轮2 MODEL=v4flash（含 SUBAGENT 槽），轮1 已捕获 env 不被回溯改。
- 附加：running 态可观测 + mid-stream dispose 不被 finally 冲回 idle。

## 4. 文件清单

- **新增** `src/bridge/providers.ts`（Provider 类型 + buildConversationEnv 纯函数）
- **新增** `src/bridge/pool.ts`（createBridge/ConversationHandle/生命周期/双接线/隔离/resume）
- **新增** `tests/bridge/providers.test.ts`（13）
- **新增** `tests/bridge/pool.test.ts`（12）
- **新增** `tests/bridge/fixtures/providers.ts`（Provider fixtures，`sk-test-…` 假值）
- **新增** `tests/bridge/fixtures/sdk-messages.ts`（Phase 0 形状的 init/assistant/result 流）

禁改清单零触碰：smoke/、vendor/、src/gateway/**、tests/gateway/**、tsconfig*/vitest.config.ts、.env、CLAUDE.md 均未改（git status 仅 `src/bridge/`+`tests/bridge/` 两个新 untracked 目录）。

## 5. typecheck 记录（一处 CFA 修正）

首次 typecheck 报 `pool.ts TS2367: comparison '"running"' and '"disposed"' have no overlap`。根因：`this._state = "running"` 直接赋值后 TS 把字段窄化为字面量 `"running"`，令 finally 里的 `!== "disposed"`（dispose() 可在流迭代中途置真）看似恒假。修法：state 写一律经 `setState(s: ConversationState)` 方法，字段保持声明类型。非放宽类型、非 any，属正解。

## 6. 自查

- 卡片每条断言均存在且为值断言（见 §3 表）。网关无真 key 断言遍历 env 全值、并发隔离断言逐 call 核对——非空转。
- 无真 key 形状串：仅 `sk-test-…` 假 sentinel（简报明许）；广义 `(sk|xai|gsk|glm|Bearer)[-_]{12,}` 扫描 src/bridge+tests/bridge 只命中这些假值。
- 严格 catch 合规（pool.ts 唯一 catch 在 fixtures cleanup 的 `catch {}`，无变量）；无 Electron import；无 vendor/gateway import（providers/pool 只 import node 内置 + 自身 providers）。
- fixtures 真实（Phase 0 消息形状：system:init→assistant text block→result:success，共享 session_id），非玩具。
- resume 优先、重放降级未实现（YAGNI，简报要求）。

## 7. Concerns

1. **`registryFactory` 本卡未用**：简报的 createBridge deps 签名含 `registryFactory?`，但 B1 不起真网关（gatewayPort 由 ConversationConfig 每对话注入）。故留为 `registryFactory?: unknown` 占位，B4 live 接真网关时定型。非阻断，属接口预留。
2. **send 的 prompt 目前是 `string`**：Handle 类型 `send(prompt: string)`。SDK query 的 prompt 支持 `string | AsyncIterable<SDKUserMessage>`（streaming-input 模式，interrupt/setModel/setPermissionMode 等控制方法**仅在 streaming-input 下可用**）。B1 fake 注入下 string 足够且所有断言通过；**B4 接真 SDK 时，若要用 Query.interrupt()/setModel() 控制方法，需改走 streaming-input（AsyncIterable prompt）**——本卡的 interrupt 语义用 abortController 实现（d.ts 确认可用、不依赖 streaming-input），故不阻断，但记此为 B4 的接线注意点。
3. 无其它阻断项。
