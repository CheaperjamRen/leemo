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
