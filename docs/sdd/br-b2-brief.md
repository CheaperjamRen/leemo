# Task B2 简报：事件规范化 + usage/cost/pricing + 余额拉取 + 防幻觉抽查

> 来源计划：docs/plans/2026-07-21-bridge-slice.md Task B2。BASE=7e3b716。
> 执行模型：Sonnet 5（规格写死卡）。本卡零 live 调用（fake SDK 消息 + fake fetch 注入）。

## Global Constraints（本批每张卡隐含遵守）

- 新代码只进 `E:\Leemo\`；`smoke/`、`vendor/`、`src/gateway/**`、既有测试禁改（发现网关 bug 报回、不就地修）。
- **严格 TDD**：先失败测试后实现，RED 证据留存；fixture 断言真实值（数字/字符串）而非 mock 自证。
- 类型防火墙：自研代码禁 import `@gateway/vendor/**`。
- 密钥纪律：key 只经 `.env`；日志/快照/commit 零明文 key；测试用假值（`sk-test-...`）。
- 命名：Leemo/momo；禁"幸运鹿/LuckyDeer/Lulu"。
- `npm run typecheck`=两条命令；自研代码在根 tsconfig（ES2022+严格 catch）。
- 禁引 Electron。

## 背景：你在建什么

B1 已建会话池 `src/bridge/pool.ts`：`ConversationHandle.send()` 返回 `AsyncIterable<SdkMessageLike>`——**原样透传 SDK 消息**，泛型 `TMessage` 是你的包装点。你这张卡把 SDK 原始消息流规范化成 `LeemoEvent` 判别联合，供前端渲染（02 v2.0 的工具卡/活动卡/审批条 + 用量 hover 弹窗）。三个新模块：events / pricing / balance，外加 pathAudit。

**SDK 消息真实形状（权威来源 = smoke/checks.mjs，Phase 0 实证，禁臆造）**——你的 fixture 照此构造：

| SDK 消息 | 判别 | 关键字段 | 来源行 |
|---|---|---|---|
| 系统初始化 | `type:'system', subtype:'init'` | `session_id` | checks.mjs:147 |
| 压缩边界 | `type:'system', subtype:'compact_boundary'` | `compact_metadata:{trigger, pre_tokens, post_tokens}` | :155-156 |
| 流式增量 | `type:'stream_event'` | `event:{type:'content_block_delta', delta:{type:'text_delta'\|'thinking_delta', text}}`（SDK partial-message 形状；见下"风险说明"） | :33 |
| 助手轮 | `type:'assistant'` | `message.content:[{type:'tool_use', id, name, input}\|{type:'text', text}]`；`parent_tool_use_id`(存在=子 agent 活动) | :53-54, :105-113 |
| 工具结果 | `type:'user'` | `message.content:[{type:'tool_result', tool_use_id, content, is_error}]`；`parent_tool_use_id`(子 agent) | :114 |
| 结果 | `type:'result'` | `subtype`('success'/'error'), `result`(最终文本), `usage`, `is_error`, `total_cost_usd`(官方端点有值/第三方多为0), `duration_ms` | :38-39, :161-166 |

**usage 对象真实形状**（gateway live result，Phase 0）：`{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, ...}`。经网关时可能带 B0 的回填标记 `leemo_estimated:true`（见下）。

**工具名注意**：子 agent 派生工具真名是 `Agent`（init 列表标 `Task` 是双名，SDK 0.3.210 措辞坐实）。你的 subagent 判定认 `parent_tool_use_id` 存在，不靠工具名。

## 要建的东西

### 1. `src/bridge/events.ts`

**`normalizeSdkStream(sdkMessages: AsyncIterable<SdkMessageLike>, ctx: {providerId, modelId, cwd, pricing?, existsSyncFn?}): AsyncIterable<LeemoEvent>`**

LeemoEvent 判别联合（`type` 判别），至少覆盖：
- `{type:'conversation.started', sessionId}` ← system:init
- `{type:'text.delta', text}` ← stream_event 的 text_delta（**best-effort 流式糖**，见风险说明）
- `{type:'thinking.delta', text}` ← stream_event 的 thinking_delta
- `{type:'text.final', text}` ← result.result（**权威最终文本**）
- `{type:'tool.started', toolUseId, name, input, subagent:boolean}` ← assistant 的 tool_use 块（subagent=有 parent_tool_use_id）
- `{type:'tool.finished', toolUseId, isError:boolean, contentSummary}` ← user 的 tool_result 块
- `{type:'subagent.activity', parentToolUseId}` ← 带 parent_tool_use_id 的 assistant/user 消息
- `{type:'compact.boundary', trigger, preTokens, postTokens}` ← system:compact_boundary
- `{type:'usage.final', usage: UsageRecord}` ← result.usage（经 buildUsageRecord 加工）
- `{type:'run.finished', subtype, isError, finalText, pathAudit: PathAudit}` ← result
- `{type:'error', message}` ← result:error 或流抛异常（严格 catch：`catch(e)` e 是 unknown，用 `e instanceof Error ? e.message : String(e)`）

**结构事件（tool/usage/compaction/run.finished）来自粗粒度消息（assistant/user/result/system）——这些形状我给你钉死了（上表），是承重项**。text.delta/thinking.delta 来自 stream_event，是流式渲染糖。

**UsageRecord 形状（字段面必须能填 08 §四双日志表——proxy_request_logs）**：
```
interface UsageRecord {
  providerId: string;
  modelId: string;
  inputTokens: number;            // usage.input_tokens
  outputTokens: number;           // usage.output_tokens
  cacheReadTokens: number;        // usage.cache_read_input_tokens
  cacheCreationTokens: number;    // usage.cache_creation_input_tokens
  durationMs?: number;            // result.duration_ms（有则取）
  costUsd?: string;               // 6 位小数 TEXT（NewMax 精度）；unpriced 时 undefined
  costSource: 'sdk' | 'local-pricing' | 'unpriced';
  tokensEstimated: boolean;       // 经网关 o200k 回填（见下）
}
```

**cost 计算（NewMax 模式，用户 7/21 拍板）**：`buildUsageRecord(usage, ctx)`：
1. 若 `result.total_cost_usd` 存在且 > 0 → `costUsd = 该值.toFixed(6)`，`costSource='sdk'`（官方 Anthropic 端点，SDK 知真价）。
2. 否则查 pricing 表：`cost = (inputTokens×inPrice + outputTokens×outPrice + cacheReadTokens×cacheReadPrice) / 1_000_000`，`toFixed(6)`，`costSource='local-pricing'`。缓存价缺省=输入价（除非价目表另给）。
3. pricing 表无此 model → `costUsd=undefined`，`costSource='unpriced'`。
4. `tokensEstimated`：读 `usage.leemo_estimated === true`（B0 回填时挂的标记，见风险说明）。

**`auditClaimedPaths(finalText: string, cwd: string, existsSyncFn = fs.existsSync): PathAudit`**（08 §三纪律③；Phase 0 硬发现=模型臆造 cwd 外绝对路径）：
- 从 finalText 抽路径样式 token（Windows `X:\...` 与 Unix `/...` 与相对 `./ ../`；反引号/引号包裹的也抽）
- 每个 existsSyncFn 检查 + 判是否在 cwd 内（path.resolve 后 startsWith cwd）
- 返回 `PathAudit = { claimed: Array<{path, exists:boolean, withinCwd:boolean}> }`
- withinCwd=false 是工作区逃逸信号（Phase 0 模型在 E:\Users\... 建目录树的那类）

### 2. `src/bridge/pricing.ts`

**`resolvePricing(providerId, modelId, overrides?): ModelPricing | undefined`**，`ModelPricing = {inputPerMTok:number, outputPerMTok:number, cacheReadPerMTok?:number}`（单位=美元/百万 token）。

- 内置占位常量表：覆盖直连三家的当前主力模型（deepseek-chat、glm-5.2、kimi-k2.5——名以 .env 的 *_MODEL 为准，见下）+ relay 的 gpt-5.6-luna。
- **执行者职责**：从各家官网/文档查当前价（DeepSeek/GLM/Kimi 官方定价页），报告里逐条列出**价格值 + 出处 URL + 查询日期**。查不到的（如中转站 gpt-5.6-luna 价格不透明）→ 该 model 不进表（resolvePricing 返回 undefined → costSource='unpriced'）。查外网需挂 VPN 代理（见 CLAUDE.md：仅外网设 http_proxy/https_proxy=127.0.0.1:10801）。
- overrides 参数：调用方注入覆盖（Phase 1 会从 Provider 目录喂真价目；本卡内置表是占位）。
- 表结构注释写明"占位常量，正式维护随 Provider 目录=Phase 1"。

### 3. `src/bridge/balance.ts`（用户 7/21 新增拍板：余额从官方 API 拉取）

**`fetchBalance(provider: {id, apiFormat, baseUrl, apiKey}, deps:{fetchFn}): Promise<BalanceInfo>`**，`BalanceInfo = {supported:boolean, totalUsd?:number, totalCny?:number, granted?:number, toppedUp?:number, raw?:unknown}`。

- **DeepSeek 必做**：`GET https://api.deepseek.com/user/balance`，header `Authorization: Bearer <key>`，解析响应（DeepSeek 返回 `{is_available, balance_infos:[{currency, total_balance, granted_balance, topped_up_balance}]}`——执行者查官方文档核实字段名，报告列出处）。
- GLM/Kimi：查各官网文档，有公开余额端点则实现、无则该 provider 返回 `{supported:false}`。报告列出每家的结论与出处 URL。
- fetchFn 注入（测试用 fake，零 live）；网络错误/非 2xx → `{supported:false, raw:错误摘要}`（脱敏，不带 key）。
- 今日/7 天用量汇总**不在本卡**（需 SQLite=Phase 1）；其契约类型由 B3 的 contract.ts 预留。你只做即时余额拉取。

## 测试要求

`tests/bridge/events.test.ts` + `pricing.test.ts` + `balance.test.ts`：
- **events**：fixture 照上表真实形状构造（一条完整流：system:init → stream_event×N → assistant(tool_use) → user(tool_result，部分带 parent_tool_use_id) → assistant(parent_tool_use_id=子agent) → result(usage+result+success)）。断言：事件序列逐类型映射、Agent 工具经 parent_tool_use_id 归 subagent.activity、compact_boundary 透传数值（pre/post_tokens）、text.final 取 result.result、cost 公式与 6 位精度、**tokensEstimated 两分支**（usage 带 leemo_estimated=true → true；不带 → false）、**costSource 三分支**（sdk/local-pricing/unpriced）、pathAudit 真路径(exists+withinCwd)/假路径(不存在)/cwd 外路径(withinCwd=false) 三例。
- **pricing**：内置表命中、未命中返回 undefined、overrides 覆盖生效。
- **balance**：DeepSeek 响应形状解析（fake fetch 喂真实响应 JSON 形状）、不支持的 provider 返回 supported:false、网络错误路径不抛且不含 key。
- 断言值不空转（复审会抽读）。

## 风险说明（遇到就按此处理，别自行发挥）

1. **stream_event 内部形状**：includePartialMessages 下 SDK 把原始 Anthropic SSE 包在 stream_event 里。我给的 `event.delta.text_delta` 是 SDK 文档形状但本卡无 live 佐证。**防御写法**：text.delta 映射走可选链（`m.event?.delta?.type==='text_delta' && m.event.delta.text`），路径不匹配就跳过——不要让 text.delta 的形状假设影响承重的结构事件。B4 live 会确认真实形状，若不同=B4 findings，不是你的锅。
2. **leemo_estimated 是否流穿到 result.usage**：B0 在网关的 message_delta.usage 挂 `leemo_estimated:true`。CC SDK 聚合 message_delta.usage 成 result.usage 时，这个非标字段**是否存活未经 live 验证**。本卡按"若 usage 上存在该字段则读，缺省 false"实现（前向兼容、可测），B4 live 验证真实流穿。报告里明确标注这是待 B4 验证的假设。
3. 若发现需要触 B1 的 pool.ts 改动才能接线（如 send 泛型不够用）→ 优先在 events.ts 侧用 `as`/包装解决；确实需要改 B1 → 报告 concern，别就地改（B1 已过审）。

## 禁改清单
smoke/；vendor/；src/gateway/**；src/bridge/pool.ts + providers.ts（B1 已过审，只读）；tests/gateway/**；tests/bridge/pool.test.ts + providers.test.ts；tsconfig*/vitest.config.ts；CLAUDE.md；docs/NewmaxAI逆向报告/。

## Steps
1. LeemoEvent 类型 + 逐事件映射 TDD（fixture 驱动，先 RED）
2. pricing.ts（含官网查价，报告列出处）+ buildUsageRecord cost/estimated TDD
3. balance.ts per-provider（先查官方文档定支持面）+ fake fetch TDD
4. auditClaimedPaths TDD；全绿 → Commit `feat(bridge): SDK event normalization, usage/cost/pricing, balance fetch, claimed-path audit`

## 验收命令
`Set-Location E:\Leemo; npm test; npm run typecheck`（验收方核对：UsageRecord 字段⊇proxy_request_logs 需求；fixture 来源真实非玩具；价目/余额端点出处可溯源；estimated 两分支+costSource 三分支非空转）

## 报告
写到 `docs/sdd/br-b2-report.md`：LeemoEvent 全 variant 清单、SDK→Event 映射表、UsageRecord 字段↔双日志表对照、pricing 查价结果（值+URL+日期）、balance 各家支持面结论（+出处）、estimated/costSource 分支证据、RED/GREEN 证据、pathAudit 三例、风险①②的处理与待 B4 验证项、文件清单、自查、concerns。
