# Task B1 简报：Bridge 会话池核心

> 来源计划：docs/plans/2026-07-21-bridge-slice.md Task B1。BASE=073170e。

## Global Constraints（本批每张卡隐含遵守）

- 新代码只进 `E:\Leemo\`；`smoke/` 旧文件、`vendor/`、`src/gateway/**` 禁改（网关 bug 报回 B0 追加卡，不就地修）。
- **严格 TDD**：先失败测试后实现，RED 证据留存；fake 注入的测试必须断言行为而非 mock 自证。
- 类型防火墙：禁 import `@gateway/vendor/**`。
- 密钥纪律：key 只经 `.env`；日志/快照/commit 零明文 key；**测试中的"真 key"一律用假值（如 `sk-test-...`）**。
- 命名：Leemo/momo；禁"幸运鹿/LuckyDeer/Lulu"。
- `npm run typecheck`=两条命令；自研代码在根 tsconfig（ES2022+严格 catch）。
- 禁引 Electron；本卡零 live 调用（fake queryFn）。
- SDK API 面：**开卡先读 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 核实签名再写测试，d.ts 为准，禁臆造**。已核实事实：query({prompt, options}) 返回 AsyncGenerator；options 含 resume/abortController(或 signal——以 d.ts 为准)/canUseTool/mcpServers/systemPrompt/permissionMode/env/cwd/maxTurns；SDK 工具真名 Agent（init 列表双名 Task）；resume 在第三方端点可靠（Phase 0+G4 实证）→ resume 优先，重放降级只留接口不实现（YAGNI）。

## 任务卡（计划原文）

**Files:**
- Create: `E:\Leemo\src\bridge\pool.ts`（`createBridge(deps: {queryFn, dataDir, registryFactory?})` → `{ createConversation(cfg): ConversationHandle, dispose() }`；ConversationHandle=`{id, send(prompt): AsyncIterable<LeemoEvent 原料——本卡先透传 SDK 消息，B2 才规范化>, interrupt(), dispose(), state}`；每对话持有 `{providerId, modelId, sessionId?}`；send 内部构造 env（direct: ANTHROPIC_BASE_URL/AUTH_TOKEN=真key/模型 4 槽位别名；gateway: BASE_URL=127.0.0.1:port/AUTH_TOKEN=leemo-gw:<id>）+ `CLAUDE_CONFIG_DIR=<dataDir>/providers/<providerId>/`（目录确保存在）；resume：首轮后存 sessionId，续轮带 resume；中途换模型=下一轮 env 生效）
- Create: `E:\Leemo\src\bridge\providers.ts`（Provider 目录类型（06 §3.1 形状：id/name/category/apiFormat/baseUrl/models/modelCapabilities/envTemplate）+ env 构造纯函数 `buildConversationEnv(provider, modelId, gatewayPort?)`——独立可测）
- Test: `tests\bridge\pool.test.ts` + `providers.test.ts`（fake queryFn 捕获收到的 options/env 断言：双接线 env 正确性、**网关模式 env 无真 key**、CONFIG_DIR 按 provider 隔离且并发两对话互不串、resume 传递、interrupt 触发 abort、dispose 清理、换模型下轮生效）+ fixtures（Phase 0 真实消息形状节选，可参考 tests/gateway/fixtures 与 smoke/results 结构，不含 key）

**设计澄清（控制方决定）：**
- send 返回值本卡=SDK 消息原样的 AsyncIterable（B2 接管规范化）；ConversationHandle 类型上给 B2 留好泛型/包装点即可，不要提前实现 LeemoEvent。
- env 构造语义（06 §3.2）：direct 模式 `ANTHROPIC_BASE_URL`=provider.baseUrl、`ANTHROPIC_AUTH_TOKEN`=真 key、4 槽位别名（ANTHROPIC_MODEL/_SONNET/_HAIKU/_SUBAGENT 按 envTemplate 映射，缺省全指 modelId）；gateway 模式 BASE_URL=`http://127.0.0.1:<gatewayPort>`、AUTH_TOKEN=`leemo-gw:<providerId>`、模型别名=`claude-<modelId>`（对齐 G3 /v1/models 的 claude- 前缀语义）。
- key 来源：cfg/provider 对象携带（内存传入），pool 不读 .env（宿主的事）。
- CONFIG_DIR 隔离：目录不存在则 mkdir recursive；同 provider 两对话共享同 CONFIG_DIR（隔离粒度=provider，NewMax 验证的语义），不同 provider 必须不同目录。
- interrupt：用 AbortController（挂到 queryFn options 的对应字段，以 d.ts 实名为准）；interrupt 后 handle 可再 send（新一轮）。dispose 后 send 抛错。
- state 最小面：`'idle'|'running'|'disposed'` 即可。

**禁改清单：** smoke/；vendor/；src/gateway/**；tests/gateway/**；tsconfig*/vitest.config.ts（tests/bridge 已被 vitest include `tests/**/*.test.ts` 覆盖，无需改配置）。

**Steps:**
1. providers.ts env 构造纯函数 TDD（direct/gateway/别名槽位/模型能力表）
2. pool.ts 生命周期与隔离 TDD（fake queryFn）
3. 全绿 → Commit `feat(bridge): conversation pool with dual-wiring env construction and per-provider isolation`

**验收命令：** `Set-Location E:\Leemo; npm test; npm run typecheck`（验收方抽读：网关模式无真 key 断言、并发隔离断言非空转）

## 报告

写到 `docs/sdd/br-b1-report.md`：sdk.d.ts 核实结论（实名签名摘录）、实现摘要、RED/GREEN 证据、文件清单、自查、concerns。
