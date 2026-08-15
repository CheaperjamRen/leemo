# Workspace And Memory Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 momo 在全局视野下把普通产物稳定放进本子或 `默认工作区`，并把 Claude Agent SDK 原生 Auto Memory 接入 Leemo 自己的分层、时序、可查看、可纠正、可撤销的记忆治理层。

**Architecture:** 保留 `~/Leemo` 作为 momo 根会话 cwd，本子仍是一级真实目录；新增的 `默认工作区` 只是无本子产物的物理兜底。记忆按全局和本子作用域各保存一份 append-only `ledger.jsonl` 与一份可重建、受 token 预算约束的 `MEMORY.md`。SDK 原生 Auto Memory 读写当前作用域的 `MEMORY.md`，每轮结束由治理层将原生变化归并到账本并重新生成安全视图；显式记住、回忆、遗忘走 Leemo 内置 memory MCP。renderer 只通过 typed Bridge 管理记忆，聊天中只展示页脚级轻回执。

**Tech Stack:** Electron 43、React 19、TypeScript 5.9、Zustand 5、Claude Agent SDK 0.3.210、Zod、Vitest 4、Testing Library、gpt-tokenizer、Node.js filesystem。

## Global Constraints

- 产品真源是 `docs/superpowers/specs/2026-07-30-workspace-memory-boundary-design.md`；本计划不能恢复旧的“根目录 `CLAUDE.md` + `memory/*.md` 全量注入”模型。
- 根会话 cwd 始终是 `~/Leemo`。`默认工作区` 不得成为本子、人格、对话范围或第三套记忆作用域。
- 当前本子有值时普通产物留在本子；当前本子为空时未指定位置的新产物进入 `默认工作区`。显式绝对路径、已有本子路径和对已有文件的 Edit 必须保持原意。
- 原生 Auto Memory 必须显式传 `autoMemoryEnabled`、`autoMemoryDirectory`、`autoDreamEnabled: false`；关闭“自动记忆”后，原生读写、memory MCP 和提示词注入同时关闭。
- 全局当前视图最多 600 tokens，本子当前视图最多 400 tokens，单次按需历史最多 600 tokens，任何一轮记忆总量硬上限 1600 tokens。
- token 预算只约束送入模型的视图；时间、来源、状态、替代链和消息 ID 留在账本与管理界面，不得常驻普通 prompt。
- 敏感凭据、秘密 Header、验证码、密码和未确认推测不得自动进入当前记忆；命中敏感规则时返回明确但轻量的未保存原因。
- 更新采用 supersede，删除采用 tombstone，撤销追加逆向事件；账本不物理覆写。损坏行跳过并可诊断，不能让一行坏数据拖垮聊天。
- 不为每条记忆或每次对话创建文件；每个作用域固定为账本和当前视图，应用级搜索索引只在内存中重建。
- `Inbox` 和旧记忆文件迁移必须不覆盖同名文件、记录移动清单、可人工恢复；迁移完成前不得删除唯一副本。
- 聊天记忆回执只放在 momo 消息页脚：`记住了：<摘要> · 撤销`。不得新增 toast、大卡、动画或自动滚动。
- 遗忘曲线与后台 LLM 定时整理保留为已批准的后续能力，本轮只留下稳定扩展点，不启动后台任务、不产生静默 token 消耗。
- 每项实现先写会因缺失行为而失败的测试，确认失败原因后写最小实现；每张卡提交前运行目标测试和 `git diff --check`。

---

## Task 1: 用 `默认工作区` 替换 Inbox 并做无覆盖迁移

**Files:**

- Modify: `src/host/workspace.ts`
- Modify: `src/main/main.ts`
- Modify: `src/renderer/workspace/client.ts`
- Modify: `src/renderer/components/DropClassifyBar.tsx`
- Modify: `src/renderer/components/BuddyShell.test.tsx`
- Modify: `src/renderer/stores/file-tree.ts`
- Modify: `src/renderer/stores/file-tree.test.ts`
- Modify: `src/main/persistence/workspace-persistence.ts`
- Modify: `tests/main/workspace-persistence.test.ts`
- Modify: `tests/host/workspace.test.ts`
- Modify: `scripts/smoke-workspace.mjs`

- [x] 将公开常量改为 `DEFAULT_WORKSPACE_DIR = "默认工作区"`，保留仅供迁移使用的 `LEGACY_INBOX_DIR = "Inbox"`。两个名称都加入根目录保留名；文件树显示默认工作区但不把它算作本子，`bookId` 始终为 `null`。
- [x] 扩展 `WorkspaceIO`：增加 `removeEmptyDir(path)`，并让测试 fake IO 的 `rename` 同时支持文件与整棵目录。生产实现分别使用 `fs.rmdirSync` 和现有跨盘保护。
- [x] 在 `workspace.ts` 新增：

  ```ts
  export interface WorkspaceMigrationReport {
    renamedLegacyRoot: boolean;
    moves: Array<{ from: string; to: string }>;
    conflicts: string[];
  }

  export function migrateLegacyInbox(
    root: string,
    io: WorkspaceIO,
  ): WorkspaceMigrationReport;
  ```

  仅有 `Inbox` 时整目录 rename；两者并存时逐项移动非冲突项，冲突原地保留并报告；旧目录空后才删除。重复运行返回空操作。
- [x] 先在 `workspace.test.ts` 写失败测试覆盖：全新创建、整目录迁移、并存合并、同名冲突、嵌套目录、幂等、`listNotebooks` 排除两种保留目录、drop/move 的 null 目标落到默认工作区。
- [x] `ensureWorkspace` 只保证根与默认工作区存在；`main.ts` 在它之前执行迁移并记录一行不含用户文件内容的结果日志。
- [x] 更新 workspace client 注释、fixture 和 smoke 断言，删除 UI/API 文案里的 Inbox 心智。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run tests/host/workspace.test.ts tests/main/workspace-persistence.test.ts src/renderer/components/BuddyShell.test.tsx src/renderer/stores/file-tree.test.ts src/renderer/components/useFileDrop.test.tsx
  npm run smoke:workspace
  npm run typecheck
  ```

- [x] Commit: `feat(r10): add the default workspace with safe Inbox migration`

## Task 2: 在保持根视野的前提下路由无本子新产物

**Files:**

- Modify: `src/host/workspace.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/host/momo-prompt.ts`
- Modify: `src/main/main.ts`
- Modify: `tests/host/workspace.test.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `tests/host/momo-prompt.test.ts`

- [x] 在 `workspace.ts` 新增纯函数：

  ```ts
  export function routeRootWritePath(
    relativePath: string,
    containers: readonly string[],
    pathExists?: (normalizedRelativePath: string) => boolean,
  ): string;
  ```

  绝对路径原样返回；已经以 `默认工作区` 或真实本子名开头的路径原样返回；其余合法相对路径前置 `默认工作区/`；越界片段交给现有审批边界拒绝而不是“修正”。
- [x] 给 `HostDeps` 增加 `routeRootArtifactPath?: (relativePath: string) => string`。只在无本子根会话包装 `canUseTool` 的 `Write.file_path`；不改 `Edit`、Bash、显式绝对路径或本子会话。
- [x] 包装器在 broker 决策为 allow 时通过 `updatedInput` 把新路径交回 SDK；deny 保持 deny。测试 default、acceptEdits 和 bypassPermissions 三种模式，确保没有因为早返回绕过路由。
- [x] `main.ts` 用实时 `listNotebooks` 和只读 exists 判断构造 resolver；根 cwd 仍传 `~/Leemo`，已有根文件不得被重定向成副本。
- [x] 重写 momo prompt 的工作区规则：当前本子路径优先；无本子且用户未指定位置时写入明确的绝对默认工作区；跨本子读取、整理和显式写入仍可在根视野完成。
- [x] 先写失败测试覆盖：裸文件、相对子目录、新本子路径、默认工作区路径、已有根文件、绝对路径、Edit、当前本子和 broker 拒绝。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run tests/host/workspace.test.ts tests/host/bridge-host.test.ts tests/host/momo-prompt.test.ts
  npm run typecheck
  ```

- [x] Commit: `fix(r10): route unscoped artifacts without shrinking momo view`

## Task 3: 建立分层时序记忆账本与预算化当前视图

**Files:**

- Create: `src/host/memory-governance.ts`
- Create: `tests/host/memory-governance.test.ts`
- Modify: `src/host/workspace.ts`
- Modify: `tests/host/workspace.test.ts`

- [x] 定义稳定领域类型：

  ```ts
  export type MemoryKind = "profile" | "preference" | "state" | "goal" | "episode" | "notebook";
  export type MemoryStatus = "current" | "uncertain" | "superseded" | "deleted";
  export type MemoryScope = { type: "global" } | { type: "notebook"; notebookId: string };
  export type MemorySourceType = "explicit-user" | "native-auto" | "legacy-import" | "settings-edit";

  export interface MemoryRecord {
    id: string;
    scope: MemoryScope;
    kind: MemoryKind;
    topic: string;
    statement: string;
    learnedAt: number;
    validFrom?: number;
    validTo?: number;
    lastConfirmedAt?: number;
    sourceType: MemorySourceType;
    sourceConversationId?: string;
    sourceMessageId?: string;
    status: MemoryStatus;
    supersedes?: string;
    pinned: boolean;
  }
  ```

- [x] 账本事件固定为 version 1、`changeId/at/action/before/after`；`before` 和 `after` 只含被本次操作影响的记录。`remember` 同 scope+topic 更新时追加旧记录 superseded 与新 current 记录，不改旧行。
- [x] `MemoryIO` 只暴露同步小文件能力：exists、mkdirp、readFile、writeFile、appendFile、readdir、rename。账本先 append，`MEMORY.md` 后重建；视图写失败不破坏真源，下次启动可重建。
- [x] 路径固定为全局 `~/Leemo/.leemo/memory/global/{ledger.jsonl,MEMORY.md}` 与本子 `<book>/.leemo/memory/{ledger.jsonl,MEMORY.md}`。`listNotebooks().hasMemory` 改看本子账本是否有 current 记录，不再看 `CLAUDE.md`。
- [x] `createMemoryGovernance` 暴露 `remember/list/history/update/remove/undo/recall/prepareNative/reconcileNative/rebuildViews`；clock 和 id factory 可注入以获得确定性测试。
- [x] 当前视图按 pinned、kind 稳定性、lastConfirmedAt、learnedAt 排序并按 token 截断。只渲染 current 且非敏感记录；全局硬限 600，本子硬限 400。`recall` 默认只回当前，includeHistory 时最多 600，返回结构化记录与已经预算化的 text。
- [x] 敏感过滤至少覆盖常见 API key/token/password/secret/private key/验证码/authorization header 形态；推测标记覆盖“可能、也许、似乎、猜测、probably、maybe”等。native-auto 命中推测时进入 uncertain 且不进当前视图；命中敏感时不写账本。
- [x] undo 仅在目标 change 的 after 仍是最新状态时追加逆向事件；已被后续修改时返回冲突，不覆盖新事实。坏 JSONL 行跳过并回传 diagnostics。
- [x] 先写失败测试覆盖：新记忆、同 topic 替代、跨时间查询、删除 tombstone、撤销、撤销冲突、pin、跨 scope 隔离、坏行恢复、重启 replay、token 上限、敏感与推测过滤、每 scope 固定两文件。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run tests/host/memory-governance.test.ts tests/host/workspace.test.ts
  ```

- [x] Commit: `feat(r10): add temporal memory ledger and bounded views`

## Task 4: 安全迁移旧记忆与误放普通文档

**Files:**

- Modify: `src/host/memory-governance.ts`
- Modify: `tests/host/memory-governance.test.ts`
- Modify: `src/main/main.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `tests/host/momo-prompt.test.ts`
- Modify: `tests/host/memory-bank.test.ts`

- [x] 在 governance 中增加 `migrateLegacyLayout(workspaceRoot, notebookIds)`，输出 `LegacyMemoryMigrationReport`，并把清单写入 `~/Leemo/.leemo/migrations/memory-v1.json`。重复运行只读取已完成清单，不重复导入。
- [x] 只把根 `CLAUDE.md`、`memory/profile.md`、`preferences.md`、`bookmarks.md`、`moments.md` 和本子 `CLAUDE.md` 当候选来源；解析标题下的非模板段落/列表，带来源标记导入对应 scope。空模板不产生记录。
- [x] 已成功导入的候选文件移动到 `.leemo/migrations/legacy-memory/` 归档；移动前确保目标不冲突，移动后验证目标存在。失败时保留原件并报告，不标记完成。
- [x] `memory/` 下除四个已知候选外的普通文件全部移动到 `默认工作区/`，沿用 `uniqueName` 语义避免覆盖。`research-ai-memory.md` 作为回归样本，必须从记忆上下文消失并在默认工作区保留完整字节。
- [x] `main.ts` 停止调用 `ensureMemoryBank`，改为初始化 governance、执行迁移、重建当前视图；保留 `memory-bank.ts` 仅作为旧格式解析的兼容 fixture，一个发布周期后再删除。
- [x] prompt 和 bridge-host 停止读取旧 root/notebook `CLAUDE.md`；测试断言旧研究文档标题、旧 message id 与完整 ledger 元数据不会进入 system prompt。
- [x] 先写失败测试覆盖：真实旧模板、用户内容、未知文档、研究样本、同名冲突、部分迁移失败、幂等、文件字节不变、迁移后旧注入关闭。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run tests/host/memory-governance.test.ts tests/host/memory-bank.test.ts tests/host/bridge-host.test.ts tests/host/momo-prompt.test.ts
  ```

- [x] Commit: `feat(r10): migrate legacy memory without losing artifacts`

## Task 5: 接通 SDK 原生 Auto Memory 和 Leemo memory MCP

**Files:**

- Create: `src/bridge/memory-mcp.ts`
- Create: `tests/bridge/memory-mcp.test.ts`
- Modify: `src/bridge/interact.ts`
- Modify: `src/host/sdk-adapter.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/host/momo-prompt.ts`
- Modify: `src/bridge/contract.ts`
- Modify: `src/main/main.ts`
- Modify: `src/host/dev.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Modify: `tests/host/sdk-adapter.test.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `tests/host/momo-prompt.test.ts`
- Modify: `tests/bridge/contract.test.ts`
- Modify: `tests/bridge/interact.test.ts`
- Modify: `src/renderer/stores/conversations.test.ts`
- Modify: `src/renderer/components/BuddyShell.test.tsx`
- Modify: `src/renderer/components/WorkbenchShell.test.tsx`

- [x] 扩展 `ConversationExtras`：`autoMemoryEnabled: boolean`、`autoMemoryDirectory?: string`、`autoDreamEnabled: false`。`buildQueryFn` 把这三个字段和已有 `cliSettings` 合并为 SDK `settings` 对象，不通过环境变量伪造；测试捕获最终 query options。
- [x] 每个会话选择一个原生目录：根会话用 global，本子会话用当前本子。create 和 updateContext 都从 `rememberMode` 更新 `autoMemoryEnabled`；`autoDreamEnabled` 始终 false。
- [x] `createMemoryMcp` 用 `createSdkMcpServer` 提供三个工具：

  ```ts
  remember({ topic, statement, kind, scope?, validFrom? })
  recall({ query, scope?, atTime?, includeHistory? })
  forget({ query, scope? })
  ```

  scope 缺省为当前本子，否则全局；无当前本子却请求 notebook 时明确失败。工具输出不含账本路径、完整历史或消息 ID。
- [x] `SendRequest` 增加可选 `sourceMessageId`。conversation store 发送当前 user timeline id；host 在 round 期间把 conversation/message source 交给 memory MCP。
- [x] prompt 只用产品语言说明何时记、何时不记、全局与本子如何选择；要求显式“记住/忘掉”走 Leemo memory 工具，禁止直接 Write/Edit `.leemo/memory`。不得在用户界面暴露 Claude Code、原始别名或内部 MCP 名。
- [x] 每轮开始调用 `prepareNative` 保存当前视图 baseline；每轮 terminal 后调用 `reconcileNative`。原生新增条目按标题/列表解析、去重、过滤后追加账本；原生删除不直接删除结构化记录；最后总是从账本重建 view。
- [x] 将 `.leemo/memory` 加入写保护：普通 Write/Edit 直接命中时拒绝并提示使用记忆工具；SDK 自己的 Auto Memory 写入通过 native 通道，不能被普通工具绕过治理。
- [x] 记忆关闭时不注册 MCP、不注入 global current view、SDK autoMemoryEnabled=false，并跳过 prepare/reconcile。技能和本子文件访问保持可用。
- [x] 本子会话由原生目录加载 400-token 本子视图，同时 prompt 追加最多 600-token 全局视图；根会话只由原生目录加载全局视图。recall 输出加入后总记忆仍不得超过 1600 tokens。
- [x] 先写失败测试覆盖 SDK settings、三个 MCP、source、scope、关闭开关、原生 diff、普通工具写保护、全局/本子组合预算和 updateContext 热生效。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run tests/bridge/memory-mcp.test.ts tests/host/sdk-adapter.test.ts tests/host/bridge-host.test.ts tests/host/momo-prompt.test.ts
  ```

- [x] Commit: `feat(r10): connect native auto memory through Leemo governance`

## Task 6: 增加 typed 管理接口与页脚级记忆回执

**Files:**

- Modify: `src/bridge/events.ts`
- Modify: `src/bridge/contract.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/host/memory-governance.ts`
- Modify: `src/main/main.ts`
- Modify: `src/renderer/stores/message-model.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Create: `src/renderer/stores/memory.ts`
- Modify: `src/renderer/bridge/context.tsx`
- Modify: `src/renderer/bridge/fixture-client.ts`
- Modify: `src/renderer/components/timeline/TurnBlock.tsx`
- Modify: `src/renderer/components/timeline/MessageFooter.tsx`
- Modify: `tests/bridge/contract.test.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `tests/host/memory-governance.test.ts`
- Modify: `tests/main/persistence.test.ts`
- Modify: `src/renderer/stores/message-model.test.ts`
- Create: `src/renderer/stores/memory.test.ts`
- Modify: `src/renderer/components/timeline/MessageFooter.test.tsx`
- Modify: `src/renderer/components/timeline/turnblock.test.tsx`

- [x] 在 contract 增加 key-free 的 `MemoryView/MemoryHistoryEntry/MemoryChangeResult`，以及 list/update/delete/pin/history/undo/open-memory-dir invoke channels。所有请求按 memory id/change id，不接受 renderer 提供任意文件路径。
- [x] `LeemoEvent` 增加 `memory.changed`：`changeId/action/label/scope/targetChangeId?`。MCP 成功后 host 推 remember/update/delete；undo invoke 带 conversationId 时推 undo 事件。
- [x] message model 增加无独立可视高度的 `MemoryTimelineItem`；fold 时把 remember 附在当前 run，undo 事件将目标 item 标为 undone。SQLite 继续通过现有 timeline JSON 持久化，不加新表。
- [x] `MessageFooter` 在 copy/time/usage 同一行渲染 `记住了：<单行省略摘要> · 撤销`；撤销 pending 时只禁用链接，成功后变成 `已撤销`。摘要最长 48 个中文字符并有完整 title。
- [x] 新 `memory` Zustand store 负责 refresh、update、remove、pin、history、undo、openDir；错误留在该 store，不能用全局 toast 冒充成功。
- [x] fixture client 为新 channel 返回可预测结果并实现与生产一致的撤销冲突；BridgeProvider 创建 store 并在 live 启动时 refresh。现有只构造部分 stores 的测试保持兼容。
- [x] host 在写账本前校验运行时输入、拒绝不存在的本子、传播系统目录打开失败；只读查询不创建空账本或视图。
- [x] 先写失败测试覆盖 event fold、同一轮多个记忆只显示最后一次轻回执、undo 状态与冲突、重启和 SQLite hydration、长文本省略、失败不假成功、键盘可操作性和评审发现的五类回归。
- [x] 运行并确认先红后绿；全量 133 files / 1910 tests、typecheck 与 main build 均通过：

  ```powershell
  npm test -- tests/bridge/contract.test.ts tests/host/bridge-host.test.ts tests/host/memory-governance.test.ts tests/main/persistence.test.ts src/renderer/stores/message-model.test.ts src/renderer/stores/memory.test.ts src/renderer/stores/conversations.test.ts src/renderer/components/timeline/MessageFooter.test.tsx src/renderer/components/timeline/turnblock.test.tsx src/renderer/bridge/context.test.tsx src/renderer/bridge/fixture-client.test.ts
  ```

- [x] Commit: `feat(r10): add lightweight memory receipts and undo`

## Task 7: 把“momo 记得的”做成可管理而不打断小白的设置区

**Files:**

- Create: `src/renderer/components/MemorySettingsSection.tsx`
- Create: `src/renderer/components/MemorySettingsSection.test.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/pages/SettingsPage.test.tsx`

- [x] 个性化页保留“自动记忆”开关，说明压缩为一行人话：开启后 momo 会在合适时机记住长期有用的信息，用户随时可改可删。关闭不删除已有记忆。
- [x] `MemorySettingsSection` 首屏显示搜索框、作用域筛选（全部/关于我/本子）、当前条目列表与“打开本地记忆目录”。没有记忆、加载中、加载失败、搜索无结果各有明确状态。
- [x] 每行展示 statement、作用域、kind 的人话标签和最后确认时间；pin 用 `Pin` 图标按钮，编辑用 `Pencil`，删除用 `Trash2`，历史/来源用 `History`。图标按钮有 aria-label、title 和稳定尺寸。
- [x] 编辑在原行展开单个 textarea 与保存/取消，不嵌套卡片；删除需行内二次确认；历史面板展示旧版本、有效时间、来源会话入口和“用户明确说/自动整理/旧数据迁移”，但不显示消息 ID 或 JSON。
- [x] 来源会话仍存在时调用现有 conversation navigation；不存在时明确显示“来源对话已不存在”，不制造坏链接。打开目录调用新的 memory channel，不再误开工作区根目录。
- [x] 记忆列表用无框分隔行而不是嵌套卡；1440x900、1040x720、720x640 三档目验页面与正文横向溢出均为 0，编辑器和保存动作在最小窗完整可见，连续长英文不撑宽。
- [x] 先写失败测试覆盖开关语义、筛选、编辑、pin、删除确认、历史、来源缺失、打开正确目录、八态、刷新竞态、并发修改和键盘焦点。
- [x] 运行并确认先红后绿；3 个定向文件 63 tests、全量 134 files / 1929 tests、三套 TypeScript typecheck 与 renderer build 均通过：

  ```powershell
  npx vitest run src/renderer/components/MemorySettingsSection.test.tsx src/renderer/pages/SettingsPage.test.tsx
  npm run typecheck
  ```

- [x] Commit: `d433f4f feat(r10): make momo memory visible and correctable`

## Task 8: 完成跨层回归、文档同步和真实用户路径脚本

**Files:**

- Create: `scripts/verify-memory-workspace.mjs`
- Create: `scripts/verify-memory-restart.mjs`
- Modify: `scripts/cdp-momo-verify.mjs`
- Modify: `scripts/verify-workspace-conversation.mjs`
- Modify: `docs/sdd/r7-requirements-ledger.md`
- Modify: `docs/research/2026-07-28-live-audit-findings.md`
- Modify: `docs/superpowers/plans/2026-07-31-workspace-memory-governance.md`

- [x] 更新旧 CDP 脚本，不再往 root `CLAUDE.md` 植入秘密事实；改用真实 UI 对话显式要求记住，再新建会话验证 recall。脚本只使用免费/已配置 provider，不记录 key。
- [x] `verify-memory-workspace.mjs` 走可见用户路径验证：无本子生成普通文档落在默认工作区；指定本子生成文件留在本子；显式记住出现轻回执；撤销后新会话不再 recall；开关关闭后不新增记忆。
- [x] `verify-memory-restart.mjs` 分 create/verify 两阶段验证：重启后当前记忆仍可 recall、旧值被新值替代、全局记忆在本子可用、本子记忆不泄露到其他本子、研究文档只在默认工作区。
- [x] 加文件系统断言：每个作用域只有 ledger/current view 两类运行文件；账本没有明文测试 key；普通 prompt 不包含 ledger 元数据；迁移 manifest 能映射每次 move。
- [x] 在需求台账把本轮条目按 Implemented / Integrated / Release-verified 分开更新；研究诊断只写本轮新证据，不覆盖历史订正。
- [x] 运行完整自动验证（134 files / 1945 tests；typecheck、renderer/main build、diff check 均通过）：

  ```powershell
  npx vitest run
  npm run typecheck
  npm run build
  git diff --check
  ```

- [x] Commit: `d129f6a fix(r10): close packaged workspace and memory paths`

## Task 9: 打包态视觉、迁移、启动与体积验收

**Files:**

- Create: `docs/research/2026-07-31-memory-workspace-verification.md`
- Modify: `docs/superpowers/plans/2026-07-31-workspace-memory-governance.md`

- [x] 记录测试前基线：当前安装包大小、解包文件数、冷启动到输入框可用耗时、空闲内存；本卡不引入图表库、数据库、embedding 模型或每条记忆一个文件。
- [x] 执行 `npm run electron:pack`，在新测试 userData 和旧数据副本各启动一次。旧数据副本只复制到临时目录，不能直接用用户真实 `~/Leemo` 做破坏性迁移试验。
- [x] 在 packaged app 跑 Task 8 两个 CDP 脚本，保存 1440x900 和 720x640 截图；目验设置页、记忆空态/列表/编辑/历史、聊天轻回执、composer 不被遮挡、滚动不跳。
- [x] 检查视觉截图像素非空、元素不重叠、长中文/英文 statement 不溢出；检查 console 无 uncaught error，重启后功能仍可用。
- [x] 对比基线：新增 unpacked 小文件只能来自固定模块/脚本，用户数据文件数按 scope 线性而非按 message 线性；冷启动和空闲内存若显著回退，定位并修复后重测。
- [x] 把命令、通过数、包路径/hash、截图路径、迁移副本路径、启动/内存/文件数写入验证文档；未在 packaged app 证明的项不能标 Release-verified。
- [x] 最后运行（134 files / 1945 tests；typecheck、Node syntax、status 与 diff check 已复核）：

  ```powershell
  npx vitest run
  npm run typecheck
  git status --short
  git diff --check
  ```

- [x] Commit: `docs(r10): record packaged memory and workspace acceptance`

## Deferred Product Work

- 遗忘曲线：只降低低价值旧记忆的召回优先级，不修改事实状态、不自动物理删除。
- 后台 LLM 定时整理：必须让用户可见成本与频率、默认不静默消费、每次整理可撤销。
- 用量统计、语义向量索引、云同步、记忆图谱：只有真实用户规模证明本地账本和内存索引不足后再进入开发。
