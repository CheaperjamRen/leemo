# Task B0 简报：网关欠账清偿

> 来源计划：docs/plans/2026-07-21-bridge-slice.md（Bridge 批次首卡）。BASE=8f3f8a2。

## Global Constraints（本批每张卡隐含遵守）

- 新代码只进 `E:\Leemo\`；`smoke/`（Phase 0 资产）旧文件只读禁改；vendor 除已有 5 处 LEEMO-PATCH 块外禁改（若需第 6 处新 patch 站点必须 BLOCKED 上报，不得自行扩面；既有 PATCH 块内的最小改动允许）。
- **严格 TDD**：先失败测试后实现，RED 证据留存；测试断言行为而非 mock 自证。
- 类型防火墙：自研代码禁 import `@gateway/vendor/**`；G2 契约 `anthropicToOpenAI` 返回 `{result, stripped}`。
- 密钥纪律：key 只经 `.env`；日志/快照/commit 零明文 key。
- 命名：Leemo/momo；禁"幸运鹿/LuckyDeer/Lulu"。
- `npm run typecheck`=两条命令（vendor emit 先行）；改 vendor 源后 typecheck 自动重 emit 声明。
- Live 成本纪律：诊断脚本打真端点前先设 VPN 三件套：`NODE_USE_ENV_PROXY=1` + `https_proxy=http://127.0.0.1:10801` + `http_proxy=http://127.0.0.1:10801` + `no_proxy=127.0.0.1,localhost`（niubiapi 拦裸 Node fetch，403 就是没设代理）。单场景单跑不刷次数。

## 背景（终审判定，本卡的两个 Important 来源）

1. **流式 usage 全零**（G4 live 实证）：经网关跑 CC，message_start 的 input_tokens 恒 0、末端 usage 全零；直连时有值。不只是成本问题——CC 自动 compaction 依赖 input token 计数，恒 0 可能致自动压缩永不触发（手动 /compact 已验通）。终审给出决定性首查：**抓 relay 原始 SSE，看有无携带 usage 的 data 帧**。已知事实：G2 的 translate.ts 在流式时默认设 `stream_options.include_usage=true`（provider-opts includeUsage 默认 true）；vendor anthropic.transformer 的 message_start 硬编码 usage 0（~line 471 附近），仅在 `if (chunk.usage)` 时填 message_delta.usage；pitfall-10 测试用的 fixture 含 usage 帧且通过——分歧必在"live SSE 形状 vs fixture"。
2. **ProviderOpts 经产线入口死路**：registry.fromEnv 硬编码 `opts:{}`，flattenSchemas/maxTokensField/reasoningInjection 等已测功能无配置通道。

另有凑手 Minor×3 与 401 语义（详见任务卡）。

## 任务卡（计划原文）

**Files:**
- Create: `E:\Leemo\smoke\relay-sse-probe.mjs`（诊断脚本：直打 RELAY2 端点 stream:true + stream_options.include_usage，dump 全部 SSE 帧结构到 smoke/results/（redact），回答分支问题：**上游有无 usage 帧**）
- Modify: `E:\Leemo\src\gateway\core\translate.ts` + `provider-opts.ts`（usage 回填：新 opt `usageBackfill:'auto'|'off'`——'auto' 且流末未见上游 usage 时，用 tokens.ts 的 o200k 近似回填 message_start.input_tokens（对请求侧算）与末 message_delta.usage.output_tokens（对累计输出文本算）；上游有真 usage 则透传不回填防双计。**根因若在 vendor message_start 硬编码 0 且上游确有帧**：修透传，位置若超出既有 2 处 G2 PATCH 块需 BLOCKED 上报）
- Modify: `E:\Leemo\src\gateway\registry.ts`（fromEnv 增 per-provider opts 通道：`RELAY2_OPTS` 可选 JSON env 合入 ProviderOpts；registry 构造函数路径本就收 opts——补测试钉住）
- Modify: `E:\Leemo\src\gateway\server.ts`（凑手①：drain await 与 res close 竞态一行 race+测试；凑手②：stripped 非空日志一断言；低优：上游 401/403 映射改 502 型 `api_error`（message 说明 upstream auth failed），客户端 401 只留给占位 token 无效）
- Test: `tests\gateway\pitfall-10-usage.test.ts` 增用例（回填 auto/off/真 usage 透传三分支）+ `server.test.ts` 增用例（竞态/stripped 日志/502 映射）+ `pitfall-02` 增锁定测试（divergent shape 直打 vendor transformer 路径，锁 backstop 谓词——G2 复审 Minor：vendor 备份谓词无测试覆盖）

**用户拍板语义（必须遵守）：**
- 回填近似值可接受，但下游要能识别：回填发生时在流末事件挂可识别标记（实现方式自定——如 message_delta.usage 加非标字段或 translate 返回元信息——报告说明选择；Bridge 批 B2 会据此设 `estimated:true`）。
- 上游有真 usage 帧则必须透传真值（NewMax 模式：流末一次性提取），回填仅兜底。

**禁改清单：** smoke/ 旧文件；vendor 除既有 PATCH 块内最小改动外；.env（RELAY2_OPTS 是可选变量，测试用注入不依赖 .env 真加）。

**Steps:**
1. 跑 relay-sse-probe.mjs（VPN 三件套）拿到分支答案，redacted 帧结构证据入报告
2. 按分支 TDD 实现回填/透传；三分支测试全绿
3. 凑手三项+401 语义 TDD；全量 test+typecheck 绿
4. Commit `fix(gateway): stream usage backfill/passthrough, provider-opts env channel, drain race, 502 mapping`

**验收命令：** `Set-Location E:\Leemo; npm test; npm run typecheck`（验收方核对：诊断证据存在且分支选择与证据一致；三分支测试非空转；501/502 语义变更后旧 401 用例已相应更新而非删除）

## 报告

写到 `docs/sdd/br-b0-report.md`：诊断证据（帧结构摘录+分支结论）、每项修改的 RED/GREEN 证据、回填标记的实现选择、文件清单、自查、concerns。
