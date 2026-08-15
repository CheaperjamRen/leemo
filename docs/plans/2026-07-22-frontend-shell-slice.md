# 前端壳竖切计划（F0 地基 + S1 搭子落地页起步）

> 日期：2026-07-22 ／ 作者：设计负责人 ／ 状态：**设计 + 工作流已确认**（用户 7/22 认可四拍循环 + 每片验两次），进 writing-plans 派第 1 片卡
> 权威链：`02-前端设计规格-v2.0`（前端唯一权威）→ `08-交互可视化与NewMax吸收增补`（可视化A/问询卡/双日志）→ `09-Bridge-IPC契约-v1.0` + `src/bridge/contract.ts`（冻结契约，前端消费面）
> 视觉基准：`docs/design-audition/k3/buddy-mode.html`（S1 目验基准）／`workbench-mode.html`（S2/S3 用）
> 本批性质：**前端从零立起**（绿地）。分片推进，每片 = 一条可演示的竖切；本文件详化第 1 片，后续片到点再补。

---

## 0 · 一句话

在冻结的 `contract.ts` 之上，用 Vite+React+TS+Tailwind+Zustand 立起前端地基（F0），并交付一个**全 fixture、零真网络、零 Electron**、打字能让 momo 流式答话的搭子首屏（S1）。

## 1 · 批次背景与两个地基事实

- **绿地**：`src/` 现只有 `gateway/` + `bridge/`；`package.json` 无 React/Vite/Tailwind/Zustand/Electron。本批不是"改前端"，是"立前端"。
- **地基事实①（tsconfig）**：根 `tsconfig.json` 是 Node-only（`lib:["ES2022"]`、`types:["node"]`，无 DOM）。React/JSX 编译不了 → 必须新开 `tsconfig.renderer.json`（DOM lib + jsx），与现有 vendor/根两份并列成**三份**；根 tsconfig 需把 `src/renderer` 加入 `exclude`（否则 Node-only 程序会尝试编译 .tsx 而失败）。
- **地基事实②（IPC 铁律）**：02 §2.1 铁律"新组件不得直连 IPC" + 尚无 Electron 主进程 → 立一个 `BridgeClient` **端口**（按 contract.ts 的 `BridgeInvokeMap`/`BridgeEventMap` 类型化），首个实现是 fixture 适配器；store 依赖端口，组件只读 store。Phase-1 上 Electron 换 `IpcBridgeClient`，**store/组件零改**。

## 2 · 竖切拆解（整批地图）

**片 = 能演示的纵向增量**；F0 地基无独立画面可验，故折进第 1 片。每片走 §8 的四拍循环。

| 片 | 内容 | 本文详化 |
|---|---|---|
| **1** 地基 + 搭子落地页 | F0（脚手架 / `tsconfig.renderer` / jsdom / token 层 / store 骨架 / fixture 端口）+ 搭子首屏 + 文字流式闭环 | ✅ 本片（§4–§9） |
| 2 核心消息卡（展示） | 工具卡 / 计划卡 / 活动卡 / 结果卡——**共享组件库**，在第 1 片的对话流上就地丰富 | 到点 |
| 3 交互卡（往返） | 审批条（canUseTool）/ 问询卡（ask-user MCP）/ 用量脚注（仅 fixture，gate#1）——需回投通道，隔离往返复杂度 | 到点 |
| 4 可视化卡 | 沙箱 iframe + token 桥接 + viz kit（08 §一 A 档）——自包含 | 到点 |
| 5 工作台壳 | 侧栏 §6 / 标签 / 顶栏 / 上下文圆环 §7.9——**复用 2–4 的组件库** | 到点 |
| 6 模式切换 | Buddy⇄Workbench（Ctrl+M，换壳数据不动，交叉淡入） | 到点 |
| 7 输入区全量 | §8：chips / / / @ / 按对话选模型 / 权限模式 | 到点 |
| 8 设置 + 首设向导 | §14 设置页 + §15 三步向导 | 到点 |
| 9 预览 / wiki / 搜索 / 技能 / 成果 | §9–13 | 到点 |

> **排序 = 最佳实践三原则**：①地基先行但折进首个可演示片（不验空白页）；②**共享组件库（2–4）先于其第二消费者（工作台 5）**，只建一次；③重头戏（消息组件库）拆成 3 个可单独演示的片、且早做不留到最后（前置风险）。更细的分片不增加用户负担（每片仍只瞄两眼），反而缩小"中间断了"的爆炸半径。

## 3 · 数据流架构决策：端口化（hexagonal）

**采用 A**。备选与否决理由：

- **A 端口化（采用）**：`BridgeClient` 端口镜像契约；`FixtureBridgeClient` 用脚本化 `LeemoEvent` 流模拟 send 的流式；store 只订阅端口，组件只读 store。Phase-1 换 `IpcBridgeClient` 零改 store/组件。store 闭环可 TDD（fake timers）。
- **B fixture 直塞 store（否决）**：store 从 fixture 直接初始化、send 用 setTimeout 直改 state。今天更省，但 Phase-1 接 IPC 要重写 store = 返工，违背"别建两次"。
- **C 伪 preload（否决）**：现在摆 `window.bridge` 形状但渲染进程假实现 = A 加一层无谓 Electron cosplay，没主进程也验不了 preload 语义。

**端口形状**（精确镜像 contract.ts，swap 最干净）：

```ts
// src/renderer/bridge/client.ts
import type { BridgeInvokeMap, BridgeEventMap } from "../../bridge/contract";

export interface BridgeClient {
  invoke<K extends keyof BridgeInvokeMap>(
    channel: K,
    req: BridgeInvokeMap[K]["request"],
  ): Promise<BridgeInvokeMap[K]["response"]>;
  subscribe<K extends keyof BridgeEventMap>(
    channel: K,
    cb: (payload: BridgeEventMap[K]) => void,
  ): () => void; // 返回 unsubscribe
}
```

> 注：contract.ts 是 `export type` 纯类型、运行时零依赖（不拖入 SDK/Electron/vendor），renderer 直接 `import type` 安全。

**FixtureBridgeClient 语义**（`src/renderer/bridge/fixture-client.ts`）：
- `invoke("bridge:createConversation")` → 返回 canned `ConversationRef`。
- `invoke("bridge:send")` → 按契约返回 `void`；随后在 `bridge:event` 上按脚本吐一串 `LeemoEvent`：`conversation.started → text.delta ×N → text.final → run.finished`，用定时器驱动（测试可注入 fake timer / 立即模式）。
- `invoke("bridge:listProviders")` → 返回 fixture `ProviderSpec[]`（S1 暂不渲染，但端口先通）。
- 事件序列**必须符合 contract 的 `LeemoEvent` 判别联合**（不臆造字段）——有测试锁定。

## 4 · F0 地基设计

**新增目录**（全新增，**不碰** `src/gateway/`、`src/bridge/`）：

```
index.html                         ← Vite 入口
vite.config.ts                     ← @vitejs/plugin-react + 别名 @renderer
tsconfig.renderer.json             ← lib:[ES2022,DOM,DOM.Iterable] + jsx:react-jsx，include src/renderer
postcss.config.js / tailwind.config.ts
src/renderer/
  main.tsx                         ← ReactDOM 挂载
  app/App.tsx                      ← 壳路由（现只挂 <BuddyShell/>）
  design/tokens.css                ← --leemo-* 双基调（搬 K3 buddy/workbench 变量）+ viz UI Kit（.viz-* 六件）
  bridge/
    client.ts                      ← BridgeClient 端口接口
    fixture-client.ts              ← FixtureBridgeClient
    fixtures/                       ← conversations/messages/providers 种子 + momo 回复脚本
    context.tsx                     ← React context 注入 client（store 经此拿端口；命名避开 LLM "provider" 概念）
  stores/
    conversations.ts               ← 会话 + 消息（订阅 bridge:event → 规范化进 messages）
    settings.ts                    ← 模式记忆 + momo 人设（开场白来源）
    notifications.ts               ← 铃铛未读
  components/momo/MomoAvatar.tsx   ← K3 内联 SVG 移植（呼吸/眨眼/星光，prefers-reduced-motion 尊重）
```

**工程三分与脚本**：
- tsconfig：vendor（DOM+宽catch）/ 根（Node+严格，**新增 `exclude: src/renderer`**）/ **renderer（DOM+jsx+严格）**。`typecheck` 脚本追加第三条：`… && tsc -p tsconfig.renderer.json`。
- vitest：**additive** 引入 renderer 的 jsdom project（vitest 4 用 `test.projects` 配置，非已废弃的 workspace 文件），**现有 node 测试行为不变**（gateway/bridge 215 测试必须仍全绿——见 §9 验收）。
- Tailwind：走 PostCSS/Vite 插件替代 K3 的 CDN；token 仍是 CSS 变量，K3 的 `bg-[var(--…)]` 类名可近乎照抄（视觉移植成本低）。

**token 层**：K3 两稿的裸名变量（`--bg/--ink/--amber/--momo-*` …）统一收编为 `--leemo-*` 语义变量（02 §三表）；双基调 = 同一套语义名在两壳下不同赋值（S1 只用 buddy 暖白一套，workbench 冷灰随 S3）。

## 5 · S1 搭子落地页设计（交互-fixture 轻活）

**组件清单**（K3 `buddy-mode.html` 移植；纯展示组件读 store/props，不直连端口）：
- `TopBar`：历史 ☰ · 模式切换器胶囊（S1 只做视觉，切到工作台是 S4）· 铃铛（未读红点，读 notifications store）
- `MomoAvatar`（F0 产出，复用）
- `Greeting`：serif 开场白，按 时段+记忆 fixture 生成（纯函数 `(hour, memoryFixture) → string`）
- `LightArtifactCard`：轻产物卡（图标+标题+一句话；点击 S1 暂 no-op / 占位）
- `ChipRow`：情绪化 chips（点击 → 填入输入框）
- `InputBox`：受控输入 + 发送键
- `PinFootnote`：底部提醒行（fixture）
- `HistoryDrawer`：320px 抽屉（☰ 开 / 遮罩·Esc 关）+ 搜索框（本地过滤 fixture 列表）+ 对话列表（本子分组只读概览）+ 底部设置入口（占位）

**唯一"活"的闭环**（验证 store→渲染，S1 的架构核心）：
1. 输入框受控打字；chip 点击填入。
2. Enter → `conversations.send(text)`：**乐观追加** user 消息进 store → `client.invoke("bridge:send", …)` → 组件订阅 store，随 `text.delta` 流式拼接 momo 气泡 → `text.final` 定稿 → `run.finished` 收尾。
3. 发送后落地页转"极简对话流"：user 气泡（右对齐）+ momo 流式**文字**（左对齐带小头像，打字机光标）——**仅 §7.1 文字基础**。

**明确不做（S1 边界，防漏做/防蔓延）**：
- 工具卡/计划卡/活动卡/结果卡/审批条/问询卡/可视化卡 = **S2**。
- **用量脚注 = 不做**（gate#1：costSource 未修，不接 live cost；脚注组件随 S2 建且只喂 fixture）。
- 真 bridge/真网络/Electron/preload = Phase-1。
- 模式真切换 = S4；设置页 = S6。

## 6 · store 设计（只立 S1 需要的三个）

- `conversations`：`{ conversations, messagesByConv, activeId }` + actions `send(text)` / 内部 `applyEvent(LeemoEvent)`（把 11 变体里 S1 用到的 `conversation.started/text.delta/text.final/run.finished` 规范化进 messages；其余变体留 `default` 分支占位，S2 填）。**规范化逻辑是纯函数，单独可测**。
- `settings`：`{ mode:'buddy'|'workbench', persona }`（S1 只读 mode 与 persona 供开场白；持久化留 Phase-1 SQLite，现内存）。
- `notifications`：`{ items, unreadCount }`（铃铛红点）。
- 三个 store 经 `bridge/context.tsx` 的 context 拿到 `BridgeClient`；**组件层零端口引用**（lint 规则强制，见 §7）。

## 7 · 禁改清单

- **不碰** `src/gateway/**`、`src/bridge/**`（含 `contract.ts` 只 `import type`，不改）、`tsconfig.vendor.json`、现有 `vitest.config.ts` 的 node 测试行为、`smoke/**`。
- 根 `tsconfig.json` **仅允许**新增 `exclude: ["…","src/renderer"]` 一处（必要，否则 Node-only 程序编译 .tsx 失败）；其余不动。
- 不引入 Electron/preload/真 IPC（Phase-1）。
- 命名：仅 Leemo/momo；用户可见名词只 本子/成果。

## 8 · 执行工作流：四拍循环（骨架我搭 · 皮 Kimi 穿 · 同步闭合）

每一片（含本片）走同一循环；步与步之间只在"绿点"交接（能跑 + 测试绿 + 用户目验过），断点可无缝接续：

1. **骨架**（设计负责人，TDD）：搭可跑的结构 + store + props 接口 + **朴素视觉占位**（灰框 / 系统字 / 无动效），逻辑测试全绿。
   → **用户验收①**：打开 `vite dev` 瞄一眼——齐不齐、逻辑通不通（不看美丑）。
2. **穿衣**（无头 `kimi -p` 派 K3，附对应 K3 稿对照）：Kimi 只往占位里填视觉（token / 动效 / 气质），**不碰结构**。设计负责人整合进骨架并复跑测试，确认逻辑未被碰坏。
   → **用户验收②**：打开瞄一眼——美不美、像不像 K3 稿（有原稿并排对照）。
3. 过 → 记台账，进下一片。

**为什么这样最稳（对应用户三诉求）**：
- **不跑偏/接得上**：接缝由骨架（设计负责人）定死，Kimi 只穿衣，产出天然长在骨架上——不存在"接不上"。骨架阶段先拦逻辑偏差，视觉阶段有原稿对照。
- **要质量**：结构 / 逻辑由 TDD + Opus 复审保证（不可逆判断点），视觉由 K3 保证（其最强场景）；两者不互相污染。骨架先绿，视觉是唯一可返工点且非阻塞——Kimi 那步失败也不塌，顶多重穿一次衣。
- **省麻烦/时间**：用户零对话（设计负责人无头驱动 Kimi）、每片只瞄两眼、断点在绿点。

**分工与分档**（模型分档纪律）：
- 骨架卡（结构 / store / 端口 / 规范化，严格 TDD）：Sonnet 5 执行，Opus 4.8 复审。
- 穿衣卡（纯视觉 / 组件皮肤）：K3（Kimi Code 无头），用户目验。
- 复审 / 终审恒 Opus 4.8。

### 本片测试面（骨架卡的 TDD 断言）
- `conversations.send` 闭环（fake timers：乐观 user 追加 → delta 累积 → final 定稿 → finished）。
- `FixtureBridgeClient` 事件序列符合 `LeemoEvent` 契约（判别联合逐字段）。
- `applyEvent` 规范化纯函数（含未知变体不崩）。
- `Greeting` 开场白纯函数（时段分支）。
- **lint 铁律**：`src/renderer/components/**` 不得 import `bridge/client`（组件不直连端口），命中为 0。
- **视觉目验**：落地页对照 `buddy-mode.html`（token / 气质 / 呼吸眨眼 / 抽屉滑出 / 流式光标）。

## 9 · 交付定义与验收（S1 收官）

**交付** = 能跑 `vite dev`、打字 Enter 让 momo 流式答话、抽屉能开合的搭子首屏；全 fixture、零真网络、零 Electron。

**验收命令/证据**（只认可复现证据）：
1. `npm run typecheck` 三段 exit 0（vendor && 根 && renderer）。
2. `npm test` 全绿，且**含原有 gateway/bridge 215 测试仍全绿**（vitest 变更 additive 的证明）。
3. 新增 renderer 逻辑测试全绿（send 闭环 / fixture 事件契约 / 规范化 / 开场白）。
4. `vite dev` 起站，目验：momo 呼吸眨眼 · 打字 Enter → 流式回复逐字出 · 抽屉开合 · chip 填入（K3 对照）。
5. lint："组件不得 import 端口"规则命中为 0。

## 10 · 延后项（登记，不在本片）

- **gate#1 成本准确性**（costSource 错算所有 provider）：Phase-1 修，先于任何 live cost 渲染；本批用量脚注只喂 fixture。
- **Electron 主进程 + preload + 真 IPC + SQLite 持久化**：Phase-1（换 `IpcBridgeClient`，store/组件零改）。
- **消息组件库**（slice 2 核心展示卡 → slice 3 交互卡 + 用量脚注 → slice 4 可视化卡）：后续片。
- pool↔interact 接线、dangerLocked 读写不对称：Phase-1（记忆 `bridge-batch-followups`）。

---

## 附：writing-plans 待产出（本文件之后）

将 F0/S1 拆成自包含任务卡（文件清单+禁改清单+验收命令）落 `docs/handoffs/`（K3 卡）与 `docs/sdd/`（TDD 卡简报），按 §8 分工与分档派发；卡级依赖：F0 端口+store → S1 交互闭环；F0 token+MomoAvatar → S1 视觉组件。
