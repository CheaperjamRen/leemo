# Task B0 报告：网关欠账清偿

> BASE=8f3f8a2。执行者=Opus（Bridge 批首卡）。计划=docs/plans/2026-07-21-bridge-slice.md，简报=docs/sdd/br-b0-brief.md。

## 0. 结论速览

- **诊断分支答案：上游有 usage 帧（passthrough 路径）**。relay 在流末发一帧真实 usage（`prompt_tokens:4399, completion_tokens:10, cached_tokens:3840`），但它与 `finish_reason:"stop"` **落在同一次网络读**——vendor 内层循环遇 finish_reason 即 break，永远读不到那一行，故被丢弃；同时 message_start.input_tokens 硬编码 0。fixture 之所以过，是因为 fixture 把 usage 帧投到**单独一次读**里。
- **修法=纯自研（first-party）**，未触 vendor：在 vendor 前挂一个「嗅探」透传（原样转发 OpenAI 字节，顺路抓 usage），在 vendor 后挂一个「改写」透传（回填 message_start 估算、把真 usage 透传到末 message_delta 或 o200k 兜底）。**未触发 vendor 第 6 patch 站点 BLOCKED 门**。
- 全量测试 **85 passed**（BASE 69 → +16 新用例），typecheck 两段 exit 0。vendor LEEMO-PATCH 仍恰 5 处，零 vendor diff。

## 1. Step 1 诊断证据（smoke/relay-sse-probe.mjs）

**脚本**：`smoke/relay-sse-probe.mjs`（新增，未改任何既有 smoke/）。两次请求一趟跑完：A 带 `stream_options.include_usage:true`，B 不带。逐**网络读**分组记录每帧结构指纹（key 名/usage 数值/finish_reason/deltaKeys），**绝不落 delta.content 文本**，redact() 兜底。

**运行**（VPN 三件套）：`NODE_USE_ENV_PROXY=1 https_proxy=http://127.0.0.1:10801 http_proxy=… no_proxy=127.0.0.1,localhost node smoke/relay-sse-probe.mjs` → **status 200，一趟成功，无重试**。结果落 `smoke/results/relay-sse-probe-2026-07-21T04-29-10-526Z.json`（已核验：无 sk-/Bearer 形字符串，无 RELAY2 key 明文）。

**redacted 帧结构摘录（A：include_usage=true）**：

```
networkRead #0: delta{role}            finish_reason=null  hasUsage=false
networkRead #1..5: delta{content}      finish_reason=null  hasUsage=false
networkRead #6 (4 帧一次读):
   delta{content}                      finish_reason=null  hasUsage=false
   delta{content}                      finish_reason="stop" hasUsage=false   ← finish
   choicesLen=0 usage{prompt=4399,completion=10,cached=3840} hasUsage=true    ← usage 同读
   [DONE]
```

**关键量化**：`usageFrameCount=1`、`finishReasonReadIndex=6`、`usageReadIndex=6`、`usageSameReadAsFinish=true`。B（不带 stream_options）**也**发 usage 帧、同样同读到达——即本 relay 不依赖 include_usage 也发 usage。

**分支结论**：上游**确有** usage 帧 → 走**透传修复**（passthrough）。根因不是「上游不发」，而是「vendor 内层循环 break-on-finish_reason 丢掉同读后到的 usage 行 + message_start 硬编码 0」。因 vendor usage 代码（~471 message_start / 488-518 usage 映射 / 923 finish break）**远离既有 2 处 G2 PATCH 块**，且首方修复可达到正确语义，按简报优先选 first-party 路径，**未申请第 6 patch 站点**。

## 2. Step 2 usage 透传/回填（RED→GREEN）

**契约变更**：`openaiToAnthropicStream(upstream, streamOpts?)` 新增可选第二参 `{request?, opts?}`。省略=旧单参语义（vendor 输出原样，保后向兼容，有测试钉）。

**实现**（`src/gateway/core/translate.ts`，纯自研）：
1. `sniffUpstreamUsage`：vendor **之前**的透传，原样转发 OpenAI 字节，逐行 scrape usage（镜像 vendor 的 cached 扣减）写入 `sink.usage`。纯观察不改字节，vendor 解析不受影响——绕过了「break-on-finish 丢同读 usage」的坑。
2. `rewriteUsage`：vendor **之后**的透传，按 `\n\n` 切块改写：
   - `message_start.usage.input_tokens` ← 若 auto 且无上游 usage：countTokens(request) 的 o200k **前置估算**（非零→CC 自动 compaction 前提）。真 prompt_tokens 只在流末随 finish_reason 到达，**不缓冲整流则无法落到首帧**（不缓冲契约 server.test 钉死），故首帧用估算、末帧用真值。
   - 末 `message_delta.usage` ← 有 `sink.usage`：透传真值（input=prompt−cached，output，cache_read），**不打 leemo_estimated**；否则 auto：input=估算、output=累计输出文本的 o200k、打 `leemo_estimated:true`；off：留 vendor 的 0。
3. `provider-opts.ts` 新增 `usageBackfill:'auto'|'off'`（默认 'auto'）；`tokens.ts` 新增 `countText(string)`。
4. `server.ts` handleMessages 流式分支把 `{request: anthropicReq, opts: provider.opts}` 传入。

**回填标记的实现选择（用户拍板语义）**：回填发生时在**末 message_delta.usage 挂非标字段 `leemo_estimated:true`**。选它而非 translate 返回元信息，是因为流式产物是 ReadableStream，标记必须随流内联下游才拿得到；B2 的 `normalizeSdkStream` 在提取 usage 时读该字段即可置 `UsageRecord.estimated:true`。真 usage 透传路径**绝不**打此标记（防 B2 误判 + 防双计）。

**防双计证据**（branch1 实跑 vendor 后字节 dump）：
```
message_start.usage = {input_tokens:5, output_tokens:0}          ← 前置估算
message_delta.usage = {input_tokens:559, output_tokens:10, cache_read_input_tokens:3840}  ← 真值透传
hasEstimated = false
```
input 在两个事件各出现一次、各自是该事件正确值，**从不相加**；leemo_estimated 只在 branch2 出现。

**RED 证据**（`tests/gateway/pitfall-10-usage.test.ts` 增 4 用例 + fixture `sseGroupedStream` 复现「同读」live 形状）：
- 首跑：branch1 `expected 0 to be 559`（真 usage 被 vendor 丢）、branch2 `expected 0 to be 5`（无回填）双 FAIL；branch3（off 留 0）先天绿。
- 实现后：pitfall-10 **9/9 绿**。三分支：①真 usage 同读到达→透传+不标记 ②auto 无上游 usage→o200k 回填+标记 ③off→留 0 不标记。另加 no-arg 后向兼容用例。

## 3. Step 3 凑手×3 + 401 语义（RED→GREEN）

**registry RELAY2_OPTS 通道**（`registry.ts` fromEnv；新测试 `tests/gateway/registry.test.ts` 5 用例）：
- RED：merge 用例 + 「畸形 JSON 应报为 config 问题不静默吞」用例 FAIL。
- 实现：`RELAY2_OPTS` 可选 JSON env→解析→合入 relay2 opts；空白=视为无（空 opts）；畸形/非对象→推入 `missing`（dev.ts 既有 `missing.join` 打印，可读上报）不静默。测试注入假 env，不碰真 .env。GREEN 5/5。

**server.ts 三项**（`tests/gateway/server.test.ts` 增 5 用例，16/16 绿）：
- 凑手①（drain 竞态）：抽出 `export waitForDrain(res)`——drain 之外也监听 close/error 并**卸载全部监听**，杜绝「客户端中途断连→drain 永不触发→promise 永挂」。单测用假 emitter：只发 close 不发 drain，promise 仍 resolve，且 attached=detached=3（零泄漏）。这是真正钉住修复的用例（旧 `res.once("drain",resolve)` 在此假 emitter 下会永挂）。另有 backpressure+断连集成用例（mock 观测到上游连接关闭）。
- 凑手②（stripped 日志）：断言含 web_search/computer 的 strip 日志行存在且上游只收到 Read（此前功能已实现但**无测试**，G3 复审 Minor）。
- 低优（401/403→502）：RED=`expected 502 to be 401` 双 FAIL。实现：`upstreamErrorType` 移除 401/403 特判；`!upstream.ok` 分支特判 401/403→`sendError(502,"api_error","upstream auth failed …")`。客户端 401 **只**留给占位 token 无效（既有两用例仍绿，语义：网关 token 有效但上游 key 被拒=上游/配置问题，非客户端可重认证解决）。**旧 401 用例**：`bad/unknown placeholder token → 401` 与 `upstream 5xx → 5xx` **未改**（它们测的是别的语义，仍绿），无删除。

**凑手③（vendor backstop 谓词锁定）**（`pitfall-02` 增 2 用例，11/11 绿）：直打 `AnthropicTransformer.transformRequestOut`（**绕过 facade 预剥离**），喂 divergent shape（versioned `type` **且带** input_schema 的 computer_20250124）——若旧 `&& !input_schema` 子句复活，computer 会漏进 wireNames；锁定断言 wireNames=["Read"] 且 strippedServerTools=[computer,web_search]。补 client-tool（无 type/type:custom 带 schema）保留用例。此前 backstop 是热路径死代码、零覆盖（G2 复审 Minor）。

## 4. 文件清单

改（自研）：`src/gateway/core/translate.ts`（sniffer+rewriter+新签名）、`core/provider-opts.ts`（usageBackfill）、`core/tokens.ts`（countText）、`registry.ts`（RELAY2_OPTS）、`server.ts`（waitForDrain 抽取+调用、401/403→502）。
改（测试/fixture）：`tests/gateway/pitfall-10-usage.test.ts`、`pitfall-02-tooluse-serverstrip.test.ts`、`server.test.ts`、`fixtures/sse.ts`（+sseGroupedStream）。
新增：`smoke/relay-sse-probe.mjs`、`tests/gateway/registry.test.ts`、`smoke/results/relay-sse-probe-*.json`（诊断产物）。
**零**：vendor（5 LEEMO-PATCH 不变，git 无 vendor diff）、.env、CLAUDE.md、docs/NewmaxAI逆向报告/、smoke/ 旧文件。

## 5. 验收命令

`Set-Location E:\Leemo; npm test; npm run typecheck` → test **85 passed (16 files)**；typecheck 两段 exit 0。

## 6. 自查

- 诊断证据答分支？✅ usageSameReadAsFinish=true 直接解释「上游有帧但被 vendor 丢」；代码走 passthrough 与证据一致。
- 双计？✅ 有真 usage 只透传不打标；估算只在无上游 usage 时；input 每事件各出现一次非相加（byte dump 佐证）。B2 标记通道=`message_delta.usage.leemo_estimated`。
- 凑手三项各有测试？✅ 竞态（单测+集成）、stripped 日志（断言）、谓词锁定（直打 vendor divergent shape）。
- 401→502 旧用例更新非删除？✅ 无 401 用例被删；客户端 401 两用例（缺/未知 token）仍绿，上游 5xx 用例仍绿；新增 401/403→502 两用例。
- vendor 越界改动？✅ 无，git 零 vendor diff，5 patch 不变，未触发 BLOCKED 门。

## 7. Concerns

1. **message_start.input_tokens 是估算而非真值**（passthrough 分支）：真 prompt_tokens 流末才到，不缓冲整流则无法落到首帧（不缓冲契约禁缓冲）。取舍=首帧给 o200k 估算保证非零（CC 自动 compaction 靠它），末帧给真值。CC 的 compaction 触发用的是**运行中**的 input 计数，估算非零即达目的；若下游严格要首帧真值则需牺牲不缓冲——建议留给 B4 live 复核自动 compaction 是否真触发。
2. **o200k 估算与真 tokenizer 有偏差**：本就是近似（tokens.ts 既有约定），仅兜底用，且标 estimated。
3. **rewriter 假设 vendor 输出是规整的 `event:\ndata:\n\n` 块**：与 vendor 当前实现一致；若 vendor 升级改 SSE framing 需回归（vendor 已锁版本，低危）。
4. B（不带 stream_options）也发 usage 帧：说明 includeUsage 开关对本 relay 非必需，但保留该开关（别的 OpenAI-compat 端点可能 choke），无需改动。
