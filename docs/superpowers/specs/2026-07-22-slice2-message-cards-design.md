# Slice-2 设计：消息展示卡（工作台对话流）

> 日期：2026-07-22 ／ 作者：设计负责人 ／ 状态：**设计已确认**（用户 7/22 逐段认可，进 writing-plans 拆卡）
> 权威链：`docs/specs/02-前端设计规格-v2.0.md`（前端唯一权威）→ `08-交互可视化与NewMax吸收增补`（可视化/问询卡）→ 冻结契约 `src/bridge/contract.ts` + `src/bridge/events.ts`（LeemoEvent 判别联合，S2 数据源）
> 视觉基准：`docs/design-audition/k3/workbench-mode.html`（工具卡/计划卡有基准；活动卡/结果卡无基准，K3 自由发挥）
> 上游：slice-1（搭子落地页）已合 main（HEAD=63ef575），241 测试全绿 + typecheck 三段绿
> slice 计划母文档：`docs/plans/2026-07-22-frontend-shell-slice.md`（本文件是其「片 2」的详化）

---

## 0 · 一句话

在 slice-1 立起的 hexagonal 前端骨架上，把 momo 一个回合里的结构化动作（计划 / 工具 / 分身活动 / 收尾 / 上下文压缩）从 `LeemoEvent` 流折成有序 timeline，并渲染成工作台风格的展示卡——全 fixture、零回投、零 Electron。

## 1 · 一处交接偏差校正（S2 性质的关键）

交接文档（`s2-handoff.md`、slice 计划）称 S2 是「组件层活，不动 reducer/store——applyEvent 已折的 variant 只是渲染成卡」。**核实真代码 `src/renderer/stores/message-model.ts:32` 发现偏差**：

```ts
default: return messages;   // tool.started/finished、subagent.activity、compact.boundary 全在此被丢弃
```

这些事件在契约（`events.ts` 的 `LeemoEvent` 联合）里存在，但**当前 reducer 一个都没折进 timeline**。当前 store 只有 `RendererMessage[]`（纯 user/momo 文字气泡）。

**结论**：S2 **不是纯视觉/组件活**，它需要**先扩 reducer 的领域模型**（把 tool/plan/activity/result/compact 折成可渲染结构化项）。这是**严格 TDD 边界**（reducer=逻辑，铁律要测），不是 K3 穿衣能碰的。据此 S2 骨架卡 = Sonnet 5 TDD 派发，非轻活。

## 2 · 范围（四点已对齐）

| 决策点 | 定案 |
|---|---|
| timeline 数据模型 | **扁平判别联合**（`TimelineItem[]`，非回合分层、非侧车 state）——时序进数据模型（数组天然保序），视觉分组进渲染层（按 runId） |
| 卡集 | **四展示卡 + compact 分隔线**：工具卡 / 计划卡 / 活动卡 / 结果卡 / compact 分隔 |
| 活动卡·结果卡视觉（无 K3 基准） | **骨架全建**四卡数据+朴素占位（验收①全可验）；穿衣拍 K3 照工具/计划基准做，活动/结果卡给 K3 token 体系**自由发挥** |
| 验收①形态 | **一条完整演示回合**：fixture 打字 Enter 后按定时器逐个吐出含全部事件类型的「真干活」序列 |
| run 折叠（渐进式披露） | **结构现在做**（RunGroup 折叠条：完成即默认折叠 / 进行中默认展开 / 可 toggle，纯渲染 UI state，reducer 零改）；**卡内深度展开与富产物延后**（见 §4a） |

**明确不做（S2 边界，防蔓延）**：
- 审批条（canUseTool）/ 问询卡（ask-user MCP）/ 用量脚注 = **S3**（需回投通道，隔离往返复杂度）
- 可视化卡（沙箱 iframe）/ 富产物·成果 HTML 组件 = **S4**（run 的「最终产物富展示」骑 S4 可视化机制）
- 真 bridge / 真网络 / Electron / preload = Phase-1
- **卡内深度展开**（思考流详情正文、单工具卡入参/输出正文）= 穿衣拍增强或 S3（surface 更大，非 S2 骨架必需）

## 3 · 数据模型（reducer 扩展形状）

当前 `RendererMessage[]` 升级为判别联合的有序 timeline：

```ts
export type TimelineItem =
  | { kind: "text";     id: string; runId: string; role: "user" | "momo"; text: string; streaming: boolean }
  | { kind: "tool";     id: string; runId: string; toolUseId: string; name: string; input: unknown; status: "running" | "ok" | "error"; summary?: string }
  | { kind: "plan";     id: string; runId: string; toolUseId: string; todos: { text: string; status: "done" | "active" | "todo" }[] }
  | { kind: "activity"; id: string; runId: string; parentToolUseId: string; childToolUseIds: string[] }
  | { kind: "result";   id: string; runId: string; isError: boolean; finalText: string; pathAudit: PathAudit }
  | { kind: "compact";  id: string; trigger: string; preTokens: number; postTokens?: number };  // 分隔线，无 runId
```

**reducer（`applyEvent`）扩展 —— 纯函数、逐事件、无状态**：

| 事件 | 动作 |
|---|---|
| `text.delta` / `text.final` | 现有逻辑，加 `kind:"text"` + `runId`（几乎原样搬） |
| `tool.started` | `name==="TodoWrite"` → 追加 `plan` 项（投影 `input.todos`）；否则追加 `tool` 项 `status:"running"`；`subagent:true` 时其 toolUseId 挂进对应 `activity` 项的 childToolUseIds |
| `tool.finished` | 按 `toolUseId` 定位项，`status`→`ok`/`error`（读 `isError`）+ `summary`（读 `contentSummary`） |
| `subagent.activity` | 追加/累积 `activity` 项（按 `parentToolUseId` 去重合并） |
| `compact.boundary` | 追加 `compact` 分隔项 |
| `run.finished` | 追加 `result` 项（带 `pathAudit`）+ 清所有 `streaming` |
| `thinking.delta` / `usage.final` / `error` / 未知 | `default: return items`（保持不崩，有测试锁；usage/error 的展示留后续片） |

**runId 来源**：`conversation.started`（或 `send` 触发）记当前 runId，之后每追加项打标。**视觉分组 = 渲染层按 runId 分组显示 momo 头像；reducer 不管分组**——关注点分离核心：时序进数据模型，分组进渲染层。

> 命名迁移：`RendererMessage` → `TimelineItem`（`message-model.ts` 内）。现有 `message-model.test.ts` 相应更新。`PathAudit` 从 `../../bridge/contract` `import type` 复用（不重定义）。
>
> **TodoWrite 入参防御**：`tool.started` 的 `input` 类型是 `unknown`（契约如实），TodoWrite 的 `input.todos` 结构是从 SDK 惯例推断。reducer 折 plan 项时须**防御式解析**（`Array.isArray` 守卫、逐项字段校验、缺字段降级），解析失败退化为普通 `tool` 项而非崩溃——有测试锁「畸形 TodoWrite input 不崩」。

## 4 · 组件层（卡组件库 + 渲染分发）

hexagonal 铁律不变——组件只经 context hooks 读 store，**禁直连端口**（`components/guard.test.ts` 文件扫描守卫，真 fail-red）。新增：

```
src/renderer/components/timeline/
  Timeline.tsx        ← 顶层：读 store 的 items，按 runId 分组，按 kind 分发到卡组件（唯一读 store 者）
  TextBubble.tsx      ← 从现 MessageList 抽出（user 右对齐 / momo 左对齐带小头像 + 流式光标）
  ToolCard.tsx        ← 工具卡：状态图标 + 动词 + 目标 + 摘要 + 折叠 chevron（K3 基准：workbench §工具卡）
  PlanCard.tsx        ← 计划卡：TodoWrite → 勾选清单 + N/M 进度（K3 基准：workbench §计划卡）
  ActivityCard.tsx    ← 活动卡：分身干活 + 嵌套子工具（无 K3 基准，自由发挥）
  ResultCard.tsx      ← 结果卡：收尾 + pathAudit 反幻觉路径警示（无 K3 基准，自由发挥）
  CompactDivider.tsx  ← compact 上下文压缩细分隔线
```
  RunGroup.tsx        ← 一个 run 的容器：折叠条 + 过程卡（折叠区）+ 最终输出/结果卡（常驻）
```

**分发核心**：`Timeline` 按 `runId` 把 items 分组成 **RunGroup**；每组内按 `item.kind` switch 分发到对应卡组件（TS 判别联合 → 卡 props 精确、漏 case 编译期报错）。`MessageList.tsx` 被 `Timeline.tsx` 取代（`BuddyShell` 引用点改一处）。

**纯展示原则**：卡组件与 RunGroup 全部**读 props、零 store/端口引用**；只有 `Timeline` 顶层读 store。→ 组件天然可单测、K3 穿衣只碰组件内部不碰分发逻辑。

**骨架拍产出**：所有卡朴素占位（灰框 / 系统字 / 无动效），但**数据全绑对** + 折叠逻辑通。验收①可见：进行中的 run 展开着实时出卡、完成的 run 收成一条折叠条（点开可见过程卡）——只是丑。动效/K3 气质留穿衣拍。

## 4a · run 折叠（渐进式披露，成熟 Agent 的 run-level disclosure）

用户 7/22 补充诉求：**回合结束后过程卡应能折叠，最终只留一条折叠条 + 最终输出 + 产物**，兼顾「过程可追溯」与「单轮不冗长」。

**决定：折叠「结构」S2 现在做，「深度」延后。** 理由——折叠边界 = 一个 run，这个数据事实（runId + result 项）S2 本就在算；Timeline 本就按 runId 分组。现在把分组组件带折叠开关建出来 = **锁正确渲染边界，零返工**；且纯渲染层的事，**reducer / 契约零改**（run 状态是数据，折叠开合是渲染 UI state）。若现在按「永远展开」建，以后加折叠 = 重建分组组件。

**RunGroup 行为（S2 做）**：
- **进行中的 run（无 `result` 项）→ 默认展开**：实时看 momo 干活（过程卡逐个流式出）。
- **已完成的 run（有 `result` 项）→ 默认折叠**：只留折叠条（如「momo 干了活 · 3 工具 · 1 计划 · 已完成」）+ 最终文字输出 + 结果卡常驻；过程卡（计划/工具/活动/compact）收进条里。
- 点折叠条可 **toggle 展开/收起**。折叠状态 = RunGroup 局部 UI state（`useState`），**默认值由「该 run 是否有 result 项」推导**。
- 骨架拍：朴素 toggle + 逻辑测试（完成→默认折叠 / 进行中→默认展开 / toggle 生效 / 最终输出常驻不被折）。穿衣拍：K3 做折叠动画 + 折叠条气质。

**延后（不在 S2）**：
- **卡内深度展开**（思考流详情正文、单工具卡的入参/输出正文）→ surface 更大，穿衣拍增强或 S3。
- **富产物/成果展示**（HTML 组件 / 可视化）→ **S4 可视化卡机制**，已切走。S2 的「最终输出」= 最终文字 + 结果卡。

## 5 · fixture 演示流（验收①的来源）

改造 `src/renderer/bridge/fixture-client.ts` 的 momo 回复脚本：打字 Enter 后按定时器逐个吐出一整段「真干活」序列——

```
conversation.started
→ text.delta ×N（短开场）→（保持流式）
→ tool.started(name="TodoWrite", input:{todos:[…4条]})           // 计划卡
→ tool.started/finished(name="Read", …)                          // 工具卡①
→ tool.started/finished(name="Grep", …)                          // 工具卡②
→ tool.started(name="Write", …)（保持 running）                   // 工具卡③进行中
→ subagent.activity(parentToolUseId) + tool.started(subagent:true) // 活动卡
→ compact.boundary(trigger, preTokens, postTokens)               // 分隔线
→ text.delta ×N（流式收尾）→ text.final
→ usage.final（reducer 暂 default 吞，仍须符合契约）
→ run.finished(subtype, isError:false, finalText, pathAudit)     // 结果卡
```

事件全部严格符合 `LeemoEvent` 判别联合（有测试逐字段锁，不臆造字段）。定时器驱动（测试注入 fake timer / 立即模式，同 slice-1）。

## 6 · 测试面（严格 TDD，Sonnet 5 骨架卡）

1. **`applyEvent` 新分支纯函数**：tool.started 追加 running 项 / tool.finished 按 id 更新 status+summary / TodoWrite→plan（todos 投影）/ subagent.activity→activity（按 parentToolUseId 去重）/ compact→分隔项 / run.finished→result 项且清 streaming / 未知 variant 不崩 / runId 打标正确 / 时序穿插保序（卡与文字相对顺序）。
2. **fixture 演示流事件序列符合契约**：判别联合逐字段（tool_use_id/name/input/subagent、is_error、pathAudit 形状等）。
3. **`Timeline` 分发 + `RunGroup` 折叠**：给定 items → 分组渲染对应卡（每 kind 一个断言，用 jsdom/RTL）；完成的 run 默认折叠（过程卡不可见、最终输出+结果卡常驻可见）/ 进行中的 run 默认展开 / 点折叠条 toggle 生效。
4. **guard 铁律**：`src/renderer/components/timeline/**` 不 import `bridge/client`，命中 0。
5. **不回归**：原 gateway/bridge 215 + slice-1 renderer 测试仍全绿（总 241 基线）。

## 7 · 禁改清单

- **不碰** `src/gateway/**`、`src/bridge/**`（含 `contract.ts`/`events.ts` 只 `import type`，不改）、`tsconfig.vendor.json`、`smoke/**`、现有 `vitest.config.ts` 的 node 测试行为。
- **Phase-1 gate 不碰**（接 IPC/Electron 才带走，见记忆 `fe-slice1-phase1-gates`）：
  - gate#1 store 订阅生命周期（`conversations.ts` 把 `client.subscribe` 塞进 `context.tsx` 的 useMemo 且丢弃 unsubscribe）——S2 不趁机改。
  - gate#2 fixture default-case 白谎（`fixture-client.ts` invoke() default 返 undefined）——S2 不趁机改（S2 只扩 send 的事件脚本，不碰 invoke default 分支）。
- 命名：仅 Leemo/momo；用户可见名词只「本子 / 成果」。

## 8 · 四拍循环（同 slice-1，已验证有效）

1. **骨架**（设计负责人，TDD；Sonnet 5 执行 + Opus 4.8 复审）：扩 reducer（判别联合 + 新分支）+ 卡组件朴素占位 + Timeline 分发 + fixture 演示流，逻辑测试全绿。
   → **用户验收①**：`vite dev` 打字 Enter → 四卡 + 分隔线逐个出现（不看美丑，看齐不齐/逻辑通不通）。
2. **穿衣**（无头 `kimi -p` 派 K3）：K3 只往卡组件占位填视觉（token/动效/气质），照 `workbench-mode.html` 做工具卡/计划卡，活动卡/结果卡自由发挥；**不碰** Timeline 分发/reducer/props 签名/事件流。设计负责人整合 + 复跑测试确认逻辑未坏。
   → **用户验收②**：对照 `workbench-mode.html` 目验。
3. 过 → 记台账 `docs/sdd/progress.md`，进 slice-3。

**kimi 无头派发教训**：裸 `kimi -p "<prompt>" -m kimi-code/k3`，**不加** `--yolo`/`--auto`（与 `-p` 冲突）；`-p` 自带文件写权限；模型端点国内直连不走代理。

## 9 · 交付定义与验收（S2 收官）

**交付** = `vite dev` 打字 Enter，momo 流式吐出含计划卡/工具卡/活动卡/结果卡/compact 分隔的完整回合；全 fixture、零回投、零 Electron。

**验收命令/证据**（只认可复现证据，自跑非采信）：
1. `npm run typecheck` 三段 exit 0（vendor && 根 && renderer）。
2. `npm test` 全绿，含原 241 测试不回归。
3. 新增 renderer 逻辑测试全绿（reducer 新分支 / fixture 演示流契约 / Timeline 分发 / guard）。
4. `vite dev` 目验：四卡 + compact 分隔线逐个流式出现（骨架拍朴素 / 穿衣拍对照 workbench-mode.html）。
5. guard："timeline 组件不得 import 端口"命中 0。

## 10 · 分工与分档（模型分档纪律）

- 骨架卡（reducer 扩展 / 卡组件 / Timeline 分发 / fixture 演示流，严格 TDD）：**Sonnet 5** 执行，**Opus 4.8** 复审。
- 穿衣卡（纯视觉 / 卡皮肤）：**K3**（Kimi Code 无头），用户目验。
- 复审 / 终审恒 **Opus 4.8** 不降档（派 subagent 显式指定 model）。

## 11 · 延后项（登记，不在本片）

- 审批条 / 问询卡 / 用量脚注（回投通道）→ **slice-3**。
- 可视化卡（沙箱 iframe + token 桥接）→ **slice-4**。
- `usage.final` / `error` 事件的展示渲染 → 随 slice-3 用量脚注或按需。
- Phase-1 gate #1/#2、Electron 主进程 + preload + SQLite → Phase-1。
