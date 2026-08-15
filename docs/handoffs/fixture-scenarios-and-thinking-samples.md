# Fixture 场景库清单 + 思维链样例（draft）

> 日期：2026-07-22 ／ 用途：片3 前置 fixture 场景库 + 思维链丰富化的实现草稿
> 落地：`src/renderer/bridge/fixtures/scenarios/`（具名场景集）；fixture-client 支持按场景名驱动
> 事件类型见 `src/bridge/events.ts` 的 `LeemoEvent` 判别联合；reducer 见 `src/renderer/stores/message-model.ts`

---

## A · 场景清单（★=5天冲刺关键路径必备，其余为稳态打磨）

### A组 快乐路径（基线）
1. ★ **整理笔记**（现有 DEMO_TURN）— text+thinking+plan+tools+subagent+compact+usage+result 全要素
2. **纯聊天**（零工具）— 用户问 momo 答，只有 text，无过程折叠卡（验：无工具时不出空折叠）
3. **单工具快答** — 一次 Read → 直接答（验：单步过程折叠的最小态）

### B组 非快乐路径（★冲刺必测——真工具会触发这些）
4. ★ **工具失败** — `tool.finished isError:true` → momo 说明并换招或报错（验：ToolCard error 态红 + 后续文本）
5. ★ **审批拒绝** — canUseTool 待答 → 用户拒 → momo 承认停手（验：审批条 deny 分支 + 回投）
6. ★ **审批允许一次** — canUseTool → allow-once → 工具继续（验：回投 resolve 后流恢复）
7. ★ **中断重来** — 流中用户中断 → interrupted 页脚「已停止」→ 重新发（验：activeRunId 清、footer interrupted、新 runId）
8. **compact 触发** — 长上下文 → 流中 `compact.boundary` → 继续（验：CompactDivider 不裂折叠卡）
9. **超长/空计划** — todos=[] 边界 / 12 条 todo 滚动（验：PlanCard 0 分母、长列表）
10. ★ **运行报错** — `run.finished isError:true` → 错误页脚（验：MessageFooter「⚠ 这条没跑完」）

### C组 思维链密集（用户点名——见下方样例）
11. **多段思考交织** — thinking→Read→thinking→Write（验：多个 ThinkingCard 按时序不合并）
12. **自我纠正思考** — momo 想到一半推翻重来（验：内心独白真实感）
13. **犹豫决策思考** — 两种写法权衡（验：不确定性表达）

### D组 多轮对话级（用户点名——见下方样例）
14. **多轮上下文引用** — 第2轮思考引用第1轮成果（验：跨 run 的 thinking 连贯）
15. **长对话滚动** — 5+ 回合（验：智能滚动/回到底部/按回合分组）
16. **问询往返** — ask-user 卡 → 多选 → 继续（验：问询卡回投，片3）

### E组 状态
17. **空状态** — 无消息（Greeting + 落地卡）
18. **liveness** — 运行中工具 + 停止键（验：LiveStatusBar + InputBox busy）
19. **分身活动** — subagent 嵌套（验：ActivityCard childToolUseIds 计数）

---

## B · 思维链样例（LeemoEvent 数组，可直接进 scenarios）

### 样例 1 · 多段思考交织（场景 11）
```ts
export const THINKING_INTERLEAVED: LeemoEvent[] = [
  { type: "thinking.delta", text: "先扫一眼这份 PPT 的目录，" },
  { type: "thinking.delta", text: "38 页有点多，重点八成在「遍历」和「平衡树」两节。" },
  { type: "tool.started", toolUseId: "t1", name: "Read", subagent: false, input: { file: "第五章.pptx" } },
  { type: "tool.finished", toolUseId: "t1", isError: false, contentSummary: "38 页 · 2,146 字" },
  { type: "thinking.delta", text: "果然，前 3 章是铺垫，" },
  { type: "thinking.delta", text: "考点集中在第 4 节的三种遍历和第 6 节的 AVL 旋转——先把这两块的例题挑出来。" },
  { type: "tool.started", toolUseId: "t2", name: "Grep", subagent: false, input: { query: "例题" } },
  { type: "tool.finished", toolUseId: "t2", isError: false, contentSummary: "命中 9 处" },
  { type: "text.final", text: "看完了，重点就在遍历和 AVL 两块，我挑了 6 道最典型的例题。" },
  { type: "run.finished", subtype: "success", isError: false, finalText: "看完了，重点就在遍历和 AVL 两块，我挑了 6 道最典型的例题。", pathAudit: { claimed: [] } },
];
```

### 样例 2 · 自我纠正思考（场景 12）
```ts
export const THINKING_SELF_CORRECT: LeemoEvent[] = [
  { type: "thinking.delta", text: "本子里已经有一份「第五章笔记」了，" },
  { type: "thinking.delta", text: "那我直接往里追加就行——" },
  { type: "thinking.delta", text: "等下，先看看那份是不是同一版，别覆盖了用户手写的批注。" },
  { type: "tool.started", toolUseId: "t1", name: "Read", subagent: false, input: { file: "第五章笔记.md" } },
  { type: "tool.finished", toolUseId: "t1", isError: false, contentSummary: "已有 3 段手写批注" },
  { type: "thinking.delta", text: "果然有批注，那不能覆盖，改成新建一份「复习版」并在末尾链接过去。" },
  { type: "text.final", text: "你之前那份有手写批注，我没动它，另存了一份「复习版」，末尾放了跳转链接。" },
  { type: "run.finished", subtype: "success", isError: false, finalText: "你之前那份有手写批注，我没动它，另存了一份「复习版」，末尾放了跳转链接。", pathAudit: { claimed: [] } },
];
```

### 样例 3 · 犹豫决策思考（场景 13）
```ts
export const THINKING_DELIBERATE: LeemoEvent[] = [
  { type: "thinking.delta", text: "笔记结构有两种走法：" },
  { type: "thinking.delta", text: "一种按 PPT 页码顺序抄，好对照但零散；一种按考点重排，好复习但要动脑归类。" },
  { type: "thinking.delta", text: "用户是要「复习」笔记，那按考点重排更合适——多花点力气值。" },
  { type: "text.final", text: "我按考点帮你重排了，不是照 PPT 顺序抄，这样复习时一条线索能串起来。" },
  { type: "run.finished", subtype: "success", isError: false, finalText: "我按考点帮你重排了，不是照 PPT 顺序抄，这样复习时一条线索能串起来。", pathAudit: { claimed: [] } },
];
```

---

## C · 多轮思维链样例（场景 14——一整段对话，跨多个 run，思考引用前文）

> fixture-client 按「用户每次 send 触发下一个 run 的事件流」驱动。以下是 3 轮对话，thinking 逐轮引用前轮成果。

### 轮 1 · 用户：「把第五章 PPT 整理成复习笔记」
```ts
export const MULTITURN_R1: LeemoEvent[] = [
  { type: "thinking.delta", text: "先通读 PPT 找考点，再决定笔记结构。" },
  { type: "tool.started", toolUseId: "r1t1", name: "Read", subagent: false, input: { file: "第五章.pptx" } },
  { type: "tool.finished", toolUseId: "r1t1", isError: false, contentSummary: "38 页" },
  { type: "tool.started", toolUseId: "r1p1", name: "TodoWrite", subagent: false, input: { todos: [
    { content: "提取 PPT 全文", status: "completed" },
    { content: "按考点重排", status: "completed" },
    { content: "写入本子", status: "completed" },
  ] } },
  { type: "text.final", text: "笔记整理好了，按「遍历 / 平衡树 / 应用」三块重排，存到本子了。" },
  { type: "run.finished", subtype: "success", isError: false, finalText: "笔记整理好了，按「遍历 / 平衡树 / 应用」三块重排，存到本子了。", pathAudit: { claimed: [] } },
];
```

### 轮 2 · 用户：「再帮我出 10 道练习题」（思考引用轮1的笔记结构）
```ts
export const MULTITURN_R2: LeemoEvent[] = [
  { type: "thinking.delta", text: "刚整理的笔记里「遍历」和「AVL 旋转」是重点，" },
  { type: "thinking.delta", text: "出题就围绕这两块，难度按 6 基础 + 3 中等 + 1 综合分配，别全堆难的。" },
  { type: "tool.started", toolUseId: "r2t1", name: "Write", subagent: false, input: { file: "第五章-练习题.md" } },
  { type: "tool.finished", toolUseId: "r2t1", isError: false, contentSummary: "10 题 + 答案" },
  { type: "text.final", text: "10 道题按你笔记的重点出的：6 道遍历基础、3 道 AVL 中等、1 道综合应用，答案在末尾。" },
  { type: "run.finished", subtype: "success", isError: false, finalText: "10 道题按你笔记的重点出的：6 道遍历基础、3 道 AVL 中等、1 道综合应用，答案在末尾。", pathAudit: { claimed: [] } },
];
```

### 轮 3 · 用户：「这一章我还有哪里没弄懂？」（思考综合前两轮）
```ts
export const MULTITURN_R3: LeemoEvent[] = [
  { type: "thinking.delta", text: "从刚出的题看，AVL 旋转是最容易错的——" },
  { type: "thinking.delta", text: "用户没做题我看不到对错，但根据笔记里这块内容最密、例题最多，" },
  { type: "thinking.delta", text: "大概率这里是难点。我提醒他重点盯这块，而不是泛泛地说「多复习」。" },
  { type: "text.final", text: "凭这章的结构猜，AVL 的左右旋最容易卡壳——内容最密、例题最多。你先拿练习题里那 3 道 AVL 试试，卡住我们再拆。" },
  { type: "run.finished", subtype: "success", isError: false, finalText: "凭这章的结构猜，AVL 的左右旋最容易卡壳——内容最密、例题最多。你先拿练习题里那 3 道 AVL 试试，卡住我们再拆。", pathAudit: { claimed: [] } },
];
```

---

## D · 冲刺 vs 稳态的取舍提示

- **若走 5 天内测冲刺**：场景库只需 ★ 子集（1/4/5/6/7/10）做 TDD 护栏——够测审批回投 + 错误路径，然后直奔真模型，真实场景自然发生，不必造全套假数据。
- **若走稳态片3-9**：全 19 场景 + 全部思维链样例都做进场景库，每片喂 3-5 场景验收，专治单场景盲区。
- 思维链样例（B/C 组）两条路都值得做——多轮思考是 momo「有脑子」人格感的关键，且已是纯数据零风险。
