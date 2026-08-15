# Leemo r9c 模型设置可信度实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让普通用户在一分钟内接好模型，让高级用户能安全配置 Claude Code 角色映射、模型发现地址和请求头，同时保持设置结果与真实运行一致。

**Architecture:** 保留现有 1040×720 设置弹窗和左侧总导航；模型页内部采用紧凑供应商主列表与右侧编辑器。编辑器按连接、模型与角色、高级渐进展开，所有字段只接到现有 bridge/provider 真契约。

**Tech Stack:** React 19、TypeScript、Zustand、Electron IPC、Claude Agent SDK provider env、Vitest、Testing Library、Lucide React。

## 2026-07-30 执行结果

- ✅ Task 1~3 已完成：运行时六槽位契约、旧 Small Fast 迁移、秘密 Header 进程侧隔离，以及紧凑主从信息架构均有跨层测试。主槽位已进一步收紧为当前对话的真实选择，服务商设置不能覆盖它。
- ✅ Task 4 已完成当前可信边界：当前草稿测试、远端发现失败后的手动模型、三段编辑、Anthropic 五个任务角色保存恢复、脱敏错误、固定操作栏，以及切服务商 / 切设置页 / 搜索跳页 / 关闭 / Escape 的脏草稿保护均有回归。连接与模型发现采用配置指纹和请求代次，保存成功后强制重新读取脱敏配置。
- 🟡 Task 5 完成了设置搜索到内页；错误直达未做。现有 `run.finished` 只有整轮失败事实，没有可靠 `providerId/errorKind`，在补契约前给所有错误挂“前往模型设置”会误导权限、工具和文件错误。
- 🟡 Task 6 完成了全新 E2E 根下的发布包用户路径、真实窗口与 1024×768 / 720×700 / 720×640 响应式布局、全量测试/类型检查/构建/打包与包体对比。为避免无必要额度消耗，本卡没有重复跑付费真实模型与真实子 Agent 组合矩阵；供应商错误矩阵由 host/bridge fixtures 覆盖。
- ✅ 复审后补齐 OpenAI 兼容链：产品 host 懒启动本地 gateway，动态注册表读取最新完整配置；初始创建和对话中途切换都会补齐网关接线，当前对话与五个任务角色恢复为准确上游模型 ID，renderer 不承担端口生命周期。自包含验收脚本已启动指定发布包、校验 exe/installer 哈希、`app.asar` 页面与隔离根，并通过 packaged renderer IPC 事件流证明本地 OpenAI mock 完成一轮 Claude Code SDK 对话；facts 只在断言和清理全部成功后原子发布，失败路径也有陈旧 facts / 临时根清理回归。
- ✅ 复审后补齐并发与失败收敛：保存/删除 busy 锁穿透到整个设置弹窗；写入成功但刷新失败时，本地列表按已确认结果收敛；gateway 日志同时脱敏 Key 和自定义 Header 值。
- 最终证据：`docs/research/audit-shots/settings-r9-final-packaged-facts.json`、`settings-r9-final-packaged-provider-{connection,roles,advanced}.png`、`settings-r9-final-packaged-responsive-*.png`、`openai-gateway-r9-packaged-facts.json`。

## Global Constraints

- 简单路径只要求选择预设、粘贴 Key、测试并保存；高级能力不得阻碍首次接入。
- 保存与连接成功是两个事实；失败不能偷偷保存，保存也不能伪装已连通。
- API Key 和秘密型 Header 只写不读，不得回到 renderer、日志、诊断或截图。
- 只开放运行时确实消费的模型角色；不做任意 env、原始 JSON/TOML 或请求体覆写。
- NewMax 与 CC Switch 只作为信息层级和交互参考，不复制其代码、品牌或无关平台能力。

---

## Task 1：修正 Claude Code 角色映射契约

**Files:**

- Modify: `tests/bridge/providers.test.ts`
- Modify: `tests/bridge/pool.test.ts`
- Modify: `tests/host/provider-catalog.test.ts`
- Modify: `src/bridge/providers.ts`
- Modify: `src/host/provider-catalog.ts`
- Modify: `src/host/provider-config.ts`

- [ ] 新增 Fable 映射传入 SDK env 的失败测试。
- [ ] 新增旧 `ANTHROPIC_SMALL_FAST_MODEL` 配置读取后迁移、但新投影不再输出该字段的测试。
- [ ] 运行 bridge/host 定向测试确认当前缺少 Fable 且仍以 Small Fast 为现役槽位。
- [ ] 将现役白名单改为主模型、Fable、Sonnet、Opus、Haiku、Subagent；迁移器保留旧字段读取并映射到合理兼容目标，不静默覆盖用户已设置的现役值。
- [ ] 重跑 provider、catalog、pool 测试。
- [ ] Commit: `fix(r9): align model roles with current claude code`

## Task 2：关闭秘密请求头回读通道

**Files:**

- Modify: `tests/host/bridge-host-providers.test.ts`
- Modify: `tests/host/provider-config.test.ts`
- Modify: `src/host/provider-config.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/bridge/contract.ts`

- [ ] 新增 `Authorization`、`Proxy-Authorization`、`x-api-key` 等 Header 不出现在 `getProviderConfig` 响应中的失败测试。
- [ ] 新增“未重新输入则保留旧秘密 Header、显式删除则移除、替换则更新”的持久化测试。
- [ ] 运行定向测试确认当前 IPC 泄漏。
- [ ] 引入 key-safe Header 投影和写入语义；非秘密 Header 可编辑回显，秘密 Header 仅返回“已配置”状态。
- [ ] 重跑 bridge-host/provider-config 测试并扫描日志与 fixture。
- [ ] Commit: `fix(r9): keep secret provider headers process-side`

## Task 3：模型页主从信息架构

**Files:**

- Modify: `src/renderer/pages/SettingsPage.test.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Create: `src/renderer/components/ProviderList.tsx`
- Create: `src/renderer/components/ProviderList.test.tsx`
- Modify: `src/renderer/components/ProviderConfigForm.tsx`
- Modify: `src/renderer/components/ProviderConfigForm.test.tsx`

- [ ] 新增 1440×900 等效布局断言：模型页首屏至少显示六条供应商行，不显示 raw kind，选择行后右侧详情不丢失列表。
- [ ] 新增已配置、未配置、测试中、连接成功、连接失败状态测试。
- [ ] 运行测试确认当前巨型卡片瀑布失败。
- [ ] 实现 220px 左侧紧凑供应商列表、右侧编辑器和清晰的添加入口；保留现有设置弹窗外壳。
- [ ] 列表只显示用户信息：名称、默认模型、状态、模型数；协议与技术字段进入详情。
- [ ] 重跑 SettingsPage 与 ProviderList 测试。
- [ ] Commit: `feat(r9): redesign provider settings hierarchy`

## Task 4：连接、模型与角色、高级三段编辑

**Files:**

- Modify: `src/renderer/components/ProviderConfigForm.test.tsx`
- Modify: `src/renderer/components/ProviderConfigForm.tsx`
- Modify: `src/renderer/stores/providers.test.ts`
- Modify: `src/renderer/stores/providers.ts`

- [ ] 测试连接页只呈现名称、协议、Base URL、Key、默认模型和测试保存主动作。
- [ ] 测试远端模型发现失败后仍可手工添加模型并完成连接。
- [x] 测试主模型始终跟随当前对话；Anthropic 服务商可编辑 Fable、Sonnet、Opus、Haiku、子 Agent 五类覆盖并完整保存/恢复；OpenAI 兼容网关在真实映射完成前禁用并解释。
- [ ] 测试高级页的 `modelsUrl`、非秘密 Headers、秘密 Header 状态与删除语义。
- [ ] 运行定向测试确认当前 `envTemplate`、`modelsUrl` 未被表单加载/保存。
- [x] 实现三段编辑器和脏草稿保护；关闭、取消、失败状态均不能锁死弹窗。
- [ ] 测试结果分清端点、认证、文本模型、模型回显、可选视觉，并显示已存在的错误分类和脱敏技术详情。
- [ ] 重跑 ProviderConfigForm 与 providers store 测试。
- [ ] Commit: `feat(r9): connect advanced provider configuration`

## Task 5：设置搜索与错误直达

**Files:**

- Modify: `src/renderer/pages/SettingsPage.test.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/components/timeline/MessageFooter.test.tsx`
- Modify: `src/renderer/components/timeline/MessageFooter.tsx`

- [ ] 新增搜索“Fable”“模型发现地址”“请求头”可定位对应段落的测试。
- [ ] 新增供应商错误可点击“前往设置”，直接选中出错供应商并显示正确分段的测试。
- [ ] 运行测试确认当前搜索只匹配分类词且错误没有修复路径。
- [ ] 实现设置项索引、定位高亮和 provider deep-link；不自动重试或消耗额度。
- [ ] 重跑定向测试。
- [ ] Commit: `feat(r9): link model errors to actionable settings`

## Task 6：真实模型与打包验收

**Files:**

- Create: `scripts/e2e-r9-provider-settings.cjs`
- Create: `scripts/verify-packaged-openai-gateway.mjs`
- Create: `docs/research/r9c-provider-settings-audit.md`
- Create: `docs/research/audit-shots/r9c-model-settings-*.png`

- [ ] 使用临时测试凭据完成“测试保存 -> 新对话 -> 工具调用 -> 子 Agent -> 关闭 -> 重启 -> 复用”，不把凭据写进仓库、日志、截图和安装包。
- [ ] 用自定义 provider 模拟 `/models` 不兼容，确认手工模型路径仍可用。
- [ ] 分别触发 401、403、模型不存在、限流、网络、超时和服务端错误，检查人话原因与下一步。
- [ ] 在 1440×900 与 1280×720 截图，检查列表密度、长 URL、长模型名、错误详情、秘密字段和按钮可达性。
- [x] 运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run build:main` 和打包 E2E。
- [x] 对比安装包体积和解包文件数，不因图标库或设置改造引入大量解包小文件。
- [ ] Commit: `test(r9): verify provider setup end to end`
