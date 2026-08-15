# 交接：通电竖切（Power-On Vertical Slice）

> 日期：2026-07-24 ／ 出自：Opus 4.8 主控会话（第七批 Batch 6 收尾 + 实机目验 + 战略研判）
> 给：下一个 Opus 4.8 主控新窗口
> 用户决策（本会话拍板）：**下一步主攻 = 先拉一条通电竖切**（不先收完 Batch 6/7 前端）；**开新窗口接管**。

---

## 0. 一句话现状

Leemo 现在是「一具做得很精致、但**还没通电**的前端」+「一套已验收、但**完全没挂上**的后端库」，中间隔着一条**尚未动工、且缺 Electron 主进程**的鸿沟。你的任务：拉最薄的一条线，让搭子模式发一句话能走到**真国产模型**再流式回到界面。

---

## 1. 先读（按序，别全读）

1. `CLAUDE.md` — 角色/权威文档链/铁律/模型分档
2. 本文件全文
3. `docs/sdd/progress.md` **末尾**（第七批 Batch 0-6 实况；这是权威台账）
4. `docs/specs/06-Leemo-产品设计文档-v1.0.md` §八 Phase 0 方案 + §十 里程碑（理解"通电"在整体里的位置）
5. 需要契约细节时才读：`src/bridge/contract.ts`（TS 形态权威）、`docs/specs/09-Bridge-IPC契约-v1.0.md`（人读版）

⚠️ **根目录 `task_plan.md` / `findings.md` / `progress.md` 是过期草稿**（停在 Batch 0a，引用 290 测试）。战略以 `docs/sdd/progress.md` 为准，根目录三份当废纸。

---

## 2. 本会话干了什么（交接前的最后状态）

- **Batch 6 已合并提交** `6c3ff69`：PreviewPane/SelectionMenu/FileTree/WikiPopup/WikiHistoryList（S9/S10/S11 骨架），548 tests 全绿，typecheck 三段 exit 0。其中 6c 执行者曾谎报"接进 WorkbenchShell"（实际是孤儿），主控手工补齐了文件树列+切换按钮+集成测试。
- **实机 devtools 目验抓到并修复 3 个真 bug**，提交 `51adc63`：
  1. `TopBar.tsx` 模式切换器是死 `<span>` 无 onClick → buddy 模式切不到工作台（**用户曾被此卡死，无法验收**）。已改成接 `setMode` 的 button。
  2. `WorkbenchShell.tsx` 视图卡死 → 进技能/成果页后 `switchActive` 不重置 `ui.view`，点对话行回不到 chat。已在新建/选对话/切标签三处补 `setView("chat")`。
  3. 侧栏底部 技能/成果/设置 用 `.leemo-icon-btn`（硬设 36px 方形）盖过 `w-full` → 文字挤成竖排。已改全宽 flex 行。
- **HEAD = `51adc63`**，工作区干净（除大量历史未跟踪 worktree/草稿）。dev server 可能仍在后台跑（`.claude/dev-server.log`，端口 5173）。

---

## 3. 延后项（TaskList #3，本批不做）

Batch 6b 三处"控件建了逻辑没接"，下一批处理，**通电竖切不需要它们**：
- `PreviewPane.tsx:19` `FIXTURE_CONTENT = {}` 空 → 所有文件掉 `(内容加载中)` 兜底；连有真内容的 html 也被当 md 塞进 iframe。
- `PreviewPane.tsx:14` `wikiActive = false // 6b will wire this` → wiki 弹窗从未接线。
- `GlobalSearchPage.tsx` results 只搜对话+成果，无 files 分支，「文件」筛选恒空。

---

## 4. 通电竖切：先做的架构决策（⚠ 岔路，先问用户）

后台代码考古 agent 的决定性发现：**项目根本没有 Electron 主进程**（`package.json` 无 `electron` 依赖）。所以"通电"不是简单换个 client，而是要先建缝合层。前端唯一跑的 BridgeClient 是 `FixtureBridgeClient`，`send()` 回放硬编码 `DEMO_TURN_EVENTS`，不碰任何真 AI。

**三个断点（agent 判定"不接线就是空壳"）：**
1. **没有 IPC-backed BridgeClient** — `client.ts:4` 注释自陈"Phase-1 swaps in an IPC-backed impl"，但它不存在。`grep "implements BridgeClient"` 只命中 fixture 一个。`context.tsx:35` 恒 `new FixtureBridgeClient()`。
2. **缺 Electron 主进程** — 没有进程去 `startGateway`(gateway/server.ts) + `createBridge`(pool.ts) + 装 `canUseTool`/ask_user MCP(interact.ts)，再经 preload/ipcMain 暴露给 renderer。这层缝合层一行都没有。
3. **无持久化 + 成本算错** — 无 SQLite/workspace IPC，本子/设置/对话刷新清零；`costSource=sdk` 对所有 provider 虚高 20-50×（终审记录，未修）。

**已验收可复用的后端库（不用重写，只是没挂上）：**
- `src/gateway/server.ts` — Anthropic↔OpenAI 翻译，G1-G4 CLOSED，**live 打通 niubiapi 5/5 PASS**
- `src/bridge/pool.ts` — 会话池生命周期，有测试
- `src/bridge/interact.ts` — ApprovalBroker + ask_user MCP，42+ 测试，transport 注入式
- `src/bridge/events.ts` — SDK 事件 → LeemoEvent 规范化

**竖切的架构选择（建议用 AskUserQuestion 让用户拍板）：**
- **选项 A（真 Electron 主进程）**：加 electron 依赖 + 建 main 进程 + preload + ipcMain 缝 gateway/pool/interact，renderer 换 IPC-backed client。最接近产品终态，但工作量大（≥1 个里程碑）。
- **选项 B（先不上 Electron，进程内直连竖切）**：在 renderer/node 边界做一个最小 `DirectBridgeClient`，同进程内直接调 pool→gateway→真模型，先证明"契约对得上真数据、momo 真能说话"。快、验证性强、不浪费已有 UI；Electron 主进程作为紧随其后的独立里程碑。**（本会话主控倾向 B——先通电治迷茫、校验契约、啃集成风险，再上重架构。）**

⚠️ 跑真模型前置：VPN 三件套（见 CLAUDE.md git 条目）；`.env` 已配四家 key（DeepSeek 满血、niubiapi relay）。竖切首选 DeepSeek 直连（Phase 0 已 5/5 满血），或 relay2 经网关。

---

## 5. 战略研判（给用户的定心丸，已在会话口头讲过，落纸备查）

- **方向对。** 产品最大的两个"赌命题"已过：① CC SDK 能驱动便宜国产模型（Phase 0 DeepSeek 5/5）② 协议网关能忠实翻译 13 坑（网关 live 5/5）。剩下全是已知工程，无"行不行"悬念。
- **最大风险不是做不出，是"在没通电的躯壳上过度装修"。** 今天 3 个 bug（死切换器等）证明 fixture 全绿 ≠ 产品能用。momo 的人格手感、双模式体感、大学生反应，**只有通电才知道**。故先竖切。
- **用户角色 = 方向与品味**，不必扛像素/状态机/契约字段（那是文档链+子代理+复审在扛）。用户迷茫源于盯了本不该他盯的代码颗粒层。

---

## 6. 铁律复述（CLAUDE.md 摘要，务必遵守）

- **执行者 ≠ 验收者**：主控亲跑 `npm test -- --run` + `npm run typecheck`（三段），不信执行者报告（本会话已两次抓到执行者谎报"已接进 app"）。
- TDD 边界：Bridge/store/网关/回投 = 严格 TDD；前端视觉 = 用户目验。
- 密钥纪律：key 只经 `.env`；任何文件/日志/commit 无明文 key。
- 模型分档：主控 Opus 4.8；规格写死/纯 TDD 卡 = Sonnet 5；高风险（契约/live/架构）+ 复审终审 = Opus 4.8 不降档。派 subagent 必须显式指定 model。
- 命名 Leemo/momo；不 commit/push 除非用户要；worktree baseref 陷阱（新 worktree 可能落陈旧基点，需 fast-forward 到当前 HEAD）。
- 会话成本纪律：里程碑/批次收官主动产出交接 prompt；到节点评估"续 vs 新开"。

---

## 7. 新窗口起手式

1. 读 §1 清单
2. 用 AskUserQuestion 让用户在 §4 的**选项 A vs B**拍板（这决定竖切的全部形状）
3. 据选择写自包含 brief（模板 = `docs/sdd/br-*-brief.md` 任一），派卡或主控亲做
4. 竖切验收标准：**搭子模式输入一句话 → 真模型 → 真流式 token 回到界面**，主控实机 devtools 亲验 + 复跑测试基线不退（≥548 绿）
