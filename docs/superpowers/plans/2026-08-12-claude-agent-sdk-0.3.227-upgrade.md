# Claude Agent SDK 0.3.227 Upgrade Implementation Plan

> **执行原则：** focused TDD，先证明旧实现缺少新版语义，再做最小接线；不 stage、不 commit、不改 subagent 深度。

**目标：** 安全升级到 Claude Agent SDK `0.3.227`，并把结构化错误、取消、权限拒绝、子任务重试和完整多模型用量映射到 Leemo 的稳定事件与现有 UI。

**版本边界：** 执行时 npm 的 `latest` 已是 `0.3.228`；本计划按用户批准的 `0.3.227` 精确锁定，不在同一轮验证中继续追版。

**架构：** 在 `src/bridge/events.ts` 完成 SDK→Leemo 语义归一化；在 Claude conversation record 上保存累计 `modelUsage` 游标；renderer 只消费 Leemo 稳定 outcome/retry/tool 状态；SQLite 继续使用既有 usage 表，但从 model breakdown 展开写入。

## Task 1：锁定归一化语义（RED）

**文件：**
- 修改 `tests/bridge/events.test.ts`
- 修改 `src/renderer/stores/message-model.test.ts`
- 修改 `src/renderer/stores/context-usage.test.ts`

新增聚焦用例：`529` 过载、`429` 限流、assistant aborted、系统/结果级 permission denial、多模型累计差分与回退、subagent retry 与 connection retry 并存、上下文 token 使用主循环字段。运行测试，确认仅新增断言失败。

## Task 2：升级依赖并实现 host 归一化（GREEN）

**文件：**
- 修改 `package.json`
- 修改 `package-lock.json`
- 修改 `src/bridge/events.ts`
- 修改 `src/bridge/pool.ts`
- 必要时修改 `src/host/sdk-adapter.ts`

精确安装 `0.3.227`。增加 usage cursor、稳定 outcome、tool denied 与 retry identity；将 cursor 挂到 Claude conversation 生命周期，不跨 provider 污染。先跑 Task 1 focused tests。

## Task 3：接通 renderer 与持久化

**文件：**
- 修改 `src/renderer/stores/message-model.ts`
- 修改 `src/renderer/stores/context-usage.ts`
- 修改 `src/main/persistence/schema.ts`
- 修改对应 focused tests

让 cancelled、denied、retry scope 和多模型 usage 正确进入 timeline；持久化按 model breakdown 展开，用 context 专用字段驱动上下文比例。不得新增第二套失败卡或第二套 retry store。

## Task 4：优化现有错误/用量表面

**文件：**
- 修改 `src/renderer/components/timeline/FailureRecoveryCard.tsx` 及测试（仅在现有组件内）
- 修改 `src/renderer/components/timeline/MessageFooter.tsx` 及测试（仅在确有多模型明细时）
- 必要时修改 `ProcessFold.tsx` 及测试

按 outcome 给出准确摘要；原始错误保持折叠；人工重试只在语义成立时出现；多模型用量在现有浮层中紧凑展示，不把正文顶开。

## Task 5：回归与运行证据

1. 运行 events/message-model/context-usage/persistence/timeline focused tests；
2. `npm run typecheck`；
3. `npm run build`；
4. `npm run build:main`；
5. `npm ls @anthropic-ai/claude-agent-sdk` 与 lockfile 版本核验；
6. 运行真实 SDK smoke（凭据可用时）；
7. 检查 `git diff --check`，确认没有 stage/commit；
8. 回报备份位置、变更语义、验证证据和仍需后置的二层 subagent。
