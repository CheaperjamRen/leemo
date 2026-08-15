# Slice-2 交接：消息展示卡（工作台对话流）

## 一句话状态
slice-1（搭子落地页）已合 main（HEAD=600439a：merge d36d332 + 台账）；241 测试全绿 + typecheck 三段绿。现做 **slice-2 = 消息展示卡**。

## 先读（按需，别全读）
- 台账 `docs/sdd/progress.md` 末尾「第四批 CLOSED」段（slice-1 全过程 + 下一步）
- 持久记忆 `MEMORY.md`（尤其 `fe-slice1-phase1-gates`：2 个 Phase-1 gate 别碰）
- 前端唯一权威 `docs/specs/02-前端设计规格-v2.0.md`（消息卡/可视化/问询卡渲染规格章节）
- slice 计划 `docs/plans/2026-07-22-frontend-shell-slice.md`（S2 范围定义）
- 视觉基准 `docs/design-audition/k3/workbench-mode.html`（工作台模式：计划卡 / 工具卡 / 审批条 / 折叠用量脚注）+ 已在 `k3/` 的 workbench 截图
- 冻结契约 `src/bridge/contract.ts` + renderer 侧 `src/renderer/stores/message-model.ts`（applyEvent 已折的 LeemoEvent variant：tool.started/finished、subagent.activity、compact.boundary、usage.final 等——**卡的数据源已在,不用新造事件**）

## S2 做什么
消息流里的结构化卡片：**工具卡 / 计划卡(TodoWrite) / 活动卡(subagent) / 结果卡**。视觉基准 = workbench-mode.html。全部数据来自已有 LeemoEvent 流（applyEvent 已产出 messages/tool 状态），S2 只是**把这些 variant 渲染成卡**——组件层活,不动 reducer/store 契约。

## 四拍循环（同 slice-1，已验证有效）
骨架我搭(TDD,逻辑要测) → **用户验收①**(骨架朴素视觉截图) → K3 穿衣(纯视觉,无头 kimi -p 派发) → **用户验收②**(对照 workbench-mode.html 目验)。K3 只做视觉,绝不碰 store/reducer/props 签名/事件流。

## 硬约束（继承 slice-1，全适用）
- 架构 hexagonal：组件经 context hooks 读 store，**禁直连 bridge 端口**（`components/guard.test.ts` 文件扫描守卫,真 fail-red）
- TDD 边界：reducer/store/逻辑=严格测试；前端视觉=用户目验
- 模型分档：主控=Opus 4.8；骨架逻辑卡=Sonnet 5 TDD；K3 视觉=kimi；复审/终审=Opus 4.8 不降档（派 subagent 显式指定 model）
- 命名仅 Leemo/momo；名词预算=2（本子/成果）
- **Phase-1 gate 别碰**（接 IPC/Electron 时才带走）：①store 订阅生命周期（`conversations.ts` 把 `client.subscribe` 塞进 `context.tsx` 的 useMemo 且丢了 unsubscribe，单例 IPC client 前必修）②fixture default-case 白谎（`fixture-client.ts` invoke() default 对 fetchBalance/usageSummary 返 undefined）
- **kimi 无头派发教训**（省得重踩）：裸 `kimi -p "<prompt>" -m kimi-code/k3`，**不加** `--yolo`/`--auto`（与 `-p` 冲突报错）；`-p` 自带文件写权限；模型端点国内直连不走代理

## 工作区
建议**新 worktree 从 main 开**（同 slice-1，隔离 skeleton+dressing 的杂乱提交），或直接在 main 上做也行（gateway/bridge 批就在 main）。slice-1 旧 worktree `worktree-fe-slice1-skeleton`（在 `.claude/worktrees/`，harness locked，分支已合 main）可退休——用户或新会话清理。

## 验收/成本纪律
- 验收只认复现证据（自己复跑测试+typecheck，非采信执行者自称）
- 用户偏好：AskUserQuestion 选项卡提问（每轮≤4，Other 里有高质量补充逐句读）
- 里程碑一会话；思考尽量合并步骤一起输出，有问题再细拆（用户 7/22 明确要求：省 context/缓存成本）
