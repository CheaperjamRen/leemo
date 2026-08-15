# R11 内置 Skills 与技能中心实施计划

> **执行要求：** 在本地文档工具计划完成后，按 `superpowers:executing-plans` 逐任务实施。40 个 Skills 必须依赖真实能力并按需物化，不得用静态占位卡片冒充。

**目标：** 提供 40 个可选内置 Skill 和可管理的自定义 Skill。首装只启用 8 个，用户能按分类搜索、理解用途与依赖、启停并在重启后保持；启用变化从下一轮起生效。安装包只增加一个编译资源，不增加 40 个发行小文件。

**架构：** `src/host/builtin-skills.ts` 是内置目录与正文唯一真源，编译进 main bundle。host 的 `bridge:listSkills` 返回 40 个内置 metadata 加用户目录扫描结果，正文不跨 IPC。启用时，host 只把对应内置 `SKILL.md` 物化到 `<Leemo>/.leemo/runtime/builtin-skills/` 的独立本地插件；用户 Skills 继续留在 `<Leemo>/.claude/skills/`。SDK 接收两个内部 plugin path，但 UI 永远只显示中文名、分类、来源和需求。启停偏好以稳定 `skillOverrides` 写入现有 settings 持久化，并通过 `bridge:syncEnabledSkills` 热更新活动会话下一轮。

**技术栈：** TypeScript 5.9、Claude Agent SDK local plugins、Electron IPC、React 19、Zustand 5、Vitest、Testing Library、现有 SQLite settings。

## 全局约束

- 产品目录和 8 个默认启用项以 `docs/superpowers/specs/2026-07-31-r11-beta-foundation-design.md` 第六节为准。
- 启动/列表 IPC 只传 metadata：`id/name/description/category/requirements/defaultEnabled/source/availability`；Skill 正文只在运行时插件被触发时加载。
- 内置 Skill 的名称和 description 必须互斥，description 明确“何时用/何时不用”，减少误触发。
- 每个 Skill 声明 `requiredCapabilities`；不可用时开关禁用并显示人话原因，不能等模型调用后才失败。
- 内置目录只读、由 Leemo 更新；用户可复制为自定义后编辑。自定义目录与内置运行时目录分开。
- 禁用内置 Skill 必须从运行时插件物理移除，不能留下可绕过开关的斜杠命令；用户自定义部分禁用沿用现有“从 momo/菜单隐藏，不是安全沙箱”边界并在 UI 说明。
- 偏好以稳定 `id` 持久化，不以显示名持久化；新版本新增 Skill 时使用自己的 `defaultEnabled`，旧偏好不冻结目录。
- 每项先红后绿；每个任务提交前运行定向测试和 `git diff --check`。

---

## Task 1：建立 40 个 Skills 的单一目录真源

**Files:**

- Create: `src/host/builtin-skills.ts`
- Create: `tests/host/builtin-skills.test.ts`
- Modify: `src/bridge/contract.ts`
- Modify: `tests/bridge/contract.test.ts`

**Interfaces:**

- Produces: `SkillCategory = "learning" | "career" | "research-office" | "workbench"`
- Produces: `SkillRequirement = "core" | "filesystem" | "web-search" | "academic-search" | "document-read" | "document-create"`
- Produces: extended `SkillInfo { id; name; description; category; requirements; defaultEnabled; source; available; unavailableReason?; qualifiedName; dir? }`
- Produces: private `BuiltinSkillDefinition extends SkillInfoMetadata { body }`

- [x] **Step 1：写目录完整性失败测试**

  精确断言 12 学习 + 10 求职 + 10 研究办公 + 8 创作工作台 = 40；稳定 id/中文名唯一；默认启用恰好 8；每项 description/body/requirements 非空且 name 不含 `:`。

- [x] **Step 2：写依赖真实性测试**

  PDF/Word/PPT/Excel Skills 必须声明文档工具；arXiv 检索声明学术搜索；网页研究声明联网搜索；不得声明代码中不存在的 capability。

- [x] **Step 3：实现 metadata 与正文**

  每个正文包含适用边界、输入确认、分步方法、证据/文件输出、失败降级和完成判据；不复制 Anthropic/OpenAI source-available Skill 文本，不提示临时安装依赖。

- [x] **Step 4：运行定向测试并提交**

  ```powershell
  npx vitest run tests/host/builtin-skills.test.ts tests/bridge/contract.test.ts
  git diff --check
  git add src/host/builtin-skills.ts src/bridge/contract.ts tests/host/builtin-skills.test.ts tests/bridge/contract.test.ts
  git commit -m "feat(r11): define builtin skill catalog"
  ```

## Task 2：实现独立运行时插件与按需物化

**Files:**

- Modify: `src/host/skills.ts`
- Modify: `tests/host/skills.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**

- Produces: `builtinPluginRootFor(memoryDir)`
- Produces: `materializeBuiltinSkills(memoryDir, enabledIds, io)`
- Produces: runtime manifest name `leemo-builtin`
- Preserves: user plugin manifest name `leemo`

- [x] **Step 1：写失败测试固定物化边界**

  只生成启用项；禁用后删除对应受管目录；不会删除/覆盖用户 `.claude/skills`；损坏的运行时 manifest 可重建；临时目录/半写文件不进入可见插件。

- [x] **Step 2：实现版本化 staging + swap**

  先在同级 staging 目录写 manifest 与 `SKILL.md`，全部成功后替换当前受管目录。目录名使用稳定 id，正文 frontmatter 的 `name/description` 来自目录真源。

- [x] **Step 3：扩展 SkillsIO 与主进程 fs seam**

  增加安全删除/rename/list 所需最小方法；真实实现只允许作用于计算出的 runtime root，测试验证目标路径。

- [x] **Step 4：运行定向测试并提交**

  ```powershell
  npx vitest run tests/host/skills.test.ts tests/host/builtin-skills.test.ts
  git diff --check
  git add src/host/skills.ts src/main/main.ts tests/host/skills.test.ts
  git commit -m "feat(r11): materialize enabled builtin skills"
  ```

## Task 3：扩展 SDK 多插件接线与 host 同步通道

**Files:**

- Modify: `src/host/sdk-adapter.ts`
- Modify: `tests/host/sdk-adapter.test.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `src/bridge/contract.ts`
- Modify: `tests/bridge/contract.test.ts`

**Interfaces:**

- Replaces: `ConversationExtras.pluginPath?: string` with `pluginPaths?: string[]`
- Produces: `bridge:syncEnabledSkills { enabledQualifiedNames: string[] } -> { updatedConversations: number }`
- Produces: merged `bridge:listSkills` catalog + custom scan

- [x] **Step 1：写多插件与禁用绕过失败测试**

  断言启用内置项时只物化那些项；有自定义启用项时同时传两个 plugin path；全部关闭时不传 plugin/skills；禁用内置项不在磁盘和 slash path；非法/未知 qualified name 被忽略而不是注入 SDK。

- [x] **Step 2：实现 host 列表投影**

  内置 40 项始终可见；自定义项继续容错扫描。重复显示名用来源区分，qualified name 不渲染；损坏自定义 Skill 只跳过自身。

- [x] **Step 3：实现同步通道和热更新**

  materialize 后更新所有活动会话的 `pluginPaths/enabledSkills`；正在运行的轮次不中断，下一轮重新读取。创建/恢复会话也先根据 request 的 enabled list 物化，避免启动竞态。

- [x] **Step 4：运行定向测试并提交**

  ```powershell
  npx vitest run tests/host/sdk-adapter.test.ts tests/host/bridge-host.test.ts tests/bridge/contract.test.ts
  git diff --check
  git add src/host/sdk-adapter.ts src/host/bridge-host.ts src/bridge/contract.ts tests/host/sdk-adapter.test.ts tests/host/bridge-host.test.ts tests/bridge/contract.test.ts
  git commit -m "feat(r11): hot-sync builtin and custom skills"
  ```

## Task 4：持久化启停偏好并消除首轮竞态

**Files:**

- Modify: `src/renderer/stores/settings.ts`
- Modify: `src/renderer/stores/settings.test.ts`
- Modify: `src/renderer/stores/skills.ts`
- Modify: `src/renderer/stores/skills.test.ts`
- Modify: `src/renderer/bridge/context.tsx`
- Modify: `src/renderer/persistence/sync.test.ts`

**Interfaces:**

- Produces: `skillOverrides: Record<string, boolean>` with bounded sanitization
- Produces: `setSkillOverride(id, enabled)`
- Changes: `SkillsState.disabled` stores stable ids, not display names

- [x] **Step 1：写默认与迁移失败测试**

  首装只启用 8 个内置、用户自定义默认启用；重启保留开关；未知/超长/非布尔 override 丢弃；新版本新增 Skill 仍采用它的默认值。

- [x] **Step 2：写启动顺序失败测试**

  settings hydrate 完成后再 refresh/sync Skills，并在 `persistenceReady` 之前完成；第一条对话必须得到持久化后的 allow-list，不得短暂启用 40 项或回到默认。

- [x] **Step 3：实现 store 协作与失败回滚**

  toggle 先乐观更新、写 settings、调用 `bridge:syncEnabledSkills`；同步失败则回滚开关与 override，并保留一条可见的人话错误。`resolveEnabledSkills` 过滤 unavailable 项。

- [x] **Step 4：运行定向测试并提交**

  ```powershell
  npx vitest run src/renderer/stores/settings.test.ts src/renderer/stores/skills.test.ts src/renderer/persistence/sync.test.ts
  git diff --check
  git add src/renderer/stores/settings.ts src/renderer/stores/settings.test.ts src/renderer/stores/skills.ts src/renderer/stores/skills.test.ts src/renderer/bridge/context.tsx src/renderer/persistence/sync.test.ts
  git commit -m "feat(r11): persist skill preferences"
  ```

## Task 5：重做技能中心用户旅程

**Files:**

- Modify: `src/renderer/pages/SkillsPage.tsx`
- Modify: `src/renderer/pages/SkillsPage.test.tsx`
- Modify: `src/renderer/components/slash-menu.ts`
- Modify: `src/renderer/components/slash-menu.test.ts`
- Modify: `src/renderer/components/BuddyShell.tsx`
- Modify: `src/renderer/components/WorkbenchShell.tsx`

**Interfaces:**

- Produces: category filter, search, enabled count, source split, requirement status
- Preserves: `/技能名` explicit invocation only for enabled and available skills

- [x] **Step 1：写完整用户旅程失败测试**

  断言 40 个内置目录可搜索；分类数字正确；默认 8 个开；“内置/我的”分区清楚；依赖不可用的项禁用并解释；搜索无结果有可恢复空态。

- [x] **Step 2：实现紧凑信息架构**

  顶部为搜索和分类 tabs；列表用紧凑行/两列而非 40 张大卡；每项展示名字、用途、来源、必要依赖、开关。内置项不显示物理路径；“打开自定义技能目录”只对应用户目录。

- [x] **Step 3：实现自定义复制入口（P1 延后，本轮不放置假入口）**

  内置项提供“复制为自定义”，host 生成不冲突的新目录并打开；不提供直接编辑内置正文。若本轮成本过高，入口可排入 P1，但 UI 不得伪装可编辑。

- [x] **Step 4：同步斜杠菜单和空态**

  `/` 菜单只列 enabled + available；关闭后下一轮和菜单同时消失。搭子/工作台的建议 chips 不因为 40 项撑高输入区。

- [x] **Step 5：运行 UI、typecheck 与 build 并提交**

  ```powershell
  npx vitest run src/renderer/pages/SkillsPage.test.tsx src/renderer/components/slash-menu.test.ts src/renderer/components/BuddyShell.test.tsx src/renderer/components/WorkbenchShell.test.tsx
  npm run typecheck
  npm run build
  git diff --check
  git add src/renderer/pages/SkillsPage.tsx src/renderer/pages/SkillsPage.test.tsx src/renderer/components/slash-menu.ts src/renderer/components/slash-menu.test.ts src/renderer/components/BuddyShell.tsx src/renderer/components/WorkbenchShell.tsx
  git commit -m "feat(r11): deliver searchable skill center"
  ```

## Task 6：打包态触发、重启和包体验收

**Files:**

- Create: `scripts/cdp-skills-r11-verify.mjs`
- Create: `docs/research/2026-07-31-r11-skills-verification.md`
- Modify: `docs/sdd/r7-requirements-ledger.md`

- [ ] **Step 1：验证目录数量与正文按需加载**

  首装列表 40，运行时目录只有默认 8；禁用/启用后目录数量和 allow-list 同步；模型未触发时上下文不包含 40 份正文。

- [ ] **Step 2：走四类真实 Skill**

  各验证一个学习、求职、研究办公、工作台 Skill；其中至少一个调用文档工具、一个调用搜索、一个只用本地文件。结果必须符合各自完成判据，不以工具卡出现代替成功。

- [ ] **Step 3：验证失败和重启**

  关闭联网后 arXiv/网页依赖给出启用提示；损坏自定义 Skill 不影响其余 40 项；重启后开关、运行时物化和斜杠菜单一致。

- [ ] **Step 4：四视口与性能/包体检查**

  `1440x900 / 1280x720 / 1024x768 / 720x640` 无裁切；记录 renderer chunk、main bundle、安装器、app.asar、解包文件数、冷启动和空闲内存。发行包不得出现 40 个独立 Skill 文件。

- [ ] **Step 5：全量验证**

  ```powershell
  npm test
  npm run typecheck
  npm run build
  npm run build:main
  npm run electron:pack
  node scripts/cdp-skills-r11-verify.mjs
  git diff --check
  ```

- [ ] **Step 6：更新证据并提交**

  ```powershell
  git add scripts/cdp-skills-r11-verify.mjs docs/research/2026-07-31-r11-skills-verification.md docs/sdd/r7-requirements-ledger.md
  git commit -m "test(r11): verify packaged skill catalog"
  ```
