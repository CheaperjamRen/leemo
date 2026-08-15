# Task B4 报告：Bridge Live E2E（收官验证）

> 简报：`docs/sdd/br-b4-brief.md`。BASE=424be24。执行模型 Opus 4.8（唯一打真网 live 卡）。
> 结果：`smoke/results/bridge-live-2026-07-21T16-11-30-360Z.json`（7/7 PASS，clean run）。
> 首跑 `...16-10-12`（6/7，c4 harness 误判，见下）保留作 provenance。

## 一、运行设计

### bootstrap（抄 gateway-live）
- **网关**：子进程 `spawn(node, [tsx/cli.mjs, src/gateway/dev.ts])`，解析 stdout 端口（dev.ts 自带 alias-hook 读 vendor + 自 `loadEnvFile` 读 `.env` 拿 RELAY2_*）。与 gateway-live 同款，不改原文件（新增独立重实现）。
- **bridge TS 模块**：**内嵌 tsx loader**——`register()`（`tsx/dist/esm/api/index.mjs`）后 `import()` `src/bridge/*.ts`（in-process）。bridge 不碰 vendor，只需 TS→JS 转译，无需 alias-hook。预检已验：6 模块导出全部可加载。
- **脱敏**：`lib.redact`（扫 runner `process.env` 里 `*_API_KEY/*_TOKEN` 逐字替换）+ `sk-/Bearer` 形状正则兜底（`redactHard`）。本 runner `loadEnv()` 读入了 DEEPSEEK/RELAY2 key，故 redact 全程逐字擦除。

### 真 SDK → pool.QueryFn 适配
- `query({prompt, options})` 适配为 `(params)=>AsyncIterable<SdkMessageLike>`（SDK message 是 SdkMessageLike 子类型，原样透传）。
- **QueryOptions→SDK Options**：pool 只给 `env`/`abortController`/`resume`（字段名以 `sdk.d.ts` 为准：`abortController` 无 `signal`；`resume` 为 string），适配器按 provider id（从 `CLAUDE_CONFIG_DIR` basename 派发）补齐每对话 extras：`cwd`/`canUseTool`/`includePartialMessages:true`/`permissionMode`/`settingSources:[]`/`maxTurns`。
- **string prompt 升流式输入**：仅当需要 canUseTool/控制请求时（对话 A），把 `send()` 的 string prompt 包成单条 `{type:'user',...}` 流式输入（复用 `lib.u`，checkMultiturn 已验证的形状），以启用真 SDK 的 canUseTool 回调；对话 B（纯文本）原样走 string（checkStreaming 同款已验路径）。**不改 pool.ts**（B1 冻结）——升级发生在适配器层。
- 单一 `queryFn`/单一 `createBridge` 服务两对话，靠 env 里的 `CLAUDE_CONFIG_DIR` 派发 extras + 捕获实际下发 env（隔离 dump 的 ground truth）。

### 两对话（同一 createBridge，并发 send）
- **A = DeepSeek 直连**：apiFormat anthropic，baseUrl `https://api.deepseek.com/anthropic`，真 key 走 `ANTHROPIC_AUTH_TOKEN`（直连语义）。round1=Read notes.md→Write answer.txt 工具轮 + 记暗号；round2=resume 召回暗号。
- **B = relay2 经网关**：apiFormat openai，起 G3 网关拿 port，占位 token `leemo-gw:relay2`。round1=数 1..5 流式文本。
- `Promise.all([driveA, driveB])` 并发，验隔离与并发无串扰。

## 二、核心 7 条逐条证据（7/7 PASS）

1. **双接线事件流完整 — PASS**：A 事件序列 `conversation.started → thinking.delta×N → (tool.started/tool.finished)×… → text.delta×43 → usage.final → text.final → run.finished(success)`，工具 `Read/Glob/Read/Write`，answer.txt 实写 `MOMO-7413`。B `conversation.started → text.delta×9 → usage.final → text.final(“1\n2\n3\n4\n5”) → run.finished(success)`。
2. **usage.final 非零 + cost — PASS**：DeepSeek `inputTokens=21821, outputTokens=402, costUsd=$0.162483, costSource=sdk`；relay2 经网关 `inputTokens=18828(>0), costUsd=$0.094465, costSource=sdk`。**结清"经网关 usage 全零"**（§七旧观察）——B0 修复已生效。
3. **tokensEstimated 结论 — PASS(已观测)**：relay2 经网关 `tokensEstimated=false, costSource=sdk`。结论见 §三.2。
4. **密钥隔离 — PASS**：relay2 子进程 env dump（ground truth，实际下发给 query）：`ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`、`ANTHROPIC_AUTH_TOKEN=leemo-gw:relay2`、`ANTHROPIC_API_KEY=""`、`has_RELAY2_API_KEY=false`、`has_DEEPSEEK_API_KEY=false`(兄弟 key 亦剥)、`keyShapedValues=[]`。DeepSeek 直连 env：`ANTHROPIC_AUTH_TOKEN` 含真 key（直连语义，允许），但无兄弟 `RELAY2_API_KEY`（sanitizeHostEnv 效果）。
5. **审批桥 live — PASS**：`permissionMode=default` 逼真 SDK 回调 canUseTool；broker（default policy=full ask flow）→ fake transport 收到 **2** 个 ApprovalRequest（Read/Write），返回 allow-once，工具经审批放行后真的执行。**证 canUseTool 适配器与真 SDK 签名兼容 + 审批往返 live 可用**。
6. **resume 续轮召回 — PASS**：A round2（pool 自动把 round1 的 session_id 作 resume 下传）finalText=`MOMO-7413`，success。
7. **CONFIG_DIR 隔离 — PASS**：`<dataDir>/providers/deepseek/` 与 `.../relay2/` 各自落盘、路径互异。

### c4 首跑 FAIL 的归因（诚实记录）
首跑 c4 FAIL：`keyShapedValues=[GLM_MODEL]`。根因=harness 的 key-shape 正则 `/^(sk|xai|gsk|glm)[-_]/` 把 `GLM_MODEL` 的值 `glm-5.2`（**模型名**）误判为密钥。**非真泄漏**（四项真-key 断言全绿，无任何 provider key 进 relay2 子进程）。归因=**harness 启发式过宽**，收紧为「排除 `_MODEL/_URL/_BASE_URL` 配置变量名 + key-shape 前缀分支要求值长 ≥20（真 key 都很长）」后复跑 `keyShapedValues=[]`，c4 PASS。B1 `sanitizeHostEnv` 本身正确（`GLM_MODEL` 非密钥形名，正确保留）。此为唯一 harness 缺陷，已修，非 src/ 问题。

## 三、三累积假设观测事实

1. **risk#1 — stream_event→text.delta 确实产出**：直连 43 个 text.delta（+ thinking.delta，证 `thinking_delta` 分支亦命中）；网关 9 个 text.delta。events.ts 的防御式可选链在真 SDK `content_block_delta`/`text_delta` 形状下正确命中，未因任何形状偏移抛错或影响结构事件。**risk#1 关闭：映射真实有效。**
2. **risk#2 — leemo_estimated 不流穿 result.usage，UsageRecord.tokensEstimated=false**：relay2 经网关最终 `tokensEstimated=false`、`inputTokens=18828`（非零）、`costSource=sdk`。观测事实——真 SDK 的 `result.usage` 取**流末** message_delta 的真实 usage 聚合，B0 挂在 **message_start** 的 `leemo_estimated:true` 估值标记**不进入** result.usage（被最终真值取代/被聚合剥离）。**这是有效结论**：`buildUsageRecord` 读 `usage.leemo_estimated===true`，真 SDK 下该字段不在 result.usage → 落 `false`，属正确行为。与 §七"usage 全零"对照——B0 让经网关 usage 恢复非零，且最终即真值故本就不该标估算。**risk#2 关闭。**
3. **compaction（B0 concern）— 未主动触发，留观测**：自动压缩需堆 10 万+ tokens（成本高），本 live 卡不烧。手动 `/compact` 经网关的压缩管线在 §七 checkCompaction 实测 PASS（boundary+召回存活），证管线经网关可用；估值驱动的**自动触发**保真度留待专门压测卡（非阻断，不卡 PASS）。

## 四、密钥隔离 dump / 泄漏扫描

- 隔离 dump 见 §二.4（结果 JSON `isolation` 字段，ground truth = 实际下发给 query 的 env）。
- 泄漏扫描：`Select-String -Path smoke\results\*.json -Pattern 'sk-[a-zA-Z0-9]{8}'` → **零命中**（覆盖两次运行全部结果文件）。结果双层脱敏。

## 五、best-effort 探测

- **DeepSeek 余额 — PASS**：`fetchBalance(deepseek)` → `supported=true, totalCny≈25.5, toppedUp≈25.5`。实证 balance.ts 对 `/user/balance`（字符串金额→Number）响应形状假设正确。
- **ask_user MCP live — 未触发**：未接入 live 模型（诱发不稳定 + 会干扰工具轮判定）；往返已在 B3 fake 测覆盖。

## 六、concerns（记回，不就地修 src）

- **relay2 经网关 `costSource=sdk` 但 relay 真实转售价不可知**（**B2/events.ts 后续整改点**）：pricing.ts 故意不收 relay 转售价，但经网关时 SDK 对 `claude-` 伪装模型按内置 Anthropic 价目算出 `total_cost_usd>0`，events.ts 规则①遂标 `costSource=sdk`——其前提"官方端点 SDK 已知真价"**对网关接线不成立**，展示价失真。建议 Phase 1 成本采集对**网关接线**对话抑制/覆盖 SDK cost（改 local-pricing 或标 unpriced）。非 Bridge/网关 bug（events.ts 按既定规则执行），仅语义缺口。
- 未发现阻断性 Bridge/网关 bug；未改任何 src/**、.env、tsconfig。

## 七、文件清单

- 新增：`smoke/bridge-live.mjs`（runner，唯一新增 smoke 资产）。
- 追加：`docs/reports/phase0-report.md` §八；本报告 `docs/sdd/br-b4-report.md`。
- 结果（不入 commit，本地资产）：`smoke/results/bridge-live-*.json`。
- 未改：src/**、.env、vendor/、tsconfig*、其余 smoke/ 文件。

## 八、结论

**Bridge 竖切 Live 验收 PASS（7/7）。** 真 SDK `query()` 经 pool 注入、events.ts 归一、interact.ts canUseTool 适配、providers.ts sanitizeHostEnv 隔离，四模块经真端点（DeepSeek 直连 + relay2 网关）端到端跑通；双对话并发无串扰；三累积假设全部结清（risk#1 产出/risk#2 不流穿/compaction 留观测）。Bridge 批收官。
