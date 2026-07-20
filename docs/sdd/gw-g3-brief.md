# Leemo 第二批实施计划 A 线：本地协议网关竖切

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `E:\Leemo` 建成本地协议网关：`127.0.0.1` HTTP 薄壳 + vendor 的 `@musistudio/llms` anthropic 转换核心，使 claude-agent-sdk 经 `ANTHROPIC_BASE_URL` 指向本地网关即可使用纯 OpenAI 协议端点；13 个已知坑全部 TDD 快照回归覆盖；最终用用户中转站真实 OpenAI 端点跑通 Phase 0 五项核心验证。

**Architecture:** 三层——①vendor 层 `src/gateway/vendor/llms/`（上游 MIT 源码原样+最小修补，独立 tsconfig 路径别名）②核心层 `src/gateway/core/`（transformer 适配器：请求 anthropic→openai、响应/SSE openai→anthropic、thinking 规整、provider 开关）③壳层 `src/gateway/server.ts`（http.createServer + 端点面 /v1/messages?beta=true、count_tokens、/v1/models、/health + SSE 直通管道 + 密钥隔离占位 token 路由）。测试用 vitest：单元（纯函数转换）+ 快照（SSE 事件序列）+ live（中转站真端点，可跳过）。

**Tech Stack:** TypeScript 5.x + vitest + tsx（运行时执行 TS）。运行时新依赖仅 `uuid`、`jsonrepair`、`gpt-tokenizer`（count_tokens 用 o200k_base 近似）；**不引入** fastify/express/openai SDK（薄壳用原生 http；openai 包类型 import 改为本地类型声明）。

## Global Constraints（每张卡隐含遵守）

- 新代码只进 `E:\Leemo\`；`E:\幸运鹿AI\` 与 `E:\Leemo\smoke\`（Phase 0 已验收资产）只读，**禁改**。
- **严格 TDD**（宪法：网关=严格 TDD）：每个转换行为先写失败测试再实现；13 坑每坑至少一个显式命名的测试用例。
- vendor 纪律：`src/gateway/vendor/llms/` 内文件保持上游原样；必须修改处用 `// LEEMO-PATCH: <原因>` 行内标注；vendor 目录带 `LICENSE`（MIT 全文+署名 musistudio）与 `UPSTREAM_COMMIT.txt`（已钉 ac0fafec239f7e75deaac513ef7b5f25ed058f0a）。素材已在 `E:\Leemo\vendor-staging\llms\`（Task G1 迁入正式位置后删除 staging）。
- API key 只经 `.env`（RELAY2_* 新变量组）；日志/测试快照/commit 不得含明文 key；网关日志打印前经脱敏。
- 密钥隔离铁律：真 key 只在网关进程内存；SDK 子进程 env 只拿占位 token `leemo-gw:<providerId>`。
- 命名：Leemo/momo；不得出现"幸运鹿/LuckyDeer/Lulu"。
- PowerShell 5.1 验收命令（无 `&&`）；执行者≠验收者；每卡产出可复现证据。
- **13 坑清单（测试命名基准，07 号计划 §3.3 原文）**：①流式 tool_calls 参数拼接（含零参数工具 `|| "{}"` 兜底）②含工具轮次 stop_reason=tool_use ③content block index 跨类型单调映射 ④tool id 全链路往返一致 ⑤cache_control 剥离 ⑥max_tokens 必填/clamp/max_completion_tokens ⑦system 字符串/块数组拼接 ⑧tool_result 嵌图片提升为 user 消息 ⑨reasoning_content/thinking 碎片化（含按 provider 开关，不得无条件注入）⑩usage 映射（cached_tokens 扣减+stream_options.include_usage 可关）⑪GLM 拒 anyOf/oneOf/$ref 的 schema 扁平化 ⑫SSE 事件状态机（event+data 成对/ping/[DONE] 吞掉/message_start→content_block_*→message_delta→message_stop 顺序）⑬`?beta=true` 与 count_tokens 端点面。

**已核实事实（不必再查）**：llms 上游 `src/transformer/anthropic.transformer.ts` 1069 行为核心（类 AnthropicTransformer，endPoint /v1/messages，含 transformRequestOut=anthropic→unified、transformResponseIn/convertOpenAIResponseToAnthropic、convertOpenAIStreamToAnthropic SSE 状态机、toolCallIndexToContentBlockIndex 映射）；依赖面=types/llm.ts(239行)+types/transformer.ts(43行)+utils/thinking(8行)/image(9行)/toolArgumentsParser(50行,jsonrepair)+api/middleware 的 createApiError(39行)+`openai/resources` 仅类型 import+uuid。已知上游 bug 两个：reasoning 无条件注入（打挂不支持模型）、server tools 静默丢弃（改显式剥离）。NewMax 逆向图纸：thinking 规整 EFFORT_BUDGET_MAP（low 4000/medium 12000/high 24000/xhigh 40000/max 60000，default 16000）；网关模式 env=`ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` + `ANTHROPIC_AUTH_TOKEN=占位`。SDK 侧（Phase 0 实证）：CC 恒带 `?beta=true`；`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` 时拉 /v1/models（Anthropic 格式，id 需 claude/anthropic 前缀才显示）；count_tokens 被压缩逻辑依赖。

---

### Task G3: 网关薄壳（server + 端点面 + 密钥隔离 + SSE 直通）

**Files:**
- Create: `E:\Leemo\src\gateway\server.ts`（`startGateway(registry): Promise<{port, close}>`——http.createServer 绑 127.0.0.1:0；路由：POST /v1/messages（含 ?beta=true）、POST /v1/messages/count_tokens（gpt-tokenizer o200k_base 近似）、GET /v1/models（Anthropic 格式；自定义模型 id 加 `claude-` 前缀伪装进模型发现）、GET /health；从 Authorization 解析 `leemo-gw:<providerId>` → registry 查真 key/baseUrl/opts → 转换 → undici fetch 上游 → SSE 直通（不缓冲、每 chunk flush、client abort 传上游 AbortController）；错误映射为 Anthropic 错误形状）
- Create: `E:\Leemo\src\gateway\registry.ts`（ProviderRegistry：内存 Map，`{id, baseUrl, apiKey, model, apiFormat:'openai', opts}`；from .env 的 RELAY2_* 构造测试实例；含 redact 日志包装）
- Create: `E:\Leemo\src\gateway\dev.ts`（`npm run gateway:dev`：读 .env 起网关打印 port，手工调试用）
- Test: `E:\Leemo\tests\gateway\server.test.ts`（**不打真上游**：用本进程内起的 mock openai 上游（http.createServer 返回 fixture SSE）测全链路：占位 token 路由/真 key 只出现在上游请求头/beta=true 透传/count_tokens 返回合理数值/models 格式/404/401/上游 5xx 映射/client abort 后上游请求被取消）

**Interfaces:**
- Consumes: G2 三模块。
- Produces: `startGateway`/`ProviderRegistry`（G4 与未来 Bridge 消费）；mock 链路测试全绿。

**禁改清单：** smoke/；vendor/；G2 core 文件（发现 bug 报告回 G2 修，另起 commit）。

- [ ] **Step 1:** TDD：mock 上游 fixture → server 测试先红后绿（重点：密钥隔离断言=抓 mock 上游收到的 Authorization 头是真 key、而网关自身日志与响应无真 key）
- [ ] **Step 2:** SSE 直通压力用例：fixture 100-chunk 流逐 chunk 送达（无整体缓冲——用时间戳断言首 chunk 早于末 chunk 到达）
- [ ] **Step 3:** typecheck+test 全绿 → Commit `feat(gateway): local gateway server with endpoint surface, key isolation, SSE passthrough`

**验收命令：** `Set-Location E:\Leemo; npm test; npx tsc --noEmit`（验收方抽查密钥隔离断言与 abort 传递用例真实存在）

---

