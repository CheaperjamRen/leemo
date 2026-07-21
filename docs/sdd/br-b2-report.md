# Task B2 报告：事件规范化 + usage/cost/pricing + 余额拉取 + 防幻觉抽查

> BASE=7e3b716。执行模型=Sonnet 5。零 live 调用（fake SDK 消息流 + fake fetch 注入）。

## 1. LeemoEvent 全 variant 清单

`src/bridge/events.ts` 判别联合，11 个 variant，与简报逐一对应：

| variant | 字段 |
|---|---|
| `conversation.started` | `sessionId: string` |
| `text.delta` | `text: string` |
| `thinking.delta` | `text: string` |
| `text.final` | `text: string` |
| `tool.started` | `toolUseId, name, input: unknown, subagent: boolean` |
| `tool.finished` | `toolUseId, isError: boolean, contentSummary: string` |
| `subagent.activity` | `parentToolUseId: string` |
| `compact.boundary` | `trigger, preTokens: number, postTokens?: number` |
| `usage.final` | `usage: UsageRecord` |
| `run.finished` | `subtype, isError: boolean, finalText: string, pathAudit: PathAudit` |
| `error` | `message: string` |

## 2. SDK → Event 映射表

| SDK 消息 | 判别 | → LeemoEvent | 实现位置 |
|---|---|---|---|
| 系统初始化 | `type:'system', subtype:'init'` | `conversation.started{sessionId}` | events.ts:344-345 |
| 压缩边界 | `type:'system', subtype:'compact_boundary'` | `compact.boundary{trigger,preTokens,postTokens?}` | events.ts:346-357（`pre_tokens` 非 number 时整条跳过，防半残 payload） |
| 流式增量 text | `type:'stream_event', event.delta.type==='text_delta'` | `text.delta{text}` | events.ts:308-317（可选链，见风险①） |
| 流式增量 thinking | `type:'stream_event', event.delta.type==='thinking_delta'` | `thinking.delta{text}` | 同上 |
| 助手 tool_use | `type:'assistant', message.content[].type==='tool_use'` | `tool.started{toolUseId,name,input,subagent}` | events.ts:279-286（`subagent` = 消息级 `parent_tool_use_id` 存在） |
| 助手/工具消息带 parent_tool_use_id | `parent_tool_use_id != null` | `subagent.activity{parentToolUseId}`（先于该消息其余事件发出） | events.ts:271-274 |
| 用户 tool_result | `type:'user', message.content[].type==='tool_result'` | `tool.finished{toolUseId,isError,contentSummary}` | events.ts:287-293 |
| 结果:成功 | `type:'result', is_error:false` | `usage.final`→`text.final`→`run.finished{isError:false}` | events.ts:373-405 |
| 结果:错误 | `type:'result', is_error:true` | `error{message}` 先发，再 `usage.final`/`text.final`/`run.finished{isError:true}` | events.ts:376-379 |
| 迭代器自身抛异常 | try/catch 外层 | 单条 `error{message}`（流终止） | events.ts:413-415 |
| 未知 `type` | default 分支 | 跳过，不抛 | events.ts:407-410 |

**子 agent 判定**：全程只认 `parent_tool_use_id` 字段是否存在（`!= null && !== ""`），从不比对工具名——fixture 里内层 `tool_use.name` 特意写成 `"Agent"`（brief 明确的 SDK 0.3.210 双名坑：init 工具列表写 `Task`，实际发出的块名是 `Agent`），测试 `tool.started for the parent_tool_use_id-tagged assistant message has subagent=true and name 'Agent'` 钉住这点。

## 3. UsageRecord 字段 ↔ 双日志表对照

`UsageRecord`（events.ts:29-40）字段面核对 NewMax `proxy_request_logs`（`docs/NewmaxAI逆向报告/NewMax-深度补充分析报告-数据库-Skill-安全-智能体.md:214-245`）：

| UsageRecord 字段 | proxy_request_logs 对应列 | 备注 |
|---|---|---|
| `providerId` | `provider_id` | 直接对应 |
| `modelId` | `model` / `request_model` | UsageRecord 只留一个 modelId；NewMax 拆 model vs request_model 是为了区分"目录名"和"实际请求名"（本卡场景下二者恒一致，未拆） |
| `inputTokens` | `input_tokens` | 直接对应 |
| `outputTokens` | `output_tokens` | 直接对应 |
| `cacheReadTokens` | `cache_read_tokens` | 直接对应 |
| `cacheCreationTokens` | `cache_creation_tokens` | 直接对应 |
| `durationMs` | `latency_ms` / `duration_api_ms` | 单值对应，NewMax 区分"总延迟"与"上游 API 耗时"两列，本卡只有 `result.duration_ms` 一个来源 |
| `costUsd` | `total_cost_usd` | 均为 TEXT/6 位精度字符串（`.toFixed(6)`），语义一致；NewMax 额外拆 `input_cost_usd`/`output_cost_usd`/`cache_read_cost_usd`/`cache_creation_cost_usd` 四个分项——**UsageRecord 只给合计，不给分项**，这是简报定死的形状（brief §UsageRecord 形状原文只有单一 `costUsd`），非实现疏漏 |
| `costSource` | （NewMax 无对应列） | Leemo 新增字段，NewMax 没有这个概念（它总是有价目表，不区分"官方端点报价/本地估算/无价"三态）——是本产品的差异化审计位 |
| `tokensEstimated` | （NewMax 无对应列） | 同上，Leemo 新增（对应 B0 网关 o200k 回填链路） |
| （无对应字段） | `request_id`/`status_code`/`error_message`/`is_streaming`/`conversation_id`/`created_at`/`request_headers`/`request_body`/`response_headers`/`response_summary`/`source`/`num_turns`/`stop_reason`/`model_usage_json`/`currency` | 这些是**持久化层**（SQLite 表行）才需要的字段（主键、HTTP 审计、时间戳、JSON blob），UsageRecord 是**内存态事件净荷**，不是表行——落库时由 Phase 1 的持久化层在 UsageRecord 基础上加这些字段，不是本卡缺失 |

结论：UsageRecord 字段面 ⊇ proxy_request_logs 的"核心计费四维+成本+延迟"需求（brief 验收命令的核对项），差异部分（分项成本拆分、HTTP 审计字段、主键/时间戳）要么是简报明确排除的粒度（分项成本），要么是持久化层职责（Phase 1），不属于本卡 events.ts 的产出面。

`tool_call_logs`（events.ts:185-213）方面：`tool.started`/`tool.finished` 两个事件合起来覆盖 `tool_name`(`name`)、`status`/`is_error`(`isError`)、`input_summary`(`input`)、`error_message` 隐含在 `contentSummary`——`conversation_id`/`workspace_id`/`model`/`provider_id`/`provider_name`/`created_at` 同样是持久化层职责（调用方在写库时从 ctx 补齐，事件本身不携带这些，因为一次 normalizeSdkStream 调用已经在 ctx 里固定了 providerId/modelId，没必要在每个事件里重复）。

## 4. Pricing 查价结果（值 + URL + 查询日期）

`src/bridge/pricing.ts` 内置表——**每条均来自官方文档/官网，非第三方聚合站**：

| Provider:Model | 官方来源 | 查询日期 | input/output/cache-hit（原始币种） | 转换后（USD/M tokens） |
|---|---|---|---|---|
| `deepseek:deepseek-chat` | https://api-docs.deepseek.com/quick_start/pricing | 2026-07-21 | $0.14 / $0.28 / $0.0028（USD，官方直接美元报价，非折算） | 0.14 / 0.28 / 0.0028 |
| `glm:glm-5.2` | https://open.bigmodel.cn/pricing（Vue SPA，curl 拿不到内容，改用 chrome-devtools 渲染后读 accessibility-tree 快照拿到真实表格） | 2026-07-21 | ¥8 / ¥28 / ¥2（CNY，每百万 token） | 1.1821 / 4.1372 / 0.2955（÷6.7669） |
| `kimi:kimi-k2.5` | https://platform.moonshot.cn/docs/pricing/chat-k25（Next.js RSC payload，curl 原始 HTML 拿不到数据，改抓内嵌 RSC JSON） | 2026-07-21 | ¥4.00 / ¥21.00 / ¥0.70（CNY，每百万 token；cache-miss-input/output/cache-hit） | 0.5911 / 3.1029 / 0.1034（÷6.7669） |

CNY→USD 汇率：**6.7669**（https://api.frankfurter.app ，ECB 源，汇率日期 2026-07-20，抓取日 2026-07-21）。交叉核对了第二个源（open.er-api.com，6.778084，2026-07-21）——两者相差 <0.2%，取 frankfurter.app（ECB 官方数据源，更可信），写入代码注释。

**relay2 `gpt-5.6-luna`：故意不进表。** OpenAI 官方对 `gpt-5.6-luna` 的自家报价确实公开（$1/$6 每百万 token），但 Leemo 的 `RELAY2` provider 是第三方中转站（niubiapi），转售价与 OpenAI 官方价是两回事——中转站的实际结算价从未在任何文档中公开确认。简报原文："查不到的（如中转站 gpt-5.6-luna 价格不透明）→ 该 model 不进表"，照办：`resolvePricing("relay2","gpt-5.6-luna")` 返回 `undefined`，`buildUsageRecord` 落到 `costSource='unpriced'`。测试 `pricing.test.ts`「returns undefined for an unknown providerId/modelId pair (e.g. relay gpt-5.6-luna — unconfirmable third-party pricing)」钉住这个行为。

`overrides` 参数（Phase 1 注入点）：三例测试覆盖——覆盖表内已有条目、覆盖表内缺失条目（如临时给 relay2 塞价）、覆盖不泄漏到无关 key 的查询。

## 5. Balance 各家支持面结论（+ 出处）

`src/bridge/balance.ts`：

| Provider | 结论 | 出处 | 关键点 |
|---|---|---|---|
| **DeepSeek** | **支持**，`GET https://api.deepseek.com/user/balance` | https://api-docs.deepseek.com/api/get-user-balance/（2026-07-21） | 响应 `{is_available, balance_infos:[{currency,total_balance,granted_balance,topped_up_balance}]}`；**金额字段是字符串**（官方文档原样如此，代码内 `Number()` 强转）。一个 GitHub 上的第三方 OpenAPI 镜像给出的 schema（`{type,amount,currency}`）与官方文档不符，**未采用**，以官方页面直读为准。 |
| **Kimi (Moonshot)** | **支持**，`GET https://api.moonshot.cn/v1/users/me/balance` | https://platform.moonshot.cn/docs/api/balance（2026-07-21） | 响应 `{code, data:{available_balance,voucher_balance,cash_balance}, scode, status}`；**金额字段是数字**（与 DeepSeek 相反，官方示例响应直接是 number，无需 `Number()` 转换）。**币种=CNY**（platform.moonshot.cn 按人民币计费）——`available_balance` 映射到 `totalCny`，非 `totalUsd`（复审 Important 修复，见下方§修复轮；避免 UI 把余额虚高 ~6.8 倍）。 |
| **GLM (智谱)** | **不支持**，`{supported:false}` | 查过 open.bigmodel.cn 相关文档与开发者社区 | 未找到任何公开、文档化、API-Key 认证的余额查询端点；网上流传的是一个非官方、cookie 鉴权、随时可能失效的逆向端点，且那个端点查的是"套餐/编码计划配额"这个不同概念，不是钱包余额。判定：不实现，`supported:false`，由 `UNSUPPORTED` allowlist 显式登记（而非"默认支持"再报错），保证以后新增 provider 不会静默"意外支持"。 |
| 其它/未知 providerId | `{supported:false}`，`fetchFn` 全程不被调用 | — | `balance.test.ts`「an entirely unknown providerId → supported:false, does not call fetchFn」用 `called` 标志位实测这一点，非空转。 |

错误路径：非 2xx → `{supported:false, raw:'<provider> balance HTTP <status>'}`；网络异常（`fetchFn` 抛错）→ `{supported:false, raw:<脱敏后的错误摘要>}`。脱敏实现 `redact()`（balance.ts:50-53）在返回前把 apiKey 子串替换成 `<redacted>`；`balance.test.ts`「a thrown network error yields supported:false, no throw escapes, and no key leaks into raw」构造了一个**错误消息里真的嵌了假 key**的场景（`connect failed for key ${apiKey}`），断言 `raw` 不含该 key——这是真实的泄漏测试，不是摆设。

## 6. estimated / costSource 分支证据

`buildUsageRecord`（events.ts:117-151）三态 `costSource` + 两态 `tokensEstimated`，测试位置：

| 分支 | 断言位置（`events.test.ts`） | 关键断言 |
|---|---|---|
| `costSource='sdk'` | "costSource='sdk' when result.total_cost_usd > 0, formatted to 6 decimals" | `total_cost_usd=0.123456` → `costUsd==="0.123456"` |
| `costSource='local-pricing'` | "costSource='local-pricing' when no sdk cost but a pricing-table hit, using the NewMax formula" | `input=10,output=5,cache=0` + `pricing={0.14,0.28,0.0028}` → `costUsd===(2.8/1_000_000).toFixed(6)`（数值验证，非字面量硬编码巧合） |
| `costSource='unpriced'` | "costSource='unpriced' when no sdk cost and no pricing-table entry (ctx.pricing omitted)" | `ctx.pricing` 缺省 → `costUsd===undefined` |
| `tokensEstimated=true` | "tokensEstimated=true when usage.leemo_estimated===true" | `resultWithEstimatedUsage` fixture 携 `leemo_estimated:true` → 读出 `true` |
| `tokensEstimated=false` | "tokensEstimated=false when usage.leemo_estimated is absent" | 无该字段 → `false`（非 `undefined`，非真值判定） |

`buildUsageRecord`独立单测（不经流）另补两例：字段齐填（`fills every UsageRecord field...`）+ NaN 安全（`buildUsageRecord({}, ctx)` 全 token 数字段=0，非 `NaN`/`undefined`，见 `num()` helper events.ts:100-102）。

## 7. RED / GREEN 证据

严格 TDD。本次收尾自查时**重新验证了 RED 的真实性**（非仅凭历史记忆）：把 `src/bridge/{events,pricing,balance}.ts` 临时移走，重跑三个新测试文件：

```
FAIL  tests/bridge/balance.test.ts
Error: Cannot find module '../../src/bridge/balance' imported from E:/Leemo/tests/bridge/balance.test.ts
FAIL  tests/bridge/events.test.ts
Error: Cannot find module '../../src/bridge/events' imported from E:/Leemo/tests/bridge/events.test.ts
FAIL  tests/bridge/pricing.test.ts
Error: Cannot find module '../../src/bridge/pricing' imported from E:/Leemo/tests/bridge/pricing.test.ts

 Test Files  3 failed (3)
      Tests  no tests
```

三个模块均以「先写 fixture/断言 → 确认 `Cannot find module` RED → 再写实现」的顺序完成。移回实现文件后重跑，GREEN：

```
 Test Files  21 passed (21)
      Tests  164 passed (164)
```

（新三文件单独计：events 29 + pricing 8 + balance 8 = 45；加上 B0/B1 既有 119 = 164。）

`npm run typecheck`（`tsc -p tsconfig.vendor.json && tsc -p tsconfig.json`）：两条全过，exit 0。

## 8. pathAudit 三例

`auditClaimedPaths`（events.ts:177-206）测试覆盖三个核心场景（独立单测 `tests/bridge/events.test.ts` "auditClaimedPaths — unit tests with injected existsSyncFn" 段落 + 一个经完整流的集成测试）：

1. **cwd 内且存在**：`auditClaimedPaths("see \`/work/proj/readme.md\`", "/work/proj", (p) => p === "/work/proj/readme.md")` → `{path:'/work/proj/readme.md', exists:true, withinCwd:true}`。集成测试用真实文件 `path.join(CWD,'sdk-messages.ts')`（fixtures 目录下真实存在的文件）验证同一结论。
2. **cwd 内但不存在**：`auditClaimedPaths("see \`/work/proj/ghost.md\`", "/work/proj", () => false)` → `{exists:false, withinCwd:true}`。集成测试用 `path.join(CWD,'does-not-exist-xyz.ts')`（真实不存在）复现。
3. **cwd 外（Phase 0 工作区逃逸信号）**：`auditClaimedPaths("see \`/etc/passwd\`", "/work/proj", () => true)` → `{exists:true, withinCwd:false}`——**即使 existsSyncFn 返回 true，withinCwd 判定不受影响**，这正是 Phase 0 发现的关键信号（模型在 `E:\Users\...` 建目录树，那类越界不是"文件不存在"能捕捉的，必须靠路径包含关系单独判定）。集成测试用平台相关的 `E:\Users\ghost\made-up-dir`（win32）复现同一逻辑。

另外覆盖：Windows 绝对路径抽取（`E:\Leemo\out.txt`）、无路径文本返回空数组两个边界例。

## 9. 风险①②的处理 + 待 B4 验证项

**风险①（stream_event 内部形状未经 live 验证）**：`eventFromStreamEvent`（events.ts:308-317）全程可选链（`msg.event?.delta`，逐层 `?.`），任何不匹配的形状直接返回 `undefined`（该消息被跳过，不抛、不影响其它事件）。专门测试「malformed stream_event (unexpected delta shape) is skipped defensively, not thrown」构造了三种畸形输入（未知 delta kind / 空 event 对象 / `event: undefined`），断言不产生 `text.delta`/`thinking.delta`、且 `run.finished` 仍正常到达（即结构事件完全不受影响）。**待 B4 验证**：真实 SDK 的 `stream_event.event.delta` 形状是否真如 sdk.d.ts 所述——若不同，是 B4 的 live findings，不追溯为本卡缺陷（简报原文口径）。

**风险②（`leemo_estimated` 是否流穿到 `result.usage`）**：`buildUsageRecord` 按"存在即读，缺省 false"实现（`usage.leemo_estimated === true`，events.ts:122），前向兼容、可测，两分支均有独立测试（见 §6）。**待 B4 验证**：B0 在网关侧 `message_delta.usage` 上挂的 `leemo_estimated:true` 标记，经 CC SDK 把多个 `message_delta` 聚合成最终 `result.usage` 之后，这个非标准字段是否真的存活到那一层——本卡只能验证"若存在则正确读出"，无法验证"SDK 聚合逻辑是否保留它"，因为这需要真实 SDK 运行时行为，fake 消息流无法代为验证。

**风险③（B1 的 pool.ts 是否需要改动）**：未发生。`events.ts` 完全通过 `normalizeSdkStream(sdkMessages: AsyncIterable<SdkMessageLike>, ctx)` 消费 B1 的输出，用局部 `IncomingMsg extends SdkMessageLike` 结构类型 + `as` 断言读取 B1 未声明但实际存在的字段（`parent_tool_use_id`/`message`/`result`/`usage` 等），零改动 `pool.ts`/`providers.ts`（git status 可证，见 §11）。

## 10. 文件清单

**新增：**
- `src/bridge/events.ts`（416 行）——`LeemoEvent` 判别联合、`UsageRecord`/`PathAudit` 类型、`buildUsageRecord`、`auditClaimedPaths`、`normalizeSdkStream`
- `src/bridge/pricing.ts`（86 行）——`ModelPricing` 类型、内置价目表、`resolvePricing`
- `src/bridge/balance.ts`（195 行）——`BalanceInfo` 类型、DeepSeek/Kimi 适配器、`fetchBalance` 分发
- `tests/bridge/events.test.ts`（516 行，29 例）
- `tests/bridge/pricing.test.ts`（70 行，8 例）
- `tests/bridge/balance.test.ts`（154 行，8 例）

**修改（扩展，非覆写）：**
- `tests/bridge/fixtures/sdk-messages.ts`：B1 原有 `TestMsg`/`oneTurnStream` 原样保留，新增 `TestMsgB2`/`fullTurnStream`/`resultWithSdkCost`/`resultWithEstimatedUsage`/`resultUnpriced`/`resultError`。已核实 `pool.test.ts` 只引用原有的 `oneTurnStream`/`TestMsg`，本次扩展不影响 B1 既有测试。

**禁改清单核对**（`git status --short` 逐条比对）：`smoke/`、`vendor/`、`src/gateway/**`、`src/bridge/pool.ts`+`providers.ts`、`tests/gateway/**`、`tests/bridge/pool.test.ts`+`providers.test.ts`、`tsconfig*`/`vitest.config.ts`、`CLAUDE.md`、`docs/NewmaxAI逆向报告/` —— 全部零触碰。

## 11. 自查

- **LeemoEvent 每个 variant 均有断言存在性 + 值的测试**：11 个 variant 逐一在 §2 映射表中列出实现位置和对应测试。自查过程中发现 `error` variant 曾经只有一个测试"存在但断言不充分"（测试名称提到 error 但从未真正定位/断言 `error` 事件内容——`grep -n "'error'\|\"error\""` 命中零次），判定为真实覆盖缺口，已修：强化原测试直接断言 `errorEvent.message==="execution failed: boom"`，并新增两例专门覆盖"迭代器自身抛异常"路径（`Error` 对象/字符串两种非规范抛出形态），验证 `e instanceof Error ? e.message : String(e)` 的严格 catch 写法真的按预期工作。三例均已在实现**不变**的前提下通过（证明这是测试覆盖缺口，不是隐藏的实现 bug）。
- **无真实 key 形状字符串**：对全部三个新源文件 + 三个新测试文件 + 扩展的 fixture 文件跑 `grep -nE "sk-[A-Za-z0-9]{16,}|Bearer [A-Za-z0-9_\-]{20,}"`，零命中（测试里的 key 均为 `sk-test-...` 字面假值，`Bearer` 只出现在拼接表达式 `` `Bearer ${apiKey}` `` 里，非字面泄漏）。
- **`resolvePricing` 死引用已清**：`events.ts` 最初 `import { resolvePricing, ... }` 但从未调用（`ctx.pricing` 由调用方——B4/未来集成层——预先 resolve 好传入，`events.ts` 内部不需要再查表），已改为 `import type { ModelPricing }`（type-only），消除误导性的死代码。
- **严格 catch 合规**：`events.ts` 唯一的运行时 `catch(e)` 在 `normalizeSdkStream` 外层（`e` 类型 `unknown`，用 `e instanceof Error ? e.message : String(e)` 提取），以及 `auditClaimedPaths` 内部一处 `try{...}catch{ exists=false }`（无变量捕获，纯防御）；`balance.ts` 两处 provider 适配器的 `catch(e)` 同样走 `err instanceof Error ? err.message : String(err)`。均为 ES2022+严格 catch 写法，root tsconfig 合规。
- **类型防火墙**：`grep -rn "@gateway/vendor" src/bridge/{events,pricing,balance}.ts` 零命中；三文件只 import node 内置模块（`node:fs`/`node:path`）+ 本卡内部类型（`./pool`的`SdkMessageLike`类型、`./pricing`的`ModelPricing`类型）。
- **无 Electron import**：三文件 `grep -n "electron"` 零命中。
- **fixture 真实性**：`fullTurnStream` 的每条消息形状均转录自简报表格（本身溯源 `smoke/checks.mjs` 实证行号），非臆造；pricing/balance 的数值/端点/响应形状均来自官方文档直读（§4/§5 逐条列出 URL+日期），未采信与官方文档冲突的第三方聚合源（Kimi 价格聚合站分歧、DeepSeek balance 的 GitHub OpenAPI 镜像分歧，均已在源码注释和本报告中记录为"不采用"）。

## 12. Concerns

1. **`"kimi"` provider id 尚未有 B1 fixture 独立确认**：`tests/bridge/fixtures/providers.ts` 目前只有 `deepseek`/`deepseek-tpl`/`relay2`/`glm` 四个 Provider fixture，没有 `kimi`。本卡 `pricing.ts`/`balance.ts`/相关测试里使用的 provider id `"kimi"` 是根据 `.env.example` 的 `KIMI_MODEL`/`KIMI_API_KEY` 命名模式推断的，语义上应该正确，但没有一个既存的 B1 Provider fixture 能交叉验证这个 id 字符串本身。建议：B3/B4 补 Provider 目录时确认 `kimi` 就是最终 id（如果拍板用别的字符串，只需要改 `BUILTIN_PRICING`/`UNSUPPORTED`/`FETCHERS` 里的 key，改动面很小）。
2. **CNY→USD 汇率是写死的时点值（6.7669，2026-07-20）**：GLM/Kimi 官方定价本身是 CNY 报价，本卡为了统一 `UsageRecord.costUsd` 的美元单位做了一次性折算并把结果写死进代码常量。这个值会随时间漂移（汇率每天变，官方 CNY 价目也可能调整）——**Phase 1 用 Provider 目录接管价目表后，这块占位常量应整体替换成活的价目源**（可能是定期刷新的汇率+价目缓存，而非编译时常量）。当前实现的注释里已明确标注"占位常量，正式维护随 Provider 目录=Phase 1"，不需要现在就解决，只是记录这个已知的时效性局限。
3. **relay2 的 `gpt-5.6-luna` 无成本追踪**：这是简报预期内的结果（中转站实际结算价不透明，不能瞎猜），但**实际影响**是 Leemo 目前最常用的网关模型（G4 live 验收已用它跑通）在 `costSource='unpriced'` 状态下完全没有成本可见性。如果后续 niubiapi 或其它中转站愿意公开/文档化计价方式，应尽快补进价目表；这不是本卡能解决的（数据不存在，不是代码没写)，但值得作为产品侧的关注点记录。
4. **风险①②按简报要求留给 B4 live 验证**（已在 §9 详述），不在此重复。

---

**验收命令复现**：`Set-Location E:\Leemo; npm test; npm run typecheck` → 164/164 passed + typecheck 两段 exit 0。

---

## 修复轮（复审 Approved + 1 Important → 已修）

复审结论：**Approved，1 个 Important 必修**（+ 1 处可追溯性 nit：报告头 BASE 误写 `701fe09`，应为 `7e3b716`，已在文首订正）。

### Important — Kimi 余额把 CNY 金额错标成 totalUsd（已修）

**缺陷**：`src/bridge/balance.ts` 的 `fetchKimiBalance` 原实现 `return { supported: true, totalUsd: body.data.available_balance }`。但 Moonshot（platform.moonshot.cn）按人民币计费，`available_balance` 是 CNY 金额，不是 USD——若原样显示在 UI，余额会虚高约 6.8 倍（USD/CNY≈6.7669，见§4）。对照同文件里 DeepSeek 路径（按 `currency==='USD'|'CNY'` 分流到 `totalUsd`/`totalCny` 两个字段，balance.ts:104-109）可看出币种理应分开处理，Kimi 这条路径当初漏了这一步、把币种硬编码成了 USD。

**修法**：
1. `src/bridge/balance.ts`：`fetchKimiBalance` 返回值改为 `{ supported: true, totalCny: body.data.available_balance }`；Kimi 段顶部注释同步订正（原文提到"USD"的措辞已改为明确说明"Moonshot 按 CNY 计费，映射到 totalCny，不是 totalUsd"，并点出这是一个曾经犯过、已修复的错误，供后续读者警惕同类坑）。
2. `tests/bridge/balance.test.ts`：原断言 `expect(info.totalUsd).toBeCloseTo(49.58894, 5)` 是"把 bug 焊死成规范"的空转断言，已改为 `expect(info.totalCny).toBeCloseTo(49.58894, 5)` + `expect(info.totalUsd).toBeUndefined()`——同时钉住"金额落在正确字段"和"错误字段必须留空"两件事，防止同一坑以"totalUsd 又被顺手填回去"的形式复发。

**RED/GREEN 证据**：先改测试断言（改到应指向修复后语义），跑 `npx vitest run tests/bridge/balance.test.ts`，在实现修复前得到真实 RED：

```
× fetchBalance — Kimi > parses the official Moonshot balance response shape (code/data/scode/status)
AssertionError: expected undefined to be close to 49.58894, received difference is NaN, but expected 0.000005
 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

（`info.totalCny` 在旧实现下是 `undefined`，NaN 差值证实断言确实在检验修复前的错误状态，非空转。）改 `balance.ts` 的 `totalUsd`→`totalCny`后重跑，GREEN：

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

全量回归：`npm test` → **164/164 passed**（断言内容调整，用例数不变）；`npm run typecheck` → 两段 exit 0。

**币种订正说明**：本卡两个余额 provider 现在的币种语义是——DeepSeek 按响应里的 `currency` 字段动态分流（USD→`totalUsd`，CNY→`totalCny`，都可能出现，取决于账户开户地）；Kimi 固定输出 CNY（Moonshot 平台本身只有人民币计价，不会返回 USD 分支），故 Kimi 恒用 `totalCny`，且 `totalUsd` 恒为 `undefined`。这与 pricing.ts 里 GLM/Kimi 价目表的 CNY→USD 折算是两回事——那里是"为了统一 costUsd 单位而做的价目层折算"，这里是"balance.ts 如实反映账户里实际货币的余额"，不应该也去做汇率折算（余额折算成 USD 会引入汇率时效性问题，且用户在 Moonshot 官网看到的就是 CNY 原始数字，balance.ts 应该如实对应，不该自作主张换算）。

**新 commit（不 amend）**：`fix(bridge): kimi balance is CNY not USD`。


