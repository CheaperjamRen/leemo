# 轮 7 交接 —— 给下一个 coding agent

> 写于 2026-07-29。上一手：Claude Code（本轮做实机诊断 + PRD + A/C6 三个 commit + A3 未提交）。
> **读这一份就够开工。** 但下面「必读」那 4 份必须真读，不是引用。

> **状态订正（2026-08-02）**：本文下面的 A3 未完成、Skills 未做等描述是历史交接快照，不能当作当前状态。当前应以 `docs/sdd/r7-requirements-ledger.md` 第十八节以后、`docs/research/2026-07-31-r11-skills-verification.md`、`docs/research/2026-07-31-r11-document-tools-verification.md` 和最新代码为准：旧的 40 个生成式占位模板已经删除，当前为 26 个真实通用精选 Skill + 4 个 Office Skill；外部工作区、定时任务、搜索语义收口、静态社区精选下载清单、本地来源安装和 Word 精确文字修改副本均已有实现。全量回归为 163 个测试文件 / 2248 个测试通过。MVP 不运营在线 Skill Hub；用户自己的 Skill 位于工作区 `.leemo/skills`，未知来源默认可直接安装且扫描可选。

---

## 0. 三十秒版

- 用户 7/28 实机用了一遍，判定「纯垃圾半成品」，四条抱怨：**写文件写不了 / 联网搜索不起效 / 本子是摆设 / 设置简陋难搞**。
- 我用 CDP 驱动真 Electron 复现了全部四条，根因写在 `docs/research/2026-07-28-live-audit-findings.md`。
- **核心诊断：能力都是真的、也都验收过了；断的是每条路径的最后一厘米。历史台账全绿是因为验收脚本每次都替用户走完了那一厘米。**
- 已修并实机验证：工作区统一（A1）、权限策略接线（A4）、acceptEdits 真实现（A5）、假警报（C6）。
- **正在做**：A3 设置落盘 + 热生效。落盘那半已验证；热生效**打开方向有 bug 没定位完**（见 §4）。
- 全部需求与批次在 `docs/sdd/r7-requirements-ledger.md`，那是**唯一需求真源**。

---

## 1. 必读（按顺序，都要真读）

| # | 文件 | 为什么 |
|---|---|---|
| 1 | `docs/sdd/r7-requirements-ledger.md` | **唯一需求真源**。用户 7/28 四条拍板 + 能力面真实底账 + A~F 批次 + 12 条收工判据 |
| 2 | `docs/research/2026-07-28-live-audit-findings.md` | 实机诊断，逐条根因 + 代码位置 + 截图。**含一条我自己的订正**（见 §6） |
| 3 | `docs/specs/11-Leemo-PRD-我理解的产品-v0.1.md` | 产品理解。用户看完说「理解了 80%+，很满意」，但补了三条纠错（§2） |
| 4 | `docs/handoff/*轮6*` + `docs/sdd/progress.md` | 上一轮交接与台账。**注意 progress.md 的验收口径有系统性偏差**（§6） |

06/02/10 号规格仍是宪法，冲突以它们为准。

---

## 2. 用户说过的话 —— 必须记住的口径

### 2.1 7/28 四条拍板（后续一切以此为准）

1. **差异化 = 通用 agent 层先与 workbuddy / ChatGPT(Codex) 一致，再叠学习+求职特化。**
   底层是 Claude Code = 最强 coding harness，**coding agent 能力也要一致**。
   特化 = 预装好用的 MCP / Skills + 特定功能。
   ⇒ **通用能力平齐是特化的前置，不是可选项。**
2. **momo = 有主见且靠谱，但绝不拒绝用户。**
   可以做有主见的评价；**不允许曲解或拒绝用户给的任务**。
   用户原话：*「用户不是来被甩脸色的」*、*「workbuddy 什么都愿意干、任劳任怨」*。
   现状是 momo 会顶回来（历史对话里真有「这活不该干」「我拒绝」），**必须改**。
3. **CC 原生的现成好用功能一样都不许落下**：所有 tools、subagent、
   browser use MCP / chrome MCP 等，逐项打通并实测。
4. **PRD §七 12 条判据全部修绿。**

### 2.2 「视觉」的边界（用户主动澄清，很重要）

> 「这里说的视觉，仅仅是指美观程度和美术设计，而不是泛指 UI/UX/功能，
> **一切影响到功能和产品定位符不符合的 UI/UX 都不算在纯视觉里，是属于一定要解决和优化的问题。**」

分类判据：**这个坏了会不会让用户走不通/误解产品是什么？**
- 会 ⇒ **功能**，当轮必修：无导航、点了没反应、假数据、误导性提示、状态退不出、违反产品定位。
- 不会 ⇒ 纯视觉，可攒：色相层级、间距留白、阴影圆角、字重、插画、动效曲线。

**历史教训**：此前把这类问题都塞进「视觉待目验」批次攒着（comate/15 攒了 7 项），
于是既没当功能修、也没人看，用户一上手全撞上。**不许再攒。**

### 2.3 工作区模型（用户亲自纠正我的错误设计）

我提议「cwd 统一改成 `~/Leemo` 根」，**被用户否了**。他要的是：

> 「我们的『本子』逻辑，本质上是用户自己电脑上的新增的文件夹和工作区，跟 IDE/cli 里面
> 概念的每个文件夹对应一个工作区是相通的，我们只是相当于统筹管理了这些工作区/文件夹…
> 每一个本子背后对应的都是一个文件夹，然后这些文件夹里有各自的对话记录 session 等，
> 然后 leemo 主人格的对话在一个更上级的文件夹里或者直接就是在某个默认工作区里」

⇒ **Leemo 统筹管理多个工作区，每个本子就是其中一个。本子是第一等公民，不是标签。**
落地成五条规则，写在 PRD §4.2。A1 已按此实现（cwd 每对话一个）。

### 2.4 用户认可的两个新 idea（我提的，他说「都认可了」）

- **挂载外部文件夹为本子** —— 用户电脑上早有 `D:\大学\高数\`，让他挂进来比让他搬家现实得多。
  「让 Leemo 从『又一个要我搬家的软件』变成『管我已有东西的软件』」。
- **本子模板** —— 新建本子选「课程/项目/求职」，预置目录结构与本子级 CLAUDE.md。
  二期求职工作台其实就是一个本子模板，不需要另做一个壳。

### 2.5 四个 AskUserQuestion 的拍板结果

| 问题 | 用户选择 |
|---|---|
| 写文件默认弹不弹审批 | **写文件不问，跑命令才问**（= acceptEdits 真实现）✅ 已做 |
| 浏览器 MCP 预装哪个 | **chrome-devtools MCP**（复用已装 Chrome，不另下 300MB） ⬜ 待做 |
| 附件做到什么程度 | **图片真进对话 + 文件转成本子里的引用** ⬜ 待做 |
| 批次顺序 | **A 和 D 一起做**（地基 + momo 口径） |
| 设置热生效语义 | **下一轮生效 + 界面明说「下轮起生效」**（不中断当前轮） |

### 2.6 用户的工作方式偏好

- 技术选型/技术路径**全权交给你拍**，简述理由即可，别让他在看不懂的选项里纠结。
- 产品功能设计、用户心智**他要管**，「我都不希望你跑偏」。
- **有疑问尽量多问他，少自己做决定**（原话）。
- 他会认真读、并写高质量补充。他能看出你在敷衍。

---

## 3. 已完成（3 个 commit，都实机验证过）

### `4b0c12b` docs(r7): 实机诊断 + PRD + 轮7需求台账
含全部截图与 6 个可复跑的 CDP 验收脚本（`scripts/ux-*.mjs`）。

### `f57990c` feat(r7-A): 本子=工作区 + 权限策略真接线 + acceptEdits 真实现

- **A1**：`HostDeps.sandboxDir` → `workspaceRoot`；cwd **每对话一个**（本子对话=该本子目录，
  主人格对话=`~/Leemo` 根）；ConvRecord 带自己的 cwd 供 pathAudit。**沙箱去掉了。**
  - 实机：同一句「请在工作区里新建文件 诊断/xxx.md」跑三次，文件全部落在
    `C:\Users\Example\Leemo\诊断\`，旧 sandbox 空。**修复前 100% 落在用户看不见的地方。**
- **A4**：`permissionMode` / `dangerousCommandCaching` 此前**从未过线**（设置页有控件、
  broker 有字段、中间没有线）。contract 加了 `dangerousCommandCaching`。
- **A5**：`acceptEdits` 从 RESERVED 空壳变成真实现 —— `EDIT_TOOLS`（Write/Edit/NotebookEdit）
  自动放行，Bash/KillShell/第三方 MCP 仍问。
  - 实机：审批卡峰值 **0**，回合 **10 秒**结束（修复前同样一句卡在审批条上 **90 秒**）。

### `5c5dbb9` fix(r7-C6): URL 与相对路径不再被误报成「写到工作区外」

两个假阳性都让**成功**的回合显示琥珀警报：`[A-Za-z]:` 匹配 `https:` 里的 `s:`；
裸 `/` 分支匹配 `诊断/写文件测试.md` 中间那个斜杠。都修了，仍抓得住真逃逸。

---

## 4. 正在做 —— A3（未提交，工作区里）

**状态：1494 测试全绿、typecheck 0 错、`npm run build` + `build:main` 都干净。落盘那半已实机验证。热生效有一个未定位完的 bug。**

### 4.1 已做完的部分

**落盘**（已实机验证 `keys=11`、`webEnabled=true` 真写进 SQLite）
- `schema.ts`：新增 `settings(key, value_json)` 表 + `saveSettings()`（整表替换、事务）
- `main.ts`：`leemo:persist` 加 `saveSettings` op
- `client.ts` / `ipc-persistence-client.ts`：端口加 `saveSettings`，`PersistedSnapshot.settings`
- `settings.ts`：`PERSISTED_SETTING_KEYS`（11 个，显式白名单）+ `pickPersistedSettings()` +
  `hydrate()`（逐字段校验，坏值丢弃保默认，**不因一个坏字段整次失败**）
- `sync.ts`：settings 订阅，**按值比较**（不是引用 —— 每次 set 都产生新 state 对象），**不 debounce**
- `context.tsx`：hydrate **必须在** `startPersistenceSync` 之前（否则 sync 拿默认值当基线，把用户设置覆盖回去）

**热生效骨架**
- contract：新通道 `bridge:updateContext` + `UpdateContextRequest`（全字段可选，缺=不变）
- `pool.ts`：`searchShimPort` 从 readonly 改可变 + 新增 `setSearchShimPort()`（下一轮生效，同 setModel）
- `bridge-host.ts`：ConvRecord 带 `extras` / `policy` / `personaCtx` / `notebookId`；
  `bridge:updateContext` handler 重建 systemPrompt + disallowedTools + 就地改 policy 对象
  （broker 调用时才读 `policy.mode`，所以改同一个对象是热的、不用重建 broker）
- `conversations.ts`：`broadcastContext()` —— 向所有 hostLive 对话推当前 context，返回 reached ids
- `ui.ts`：`contextHint` + `noteContextApplied(count)`
- `SettingsPage.tsx`：`data-testid="context-hint"`，文案
  「已保存 · 正在进行的 N 个对话下一轮起生效」；N=0 时只说「已保存」

**为什么热生效能成立**（已核实）：`send()` 每轮重建 options，`buildQueryFn` 懒读 `extras`；
`buildConversationEnv` 每轮重读 `this.searchShimPort`。所以改容器就够，不必中断当前轮。

### 4.2 ⚠️ 未定位完的 bug —— 交接的第一件事

**症状**：联网开关**关**的方向热生效正常（实机确认 momo 立刻说「我不能联网」）；
**开**的方向不生效（momo 仍说「搜索工具在这个会话里不可用」）。

**已排除**：
- `ensureSearchShim()` 不会抛（它自带 `.catch(() => undefined)`）
- shim 是活的（日志 `search shim listening on 127.0.0.1:56199`，且服务过真查询）
- 单测覆盖了这条路且**反向验证过能抓回归**（`tests/host/bridge-host.test.ts` 的
  `describe("bridge:updateContext")`，把 handler 打残 → 2 条立刻红）

**下一步怎么查**（我已铺好路）：
`bridge-host.ts` 的 handler 里加了一行**永久日志**：
```
[leemo:ctx] update cid=xxxxxxxx known=true search=true fetch=true perm=... mode=...
```
主进程已重编译并重启（`.tmp-electron-dev5.log`）。**下一步就是：翻一次开关，看这行日志有没有出现、`known=` 和 `search=` 是什么。**
- 日志**没出现** ⇒ 渲染层没调通道（查 `context.tsx` 的 settings 订阅是否真触发、
  `broadcastContext` 的 `hostLive` 是否为空）
- 日志出现且 `search=true` ⇒ host 收到了，问题在 wiring（查 `chooseSearchWiring` 的
  返回、`extras.disallowedTools` 是否真被下一轮读到；注意 `extras.mcpServers` 在
  handler 里**没更新** —— 若走 shim 不服务的降级路径，自建搜索 MCP 不会被注册，这是个已知缺口）

### 4.3 A3 还欠的
- `extras.mcpServers` 热更新（上面那个已知缺口）
- **`contextHint` 没有自动消失**。这害我误判过一次（见 §6.2），也会误导用户。加个 ~4s 自动消失或按分区就地提示。

---

## 5. 接下来该做什么（顺序有依赖）

**先做 §4.2 那个 bug，再往下。**

### 批次 A 剩余
- **A2**：对话记录落进所属本子 `<本子>/.leemo/`，SQLite 降为可重建索引。
  这条让「一个本子拷到 U 盘，笔记+对话一起走」成立。

### 批次 D（用户要求与 A 同批）
- **D1**：prompt 层②重写 —— 有主见可评价，**但绝不拒绝、绝不曲解用户任务**。
  回归判据：拿历史那条「写 1 到 200 每个数字的解释」真跑，必须**先说一句看法然后照做**。
- **D2**：删掉现有 prompt 里导致「训人」的表述。

### 批次 B（通用能力平齐，用户拍板 1+3）
B1 CC 全原生工具逐个实机点亮 · B2 subagent 端到端 · **B3 预装 chrome-devtools MCP** ·
**B4 用户自定义 MCP 管理（stdio/SSE + env，设置页增删启停）** · **B5 attachments 打通**
（图片 base64 真进对话；PDF/文档落进本子转成引用）· B6 coding agent 能力对齐 · B7 plan mode

> **能力面真实底账**（我读码实测，与台账口径不同，以这份为准）：
> Read/Write/Edit/Bash/Glob/Grep/TodoWrite/NotebookEdit/Agent(subagent) **都没被禁**，
> `disallowedTools` 只含条件禁用的 WebSearch/WebFetch；`maxTurns=50`。
> **完全没有的**：用户自定义 MCP（`mcpServers` 只装 Leemo 自己两个）、
> browser/chrome MCP、attachments（契约无字段，InputArea 能选能显示但发送时被丢）、
> plan mode。

### 批次 C（功能性 UI/UX —— 按用户口径这**不算**视觉）
C1 设置页重构（左侧分区导航 + 分区独立滚动 + **可搜索**）· C2 补齐 06 缺的五块 ·
C3 本子选中即进入 · C4 浮层互斥+ESC · C5 清假数据 · ~~C6~~ 已修 ·
C7 对话标题 AI 生成 · C8 时间戳+用量脚注折叠 · C9 搭子态过程卡降一行 ·
**C10 搭子态加设置入口** · C11 来源链接可点 · C12 首设向导+示例本子

> **C10 优先级要提**：搭子态**根本没有设置入口**（我的验收脚本就因此卡住，只能切工作台）。
> 默认模式是搭子态 ⇒ **用户在默认模式下无法打开设置**。一行的事，但它决定设置页能不能被用到。

### 批次 E（纯视觉，最后）
NewMax 逆向产物在 `.tmp-newmax-asar/`（未跟踪，94MB，**别提交**）：
- `ds-navsections.js` —— NewMax 内建设计系统文档页：8 类基础 token + **30 个组件**。
  我们完全没有的：Skeleton / Toast / Dialog / Tooltip / Slider / TabBar / DatePicker /
  UpdateBanner / Empty / RunningDot / StreamingPulse / Mermaid
- `i18n-settings-zh.js` —— 设置页 **42 个分区，每个带 title + description + keywords，可搜索**。
  我们 8 个、3.2 屏盲滚、不可搜。**这就是用户说「设置简陋、自由度低」的确切来源。**
  （42 个里别照抄桌宠/钱包/机器人对话；「可搜索的设置」必须抄。）
- `pretty-*.css` / 其它 i18n 表 —— 视觉与文案参考

### 批次 F（学习+求职特化，通用层平齐后）
预装学习 Skills + 错题本等 + 求职本子模板 + **挂载外部文件夹为本子** + **本子模板**。

---

## 6. 会再撞的坑（我这轮撞的，都记下来）

### 6.1 主进程改动必须**重启进程**，不是 reload 渲染层
`auditClaimedPaths`、bridge-host、pool 全在主进程。我 reload 了渲染层就以为没修好，
白查一轮。流程：`npm run build:main` → **按端口杀进程** → 重启 → **确认 PID 变了**。

### 6.2 判据必须锚到真界面，而且**宁可宽不可窄**
- 我把「停止键消失」写进诊断报告，**是假阴性**：那个按钮只有 `aria-label="停止"` 没有文字，
  我的判据查 `textContent`。已在诊断文档订正。
- 我的「momo 还说不能联网」正则只写了 `不能联网`，momo 说「我确实**没有联网能力**」时
  被判成「能搜了」—— **一个假通过**。漏判成「还没修好」只是白修一次；漏判成「修好了」
  会把缺陷放给用户。
- 我查「回复里有没有链接」其实在测文风。**真正的判据是工具原始返回里有没有真 URL。**
- `contextHint` 没有自动消失 ⇒ 我读到的是上一次操作留下的**过期提示**，据此误判了一次。

### 6.3 持久化会改变验收脚本的前置条件
A3 落盘之后，「默认关」不再成立 —— 上一次跑完脚本就把 `webEnabled=true` 存下来了。
**验收脚本必须自己建立前置条件**，不能靠默认值。

### 6.4 三层开关：生效值 = 统筹 AND 子项
只翻统筹「联网功能」不够。**关**的时候两层一起失效（所以只翻统筹能关），
**开**的时候子项还停在自己的值上（默认关）⇒「开了却搜不了」。这是设计语义，不是 bug。

### 6.5 `contextBridge` 暴露的对象在渲染层**不可改**
我想包一层 `window.leemoBridge.invoke` 来抓调用，赋值静默失败，`channelsSeen: []`
看起来像「渲染层没调」。**渲染层没法这样探。要探就从主进程加日志。**

### 6.6 A3 让 `mode` 落盘 ⇒ hydrate 会盖掉早期点击（还有一次模式闪烁）
hydrate 是 mount 之后异步跑的。脚本里早点的「切工作台」会被 hydrate 覆盖回去 ——
我的脚本改成了「点到设置入口真出现为止」。
**顺带一个真问题：用户会看到一次模式闪烁（先默认后恢复）。值得修。**

### 6.7 改 acceptEdits 会连带打断既有测试
4 处审批往返测试拿 Write 当载具，Write 现在自动放行了。
我把载具换成 Bash（**新默认下 Bash 才是真会问的那个**，比钉一个非默认档更忠实）；
永久白名单那条显式钉 `default` 档（主题是白名单往返，Write 只是载具）。
**原则：改了默认行为，先分清测试的「主题」和「载具」，别顺手把主题改掉。**

### 6.8 台账/progress.md 的验收口径有系统性偏差 —— 别照信
`docs/sdd/progress.md` 里那些 live 验收**不是假的**，但**验收的是「零件通电」，不是「用户走通」**。
铁证：轮 4 成果页验收脚本的 prompt 里**写死了绝对路径** `C:\Users\Example\Leemo\预览验收\成果验收.md`,
于是文件当然落在用户可见区、bookId 当然解析成功。换成一句人话「请在工作区里新建文件」
缺陷立刻现形。同一个模式在联网上重演：live 脚本每次都**新建对话**，从没测过
「用户在已有对话里打开开关」这个必然动作。
**⇒ 看到台账说某项已验收，先问：它测的是零件还是用户路径？**

### 6.9 我这轮自己犯的过程错误（别重复）
- **多次把话说完就结束回合，工具调用没真发出去**。台账那次是真空转（我描述了它然后没写）。
  用户看到的「停了」就是这个。**说了要做就在同一轮把工具调用发出去。**
- 说「后台 agent 还在跑」但**没核实**。它们其实卡死三个半小时。
  **报告状态前先核实。**（那两个 agent 死前干完了活，产物在 `.tmp-newmax-asar/`。）
- 工具名叫错（这个 harness 里读文件是 `read_file`，我发了 `Read`）。

---

## 7. 环境与命令

```bash
npm test                 # 1494 passed / 112 files（当前状态）
npm run typecheck        # 三段 tsc，必须 0
npm run build            # 渲染层
npm run build:main       # 主进程 —— 改 host/bridge/pool/main 后必跑
npm run electron:dev     # 带 LEEMO_DEBUG_PORT=9222 起 CDP
```

**CDP 验收脚本**（都可复跑，`scripts/`）：
`ux-audit.mjs`（通用 eval/key/shot）· `ux-tour.mjs` · `ux-settings-dump.mjs` ·
`ux-write-test.mjs`（写文件落点，A1 判据）· `ux-search-test.mjs` / `ux-search-live.mjs` ·
`verify-r7-a3.mjs`（A3 七条判据，**当前 5/7，另 2 条就是 §4.2 那个 bug**）

起 Electron 前把 `http_proxy` / `https_proxy` 清空；
带 `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`
否则窗口被遮挡时渲染层会停。

**Windows 环境**：PowerShell 主力；杀进程**按端口**（`Get-NetTCPConnection -LocalPort 9222`
→ `OwningProcess`），别按命令行匹配（历史事故：匹配不到 node 子进程，旧 host 一直占端口服务旧代码）。
git commit 用 `-F <file>`，别用 here-string 接管道（我踩过，commit 静默失败）。

---

## 8. 交接时的未决事项

1. **A3 未提交**。1494 全绿、typecheck 干净，但 §4.2 的 bug 未修完。
   建议：**先修完那个 bug 再一起提交**，或先提交并在 commit message 里写明未完成项。
   （我没提交是因为没拿到用户许可。）
2. `.tmp-newmax-asar/`（94MB）、`.tmp-*.log`、`.tmp-*.txt` 都是未跟踪的临时物，**别提交**。
   建议加进 `.gitignore`。
3. `docs/research/audit-shots/60-a3-hint.png`、`61-a3-same-conversation-search.png`、
   `verify-r7-a3.json` 是 A3 的实机证据，随 A3 一起提交。
4. 我在 `bridge-host.ts` 加的 `[leemo:ctx]` 日志是**永久的**（非敏感，只记哪些旋钮动了）。
   如果你觉得吵可以降级，但保留它的理由写在代码注释里：
   **这个通道存在的意义就是回答「我改的设置到没到 momo 那儿」，而两侧都没法探。**

---

## 9. 一句话交接

> 这个项目的引擎层（网关/桥/四家 provider/搜索三层链/持久化/打包）是真的，也是最贵的部分。
> 缺的是**每条用户路径的最后一厘米**，以及**把验收判据从「零件通电」改成「用户走通」**。
> A1/A4/A5/C6 已经证明这个改法有效：四条抱怨里最痛的两条，改动都不大，
> 难的是先看清「用户实际会怎么走」。

## 10. 2026-08-02 Office 技能包交接补充

- NewMax 与 Anthropic 官方 `docx/xlsx/pptx/pdf` 的逐文件对比见
  `docs/research/2026-08-02-newmax-vs-leemo-office-skill-diff.md`。
- 产品拥有者已经把四个目录放到
  `bundled-skills/office/skills/{docx,xlsx,pptx,pdf}` 并完成重新打包。
- `electron-builder` 会把它们带到 `resources/office-skills`，运行时先离线加载；
  当前最终包为 30 张可用 Skill / 12 个默认启用，中文卡片会映射到
  `/docx`、`/xlsx`、`/pptx`、`/pdf`，实际 XLSX 正文已在打包态进入模型请求。
- Office provisioner 只读取安装包内的本地 bundle，不再包含官方插件下载分支；
  没有完整 bundle 时明确降级到基础文档工具。
- 不要把“bundle 已加载”误写成“完整 Office runtime 已就绪”。
  `npm run verify:office-runtime` 当前严格失败：缺 LibreOffice/Pandoc/MarkItDown/
  PDF 核心库，隔离工作区不能解析主程序内部的 `docx/pptxgenjs`；随包脚本还有
  Windows `socket.AF_UNIX` 和默认 GBK 解码兼容问题。NewMax 的已证实 Excel
  路径本身也依赖系统 Python/openpyxl。详见同一对比文档的“当前交付状态”。

## 11. 2026-08-02 浏览器与下一阶段补充

- 默认独立浏览器已产品化，设置页可真实检查 42 项 Playwright 能力；当前 Chrome 已接官方 Playwright 扩展协议，但扩展未在本机做最终用户路径，状态只能写 Integrated。
- 浏览器关闭时所有 `mcp__playwright__*` 工具结构禁用；开启后常规点击/输入不再逐步索权，敏感工具仍问。业务上的最终投递/发布必须由 momo 再确认或由用户在本轮明确授权。
- AskUserCard 已做等宽选项；工作台输入区最大 880px、居中、无顶部分隔线，靠阴影悬浮。像素事实和截图见 `browser-automation-ui-facts.json`。
- 最终安装包已从 `app.asar` 启动真实 MCP，走通输入、点击、保存、关闭整个 MCP、重新启动并恢复同一浏览器身份。证据为 `packaged-browser-mcp-facts.json` / `packaged-browser-mcp.png`；模型调用 0。
- 当前验证基线：164 个测试文件 / 2258 项全绿，typecheck 0 错，renderer/main/NSIS 成功；安装器 `190,117,572 B`，解包 498 文件，没有因本卡增加文件数。
- 完整审计：`docs/research/2026-08-02-browser-automation-product-audit.md`。不要误写成 NewMax 的多身份、显式接管中心和录制工作流已经完成。
- 用户最新顺序：worktree/LSP 等编程特化后移；浏览器发布路径收口后依次做英语学习、论文可视化教学、大学/职业规划。反馈云平台和总视觉大改以后再做；视觉里程碑可临时调用 `openai/gpt-image-2` 产设计参考，但绝不保存用户提供的 Key。

## 12. 2026-08-02 通用工作台新定案与当前卡

- 用户侧只使用“本子”心智；全局 momo 无本子，隐藏默认工作区只负责无本子产物落盘。一个本子直接含多对话，点击本子恢复上次对话，主动作叫“新对话”。完整决策见 `docs/specs/02-已定决策清单.md` 第 I 节。
- 轻量文件变化回执已做到 Integrated：只在可能写文件的轮次启动，成功/失败/中断都在结束前汇总净变化；脚注一行展示，可展开，进入持久化时间线。不要改回 SDK `FileChanged` 空 hook：该 hook 只观察显式 matcher/watchPaths，空配置会得到假通过。
- 回执路径现可点击审阅：搭子态会切到工作台并打开预览；文件夹图标真实使用 `showItemInFolder` 选中文件，目录才用 `openPath`，失败不会再静默成功。删除项不显示无效动作；用户看到的友好路径与内部 workspace-relative operand 分离，隐藏默认工作区仍不会暴露。
- 当前自动证据为 172 个测试文件 / 2346 项全绿，三套 typecheck 0 错，renderer/main 构建成功；`1440x900` 与 `1024x720` fixture 已目验展开、预览切换、输入区与横向溢出。尚缺最终安装包真实模型写文件复验，状态不能写成 Release-verified。
- 不要直接补一个“撤销文件修改”按钮：SDK 有 checkpoint/rewind API，但当前 query 在回合终态关闭，回合后恢复尚未实证。先证明可持续 query 或设计有明确覆盖边界的 host 快照，再开放给用户。
- 原生可视化已做到 Integrated：production host 注册保留的一方 `leemo-visualization` MCP，只接受表格/对比/时间线/流程/柱状图五种结构化载体；对话原生渲染，静态 `.html` 成果原子落盘且脚本、网络、越界、内部目录与静默覆盖受阻。隔离安装包已从可见输入框走通省略扩展名的生成、实际默认工作区路径、1024x720 卡片、连续长文本预览、成果索引和整进程重启恢复；证据为 `native-visualization-facts.json` 与同前缀两张截图。任意交互应用和画布仍是后续能力。
- 实机抓到并修复了一个重要语义分叉：host 已把根级可视化路由到 `默认工作区`，成果 store 却曾保留模型请求的旧路径，导致预览找不到文件。现在可视化加入统一的根成果路由集合，卡片和磁盘路径一致；不要在组件里另写字符串猜测。
- `electron-builder` 现直接复用 `node_modules/electron/dist` 的精确版本运行时。当前 Windows x64 机器在依赖与 builder/NSIS 缓存齐全时，使用不可达代理跑 `npx electron-builder --dir` 与完整 NSIS 均成功且无下载；不要为了打包 clone Electron 仓库，也不要恢复成每次自动联网。换机器、升级 Electron/打包工具或切换目标平台仍可能需要一次匹配下载。日常开发只需 dev Electron，里程碑才打包。
- MindMemOS 当前不集成，只保留为可重建语义索引候选；不得替代 Leemo 记忆账本。见 `docs/research/2026-08-02-mindmemos-assessment.md`。

## 13. 2026-08-02 Markdown 编辑与文件抽屉

- Markdown 预览现在可在“阅读 / 编辑”之间切换，提供六个常用格式按钮与 `Ctrl+S`。保存走主进程窄写入路由，只允许现存、完整、2 MiB 内的 Markdown；规范化后的原生 realpath 同时决定扩展名、内部目录与越界规则，不是任意 renderer 文件写权限。
- 写入使用精确旧正文做乐观并发校验；外部改动会保留磁盘新版本与 Leemo 草稿，并提供复制草稿。真实写盘不再原地截断：同目录临时文件刷盘、二次核对基线/元信息、保留权限后原子替换，暂存失败时原文件完整。
- 标签关闭、工作区切换/打开/移除与应用退出都保护未保存内容。切换事务期间锁住编辑，成功后才清理来源工作区草稿；picker 取消或切换失败保留原标签和草稿。退出使用原生确认框，取消退出不会提前停掉 scheduler，`app.quit()` 也会幂等回收 host/SDK 子进程。
- Leemo 主工作区的 `.leemo/.claude/memory` 继续受保护；外部项目的 `memory/` 是普通目录，可以编辑。不要把主工作区的 legacy memory 规则错误外推到用户项目。
- “全部文件”现在是覆盖抽屉，选择文件后自动收起。这个改动修复了 `1024x720` 下左侧栏 260 + 预览 420 + 文件树 260 把对话列压成约 84px 的严重问题；修后对话列 344px、预览 420px、输入框 279px，文字不再竖排。
- 文件树现在按大小写不敏感识别 `.md/.markdown`；抽屉内 OS 文件 drop 会停止冒泡，不再被抽屉和工作台根节点处理两次。
- 当前状态为 Integrated：隔离 Electron 在 `1024x720` 已走真实外部文件夹、编辑、保存并切换、磁盘回读，以及原生退出框的继续编辑/丢弃两条分支；最终确认框为 400px 单行操作区。全量 175 文件 / 2383 项通过，typecheck 0 错，renderer/main 构建成功。没有新的最终安装包证据，不得写成 Release-verified。
- 后续富文本、表格/图片编辑、AI 选区改写与三方合并是独立卡片；不要为了“像 NewMax”把本轮窄且可靠的写入边界扩成 renderer 任意写盘。
