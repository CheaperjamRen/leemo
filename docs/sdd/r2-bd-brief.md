# 启动轮 2 · 卡 B + 卡 D 任务卡（执行者：Sonnet 5）

设计负责人已定全部决策，本卡规格写死，**不要重开设计讨论**。两件事互不相干，可依次做，一个或两个 commit 都行。

基线：main @ `3674e8f`，664 测试绿，`npm run typecheck` 三段 exit 0。

---

## 卡 B — momo 记忆库初始化

### 为什么
卡 A 让 momo 拿到了**正确的绝对路径**，但 `~/Leemo/memory/` 下四个文件从来没被创建过。实机日志里 `Read: File does not exist` 就是这个 —— momo 说「我先记一笔」，然后写不进去。目录本身已由 `main.ts:57 ensureMemoryDir()` 创建，缺的是文件。

### 交付
新建 `src/host/memory-bank.ts`，导出：

```ts
export interface MemoryBankIO {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, contents: string): void;
  mkdirp(path: string): void;
}
/** 幂等播种。返回实际新建的文件相对路径（用于日志/测试断言）。 */
export function ensureMemoryBank(memoryDir: string, io: MemoryBankIO): string[];
```

**铁律（违反即打回）**：`ensureMemoryBank` 只创建**不存在**的文件。已存在的文件一个字节都不许改 —— 这是用户的真实记忆，不是我们的模板。没有任何代码路径可以改写已有记忆内容。

播种清单（`memoryDir` = `<home>/Leemo`，分隔符跟随平台，照抄 `momo-prompt.ts:144` 的 `sep` 写法）：

| 文件 | 首行标题 | 说明行 |
|---|---|---|
| `CLAUDE.md` | `# momo 的记忆库` | 含「当前状态 / 记忆索引 / 核心事实」三节；索引列出下面四个文件 |
| `memory/bookmarks.md` | `# 实时便签` | 格式说明照抄 layer ⑥ 的 `<YYYY-MM-DD HH:MM> <发生了什么> <为什么重要>` |
| `memory/profile.md` | `# 用户画像` | 你是谁、在做什么 |
| `memory/preferences.md` | `# 偏好与雷区` | 喜欢怎样、别踩哪里 |
| `memory/moments.md` | `# 重要时刻` | 第一人称叙述，不是冷日志 |

正文中文（用户会直接打开看），每个文件正文 ≤4 行，空态写「（还没有记录）」。

**`CLAUDE.md` 的体积是硬约束**：它每轮对话都作为 prompt 层⑧ 注入。卡 A 的验收断言「钉死配置 ≤900 token」（当时实测 762）**必须继续通过**，且断言里要带上本卡播种的 CLAUDE.md 内容。如果超了，砍模板不砍断言。

接线：`src/main/main.ts` 的 `ensureMemoryDir()` 改为调用 `ensureMemoryBank()`（真实 fs 实现的 IO 传进去），`src/host/dev.ts` 同样调用一次（它现在完全没建目录，dev 模式首写同样会挂）。失败只 `console.error` 不抛 —— 记忆库建不出来也不许挡住聊天。

### 已由主控手工完成、你不要碰
用户真实记忆库 `~/Leemo/CLAUDE.md` 里那两条验收夹具（猫「拿铁」/ 暗号 QINGSE-7413）**已经由主控删掉了**。那是上轮为了证明记忆真加载而写的假事实。你不要写任何「清理夹具」的代码路径。

---

## 卡 D — 问询卡进对话流

### 为什么
用户原话：「askusercard 也该进入对话流，等待回答的时候可以醒目置底，但是回答完了或者失效了就不该再强调了，而是成为对话流的一部分，否则强调也无意义。」

现状三个问题：
1. `BuddyShell.tsx:73-77` 把 pending **和 resolved** 一起钉在输入框上方。答完的问题一直杵在那儿。
2. 那块受 `activeId && activeRunId` 门控。`run.finished` 一到 `activeRunId` 变 null → **整块卸载，答过的问答直接从界面上消失了**，历史里一点痕迹不留。
3. `WorkbenchShell.tsx` 根本没渲染 `AskUserCard`。工作台态下 momo 问问题 = 卡片永不出现 = 回合永久挂起。

用户选定形态（选项卡已确认）：**升为对话流一等卡 + 只在滚出视野时提示**。

### 关键事实（已由主控核实，直接用，别再验）
`ask_user` 是 MCP 工具，模型调用它会**正常走 SDK 工具流**，所以时间线里**已经有**一条 `kind:"tool"` 项，`name === "mcp__leemo-ask-user__ask_user"`，带真实 `toolUseId`（`src/bridge/events.ts:279`）。这就是天然锚点。

现成先例照抄：`LEEMO_VISUALIZATION_TOOL_NAME` 已经被 `TurnBlock.tsx:10-15` 的 `isProcess` 排除出「干活过程」折叠区，改在主干流里渲染成 `VisualizationCard`。**问询卡完全照这个模式做。**

### 交付
1. `src/renderer/bridge/tool-names.ts` 加 `export const LEEMO_ASK_USER_TOOL_NAME = "mcp__leemo-ask-user__ask_user";`
2. `TurnBlock.tsx`：`isProcess` 把该工具排除（问询是 momo 直接问你，不是「干活过程」，绝不能被折叠藏起来）；遍历到该 tool 项时在主干流就地渲染问询卡。
3. **配对规则**（`AskUserPayload` 没有 toolUseId —— MCP handler 的 `extra` 拿不到 SDK 的 toolUseID，别去挖）：
   - 本回合内 `ask_user` 工具项按时间线顺序排成 `[t0, t1, …]`
   - 本 run 的问询按到达顺序排成 `[...resolvedByRun 里 kind==="question" 的项, 若有 pending 则追加]`
   - **按下标配对**。`ask_user` 会阻塞回合，两个序列必然同序。
   - **配不上的绝不静默丢弃**：多出来的问询（push 比 tool.started 先到的竞态）渲染在回合末尾兜底。看不见的 pending 问询 = 回合永久挂起，这是刚修过的同款失效模式。
4. 三态样式：
   - pending → 可交互，琥珀描边强调
   - 已回答 → **原地**转 55% 灰归档，显示选了什么（现有样式够用），**不许移动位置**
   - 已取消/失效 → 原地灰显「已取消」
5. `BuddyShell.tsx`：删掉置底那一整块。`WorkbenchShell.tsx` 不用改 —— 它渲染 `Timeline`，自动就有了。
6. **滚出视野提示**：`Timeline.tsx` 里，当「本对话有 pending 问询」且 `!atBottom` 时，把现有的 `BackToBottom` 圆箭头**换成**一枚带字的胶囊「⌄ 有个问题等你回答」，点击 `scrollToBottom`。两者**二选一，绝不同时出现**。做成纯展示组件（props `{show, onClick}`，照 `BackToBottom.tsx` 的写法），逻辑可单测。

### 自查（必须做，别跳）
上一轮修审批卡时引入过「同一张卡渲染两份重叠」的 bug。本卡结束前**亲自数一遍 DOM**：同一个问询在界面上有且仅有一份。补的回归测试要**反向验证**（临时把重复还原回去，确认测试真的失败，再修回）—— 两边都通过的测试没有价值。

---

## 禁改清单（两卡通用）
- `src/bridge/pool.ts`、`src/bridge/contract.ts`、`src/host/bridge-host.ts`、`src/main/persistence/**`、`src/renderer/stores/conversations.ts` —— **另一个 agent 正在并行改这些文件**（重启续聊卡）。碰了就冲突。
- `src/bridge/interact.ts` 的审批策略、`smoke/`、已冻结的契约字段语义。
- 不要 `git commit`。改完报告，主控复核后统一提交。

## 验收命令
```
npx vitest run                 # 664 → 只增不减，全绿
npm run typecheck              # 三段全 exit 0
```
若看到**不属于你文件清单**的测试失败，那是并行 agent 的半成品，报告即可，别去修。

## 报告要求
需求覆盖表（每项带可复现证据），外加：卡 B 说明实际播种了哪几个文件、CLAUDE.md 实测 token 数；卡 D 说明「同一问询只有一份」是怎么数的、反向验证怎么做的。
