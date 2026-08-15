# Task G2 报告：转换核心适配层（13 坑 TDD 主战场）

**执行者：** Opus（本卡） · **BASE：** HEAD=84efc29 · **完成：** 54/54 tests green, typecheck 2-pass green

## 一、实现概览

三个自研纯函数模块（`src/gateway/core/`）+ 一个 token/端点面模块，全部经严格 root tsconfig（ES2022，无 DOM，严格 catch）类型检查；vendor 仅经 `dist/vendor-types` 的 `.d.ts` 声明消费（类型防火墙未被绕过，`--listFiles` 确认无 vendor `.ts` 进入 root program）。

| 文件 | 职责 | 公共 API |
|---|---|---|
| `src/gateway/core/provider-opts.ts` | per-provider 开关表 + 默认值 + resolve 合并 | `ProviderOpts`, `DEFAULT_PROVIDER_OPTS`, `resolveProviderOpts`, `EffortLevel` |
| `src/gateway/core/normalize.ts` | anthropic 请求预处理纯函数 | `normalizeThinking`(⑨) `stripServerTools`(②) `promoteToolResultImages`(⑧) `flattenToolSchema`(⑪) `EFFORT_BUDGET_MAP` |
| `src/gateway/core/translate.ts` | vendor 隔离门面（G3 只调它） | `anthropicToOpenAI` `openaiToAnthropicResponse` `openaiToAnthropicStream`(⑫) `OpenAIChatBody` |
| `src/gateway/core/tokens.ts` | count_tokens + 端点面分类（⑬） | `countTokens` `classifyEndpoint` `EndpointFace` |

**vendor 类型隔离验证：** `translate.ts` 对 vendor 的唯一引用是 `import { AnthropicTransformer }` + 三处 `new AnthropicTransformer(...)`（纯 value 用法，从不出现在参数/返回类型位）。公共签名只用 first-party/结构化类型（`AnthropicChatRequest`/`ProviderOpts`/`OpenAIChatBody`/`Record<string,any>`/`ReadableStream<Uint8Array>`）。无 `UnifiedChatRequest`/`UnifiedTool`/`TransformerContext` 泄漏。

**运行时接线（非 patch）：** vendor 的 `convertOpenAIResponseToAnthropic`/流方法**无条件**调用 `this.logger.debug(...)` 并读 `context.req.id`；门面注入 noop logger + `{req:{id:'leemo-gw'}}` context，属运行时配置而非源码修改。

## 二、逐坑 TDD 对照表

| 坑号 | 行为 | 测试文件:行 | RED / GREEN-on-vendor 证据 |
|---|---|---|---|
| ① 流式 tool_calls 参数拼接（含零参 `{}` 兜底） | `pitfall-01-stream-toolargs.test.ts:18,35` | **GREEN-on-vendor（钉住快照）**：vendor 流状态机已正确分片拼接 `input_json_delta`；零参工具走 content_block_start.input={} 无 partial_json。RED-A 阶段先对 throwing stub 失败。 |
| ② 含工具轮 stop_reason=tool_use + **server tools 显式剥离** | `pitfall-02-tooluse-serverstrip.test.ts:14,37,50,60,72` | stop_reason 映射=GREEN-on-vendor。**server 剥离 = 新代码+PATCH ②，genuine RED**：端到端 `:72` 未打补丁时 vendor 输出 `['Read','web_search','computer']`（见 red-B-patch2.txt），打补丁后=`['Read']`。first-party `stripServerTools` 从 throwing stub RED→GREEN。 |
| ③ content block index 跨类型单调映射 | `pitfall-03-block-index.test.ts:11` | **GREEN-on-vendor**：text→tool→tool 得 index 0,1,2 严格递增、start/stop 平衡、无重复。 |
| ④ tool id 全链路往返一致 | `pitfall-04-toolid-roundtrip.test.ts:14,24,44` | **GREEN-on-vendor**：请求侧 toolu_abc123 → assistant tool_call id + tool 消息 tool_call_id；响应侧/流侧 upstream id 原样透出。 |
| ⑤ cache_control 剥离 | `pitfall-05-cache-control.test.ts:21` | **GREEN**（含非空断言守卫）：夹具确含 cache_control，OpenAI body 全树无残留（vendor 系统块保留 + 门面 `stripCacheControl` 深删兜底）。 |
| ⑥ max_tokens 必填/clamp/max_completion_tokens | `pitfall-06-maxtokens.test.ts:13,20,26,32` | **新代码 RED→GREEN**：缺省填 4096；cap 只降不升；`maxTokensField` 改名并删 max_tokens。RED-A 对 throwing stub。 |
| ⑦ system 字符串/块数组拼接 | `pitfall-07-system.test.ts:11,21` | **GREEN-on-vendor**：string→单 system 消息；块数组各块文本齐全。 |
| ⑧ tool_result 嵌图片提升为 user 消息 | `pitfall-08-toolresult-image.test.ts:21,34,45,51` | **新代码 RED→GREEN**：`promoteToolResultImages` 把嵌套 image 提到独立 user 消息（tool_result 内不再有 image），端到端 image_url 存活，输入不可变。 |
| ⑨ reasoning/thinking 碎片化 + **按 provider 开关** | `pitfall-09-reasoning-gate.test.ts:17,24,31,36,43,51,56` | 归整=新代码 RED→GREEN（EFFORT_BUDGET_MAP low4000/medium12000/high24000/xhigh40000/max60000/default16000；无能力→disabled）。**gate=PATCH ①，genuine RED**：`:51` 未打补丁时 `reasoningInjection:'off'` 仍注入 `{effort:'high',enabled:true}`（见 red-B-patch1.txt），打补丁后=undefined；`:56` 'auto' 仍透传。 |
| ⑩ usage 映射（cached 扣减 + include_usage 可关） | `pitfall-10-usage.test.ts:12,28,39,44,49` | **GREEN-on-vendor**（映射）+ **新代码**（toggle）：input=prompt−cached；cache_read 透出；stream_options 仅流式+includeUsage 时出，false 时不出。 |
| ⑪ GLM 拒 anyOf/oneOf/$ref 扁平化 | `pitfall-11-schema-flatten.test.ts:24,28,33,40,47,53,59` | **新代码 RED→GREEN**：含非空守卫；anyOf/oneOf 塌缩到代表分支，$ref 对 $defs 内联解析，$defs 删除；保留 required；输入不可变；端到端 tools 无禁用关键字。 |
| ⑫ SSE 事件状态机 | `pitfall-12-sse-statemachine.test.ts:28,76,87,99,111` | **GREEN-on-vendor（快照钉住）**：event+data 成对、message_start→content_block_*→message_delta→message_stop 顺序、[DONE] 吞掉、ping 忽略、usage 落末 message_delta、text→tool 先关文本块再开工具块、零参工具完整块、字节级分片重组一致。2 处 `toMatchSnapshot`。 |
| ⑬ ?beta=true + count_tokens 端点面 | `pitfall-13-endpoint-count.test.ts:12,18,24,28,33,37,44` | **新代码 RED→GREEN**：/v1/messages?beta=true→{messages,beta:true}；count_tokens 子路径/models/health/unknown 分类；countTokens(o200k) 正数、确定、随内容规模增长。 |

## 三、TDD 证据（命令 + 输出摘录）

证据文件：`docs/sdd/g2-evidence/{red-A.txt, red-B-patch1.txt, red-B-patch2.txt}`

**RED-A（throwing stubs，vendor 未打补丁）** — 全部坑先对占位实现失败：
```
Test Files  13 failed | 1 passed (14)
     Tests  51 failed | 2 passed (53)
（2 passed = vendor-loads smoke + 一条非空守卫断言）
所有 51 pitfall 测试抛 "TODO ... not implemented"
```

**RED-B（first-party 实现完成，vendor 仍未打补丁）** — 只剩两处 patch 依赖失败，即两 patch 的 genuine RED：
```
LEEMO-PATCH #1 (reasoning gate) — pitfall-09:51
  expected reasoning undefined, Received: { effort:'high', enabled:true }
LEEMO-PATCH #2 (server-tool strip) — pitfall-02:72 (end-to-end)
  expected ['Read'], Received: ['Read','web_search','computer']
```

**GREEN（两 patch 应用后，全绿）：**
```
Test Files  14 passed (14)
     Tests  54 passed (54)
typecheck: tsc -p tsconfig.vendor.json && tsc -p tsconfig.json  → 0 errors
```

⑫ 快照（生成于 `tests/gateway/__snapshots__/`）验证 text→tool 规范序列：
`message_start, content_block_start, content_block_delta×2, content_block_stop, content_block_start, content_block_delta×2, content_block_stop, message_delta, message_stop`

## 四、两处 patch 站点

两处均在 `src/gateway/vendor/llms/src/transformer/anthropic.transformer.ts`，各带 `// LEEMO-PATCH:` 标注。`git diff --stat` = 单文件 13 insertions / 2 deletions。

**PATCH ① reasoning 注入门（line 191-192）：**
- Before: `if (request.thinking) {`
- After: `if (request.thinking && this.options?.reasoningInjection !== "off") {`
- 本质：无条件注入 → 受 `options.reasoningInjection` 门控；'off' 抑制，default/'auto' 保持上游行为。门面用 `new AnthropicTransformer({ reasoningInjection })` 传入。

**PATCH ② server tools 可观测剥离（line 246-247, convertAnthropicToolsToUnified）：**
- Before: `return tools.map(...)` 映射**全部**工具
- After: 先 `filter` 出 server 工具（有 versioned `type` 且无 `input_schema`，排除 `type:"custom"`）压入 `this.strippedServerTools`，只 map 剩余 client 工具
- 本质：静默丢弃（server 工具变 parameters:undefined 的畸形 function 工具）→ 显式剥离 + 暴露被剥列表供网关记日志。client 自定义工具透传不变。

## 五、变更文件清单

新增（本卡提交）：
- `src/gateway/core/provider-opts.ts` `normalize.ts` `translate.ts` `tokens.ts`
- `tests/gateway/fixtures/{sse.ts, anthropic-requests.ts}`
- `tests/gateway/pitfall-01..13-*.test.ts`（13 文件）
- `tests/gateway/__snapshots__/pitfall-12-sse-statemachine.test.ts.snap`
- `docs/sdd/g2-evidence/{red-A.txt, red-B-patch1.txt, red-B-patch2.txt}`
- 本报告 `docs/sdd/gw-g2-report.md`

修改（本卡提交）：
- `src/gateway/vendor/llms/src/transformer/anthropic.transformer.ts`（2×LEEMO-PATCH）

**未提交（非本卡）：** `CLAUDE.md`（用户既有改动 GLM5.2/Opus4.8，动工前即存在，不碰）；`docs/NewmaxAI逆向报告/`（用户素材，禁碰）。

## 六、自审发现

- ✅ 13 坑均有显式命名测试（名含坑号），断言真行为非空转；①②⑨ 断言实打实（①拼接+零参兜底、②端到端剥离名单、⑨门控 undefined/透传）。
- ✅ 新代码路径（⑥⑧⑪⑬ + normalize 各函数）RED-A 证据留存；vendor 已实现坑（①③④⑤⑦⑩⑫）诚实标注 GREEN-on-vendor（钉住测试）。
- ✅ 两 patch 站点各有 genuine RED（red-B-patch1/2.txt）→ 应用后 GREEN。
- ✅ 恰 2 处 LEEMO-PATCH（grep 确认）；均在 card 指定的 `anthropic.transformer.ts`（**核实**：reasoning 请求侧注入确在此文件 line 191，非 `reasoning.transformer.ts`——后者处理响应侧碎片化，不是请求注入点；故未 BLOCKED）。
- ✅ 公共 API 无 vendor 类型泄漏（AnthropicTransformer 纯 value 用法）。
- ✅ typecheck 两遍绿；`--listFiles` 确认防火墙完好（vendor 仅 .d.ts 进 root）。
- ✅ 无明文 key / 无“幸运鹿/LuckyDeer/Lulu”（grep 确认）。测试输出 pristine（54 pass 无 stderr 噪声——vendor 内部 console.error 未在正常路径触发）。
- ✅ vendor 未碰 tests/gateway/vendor-loads.test.ts、smoke/、.gitignore、vitest.config.ts。

## 七、问题 / 关注

1. **⑧ 图片提升的占位文本**：当 tool_result 内容全是图片时，剥离后留 `[image content moved to a following message]` 文本占位（tool_result 不能空）。这是设计选择——保持 tool_call_id 配对完整同时不丢图；G3/真端点联调时可复核 provider 是否接受该措辞。
2. **⑨ vendor `getThinkLevel` 与 NewMax EFFORT_BUDGET_MAP 的关系**：本卡的 `normalizeThinking` 产出 anthropic 侧 `thinking.budget_tokens`（NewMax 图纸值）；vendor 内部再用自己的 `getThinkLevel(budget)` 折算成 none/low/medium/high 四档 effort。两者不冲突（前者是我们的预算规整，后者是 vendor 的 effort 分档），但真端点是否吃 effort 字段需 G4 live 验证。
3. **⑩/⑫ usage 落点依赖分帧**：vendor 状态机在 `finish_reason` 处 break 内层循环，故末尾 usage-only chunk 必须在**独立 read** 到达才会被采集。测试用 `sseEventStream`（一事件一 read，真实流式行为）覆盖；若真端点把 usage 和 finish_reason 塞进同一 SSE 帧，vendor 仍能拿到（同 chunk 的 `chunk.usage` 在 finish_reason 分支内也读），但**若 usage 单独帧且紧跟 [DONE] 无分隔**行为已被 `pitfall-12:99` 钉住。G4 live 需复核真端点分帧。
4. count_tokens 用 o200k_base 近似（Claude 真 tokenizer 闭源）；仅供 CC compaction 估算，非精确计费。

---

## §修复轮（复审 Approved-with-fixes → 已修）

复审：Approved 方向正确 + 1 Important（server-tool 判定双源分歧 + 剥离列表未经 facade 暴露）+ 1 Minor（⑨预算断言自引用）。均严格 TDD 修复。

### Important：判定单源化 + facade 暴露剥离列表

**根因：** 两处"什么算 server tool"定义不一致——
- 自研 `normalize.stripServerTools`：`type !== "" && type !== "custom"`（类型判据，无 input_schema 条款）
- vendor PATCH ②（旧）：`type !== "" && type !== "custom" && !tool?.input_schema`

对"带版本化非 custom type **且带** input_schema"的工具（如 `{type:"computer_20250124", input_schema:{...}}`），两者判定相反：normalize 判其为 server tool（应剥），旧 vendor 判据因 `&& !input_schema` 判其保留 → 日志与 wire 不一致。且 facade `anthropicToOpenAI` 旧签名只返回裸 body，从不读 `strippedServerTools`，任务卡要求的"返回被剥列表"经 G3 唯一入口不可达。

**修法：**
1. **单一谓词源**：normalize.ts 新增导出 `isServerTool(tool): boolean`（唯一定义=类型判据，显式不看 input_schema，注释说明 input_schema 条款正是分歧根源）。`stripServerTools` 改调它。
2. **facade 主动剥离 + 暴露**：`anthropicToOpenAI` 在进 vendor **前**先调 `stripServerTools`（first-party 唯一 ACTIVE 剥离），返回值签名改为 `{ result: OpenAIChatBody, stripped: AnthropicTool[] }`。`stripped` 即实际离开请求的工具，与 wire tools 证明一致（不依赖读 vendor 内部字段）。
3. **vendor PATCH ② 对齐**：删除 `&& !tool?.input_schema`，判据与 `isServerTool` 字面一致 + 加 `// Keep in sync with normalize.isServerTool` 交叉引用注释；降级为 defense-in-depth backstop（正常路径工具已被 facade 预剥）。**仍在既有 PATCH ② 站点内改，未新增第三处 PATCH**（grep LEEMO-PATCH=2；vendor diff=3 insert/2 delete）。

**公共 API 签名变更（写进契约）：**
- 旧：`anthropicToOpenAI(req, opts?): Promise<OpenAIChatBody>`
- 新：`anthropicToOpenAI(req, opts?): Promise<{ result: OpenAIChatBody; stripped: AnthropicTool[] }>`（新增导出类型 `AnthropicToOpenAIResult`）。G3 调用方需 `const { result, stripped } = await anthropicToOpenAI(...)`。normalize 新增导出 `isServerTool`。

**TDD 证据：** `docs/sdd/g2-evidence/red-C-review.txt`
- RED（tests written, impl 未改，focused 2 文件）：`Tests 7 failed | 9 passed (16)`。关键失败：`isServerTool` 未导出；分歧形状 `{type:computer_*, input_schema}` 端到端未一致剥离；facade 未返回 stripped；旧签名致 `{result}` 解构得 undefined→`Cannot read properties of undefined (reading 'reasoning')`。
- GREEN（修后 focused）：`Tests 16 passed (16)`；全量 `58 passed (58)`；typecheck 2-pass exit 0。

新增测试（pitfall-02）：
- `isServerTool predicate is the single definition (type-based, ignores input_schema)` — 断言带 input_schema 的 computer_* = true，Read/custom = false
- `divergent shape ... stripped consistently` — 构造 `{type:computer_20250124, input_schema}`，断言 wire tools=['Read'] **且** facade stripped=['computer'] 一致
- `facade exposes the stripped list so G3 reaches it WITHOUT touching vendor`
- `facade stripped list is empty when only client tools`

### Minor：⑨ 预算断言字面值钉死

旧断言 `expect(budget).toBe(EFFORT_BUDGET_MAP.high)` 从实现同款常量取值再比较——map 打错也过。改为字面值：low=4000/medium=12000/high=24000/xhigh=40000/max=60000/default=16000，并加 `expect(EFFORT_BUDGET_MAP).toEqual(expected)` 与 `expect(DEFAULT_THINKING_BUDGET).toBe(16000)` 守卫实现常量。这些断言修前即 PASS（实现常量本就正确）——本 Minor 是**测试质量**修复（消除自引用），非行为 bug。

### 修复轮命令 + 输出

```
# RED（focused, impl 未改）
npx vitest run pitfall-02 pitfall-09  → Tests  7 failed | 9 passed (16)

# GREEN（focused）
npx vitest run pitfall-02 pitfall-09  → Tests  16 passed (16)

# 全量 + typecheck
npx vitest run                        → Test Files 14 passed (14) / Tests 58 passed (58)
npm run typecheck                     → exit 0（tsc vendor && tsc root 均绿）
grep -c LEEMO-PATCH ...transformer.ts → 2
git diff --stat vendor/               → 1 file, 3 insertions(+), 2 deletions(-)
```

### 修复轮变更文件
- `src/gateway/core/normalize.ts`（+`isServerTool` 导出，`stripServerTools` 改调它）
- `src/gateway/core/translate.ts`（签名→`{result,stripped}`，进 vendor 前 first-party 剥离，+`AnthropicToOpenAIResult` 导出）
- `src/gateway/vendor/llms/src/transformer/anthropic.transformer.ts`（PATCH ② 判据对齐，仍 2 处 PATCH）
- 9 个 pitfall 测试文件（call-site 改 `{result: openai}` 解构；pitfall-02 +4 新测试 + `isServerTool` import；pitfall-09 字面值 + guard）
- `docs/sdd/g2-evidence/red-C-review.txt`（新增 RED 证据）

### 修复轮自审
- ✅ Important 先写失败测试（分歧形状 + facade 可达性）留 RED 证据再修；判定单源=`isServerTool`，vendor/normalize/facade 三处同据。
- ✅ facade 返回被剥列表，G3 经 translate 唯一入口即可拿（不触 vendor）；签名变更已入报告契约。
- ✅ 仍恰 2 LEEMO-PATCH，未扩 patch 面（vendor diff 3/2 行，仅 PATCH ② 块内）。
- ✅ Minor：⑨ 全档字面值 4000/12000/24000/40000/60000/16000 钉死 + 实现常量守卫。
- ✅ 全量 58/58，typecheck 2-pass 绿，无禁词/明文 key，测试输出 pristine；CLAUDE.md / NewmaxAI逆向报告/ / smoke/ 未碰。
