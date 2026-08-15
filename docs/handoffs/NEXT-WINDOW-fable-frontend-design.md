# 新窗口交接：前端完整形态设计（Fable 做设计 → Opus 批量执行）

> 日期：2026-07-23 ／ 分工：**Fable+Max 做设计（贵、一次性、高杠杆判断）→ 用户切 Opus 批量执行**
> 本文件 = 新窗口第一条消息可直接贴的自包含 prompt + Fable 产出后的 Opus 路标

---

## 【第一部分：贴给 Fable 的 prompt】

你是 Leemo 的设计与验收负责人（CLAUDE.md 全职责自动加载：角色/文档链/铁律/模型分档纪律）。当前你是 **Fable+Max**，用户特意升档让你做**唯一最该由最强模型做的事：整个前端未建面的完整形态设计**。做完这一份，用户会切回 Opus 照你的设计批量执行。**你只做设计，不写实现代码。**

### 30 秒背景
- Leemo = 基于 claude-agent-sdk 的桌面 AI 工作台+搭子（Electron+React+Vite+Tailwind+Zustand）。人格 momo。
- 后端引擎**已经是真的**：Bridge 竖切 B0-B4 已 live 验证（真 DeepSeek 出真 token、密钥隔离、canUseTool 真往返、resume 真召回）。契约冻结在 `docs/specs/09-Bridge-IPC契约-v1.0.md` + `src/bridge/contract.ts`。
- 前端已建：片1 搭子落地页 + 片2 消息卡/穿衣/思维链（main 290 测试绿，fixture 态跑通）。
- **未建**：工作台壳、交互卡（审批条/问询卡）、可视化卡、输入区全量、设置页、首设向导、预览区、文件树、Skills 页、全局搜索、成果页、上下文圆环、用量脚注、通知面板、wiki 窗。

### 用户的真实处境与诉求（逐字读，这是你设计的约束）
1. **时间紧、要快速拿出成果**（内测倒计时压力）。慢的真因 = 过去主控**薄设计→执行→用户目验发现形态 bug→返工**的循环，人工目验轮次过多导致空转。**返工根源 = 主控（我/你）对前端形态、组件位置、状态与交互的设计有 bug/缺陷，不是 K3 视觉能力问题。**
2. **提速模型（用户已拍板）= 设计前置 + 批量执行 + 里程碑目验**：你（Fable）把每个面的形态一次想全 → 用户审这份设计（bug 根源在此，审设计=审 bug 根源）→ 审过后 Opus 批量并行派发 K3/Sonnet、自验到里程碑才叫用户。**该相信 K3 的前端视觉能力，把人工介入从"每片目验"移到"审设计"这一个高杠杆点。**
3. **必须真能干活，不只搭子态**：用户明确否决"只做搭子态/换靶子/预置 key"。搭子态是工作台态的添头；给用户的是**实际价值不是情绪价值**。基本形态不完善就没有内测资格。用户做这产品的信心来源 = claude code 引擎强大，要把"真能用电脑干活"这个优势让用户感知到，至少不输于 workbuddy。**工作台态是主体。**
4. **成本敏感**：Fable 很贵，用户只用你一会就切 Opus。所以**把你的产出压到"只有最强模型配做、且做完长期复用零返工"的设计判断**，不要用你做机械执行。**不预置 key**（用户没预算，会教学生配置）——首设向导必须做好。
5. 质量要求：吃透 `docs/design-audition/k3/` 两张 HTML（buddy-mode/workbench-mode）的气质 + 成熟 Agent（Claude Code / 你自己）的对话形态。搭子暖白 / 工作台冷灰双基调。

### 你的产出物（唯一交付 = 一份设计文档，不碰实现）
**`docs/specs/10-前端完整形态设计-v1.0.md`**——补 `02-前端设计规格-v2.0.md` 没写的那一层：**每个未建面的精确形态**，细到 K3/Sonnet 照做零歧义、Opus 批量派发时零形态 bug。02 是"要什么"，你写"长什么样、怎么摆、什么状态变成什么"。

每个面必须覆盖这 6 层（这正是过去返工的盲区）：
1. **布局与位置**：组件在壳里的确切位置、尺寸、栅格、响应式行为（对照 K3 稿的 px 级细节）。
2. **状态机**：每个组件的全部状态 + 迁移条件（八态：loading/empty/ready/partial/error/offline/permission_blocked/stale；02 §19）。**这是我返工最狠的地方——把每个态画清楚。**
3. **store 契约**：附 A 引用的 `runs/approvals/artifacts/wikiEntries/contextUsage` store **都还不存在**（现有仅 conversations/message-model/notifications/settings，其中 settings 只有 mode/persona 骨架）。你要设计这些 store 的字段面 + action + 与 contract.ts 事件的接线（这是最高杠杆的判断——store 契约错了全线返工）。**store 设计要严格 TDD（Opus 会写测试），你给出字段/action 契约即可。**
4. **交互时序**：尤其**回投通道**（审批条/问询卡是阻塞 Promise：渲染卡→用户点→answer 回投给等待的 Promise→继续流）——这是整个前端最易出 bug 处，把时序状态画全。
5. **双基调映射**：所有颜色走 `--leemo-*` 语义 token；工作台冷灰赋值作用域怎么套（片2 已把卡片走语义 token + 搭子暖白值，工作台壳提供冷灰赋值域，卡片零改自动变色）。
6. **组件复用边界**：明确哪些是新组件、哪些复用片2 组件库（Timeline/TurnBlock/ProcessFold/6卡 + 交互卡 + 可视化卡）。

### 施工顺序建议（你在设计里给 Opus 排好批次，让它能并行派发）
把未建面按"依赖关系 + 可并行性"分批，标注每批能否并行、谁依赖谁。参考：交互卡（回投通道，高风险，先）→ 工作台壳（复用组件库）→ 输入区全量 → 独立二级面（设置/向导/搜索/文件/Skills/成果，多数可并行）→ 预览区/wiki/可视化。**你决定最优批次，写进文档。**

### 边界（别做）
- 不写实现代码、不建组件文件、不改现有 src（你是设计，Opus 执行）。
- 不碰后端/Bridge/契约（09 已冻结，你只消费）。
- 不设计 Phase-1 接真 IPC 的管道细节（那是另一条横切，Opus 阶段处理）——但你的 store 契约要为"fixture 态→真 IPC 态"零改预留（片1 端口化已铺好，IpcBridgeClient 换实现 store/组件零改）。
- 权威链冲突时后者覆盖前者：`02-前端设计规格-v2.0`（前端唯一权威）> `08-交互可视化增补` > `06-产品设计文档` > `09-契约`。视觉基准=`docs/design-audition/k3/` 两张 HTML。

### 先读再动（按需，别全读）
`docs/specs/02-前端设计规格-v2.0.md`（全，尤其 §5-§16 + 附A组件↔store↔事件对照）、`docs/design-audition/k3/workbench-mode.html`、`src/bridge/contract.ts`（store 接线的事件面）、`src/renderer/stores/message-model.ts`（已有 reducer 范式，你的新 store 照此 TDD 风格）、`docs/sdd/progress.md` 末尾（进度）。

### 交付即停
写完 `10-前端完整形态设计-v1.0.md` 就停，输出一句话总结 + 让用户审。**不要开始实现**——用户会审你的设计，然后切 Opus 执行。你若中途发现 02 spec 有形态级矛盾/缺口，在文档里标「⚠ 待用户裁决」列出，不自作主张。

---

## 【第二部分：Fable 产出后，Opus 接续路标】（用户审过设计后用）

新开 Opus 窗口或本窗口切 Opus，第一步：
1. 读 `docs/specs/10-前端完整形态设计-v1.0.md`（Fable 产出）+ 本文件 + `MEMORY.md` + 台账末尾。
2. 按 Fable 排的批次，**批量并行派发**（记忆 `sdd-cost-batching-preference` + `dispatching-parallel-agents`）：
   - store 契约层：严格 TDD，Opus 写测试 + Sonnet 实现，或 Opus 亲写（不可逆判断点）。
   - 视觉层：无头 `kimi -p -m kimi-code/k3`（记忆坑：裸 -p、git diff --stat 才是真进度信号、失败前台重派）。
   - 回投通道：Opus 对抗审查（最易出 bug）。
3. 自验纪律：每个改类型 Task 验证步含 `npm run typecheck`；主控自跑 tests + devtools 自渲染（减少用户目验）；**只在里程碑（一个完整面/一批面跑通）叫用户目验**。
4. worktree 正确姿势（记忆 `worktree-baseref-gotcha`）：`git worktree add .claude/worktrees/<name> -b <br> main` → EnterWorktree(path) → npm install → 跑基线 290 绿。
5. 遗留 gate 接真 IPC 时带走：Phase-1 gate（store 订阅/fixture default）、Bridge 遗留（costSource/dangerLocked/pool↔interact，记忆 `bridge-batch-followups`）。
6. 场景库 + 思维链样例草稿已备：`docs/handoffs/fixture-scenarios-and-thinking-samples.md`（19 场景 + 多轮思维链样例，验收喂多场景专治单场景盲区）。

### 模型分档（本轮特化）
- **Fable+Max**：仅前端完整形态设计（本文件第一部分）。做完即切。
- **Opus 4.8**：批量执行的主控 + 回投通道对抗审查 + 里程碑终审。
- **Sonnet 5**：规格写死的实现卡（store TDD 实现、视觉整合）。
- **K3（kimi -p）**：纯视觉穿衣。
- effort：设计=max（已在 Fable）；执行主控=medium；回投通道/终审=high。
