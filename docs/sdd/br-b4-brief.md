# Task B4 简报：Bridge Live E2E（DeepSeek 直连 + relay2 网关，并发双对话）

> 来源计划：docs/plans/2026-07-21-bridge-slice.md Task B4。BASE=424be24。
> 执行模型：Opus 4.8（唯一打真网 live 卡，高风险不降档）。
> **这是 Bridge 批的收官验证**：证明 B0-B3 全栈经真 SDK + 真端点端到端工作，并结清三个累积的待验证假设。

## Global Constraints
- 新文件只进 `E:\Leemo\`；`smoke/` 旧文件禁改（只**新增** bridge-live.mjs）；`src/**` 全部只读（发现 bug 报回对应卡，不就地修）。
- 命名 Leemo/momo；禁旧名。密钥纪律：日志/结果/commit 零明文 key，redact 一切。
- **Live 成本纪律**：跑前设 VPN 三件套（relay 走中转站需代理）：`$env:NODE_USE_ENV_PROXY='1'; $env:https_proxy='http://127.0.0.1:10801'; $env:http_proxy='http://127.0.0.1:10801'; $env:no_proxy='127.0.0.1,localhost'`（no_proxy 保 SDK→本地网关直连；DeepSeek 国内直连不受影响）。单场景单跑不刷次数；每 check 独立 timeout 600s。

## 背景：你在验什么

B0-B3 全部 fake 注入过审（215 测试绿）。B4 用**真 SDK query()** 驱动 Bridge，证明整栈活着，并结清三个 fake 测不出、只有真流量能证的假设：
- **B2 risk #1**：stream_event 内部 delta 形状——events.ts 的 text.delta 映射是防御式可选链写的，真 SDK 的 stream_event 形状是否让它真的产出 text.delta？
- **B2 risk #2**：网关 B0 挂的 `leemo_estimated:true` 标记，是否流穿到 SDK 的 result.usage → UsageRecord.tokensEstimated？（经网关的 relay2 对话验；DeepSeek 直连不经网关无此标记）
- **B0 concern**：经网关时 message_start.input_tokens 是 o200k 估值（真值只在流末），CC 自动 compaction 依赖 input token 计数——**估值是否够让自动压缩逻辑正常**（best-effort 探测，见下）。

## 要建的东西

`E:\Leemo\smoke\bridge-live.mjs`（新文件）：
- **运行时 bootstrap**：抄 `smoke/gateway-live.mjs` 的做法（tsx 内嵌或子进程 + alias-hook）——因为要 import src/bridge 的 TS 模块 + 起 G3 网关（startGateway 经别名 import vendor）。读 gateway-live.mjs 复用其 bootstrap 与 redact/超时/逐场景骨架。
- **真 SDK 适配**：把 `@anthropic-ai/claude-agent-sdk` 的 `query()` 适配成 pool 的 `QueryFn`（`(params)=>AsyncIterable<SdkMessageLike>`）：QueryOptions→SDK Options（env / abortController / resume 字段名以 sdk.d.ts 为准，B1 已核实 abortController 无 signal），SDK message 原样透传（其为 SdkMessageLike 子类型）。用 includePartialMessages:true 以拿 stream_event（验 risk #1）。
- **两对话并发**：
  - 对话 A = **DeepSeek 直连**（provider apiFormat:'anthropic', authMode api-key, .env DEEPSEEK_API_KEY/MODEL）——不经网关。
  - 对话 B = **relay2 经网关**（起 G3 startGateway 拿 port, provider apiFormat:'openai' + gatewayPort, .env RELAY2_*）。
  - 两对话经同一 createBridge 并发 send，验隔离与并发。

## 核心 PASS 判据（必须全过=竖切达成）

1. **双接线事件流完整**：两对话各经 `createBridge→createConversation→send`，喂给 events.ts 的 normalizeSdkStream，断言 LeemoEvent 序列含 conversation.started / text.final / run.finished(subtype success)。至少一个对话跑含工具轮（真写文件），断言 tool.started/tool.finished。
2. **usage.final 数值非零**（B0 效果实证）：至少 DeepSeek 直连对话的 usage.final.inputTokens>0（结清"经网关 usage 全零"的对立面——直连本就有值；relay2 经网关也应有值，B0 修复后）。cost 计算出（costSource sdk|local-pricing）。
3. **tokensEstimated 结论**（B2 risk #2）：relay2 经网关对话，检查 UsageRecord.tokensEstimated 与 costSource——**如实记录**真 SDK 下 leemo_estimated 是否流穿（true=网关回填标记存活；false=真 usage 透传或标记被 SDK 剥离）。二者都是有效结论,报告写明观测事实。
4. **密钥隔离**（relay2 网关对话）：dump SDK 子进程 env,断言 ANTHROPIC_AUTH_TOKEN=`leemo-gw:relay2` 占位、无 RELAY2_API_KEY、无 key 形值（沿用 gateway-live 的 isolation dump）。DeepSeek 直连对话的 env 含真 key 是直连语义(允许),但断言无**兄弟** provider 的 key(sanitizeHostEnv 效果)。
5. **审批桥 live**：把 ApprovalBroker 接成真 SDK 的 canUseTool（policy 用 acceptEdits 或传一个 auto-allow transport）,跑一个含工具的对话,断言 transport 收到 ApprovalRequest（或 bypass 模式下零请求但工具照跑）——**证 canUseTool 适配器与真 SDK 签名兼容、审批往返 live 可用**。用 fake transport 记录请求即可,不需真人点。
6. **resume 续轮召回**：同对话第二轮 send（暗号召回式），断言 resume 传递且召回成功。
7. **CONFIG_DIR 隔离**:两 provider 的 `<dataDir>/providers/<id>/` 目录各自落盘、互不串。
8. **结果落 smoke/results/**（redact）;泄漏扫描零命中。

## Best-effort 探测（记录不卡门,FAIL 按归因守则记）

- **auto-compaction 经网关**（B0 concern）:若能低成本触发（堆够上下文）,验经网关时自动压缩是否因 message_start 估值而正常/异常。触发成本高（~分钟）,做不了就如实记"未触发验证,留观测"——不卡 PASS。
- **DeepSeek 余额拉取**（B2 balance.ts live）:调 fetchBalance(deepseek),断言 BalanceInfo.supported=true 且金额字段解析（真端点验 balance.ts 的响应形状假设）。这个便宜,尽量做。
- **ask_user MCP live**:难以稳定诱使模型调 ask_user,best-effort;做不了记"未触发"。

## 判定
≥核心 7 条全过 = Bridge 竖切 live 达成。任何 FAIL 原样记录不放水,按 Phase 0 归因守则(网关 bug / 上游模型 / harness)分类。三个待验证假设(risk#1/#2/compaction)**无论结论都要如实写进报告**——这是 B4 存在的核心目的之一。

## 报告追加
- `docs/reports/phase0-report.md` 末尾追加 `## 八、Bridge 竖切 Live 验收`（核心 7 条矩阵 + 三假设结论 + best-effort 探测结果 + 归因）。
- `docs/sdd/br-b4-report.md`:运行设计(bootstrap 选择/SDK 适配)、核心 7 条逐条证据、三假设观测事实(risk#1 text.delta 是否产出 / risk#2 tokensEstimated 实测 / compaction 探测)、密钥隔离 dump、泄漏扫描、balance live 结果、文件清单、concerns。

## 禁改清单
smoke/ 旧文件(checks/lib/providers/smoke-cc-sdk/gateway-live 等一律不改,只新增 bridge-live.mjs);src/** 全部(发现 bug 报回);.env(RELAY2/DEEPSEEK 已配,只读);vendor/;tsconfig*;CLAUDE.md;docs/NewmaxAI逆向报告/。

## Steps
1. 写 bridge-live.mjs(bootstrap 抄 gateway-live + 真 SDK→QueryFn 适配 + 双 provider 构造)
2. VPN 三件套下跑双对话并发,逐条核心判据 + 三假设探测 + balance
3. 报告追加 phase0-report §八 + br-b4-report;泄漏扫描零命中
4. Commit `feat(bridge): live E2E — concurrent dual-wiring conversations with usage/approval/resume` + push

## 验收命令
`Set-Location E:\Leemo`(设 VPN 三件套后)`node smoke\bridge-live.mjs` 复跑对账;`Select-String -Path smoke\results\*.json -Pattern 'sk-[a-zA-Z0-9]{8}'` 零命中。

## 回报（≤15 行）
Status / commit + push / 核心 7 条一行矩阵 / 三假设结论一行(risk#1 text.delta / risk#2 tokensEstimated / compaction) / balance live 结果 / concerns / 报告路径。
