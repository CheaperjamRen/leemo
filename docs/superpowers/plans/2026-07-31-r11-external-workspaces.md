# R11 External Workspaces Implementation Plan

> **For agentic workers:** implement task-by-task with test-driven development and an isolated packaged acceptance profile.

**Goal:** 让用户选择任意已有文件夹作为 Leemo 的一等工作区；新对话、文件树、产物、对话归档与工作区记忆都绑定到该目录，同时保留 `~/Leemo` 下“本子”的现有心智和兼容数据。

**Architecture:** 新增主进程 `WorkspaceRegistry` 作为目录选择、最近记录、可用性与不透明 id 的唯一真源。renderer 不提交任意绝对路径；它只通过原生目录选择器取得已登记的 `workspaceId`。会话创建时把 id 交给 host，host 解析出每会话 cwd 与文件边界。`~/Leemo` 继续承载全局 momo 与本子；外部工作区把对话和本地记忆写进自己的 `.leemo/`。SQLite 仍是可重建索引，不替代便携目录真源。

**Product boundary:** 左栏只增加“打开文件夹”和最近工作区，不把外部工作区伪装成本子。切换只决定新对话；打开旧对话时恢复它绑定的工作区。移除最近记录不删除目录或 `.leemo`。目录丢失时保留对话索引并显示可恢复错误。

## Global Constraints

- 不复制、移动或递归扫描工作区外的数据。
- native dialog 是新增绝对路径的唯一入口；renderer 只持有 host 已登记的 id 和用于展示的路径。
- 规范化 Windows 路径时大小写不敏感；同一目录不能产生多个 id。
- symlink/junction 的实际路径边界在首次使用与每次文件操作前复核，不能靠字符串前缀放行。
- 首次使用外部目录时只显示一句话：“Leemo 会在这里保存对话记录和本地记忆（.leemo）。”不弹技术表单。
- 外部工作区根目录下的普通相对写入保持原路径，不重定向到 `默认工作区`。
- 旧记录没有 `workspaceId` 时一律解释为 Leemo 主工作区，迁移无需重写。
- 每个任务先写红灯测试，提交前运行定向测试、typecheck 和 `git diff --check`。

---

## Task 1: 主进程工作区登记与原生目录选择

**Files:**

- Create: `src/main/workspace-registry.ts`
- Create: `tests/main/workspace-registry.test.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/main/main.ts`
- Modify: `src/renderer/workspace/client.ts`
- Modify: `src/renderer/workspace/ipc-workspace-client.ts`

- [x] 写失败测试：固定主工作区、登记外部目录、最近排序、去重、目录缺失、移除记录不删文件、损坏 registry 文件可恢复。
- [x] 用 `realpath` + 标准化路径生成稳定不透明 id；记录写入 userData 下单个原子 JSON，不在工作区制造 registry 文件。
- [x] `pickWorkspace` 只由 `dialog.showOpenDialog({ properties: ["openDirectory"] })` 产生路径；取消选择返回 null。
- [x] IPC 返回 `{ id, name, displayPath, kind, available, lastOpenedAt }`，不接受 renderer 自报绝对路径。
- [x] 定向测试、typecheck、diff check、commit。

## Task 2: renderer 工作区选择与文件树

**Files:**

- Create: `src/renderer/stores/workspaces.ts`
- Create: `src/renderer/stores/workspaces.test.ts`
- Create: `src/renderer/components/WorkspaceSwitcher.tsx`
- Create: `src/renderer/components/WorkspaceSwitcher.test.tsx`
- Modify: `src/renderer/bridge/context.tsx`
- Modify: `src/renderer/components/WorkbenchShell.tsx`
- Modify: `src/renderer/components/NotebookSection.tsx`
- Modify: `src/renderer/stores/file-tree.ts`

- [x] 红灯固定：打开文件夹、最近工作区、当前项、缺失目录提示、移除记录、取消 picker 不改变状态。
- [x] 当前为 Leemo 主工作区时继续显示“本子”；当前为外部工作区时隐藏本子区，子目录只是普通文件夹。
- [x] 切换工作区刷新同一文件树，不清空或改写用户对话；新对话读取当前 `workspaceId`。
- [x] 空态和错误说用户能懂的话，不暴露 cwd、registry 或 IPC。
- [x] 定向测试、renderer build、四视口组件截图、commit。

## Task 3: 会话 cwd、权限边界与产物绑定

**Files:**

- Modify: `src/bridge/contract.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/host/momo-prompt.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Modify: relevant host/renderer tests

- [x] `CreateConversationRequest` 与 `ConversationMeta` 增加可选 `workspaceId`；旧记录缺省为主工作区。
- [x] host 通过注入的 resolver 得到每会话 `{ root, name, kind }`；外部 workspace 与 notebook 互斥。
- [x] cwd、文件治理、MCP cwd、产物识别和系统提示都使用会话自己的 root，禁止继续闭包捕获全局 `~/Leemo`。
- [x] 外部根写 `report.md` 就是 `<external>/report.md`；仅主工作区无本子写入才路由到 `默认工作区`。
- [x] 目录在运行中消失或越界时本轮失败并给出可恢复提示，不退回全局根继续写。
- [x] 定向 host/approval/artifact tests、typecheck、commit。

## Task 4: 多工作区便携对话归档与不可用恢复

**Files:**

- Modify: `src/main/persistence/workspace-persistence.ts`
- Modify: `src/main/persistence/schema.ts`
- Modify: `tests/main/workspace-persistence.test.ts`

- [x] 外部对话写入 `<external>/.leemo/conversations`；主工作区与本子继续沿用原路径。
- [x] 加载时扫描已登记且可用的工作区；同 id 冲突仍按 `lastActivityAt` 取新记录。
- [x] 外部目录不可用时保留 SQLite 索引记录并标记“工作区不可用”，不能让历史对话消失。
- [x] 重新登记同一路径后自动恢复，不复制归档、不制造第二份 id。
- [x] 覆盖成功、损坏归档、目录丢失、恢复、跨重启和旧记录迁移；commit。

## Task 5: 外部工作区本地记忆

**Files:**

- Modify: `src/host/memory-governance.ts`
- Modify: `src/bridge/contract.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/renderer/components/MemorySettingsSection.tsx`
- Modify: memory tests

- [x] 每个外部工作区复用同一治理格式，在 `<external>/.leemo/memory` 保存 `ledger.jsonl + MEMORY.md`；不把完整账本塞进上下文。
- [x] momo 在外部会话中读取全局用户画像的有界视图，再叠当前工作区的有界视图；写入默认落工作区，明确的跨项目偏好才落全局。
- [x] 设置页能查看、编辑、删除和查看当前工作区记忆历史；会话轻回执可撤销刚发生的记忆变更；路径与内部 scope 名不暴露给小白用户。
- [x] 关闭记忆后两层都结构性不接入；重启后保持。
- [x] 记忆预算、替代、撤销、目录丢失和跨工作区隔离测试；commit。

## Task 6: 打包态用户路径与发布证据

**Files:**

- Create: `scripts/verify-external-workspace.mjs`
- Create: `docs/research/2026-07-31-external-workspace-verification.md`
- Modify: `docs/sdd/r7-requirements-ledger.md`

- [x] 在系统临时目录创建隔离外部工作区，通过原生 picker 或受控测试入口打开，不触碰用户真实目录。
- [x] 真实完成：打开目录 -> 新对话 -> 生成文件 -> 文件树可见 -> 对话与记忆写进 `.leemo`。
- [x] 制造目录重命名/暂时不可用，验证错误可理解且没有退回别处写；恢复后继续原对话。
- [x] 重启验证最近项、会话 cwd、产物、记忆和清除最近记录；清除只改 registry。
- [x] 四视口、长输入区、安装文件数、冷启动与空闲内存同口径回归。
- [x] 全量测试、typecheck、build/main/package、证据文档、commit。
