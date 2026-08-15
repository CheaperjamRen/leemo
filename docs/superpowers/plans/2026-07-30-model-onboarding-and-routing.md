# Model Onboarding And Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Leemo 的模型设置改造成普通用户一次走通的服务商接入旅程，并让自动能力探测、默认顺序、子任务选模和图片失败恢复都符合真实运行语义。

**Architecture:** 保留现有 Electron IPC、主进程加密 Provider 存储和 1040x720 设置弹窗。以附加字段扩展 Provider 契约：布尔能力元数据继续作为旧配置/预设提示，新增独立的可追溯能力证据；新增人话任务路由，主进程再翻译为内部模型槽位；Provider 顺序作为 renderer setting 持久化。UI 复用 `SettingsPage.tsx`、`ProviderList.tsx`、`ProviderConfigForm.tsx` 和 `InputArea.tsx`，只新增一个跨层能力证据模块，避免组件和小文件膨胀。

**Tech Stack:** React 19、TypeScript 5.9、Zustand 5、Electron IPC、Claude Agent SDK 0.3.210、Vitest 4、Testing Library、Tailwind CSS 4、Lucide React。

## Global Constraints

- 已批准的产品规格以 `docs/superpowers/specs/2026-07-30-model-onboarding-and-routing-design.md` 为准；旧 `docs/superpowers/plans/2026-07-30-r9c-model-settings.md` 仅是历史记录，不能继续执行其三页签、原始角色映射或人工能力勾选方案。
- 普通用户路径不得出现 Claude Code、Fable、Sonnet、Opus、Haiku、环境变量名或“模型角色”心智；这些只允许存在于 host/bridge 内部实现与兼容测试中。
- API Key、秘密 Header 和附件绝对路径不得进入日志、截图或 SQLite；失败重试所需附件路径只保存在当前进程内存中。
- 能力探测是证据，不是权限。无论 `verified`、`failed` 还是 `unknown`，都不得隐藏附件入口、拒绝选择图片或阻断发送。
- 用户确认图片能力的优先级高于自动探针；恢复自动判断时保留最近一次自动探针结果，不需要重新输入配置。
- 不引入拖拽依赖、图表依赖或新状态框架；拖拽必须同时有键盘可操作的上移、下移和设为首选动作。
- 本卡只迁移现有真实用量能力，不建设价格编辑、预算、趋势图、智能路由、自动 fallback 或多 Key 轮换。
- 每项行为先写失败测试并确认失败原因正确，再写最小实现；每个任务独立提交，提交前检查 `git diff --check`。

---

## Task 1: 建立可追溯能力证据与自动三探针契约

**Files:**

- Create: `src/bridge/model-capabilities.ts`
- Create: `tests/bridge/model-capabilities.test.ts`
- Modify: `src/bridge/providers.ts`
- Modify: `src/bridge/contract.ts`
- Modify: `src/host/provider-test.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `tests/host/provider-test.test.ts`
- Modify: `tests/host/bridge-host-providers.test.ts`

- [x] 在 `src/bridge/model-capabilities.ts` 定义以下稳定结构，并用纯函数解析展示优先级：

  ```ts
  export type CapabilityProbeStatus = "verified" | "failed" | "unknown";

  export interface CapabilityProbeEvidence {
    status: CapabilityProbeStatus;
    checkedAt: number;
    detail?: string;
  }

  export interface CapabilityUserOverride {
    supported: true;
    updatedAt: number;
  }

  export interface CapabilityEvidence {
    probe?: CapabilityProbeEvidence;
    userOverride?: CapabilityUserOverride;
  }

  export interface ModelCapabilityEvidence {
    image?: CapabilityEvidence;
    reasoning?: CapabilityEvidence;
  }
  ```

- [x] 在 `tests/bridge/model-capabilities.test.ts` 先写失败测试，固定四条规则：用户确认覆盖自动失败；恢复自动后回到最近探针；预设布尔值只能形成 hint，不能形成 `verified`；缺失证据得到 `unknown`。
- [x] 扩展 `ConnectionTestResult`，新增 `capabilityProbes.image` 与 `capabilityProbes.reasoning`，两者均返回 `status/checkedAt/detail?`；保留旧 `vision/thinking/visionProbeError` 一个兼容周期但标记 deprecated，renderer 新代码不得再读取它们。
- [x] host 停止读取可选探针开关；连接测试固定先发最小文本请求，基础失败时请求总数为 1，基础成功时请求总数为 3。`ConnectionTestRequest.probeVision` 的 renderer 兼容字段与可见复选框在 Task 6 同步删除，不能留下死控件。
- [x] 在 `tests/host/provider-test.test.ts` 写失败测试并断言请求体：基础文本 `max_tokens: 16`；图片使用内置 32x32 红蓝 PNG 且 `max_tokens: 24`；Anthropic 思考探针使用 `thinking: { type: "enabled", budget_tokens: 1024 }` 与 `max_tokens: 1088`（协议允许的最低预算 + 64 token 回答余量）；OpenAI 兼容探针使用 `reasoning_effort: "low"` 与 `max_completion_tokens: 64`。这些探针只在用户点击“测试连接”时执行，不能后台自动烧额度。
- [x] 固定证据判定：图片真正描述红蓝才是 `verified`；明确说看不到或明确拒绝本次请求是 `failed`；网络异常、无法解析或 2xx 但回答含糊是 `unknown`。思考只有真实 thinking block、`reasoning_content` 或非零 reasoning token 信号才是 `verified`；参数被拒绝是 `failed`；请求成功但没有可靠信号是 `unknown`。
- [x] 保持基础连接 `ok: true` 不被第二、第三个探针失败覆盖；每个探针错误继续走现有脱敏分类，`detail` 不得含 API Key。
- [x] 修改 `bridge-host`，测试当前草稿的首个模型，调用自动三探针且不再读取 `probeVision`。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run tests/bridge/model-capabilities.test.ts tests/host/provider-test.test.ts tests/host/bridge-host-providers.test.ts
  ```

- [x] Commit: `feat(r9): add evidence-based model capability probes`

## Task 2: 持久化能力证据与用户纠错，不破坏旧配置

**Files:**

- Modify: `src/bridge/contract.ts`
- Modify: `src/host/provider-config.ts`
- Modify: `src/host/provider-catalog.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/renderer/stores/providers.ts`
- Modify: `tests/host/provider-config.test.ts`
- Modify: `tests/host/provider-catalog.test.ts`
- Modify: `tests/host/bridge-host-providers.test.ts`
- Modify: `src/renderer/stores/providers.test.ts`

- [x] 给 `ProviderDraft`、`ProviderConfigView`、`ProviderSpec` 和 `StoredProvider` 增加 `modelCapabilityEvidence?: Record<string, ModelCapabilityEvidence>`；不改变 `ProviderConfigFile.version`，因为这是向后兼容的可选字段。
- [x] 先写失败测试：旧文件只有 `modelCapabilities` 时正常加载；带证据的新文件完整往返；损坏的 status、时间戳、超长 detail 和任意对象键被逐项清洗；未知模型的证据不能把该模型凭空加入模型列表。
- [x] `provider-config.ts` 深拷贝并清洗证据。`detail` 限长 300 字符，不接受非有限时间戳，不接受 `supported:false` 的用户覆盖。
- [x] `provider-catalog.ts` 将预设 `modelCapabilities` 继续投影为兼容 hint，并单独投影实测证据；不得把预设的 `true` 包装成自动实测成功。
- [x] `bridge-host.ts` 的 `getProviderConfig` 和 `listProviders` 返回证据但仍不返回秘密；`saveProvider` 保存草稿证据。
- [x] `providers.ts` 的 clone 路径做模型级、能力级深拷贝，新增测试证明调用方修改返回值不会污染 store 内部对象。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run tests/host/provider-config.test.ts tests/host/provider-catalog.test.ts tests/host/bridge-host-providers.test.ts src/renderer/stores/providers.test.ts
  ```

- [x] Commit: `feat(r9): persist model capability evidence`

## Task 3: 用人话任务路由替代原始模型别名，并恢复原生子任务继承

**Files:**

- Modify: `src/bridge/providers.ts`
- Modify: `src/bridge/contract.ts`
- Modify: `src/host/provider-config.ts`
- Modify: `src/host/provider-catalog.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `tests/bridge/providers.test.ts`
- Modify: `tests/host/provider-config.test.ts`
- Modify: `tests/host/provider-catalog.test.ts`
- Modify: `tests/host/bridge-host-providers.test.ts`

- [x] 新增 renderer 可理解的数据结构：

  ```ts
  export interface TaskModelRouting {
    fastModelId?: string;
    subagentModelId?: string;
  }
  ```

  `undefined` 或空对象表示自动；不要增加 enum 或内部层级名。

- [x] 先修改 `tests/bridge/providers.test.ts`：默认构建的 env 必须完全省略 `CLAUDE_CODE_SUBAGENT_MODEL`；只有 `subagentModelId` 明确指定时才写入；OpenAI 网关只给显式值加内部前缀；当前对话 `ANTHROPIC_MODEL` 始终是用户在该对话选择的模型。
- [x] `StoredProvider` 新增 `taskModelRouting?: TaskModelRouting`。若新字段不存在，从旧 `ANTHROPIC_DEFAULT_HAIKU_MODEL` 和 `CLAUDE_CODE_SUBAGENT_MODEL` 迁移出人话字段；若新字段存在，即使为空对象也必须压过旧 env，避免用户选回“自动”后旧值复活。
- [x] `ProviderDraft` 和 `ProviderConfigView` 暴露 `taskModelRouting`；新保存路径只落盘人话字段，不再持久化 renderer 提交的任意 env 名。为避免 Task 6 完成前产生可见死控件，`envTemplate` IPC 字段暂标 deprecated 并仅兼容旧表单，随 Task 6 同步移除。
- [x] `provider-catalog.ts` 内部生成 Harness 需要的 env：快速模型只映射到内部快速任务槽；子任务模型只在显式选择时生成；其余层级跟随当前对话模型，不要求用户维护。
- [x] 修改 `buildConversationEnv`，普通任务槽可以按当前模型补齐，但子任务槽无显式覆盖时必须缺席；同步修正 direct、gateway、search shim 三种接线测试，并清除父进程残留的旧路由变量。
- [x] `bridge-host` 的配置投影返回迁移后的人话字段，确保升级用户第一次打开新页面就能理解现状，而不是看到空值或旧别名。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run tests/bridge/providers.test.ts tests/bridge/pool.test.ts tests/host/provider-config.test.ts tests/host/provider-catalog.test.ts tests/host/bridge-host-providers.test.ts
  ```

- [x] Commit: `fix(r9): restore native subtask model inheritance`

## Task 4: 建立服务商顺序和旧默认模型的单一迁移语义

**Files:**

- Modify: `src/renderer/stores/settings.ts`
- Modify: `src/renderer/stores/settings.test.ts`
- Modify: `src/renderer/components/model-picker.ts`
- Modify: `src/renderer/components/model-picker.test.ts`
- Modify: `src/renderer/bridge/context.tsx`
- Modify: `src/renderer/bridge/context.test.tsx`
- Modify: `src/renderer/components/BuddyShell.tsx`
- Modify: `src/renderer/components/WorkbenchShell.tsx`

- [x] 在 settings store 增加 `providerOrder: string[]`、`setProviderOrder(ids)`，并加入 `SettingsInitial`、`PERSISTED_SETTING_KEYS`、`pickPersistedSettings` 和逐项校验 hydrate。清洗规则是去空、去重、最多 100 项，不接受非字符串。
- [x] 在 `model-picker.ts` 增加纯函数 `orderConfiguredProviders(list, providerOrder, legacyDefaultPair?)`：只返回已配置且有模型的服务商；按已知 ID 排序；未知/删除 ID 丢弃；新服务商按原稳定顺序追加；旧 `defaultProviderId/defaultModelId` 在新顺序为空时分别提升服务商和模型。
- [x] 先写失败测试固定迁移：旧默认 pair 升级后仍位于第一；删掉默认服务商后下一项接替；同名模型按 provider pair 区分；顺序变化不修改已存在会话的 `ConversationMeta`。
- [x] `context.tsx` 的新会话 defaults、Buddy/Workbench 模型选择器都消费同一个排序投影。Provider 编辑器接收该投影的首选模型并在加载配置后 hoist 到第一项，使旧默认不只在运行时有效，也在新 UI 中可见。保持当前对话模型由 `ConversationMeta` 决定，不能在 settings 更新时调用 `setModelForConversation`。
- [x] 排序动作同步写回兼容字段 `defaultProviderId/defaultModelId`，但消费者一律从排序投影获得默认，避免两套互相打架的真源。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run src/renderer/stores/settings.test.ts src/renderer/components/model-picker.test.ts src/renderer/bridge/context.test.tsx
  ```

- [x] Commit: `feat(r9): persist provider and model priority`

## Task 5: 用服务商卡片和有序已接入列表重做模型页入口

**Files:**

- Modify: `src/bridge/contract.ts`
- Modify: `src/host/provider-catalog.ts`
- Modify: `src/renderer/components/ProviderList.tsx`
- Modify: `src/renderer/components/ProviderList.test.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/pages/SettingsPage.test.tsx`

- [x] 给 `ProviderSpec` 增加 key-free 的 `modelsUrl?: string` 投影，使卡片能从同一主进程目录预填，不在 renderer 复制端点常量。
- [x] 先写 `ProviderList.test.tsx` 失败测试：主列表只显示 configured providers；首项有“默认”；每行有第一模型和真实连接状态；可拖拽；上移、下移、设为默认按钮可由键盘触发；禁用时所有导航和排序动作均失效。
- [x] 在同一 `ProviderList.tsx` 中导出 `ProviderOfferGrid`，避免新增展示组件文件。卡片网格展示四个现有预设和“自定义 Provider”；不显示价格、虚构模型或假连接状态。
- [x] 卡片点击生成完整 `PresetOffer`：首次配置预设保留稳定 ID；同一预设再次接入时省略 ID 以创建新实例；自定义卡不预填地址或模型。
- [x] `ProviderWorkbenchSection` 只把 ordered configured providers 交给左栏；无服务商时默认展示卡片目录；有服务商时“添加模型服务商”打开目录；选择卡片进入真实表单；所有切换继续走现有 dirty/busy 防护。
- [x] 实现无依赖 HTML5 drag，但不能只依赖 drag。行内图标按钮使用 Lucide `GripVertical/ArrowUp/ArrowDown/Star`，均有 aria-label 和 tooltip；窄窗口改为横向紧凑列表，固定尺寸避免 hover 造成布局跳动。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run src/renderer/components/ProviderList.test.tsx src/renderer/pages/SettingsPage.test.tsx
  ```

- [x] Commit: `feat(r9): add provider catalog onboarding`

## Task 6: 把 Provider 编辑器改为一次走通的连续页面

**Files:**

- Modify: `src/renderer/components/ProviderConfigForm.tsx`
- Modify: `src/renderer/components/ProviderConfigForm.test.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/pages/SettingsPage.test.tsx`
- Modify: `src/renderer/components/OnboardingWizard.tsx`
- Modify: `src/renderer/components/OnboardingWizard.test.tsx`

- [x] 删除 `EditorTab`、`focusTab`、三页签导航、`ROLE_FIELDS`、人工思考/视觉 checkbox 和 `probeVision` state。新增只表达用户意图的 `revealAdvanced?: boolean` 与 `preferredModelId?: string` props，分别服务设置搜索和旧默认迁移。先写失败测试，扫描 UI 不再能找到“模型与角色”、Fable/Sonnet/Opus/Haiku、环境变量、人工能力勾选或“同时测试多模态”。
- [x] 连接区顺序固定为名称、API Key、必要连接字段。预设默认隐藏协议与 Base URL，放入高级连接参数；自定义 Provider 将协议与 Base URL 保留在主流程，不能要求展开高级设置。
- [x] 模型区始终和连接区在同一 scroll container：拉取模型、远端失败错误、手动输入、已启用模型有序列表同时可见。模型行提供拖拽、上移、下移、设为首选和删除；长 ID 截断并用 `title` 显示全文。
- [x] 高级设置使用原生 `details/summary` 或现有折叠模式，只呈现“快速与后台任务”“子任务使用的模型”“高级连接参数”。两个选模项默认分别是“自动推荐”“自动继承”，只有选择“指定模型”后出现当前 Provider 的模型下拉框。
- [x] `handleTestConnection` 固定测试 `modelRows[0]`，按钮旁写“自动测试连接、图片和深度思考”。把结构化结果合并进当前首选模型的 `modelCapabilityEvidence` 草稿；测试结果不会自动保存。
- [x] 模型行和结果区用四种人话状态：`已验证支持 · 自动探测`、`本次检测未通过 · 自动探测`、`未确认`、`用户已确认支持`。自动失败旁提供“重新检测”和“我确认这个模型支持图片”；用户确认只写 draft override；“恢复自动判断”只删 override。
- [x] 保存时同时提交有序 models、证据和 `taskModelRouting`。若保存的是默认服务商，同步兼容默认 model 到新首项；保存成功后继续重新读取脱敏配置。
- [x] OnboardingWizard 复用同一自动连接测试语义，不再提交已删除的 probe flag；不复制第二套能力勾选或角色配置界面。
- [x] 固定 footer 始终可见：取消、测试连接、保存设置。测试 pending、保存 pending、删除 pending 的锁范围继续覆盖整个设置导航。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run src/renderer/components/ProviderConfigForm.test.tsx src/renderer/components/OnboardingWizard.test.tsx src/renderer/pages/SettingsPage.test.tsx
  ```

- [x] Commit: `feat(r9): streamline provider setup journey`

## Task 7: 将用量与余额迁移为独立一级设置页

**Files:**

- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/pages/SettingsPage.test.tsx`
- Modify: `src/renderer/components/ProviderConfigForm.tsx`
- Modify: `src/renderer/components/ProviderConfigForm.test.tsx`

- [x] `SettingsTabId` 和导航改为 `general/models/usage/personalization/connectors/permissions`，编号固定 01 到 06；`SETTINGS_SECTION_TO_TAB.usage` 指向 `usage`。
- [x] 先写失败测试：搜索“费用/Token/余额”只打开用量；搜索“API Key/服务商/模型”打开模型；搜索“快速任务/后台任务/子任务模型”打开模型并展开高级设置；搜索词和可见 UI 不再包含内部别名。
- [x] 从模型页删除全局默认模型下拉框、用量区和余额入口。默认值只由顺序表达。
- [x] 用量页迁移现有 today/last7d、总费用、输入/输出 token、按 provider 汇总和“未定价”处理；把支持 balance API 的已配置 Provider 余额按钮和状态放到该页。
- [x] 不新增图表、价格编辑、月报或占位卡片。无数据时使用现有真实空状态，加载失败保留重试动作。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run src/renderer/pages/SettingsPage.test.tsx src/renderer/components/ProviderConfigForm.test.tsx
  ```

- [x] Commit: `feat(r9): separate model setup from usage`

## Task 8: 图片能力提示保持非阻断，并保住真实失败的重试上下文

**Files:**

- Modify: `src/renderer/components/model-picker.ts`
- Modify: `src/renderer/components/model-picker.test.ts`
- Modify: `src/renderer/stores/conversations.ts`
- Modify: `src/renderer/stores/conversations.test.ts`
- Modify: `src/renderer/bridge/wiring.ts`
- Modify: `src/renderer/bridge/wiring.test.ts`
- Modify: `src/renderer/components/InputArea.tsx`
- Modify: `src/renderer/components/InputArea.test.tsx`
- Modify: `src/renderer/components/InputArea.model-picker.test.tsx`
- Modify: `src/renderer/components/BuddyShell.tsx`
- Modify: `src/renderer/components/WorkbenchShell.tsx`
- Modify: `src/renderer/components/BuddyShell.test.tsx`
- Modify: `src/renderer/components/WorkbenchShell.test.tsx`

- [x] `ModelOption` 增加证据解析后的 `imageStatus/reasoningStatus` 和 source，不再把缺失证据强行折成 `false`。兼容布尔值只作为 preset hint，不能渲染“已验证”。
- [x] 先写 InputArea 失败测试覆盖三态：图片能力未确认时显示中性提示但照常发送；自动探测失败时显示“本次检测未通过，模型仍可能支持图片”但照常发送；用户确认后不显示失败警告。三态都必须保留附件按钮。
- [x] 图片提示只在草稿含图片 MIME 或常见图片扩展名时出现。提示内“选择其他模型”只打开现有模型选择器，不自动切换；无其他模型时仍允许发送。
- [x] 给 ConversationsState 增加仅内存的单一 `pendingSends` 生命周期表，记录 `runId/text/full AttachmentRef[]/providerId/modelId/errorMessage?`，并提供 `retry(conversationId)` 与 `dismissRetry(conversationId)` 动作；无错误时是 pending，有错误时就是 retry，避免两份镜像状态失同步。它不进入 hydrate 参数、timeline display metadata 或 persistence sync。
- [x] `send` 在 host acknowledgement 前创建 pending draft；同步 invoke 拒绝沿用现有回滚并让 InputArea 保留本地草稿；ack 成功后 InputArea 可清空，但 pending draft继续保留到 terminal event。
- [x] `foldConversationEnvelope` 在 `error` 事件记录安全收束后的消息；`run.finished isError` 把 pending 转为 retry；成功或用户中断清除 pending；新重试开始时清除旧 retry。未知/过期 runId 事件不能覆盖较新的草稿。
- [x] InputArea 在真实运行失败后显示“原消息和附件已保留”，提供“仍用当前模型重试”“选择其他模型”与关闭提示。两个 Shell 都调用 store 的 `retry/dismissRetry`，不各自复制重试逻辑。原模型重试原样复用文字和绝对路径；切模型后仍复用同一 retry draft；不静默删图，不修改持久化能力证据，不永久禁用模型。
- [x] 测试两个 shell 都把 active retry draft 和动作接到同一个 InputArea；切换对话时只能看到对应对话的重试条。
- [x] 运行并确认先红后绿：

  ```powershell
  npx vitest run src/renderer/components/model-picker.test.ts src/renderer/stores/conversations.test.ts src/renderer/bridge/wiring.test.ts src/renderer/components/InputArea.test.tsx src/renderer/components/InputArea.model-picker.test.tsx src/renderer/components/BuddyShell.test.tsx src/renderer/components/WorkbenchShell.test.tsx
  ```

- [x] Commit: `feat(r9): preserve failed image turns for retry`

## Task 9: 跨层回归、视觉验收与发布包证据

**Files:**

- Modify: `scripts/verify-settings-runtime.mjs`
- Modify: `scripts/verify-settings-layout.mjs`
- Modify: `scripts/cdp-provider-verify.mjs`
- Create: `docs/research/2026-07-30-model-onboarding-verification.md`
- Create: `docs/research/audit-shots/model-onboarding-r9-*.png`
- Modify: `docs/sdd/r7-requirements-ledger.md`

- [x] 在脚本中用临时 userData 和本地 mock upstream 验证：卡片选预设 -> 手动/发现模型 -> 自动三探针 -> 用户覆盖 -> 保存 -> 排序 -> 关闭 -> 重启 -> 新对话默认正确。临时 Key 只通过进程环境或运行时输入，facts 与截图不得包含它。
- [x] 增加 gateway 子任务验收：打包 Agent 工具真实派出两轮子任务；自动模式 child 继承父模型，显式模式 child 使用指定模型。主进程改动后已重打包、重启 app 再测。
- [x] 增加实际失败重试验收：mock upstream 在 host ack 后返回错误，UI 保留原文并切模型重试成功；打包 Bridge 附件两轮使用同一绝对路径、没有 silent text-only 请求。原生文件框自动化边界单列于验证报告，不伪装成已覆盖。
- [x] 运行完整自动验证：

  ```powershell
  npm test
  npm run typecheck
  npm run build
  npm run build:main
  npm run electron:pack
  ```

- [x] 运行设置 runtime/layout/CDP 脚本，并用真实 Leemo 窗口目验 1440x900、1280x720、1024x768 和 720x640。截图覆盖 Provider 卡片、连续表单、能力争议/纠正、用量页、失败重试与四视口输入区。
- [x] 检查每个视口：无横向溢出、输入或按钮遮挡、长模型 ID 撑宽、footer 不可达或窄窗换行过高；目验后将 720x640 操作区从 132px 修正为 56px。
- [x] 对比改前/改后 installer、app.asar、主 renderer chunk、解包文件数、冷启动和空闲内存。文件数保持 320，总包仅增加 7,641 B，无新依赖；内存如实保留为性能债。
- [x] 扫描打包 renderer 的可见字符串，不得出现 `Fable|Sonnet|Opus|Haiku|CLAUDE_CODE_|ANTHROPIC_DEFAULT_|Claude Code`；最终主 renderer 命中 0，SDK 包装错误也不再进入可见消息。
- [x] 将 `docs/research/2026-07-30-model-onboarding-verification.md` 写成结果、命令、打包路径、截图索引和残余风险，不写“测试通过”而没有命令证据。
- [x] 更新需求台账状态，只把已经完成打包用户路径的项目标为 release-verified；真实付费供应商组合矩阵保持公开未测。
- [x] Commit: `test(r9): verify model onboarding end to end`

## Task 10: 关闭本卡并立即转入记忆治理优先级

**Files:**

- Modify: `docs/superpowers/specs/2026-07-30-model-onboarding-and-routing-design.md`
- Create: `docs/superpowers/specs/2026-07-30-workspace-memory-boundary-design.md`

- [ ] 对照本规格第十节逐条核验，只在所有必做路径、打包证据和视觉证据齐全后把状态改为“已实现并验收”。
- [ ] 记录明确不做项，确保搜索 Provider、复杂用量、智能路由或视觉装饰没有插队。
- [ ] 读取 `C:\Users\Example\Leemo\memory\research-ai-memory.md`、现有 workspace/notebook/memory host 路径和原生 Auto Memory 行为，先产出“普通成果/工作区/本子上下文/长期记忆”写入边界规格。
- [ ] 下一卡顺序固定：工作区边界纠正 -> 原生 Auto Memory -> Leemo 记忆回执、来源、纠正、删除、撤销与重启验收。涉及用户心智的新决策先让用户复核，技术实现路径由开发侧负责。
- [ ] Commit: `docs(r10): define workspace and memory boundaries`

## Plan Self-Review

- [x] 每项已批准需求至少对应一个任务和一个可复跑验收；没有“之后补”“酌情处理”或占位步骤。
- [x] 新增 contract 字段均有 host 存储、IPC 投影、renderer 消费和 migration 测试，不存在只改一层的假接线。
- [x] 默认顺序、当前对话模型、快速任务模型、子任务模型四个概念没有相互覆盖。
- [x] 能力证据、用户覆盖、发送权限和真实失败重试是四个独立状态，不用一个布尔值兼任。
- [x] 凭据和附件路径边界未扩大；retry path 明确只在内存。
- [x] 计划只新增一个生产逻辑模块，未引入依赖；视觉截图和文档属于验收证据，不进入运行时 chunk。
- [x] 模型卡完成后直接进入记忆治理，没有把搜索增强或复杂用量提升为当前 blocker。
