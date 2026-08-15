# Phase 0 可行性验证报告

> 日期：2026-07-20 ／ SDK：@anthropic-ai/claude-agent-sdk@0.3.210（精确锁定）／ 执行机：Windows（Node v24.16.0）
> 证据文件：`smoke/results/`（本地保留，gitignore 未入库）；复现命令见 `docs/plans/2026-07-19-phase0.md` Task 5
> 权威设计文档：`docs/specs/06-Leemo-产品设计文档-v1.0.md`（下称"06 号"）
> 执行方式：本次在 HEAD=fdbce8d（harness 历经四轮修复）逐项独立 `node` 调用重跑全量；DeepSeek 亦在 HEAD 重跑以统一证据版本（旧 results 作历史保留）。

## 一、五项核心验证矩阵

| 验证项 | DeepSeek (deepseek-chat) | GLM (glm-5.2) | Kimi (kimi-k2.5) |
|--------|--------------------------|---------------|------------------|
| ① 流式 streamEvents | **PASS** · streamEvents=57 · success · 2.9s | **PASS** · streamEvents=13 · success · 5.6s | **ERROR** · 401 Invalid Authentication · 187s |
| ② 工具调用 toolsUsed | **PASS** · [Read,Write] · answer=`obsidian-7413` · 5.9s | **PASS** · [Glob,Read,Write] · answer=`obsidian-7413` · 13.9s | **ERROR** · 401（同一凭证级失败） |
| ③ 多轮 finalText 含暗号 | **PASS** · "蓝色鲸鱼 42" · assistantTurns=4 · 4.1s | **PASS** · "蓝色鲸鱼 42" · assistantTurns=2 · 7.2s | **ERROR** · 401 |
| ④ 子 agent Task 工具 | **PASS** · toolNames=[Agent,Glob] · answer 计数=3（列 alpha/beta/gamma.txt）· 7.4s | **PASS** · toolNames=[Agent,Glob] · answer 计数=3 · 15.0s | **ERROR** · 401 |
| ⑤ 压缩 pre/post_tokens | **PASS** · manual · 22189→3984 · 召回"紫色大象 88" · 88.7s | **PASS** · manual · 21146→2864 · 召回"紫色大象 88" · 61.4s | **ERROR** · 401 |

注：⑤为 resume + 字符串 `/compact` 斜杠命令手动触发（摘要请求真实走各 provider）；messageTypes 序列含 `system:compact_boundary`，证明命令被识别并路由。自动触发需 10 万级 tokens 灌注，未测，留 Phase 1 长会话观察。④的工具名实测为 `Agent`（非 init.tools 标注的 `Task`），详见 §五。

## 二、四项探测结果

| 探测 | 结果 | 对后续设计的含义 |
|------|------|-----------------|
| P1 SDK resume | **ok**：DeepSeek 召回=7 / GLM 召回=7；Kimi 401 | 06 §六：resume **可靠**（两家满血端点均正确召回）→ 持久化以 resume 为主，无需 Bridge 历史重放降级 |
| P2 AnySearch 直连 | **ok**：www.anysearch.com=200 / api.anysearch.com=404（provider 无关，各轮一致） | 06 §四：**可达** → 默认联网源成立，fallback 链首位无需换用户 key 源 |
| P3 中转站原生 Anthropic | **ok**：niubiapi.com `/v1/messages`=200，返回原生 Anthropic 形状 body，model=gpt-5.6-luna | 06 §三：**是**（中转站原生提供 Anthropic 协议）→ 网关对该中转站非必需 |
| P4 canUseTool | **ok**：DeepSeek/GLM 的 `default` 模式 Write 均经 canUseTool 回调；Kimi 401 | 06 §2.9：审批条机制基础**成立**；但模型写入路径非确定，审批条须强约束写入范围（见 §五） |

注：probes 中 P2/P3 与 provider 无关，三家重复跑结果一致；Kimi 的 P1/P4（走 SDK）同样 401 ERROR，P2/P3 正常 ok（证明"provider 凭证失效不影响与 provider 无关的探测"）。

## 三、失败与异常记录

1. **Kimi 全 SDK 检查 401** — 现象：五项核心验证（streaming/tools/multiturn/subagent/compaction）与 resume/canUseTool 探测**全部**返回 `Failed to authenticate. API Error: 401 Invalid Authentication`（脱敏后 JSON 内无明文 key，仅存该错误串）。原始错误摘录：`Claude Code returned an error result: Failed to authenticate. API Error: 401 Invalid Authentication`。各项耗时含 SDK 重试：streaming 187s／tools 183s／multiturn 359s／subagent 179s／compaction 365s／probes 371s。初判：**凭证级**失败（非 model_not_found）——端点 `api.moonshot.cn/anthropic` 可达并按协议返回 401，说明 `KIMI_API_KEY` 无效/过期/额度耗尽。是否阻塞：**不阻塞 Phase 0**（06 §八 DeepSeek 满血制，判定不依赖 Kimi）。处置：按 Global Constraints「不猜测重试其它模型名」，原样记录；**待用户确认/更换 KIMI_API_KEY 后复跑**。
2. **relay-anthropic 历史瞬断** — 历史一轮曾 `fetch failed`，本批 DeepSeek/GLM 两轮 `/v1/messages` 均 200。初判：瞬时网络抖动。不阻塞（P3 结论以稳定的 200 为准）。
3. **canUseTool 写入路径非确定** — 见 §五「模型臆造路径」。属行为级发现，非 harness bug；不阻塞 Phase 0，但对 06 §2.9 审批条设计有强约束意义。
4. **（守则②）compaction "Not enough messages"** — GLM 未出现（堆料 pre_tokens≈21k 足量，正常产生 boundary）。Kimi 因 401 未进入 compaction 逻辑，无法评估其 verbosity；如后续换 key 复跑仍报该串，应记为「堆料量对该模型 verbosity 不足」的敏感点，**不得据此下"不支持压缩"结论**。
5. **（守则④）streamEvents 阈值** — DeepSeek=57、GLM=13，均 ≥5，无落 1-4 区间情形，阈值维持不变。
6. **未发现 harness bug**（Task 5 铁律：只跑不改）。四轮修复后的机制（工具双名检测、compaction 三段式、canUseTool 证据链、脱敏）在本批全部按预期工作。

## 四、PASS 判定（06 号 §八：DeepSeek 满血制）

- **DeepSeek 五项：5/5 → PASS**（① streamEvents=57 ／ ② obsidian-7413 落盘 ／ ③ 召回"蓝色鲸鱼 42" ／ ④ Agent 工具+计数=3 ／ ⑤ 22189→3984 且召回"紫色大象 88"）。四项探测 4/4 ok。
- GLM 记录：**5/5 checks + 4/4 probes**（同为满血端点，非降级；作为 DeepSeek 不可用时一线候选，成绩已备）。
- Kimi 记录：**ERROR（401，key 待确认）**；端点可达，凭证被拒。
- **结论：Phase 0 PASS。** 收口，进入下一批（02 规格 v2.0 + 网关竖切）。（无需候选顶上：DeepSeek 满血达标。）

## 五、给下一阶段的事实清单（后续任务卡直接引用）

- **模型名实测**：DeepSeek=`deepseek-chat`（有效）／GLM=`glm-5.2`（有效）／Kimi=`kimi-k2.5`（端点可达，本批 `KIMI_API_KEY` 401，待换 key 复跑）。三家 baseUrl 见 `smoke/providers.mjs`。
- **工具双名（Agent/Task）**：SDK 0.3.210 下 `system:init` 的 tools 数组把派生工具标为 `Task`，但模型实际发出的 `tool_use.name` 是 `Agent`（DeepSeek、GLM 两家一致）。→ Bridge/审批条/工具白名单的工具名匹配**必须同时认 `Task` 与 `Agent`**，否则漏判子 agent 派生。
- **compact 机制**：①流式输入中途的纯文本 `/compact` 不走斜杠命令解析（不产 boundary）；必须 **resume + 字符串 prompt** 才路由到本地斜杠命令。②极简会话下 `/compact` 返回 "Not enough messages to compact."（无 boundary）；须先堆足上下文（实测 pre_tokens≈21-22k）compact 才真正发生并产 boundary + 召回存活。③自动触发需灌 10 万+ tokens，不在 smoke 范围，留 Phase 1 长会话观察。
- **模型臆造路径（行为级发现，必须强约束）**：canUseTool 回调 **100% 被调用**（机制可靠），但模型选择的写入路径**非确定**——历史三轮分别臆造三个 cwd 外绝对路径 `\root\probe.txt`、`\workspace\probe.txt`、`\Users\AZ\advent.2024\probe.txt`，且在 **E 盘根真实创建了目录树**（`E:\Users\AZ\advent.2024` 至今在盘，`E:\Users` 下另有多个同类臆造树）；HEAD 重跑时 DeepSeek/GLM 两家又写在了 cwd 内（writtenInCwd=true）。→ **Leemo 产品的审批条/工作区隔离必须强约束写入范围**：对 cwd 外的绝对路径写入一律拦截或重写回工作区，**不能假设模型永远写在工作区内**。这是 06 §2.9 审批条与工作区沙箱设计的硬性输入。
- **中转站原生协议**：`niubiapi.com` 原生提供 Anthropic `/v1/messages`（200，原生 body，模型 `gpt-5.6-luna`）→ 06 §三 网关对该中转站**非必需**（可直连）。
- **AnySearch 可达**：`www.anysearch.com`=200、`api.anysearch.com`=404，各 provider 各轮一致 → 06 §四 默认联网源成立。
- **resume 可靠**：DeepSeek/GLM 两家 resume 均正确召回上一轮信息 → 06 §六 持久化以 resume 为主，无需历史重放降级。
- **canUseTool 可用**：`permissionMode:'default'` 下 Write 必经 canUseTool 回调（返回 `{behavior:'allow'|'deny'}`）→ 06 §2.9 审批条 UI 机制基础成立。
- **各端点耗时量级**：单次简单 check——DeepSeek 3-8s／GLM 6-15s；compaction（三段式）——DeepSeek 88.7s／GLM 61.4s；Kimi 401（含 SDK 重试）单项 179-371s（streaming 187／tools 183／multiturn 359／subagent 179／compaction 365／probes 371）。
- **usage 量级**：系统提示占大头，单次 `input_tokens`≈18-19k（DeepSeek 18975／GLM 17899），`output_tokens` 极小（11-50）；compaction `pre_tokens`≈21-22k → `post_tokens`≈3-4k。费用未单独采集（check 未捕获 `total_cost_usd`），量级由 token 数推断；后续如需精确成本，在 Bridge 层统一读 `result.total_cost_usd`。

## 六、Kimi 复跑补记（2026-07-20，换 key 后）

（本节为换 KIMI_API_KEY 后的补跑记录；§一矩阵/§三.1/§四中 Kimi 行以本节为准。）

新 `KIMI_API_KEY` 生效，401 消失，端点 `api.moonshot.cn/anthropic` 五项核心验证 + 四项探测全部走通。逐项独立调用，结果如下：

| 验证项 | 结果 | 关键 details | 耗时 |
|--------|------|--------------|------|
| ① 流式 streaming | **PASS** | streamEvents=52 · subtype=success · input_tokens=17817（cache_read=1792）· output_tokens=47 | 6.9s |
| ② 工具调用 tools | **PASS** | toolsUsed=[Read,Read,Write] · answerContent=`obsidian-7413` | 10.5s |
| ③ 多轮 multiturn | **PASS** | finalText="蓝色鲸鱼 42" · assistantTurns=4 | 4.4s |
| ④ 子 agent subagent | **PASS** | taskToolUsed=true · toolNames=[Agent,TaskOutput,Glob] · subagentActivity=5 · answer 含"3 个"+alpha/beta（gamma 因 details.answer 存储时 slice(0,150) 截断，非模型漏报——check 判定式为 `/3|三/.test(answer)` 对完整 result.result 做正则，非对截断后的 details 做二次校验，数量断言真实成立） | 19.5s |
| ⑤ 压缩 compaction | **PASS** | trigger=manual · pre_tokens=22173→post_tokens=2301 · 召回"紫色大象 88" · messageTypes 含 `system:compact_boundary` | 115.3s |
| 探测 probes | resume ok=true（召回=7）／anysearch ok=true（www=200,api=404）／relay-anthropic **ok=false**（`TypeError: fetch failed`，与 §三.2 历史瞬断同性质，P2/P3 已知与 provider 无关，niubiapi 端点本身在 DeepSeek/GLM 轮次为 200，本次判瞬时网络抖动，不因换 key 而变）／canusetool ok=true（writtenInCwd=true，写入 `smoke/workspaces/kimi-canusetool-*/probe.txt`，foundContent=`hello`） | 各探测数秒级 |

五项核心验证 **5/5 PASS**，四项探测 **3/4 ok**（relay-anthropic 瞬断，判定与凭证无关，不影响 Kimi 满血结论）。守则②（compaction "Not enough messages"）本轮**未触发**——堆料 pre_tokens=22173，与 DeepSeek/GLM 同量级，boundary 正常产生，说明该串此前未见并非 Kimi 特性问题，而是 401 期间从未进入 compaction 逻辑。

### kimi-k3 可用性探测

`GET /v1/models`（Bearer 鉴权，未回显 key）返回 12 个模型，含 `kimi-k3`（无其他 `k3-*` 变体）：

```
kimi-k2.5, kimi-k2.6, kimi-k2.7-code, kimi-k2.7-code-highspeed, kimi-k3,
moonshot-v1-128k, moonshot-v1-128k-vision-preview, moonshot-v1-32k,
moonshot-v1-32k-vision-preview, moonshot-v1-8k, moonshot-v1-8k-vision-preview,
moonshot-v1-auto
```

以 `KIMI_MODEL=kimi-k3` 覆盖后跑两项探测（Anthropic 兼容端点 `api.moonshot.cn/anthropic`）：

| 探测 | 结果 | 关键 details | 耗时 |
|------|------|--------------|------|
| streaming | **PASS** | streamEvents=19 · subtype=success · input_tokens=19219（cache_read=512）· output_tokens=27 | 16.1s |
| tools | **PASS** | toolsUsed=[Read,Write] · answerContent=`obsidian-7413` | 71.0s |

**结论：**
- **Kimi (kimi-k2.5)：满血**。新 key 生效，5/5 核心验证 + 3/4 探测（第 4 项 relay-anthropic 为已知瞬断，与 Kimi 凭证无关）全部通过，性能量级（6-20s 单项，compaction 115s）与 DeepSeek/GLM 同一数量级，无降级迹象。§一矩阵/§三.1/§四判定自本节起以此为准：Kimi 由 ERROR（401）更正为 **PASS**。
- **kimi-k3 经 Anthropic 兼容端点可用性：√（`kimi-k3`）**。模型列表确认存在，streaming/tools 两项探测 PASS，可作为后续前端试镜候选模型名；本节仅为可用性探测，未纳入五项核心矩阵正式复跑范围。

## 七、网关竖切 Live 验收（2026-07-21，Task G4）

> 日期：2026-07-21 ／ SDK：@anthropic-ai/claude-agent-sdk@0.3.210 ／ 执行机：Windows（Node v24.16.0）／ 仓库 HEAD=96cb0b3（G1–G3 完成过审，网关 69/69 单元+快照测试绿）
> 目的：本地协议网关竖切的**活体证明**——启动真实网关，SDK 经 `ANTHROPIC_BASE_URL` 指向网关，网关以**纯 OpenAI 协议**转发到用户中转站（`RELAY2_*`，`gpt-5.6-luna`），把 §一 的五项核心验证原样（`smoke/checks.mjs` 五个导出函数，未改一字）跑通。
> 运行器：`smoke/gateway-live.mjs`（新增，未改任何既有 smoke 资产）；复现命令 `Set-Location E:\Leemo; node smoke\gateway-live.mjs --check all`。证据 JSON：`smoke/results/gateway-relay2-*.json`（gitignore 未入库）。
> 链路：`claude-agent-sdk ──ANTHROPIC_BASE_URL──▶ 127.0.0.1:<port> (Leemo gateway) ──OpenAI /chat/completions──▶ niubiapi 中转站`。

### 五项矩阵（全部经网关，非直连）

| 验证项 | 结果 | 关键 details | 耗时 |
|--------|------|--------------|------|
| ① 流式 streaming | **PASS** | streamEvents=14 · subtype=success · is_error=false（网关 SSE 状态机把上游 OpenAI 增量转成 ≥5 个 Anthropic `stream_event` 并正常收束）| 15.2s |
| ② 工具调用 tools | **PASS** | toolsUsed=[PowerShell,PowerShell,Read,Write] · answerContent=`obsidian-7413`（含工具轮次 stop_reason=tool_use、tool_id 往返、写盘落地全链路通）| 75.5s |
| ③ 多轮 multiturn | **PASS** | finalText="蓝色鲸鱼 42" · assistantTurns=2（同 session resume 召回上一轮暗号）| 8.5s |
| ④ 子 agent subagent | **PASS** | taskToolUsed=true · toolNames=[**Agent**,Glob] · subagentActivity=3 · answer 列 alpha/beta/gamma 且明写"3 个"（子 agent 派生/回收经网关正常；工具真名 `Agent` 与 §五 一致）| 16.3s |
| ⑤ 上下文压缩 compaction | **PASS** | trigger=manual · messageTypes 含 `system:compact_boundary` · post_tokens=2595 · 召回"紫色大象 88" · subtype=success（resume+字符串 `/compact` 经网关触发压缩管线，boundary 产出且召回存活）| 107.7s |

**五项 5/5 PASS ⇒ 网关竖切达成（阈值 ≥4/5，实测满分）。**

### 密钥隔离活体证据（铁律核验）

运行器**从不**调用 `loadEnv()`／`loadEnvFile()`，故其 `process.env` 全程无 `RELAY2_API_KEY`；`checks.mjs` 的 `buildEnv()` 以 `...process.env` 展开生成 SDK 子进程 env，运行器无 key ⇒ 子进程 env 只可能拿到占位 token。真 key 只活在**网关子进程**内存（`dev.ts` 自身 `loadEnvFile` 读 `.env`）。结果 JSON 的 `isolation` 字段实测：

```
ANTHROPIC_BASE_URL      = http://127.0.0.1:<port>   (指向网关)
ANTHROPIC_AUTH_TOKEN    = leemo-gw:relay2           (占位 token，非真 key)
ANTHROPIC_API_KEY       = ""                         (空)
childEnv_has_RELAY2_API_KEY        = false           (子进程 env 无真 key)
childEnv_keyShapedValues           = []              (子进程 env 无 sk-/Bearer 形状值)
runner_process_env_has_RELAY2_API_KEY = false        (运行器进程亦无真 key)
```

泄漏扫描：`Select-String -Path smoke\results\*.json -Pattern 'sk-[a-zA-Z0-9]{8}'` → **零命中**（新增 `gateway-live.mjs` 及本轮 `gateway-relay2-*.json` 亦零命中；结果与日志双层脱敏 = `lib.redact` + `sk-/Bearer` 形状正则兜底）。

### 观察与归因（不放水记录）

1. **streaming 的 `usage` 全零**、**compaction 的 `pre_tokens=0`**：功能断言全部成立（事件数、boundary、召回、落盘均真实通过），但经网关时 SDK 侧读到的 token 计数为 0——直连端点（§一/§六）为 `input_tokens≈18k`、`pre_tokens≈21-22k`。归因：网关响应/SSE 的 **usage 映射（13 坑之⑩）** 未把上游 OpenAI 的 `usage`/`stream_options.include_usage` 透传/换算到 Anthropic 字段，或该中转站流式未回 usage。属**网关侧计量口径问题，不影响本次五项功能判定**（判定式不依赖 token 数），但对后续"Bridge 层统一读 `result.total_cost_usd`/成本采集"是硬约束——**记为 G2/G3 后续卡的整改点**（本卡禁改网关代码，仅归因记录）。
2. **compaction 耗时 107.7s**：与直连量级（DeepSeek 88.7s／GLM 61.4s／Kimi 115.3s）同级，堆料/触发/召回三段经网关无异常，未触 10 分钟 abort。
3. **未发现阻断性网关 bug**：五项功能全通；上述计量口径为非阻断观察，已按铁律回报 G2/G3。

**结论：网关竖切 Live 验收 PASS（5/5）。** 本地协议网关使 claude-agent-sdk 经纯 OpenAI 协议中转站跑通 Phase 0 全部五项核心能力，密钥隔离铁律活体核验通过。竖切达成，A 线收口。

---

## 八、Bridge 竖切 Live 验收（Task B4）

> runner：`smoke/bridge-live.mjs`（新增）。真 SDK `query()` 适配成 pool 的注入式 `QueryFn`，经同一 `createBridge` 并发驱动两对话：A=DeepSeek 直连（apiFormat anthropic），B=relay2 经网关（apiFormat openai）。BASE=424be24，VPN 三件套下单跑。结果：`smoke/results/bridge-live-2026-07-21T16-11-30-360Z.json`。

### 核心 7 条判据矩阵（7/7 PASS）

| # | 判据 | 结果 | 实测证据 |
|---|------|------|----------|
| 1 | 双接线事件流完整 | **PASS** | A/B 各含 `conversation.started`/`text.final`/`run.finished(success)`；A 含真工具轮 `Read/Glob/Read/Write`（tool.started×4, tool.finished×4，answer.txt 实写 `MOMO-7413`） |
| 2 | usage.final 非零 + cost | **PASS** | DeepSeek inputTokens=21821, cost `$0.162483`(sdk)；relay2 经网关 inputTokens=**18828**(>0), cost `$0.094465`(sdk) |
| 3 | tokensEstimated 结论(risk#2) | **PASS(已观测)** | relay2 经网关 `tokensEstimated=false`, `costSource=sdk`（结论见下） |
| 4 | 密钥隔离(relay2 网关) | **PASS** | 子进程 env：`ANTHROPIC_AUTH_TOKEN=leemo-gw:relay2`、`ANTHROPIC_API_KEY=""`、无 `RELAY2_API_KEY`、无兄弟 `DEEPSEEK_API_KEY`、`keyShapedValues=[]` |
| 5 | 审批桥 live | **PASS** | canUseTool 被真 SDK 回调 2 次（Read/Write），broker→fake transport 往返 allow-once，工具经审批放行后真的执行 |
| 6 | resume 续轮召回 | **PASS** | A 第二轮 resume（pool 自动带 round1 session_id）召回暗号，finalText=`MOMO-7413`，success |
| 7 | CONFIG_DIR 隔离 | **PASS** | `<dataDir>/providers/deepseek/` 与 `.../relay2/` 各自落盘、互不串 |

> 归因备注（c4）：首跑（`...16-10-12`）c4 曾 FAIL——`keyShapedValues=[GLM_MODEL]`，系 harness 的 key-shape 正则把**模型名** `glm-5.2`（`GLM_MODEL` 的值）误判为密钥（`glm-` 前缀）。**非真泄漏**（真 key 四项断言全绿）。归因=**harness 启发式过宽**：已收紧（排除 `_MODEL/_URL` 配置变量名 + key-shape 前缀要求值长 ≥20），复跑 `keyShapedValues=[]`，c4 PASS。B1 `sanitizeHostEnv` 行为本身正确（`GLM_MODEL` 非密钥形名，正确保留）。

### 三个待验证假设结论（B4 核心目的，如实记录）

1. **risk#1（stream_event→text.delta 是否产出）：确实产出。** events.ts 防御式可选链在真 SDK 下正确命中 `content_block_delta`/`text_delta`：DeepSeek 直连 43 个 text.delta（另 thinking.delta 亦产出，证 `thinking_delta` 分支同样命中）；relay2 经网关 9 个 text.delta（网关 SSE 翻译保真到可产出增量）。risk#1 关闭。
2. **risk#2（leemo_estimated 是否流穿 result.usage）：未流穿——`tokensEstimated=false`。** relay2 经网关对话最终 `UsageRecord.tokensEstimated=false`，`costSource=sdk`，`inputTokens=18828`（非零）。观测事实：真 SDK 把 result.usage 由**流末** message_delta 的真实 usage 聚合，B0 挂在 message_start 的 `leemo_estimated:true` 估值标记**不进入** result.usage（被最终真值取代或被 SDK 聚合剥离）。这与 §七"经网关 usage 全零"的观察形成对照——**B0 修复已生效**：经网关 usage 不再为零（18828>0），且最终值即真值故无需标估算。risk#2 关闭（结论=标记不流穿，UsageRecord 落 false 属正确行为）。
3. **B0 concern（自动 compaction 经网关是否受估值影响）：未主动触发，留观测。** 自动压缩需堆 10 万+ tokens（成本高），本 live 卡不烧。已知：手动 `/compact` 经网关的压缩管线在 §七 checkCompaction 实测 PASS（boundary+召回存活），证**压缩管线本身经网关可用**；估值驱动的**自动触发**保真度留待专门压测卡（非阻断）。

### best-effort 探测

- **DeepSeek 余额（balance.ts live）：PASS。** `fetchBalance(deepseek)` → `supported=true, totalCny≈25.5, toppedUp≈25.5`，实证 balance.ts 对 DeepSeek `/user/balance` 的响应形状假设（字符串金额→Number）正确。
- **ask_user MCP live：未触发。** 未接入 live 模型（诱发不稳定且会干扰 A 工具轮判定）；往返已在 B3 fake 测覆盖。

### 观察与归因（不放水）

1. **relay2 经网关 `costSource=sdk`（cost `$0.094465`）——但 relay 真实转售价不可知。** pricing.ts **故意不收** relay2 的 gpt-5.6-luna（中转站转售价非上游列表价，查不到）。然而经网关时 SDK 的 `result.total_cost_usd>0`（对 `claude-` 伪装模型按 SDK 内置 Anthropic 价目算出），events.ts 规则①"totalCostUsd>0 ⇒ costSource=sdk（官方端点，SDK 已知真价）"的**前提对网关路径不成立**——此 cost 是 SDK 对伪装模型的假设价，**非中转站实际计费**。**非 Bridge/网关 bug**（events.ts 按既定规则执行），但属**语义缺口**：Phase 1 成本采集应对**网关接线**对话抑制/覆盖 SDK cost（改用 local-pricing 或标 unpriced），否则展示价失真。记为 **B2/events.ts 后续整改点**（本卡禁改 src，仅归因）。
2. **未发现阻断性 Bridge/网关 bug。** 7/7 功能全通；上述 cost 语义为非阻断观察。

**结论：Bridge 竖切 Live 验收 PASS（7/7）。** 真 SDK `query()` 经 pool 注入、events.ts 归一、interact.ts canUseTool 适配、providers.ts sanitizeHostEnv 隔离，四模块经真端点端到端跑通；双对话并发无串扰，密钥隔离活体核验通过，三累积假设全部结清。Bridge 批收官。
