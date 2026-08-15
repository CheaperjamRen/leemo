# Claude Agent SDK 0.3.227 升级设计

## 目标

将 `@anthropic-ai/claude-agent-sdk` 从 `0.3.210` 升级到稳定版 `0.3.227`，保持 Leemo 现有 Claude 主链路语义不变，并消费新版公开、稳定的结构化状态。升级不能通过重发整轮来“假装重连”，不能把取消、权限拒绝或部分成功统一显示为普通失败，也不能把累计用量重复入账。

> 执行时的实时 npm 查询显示 `latest` 已前进到 `0.3.228`。本轮仍精确锁定用户已经批准和完成审计的 `0.3.227`，不在验证中途静默追版；后续升级 `0.3.228` 应单独核对 changelog 后再决定。

## 升级前恢复点

- 源码快照：`E:\Leemo-backups\2026-08-12-pre-claude-sdk-0.3.227\Leemo-pre-claude-sdk-0.3.227-source.zip`
- Git 历史：`E:\Leemo-backups\2026-08-12-pre-claude-sdk-0.3.227\Leemo-pre-claude-sdk-0.3.227-history.bundle`
- 快照中的依赖版本已核对为 `0.3.210`；源码归档和 bundle 均已验证可读。

## 采用的新版能力

| SDK 信号 | Leemo 稳定语义 | 用户可见结果 |
| --- | --- | --- |
| `api_error_status` | 结构化分类限流、过载、鉴权、上游错误 | 显示简短人话摘要；原始详情默认折叠；可安全重试时保留重试入口 |
| assistant `aborted` | 本轮被取消/中止，不是模型失败 | 保留已产生内容但标记为已停止；不展示红色失败卡，不把截断文本冒充最终答案 |
| `permission_denied` / `permission_denials` | 某个工具未获允许；不自动等同整轮失败 | 对应工具显示“未获允许”；若整轮因此终止，再给调整权限后的重试建议 |
| `modelUsage` | SDK 生命周期累计值，必须按轮求差分 | 用量统计覆盖主任务、subagent 与 sidechain，且不重复计费 |
| result `usage` | 主循环本轮上下文规模 | 仅用于上下文占用判断，不拿它替代完整费用统计 |
| `subagent_retry` | 子任务自身重试，与网络重连分开 | 独立紧凑状态，不覆盖“正在重新连接”状态 |

官方 changelog 记录了 `tool_result_meta`，但 `0.3.227` 的公开 TypeScript 声明没有导出该字段。本轮在 SDK 边界做防御性的结构读取，把它作为单个工具“未执行/被拒绝/被取消”的补充信号；公开的 `permission_denied` 与 result `permission_denials` 仍是权限拒绝的权威来源。renderer 只接收稳定 Leemo 工具 outcome，不依赖或透传 SDK 内部字段。

## 关键设计

### 1. 用量游标

`modelUsage` 在 streaming-input 会话中跨轮累计。Leemo 为每个 Claude conversation 保存一份内存游标：

1. 首次结果把当前累计值作为本轮增量；
2. 后续结果按模型逐项做非负差分；
3. 任一累计计数回退时，视为 SDK 生命周期重置（恢复、新 query 或 clear），以当前值建立新基线；
4. 顶层用量保留本轮合计，`modelBreakdown` 保留各模型/provider 的真实差分；
5. SQLite 统计按 breakdown 写入，消息脚注显示合计并可查看模型明细；
6. 上下文占用单独使用 result `usage`，避免多模型合计把上下文进度条放大。

游标只存在内存，不写入用户数据。应用重启或会话 resume 后 SDK 自身也开启新的累计生命周期，因此不会需要跨重启推断差分。

### 2. 终止结果分类

Leemo 增加稳定的 `run.finished.outcome`：`completed`、`cancelled`、`permission-denied`、`rate-limited`、`overloaded`、`timeout`、`budget`、`max-turns`、`failed`。旧 `subtype` 与 `isError` 保留兼容，但 UI 以 outcome 决定文案和动作。

- `completed`：正常完成；即使部分工具被拒绝，也不伪报整轮失败。
- `cancelled`：用户或 SDK 中止；不是错误，不触发失败恢复卡。
- 可恢复的网络/服务错误：显示已发生的原生重试进度；重试耗尽后提供一次明确的人工重试。
- 权限拒绝：提示调整权限或换做法；不声称网络故障。
- 预算/最大轮次：说明限制已到达；不把“再点一次”包装成必然有效。

### 3. 重试纪律

- Claude/Codex 只消费供应商的同一轮原生 retry 事件；Leemo 不自动重发包含工具副作用的整轮请求。
- 保持当前最多 `5` 次的 Claude 原生重试配置。
- 网络重连与 subagent retry 使用不同稳定 identity，可同时存在且互不覆盖。
- 错误详情保持默认折叠，摘要必须与真实状态一致。

### 4. subagent 深度

接受 SDK 新默认的一层 subagent，不设置兼容旧版默认深度的环境变量。未来若产品明确需要二层协作，再以显式设置、可见成本和测试验收单独解锁。

## 非目标

- 不重构 BridgeHost 或更换 Claude 会话架构；
- 不新增自动整轮重发；
- 不把内部 SDK 字段直接暴露给 renderer；
- 不在本轮开放二层 subagent；
- 不为理论兼容增加新的通用事件总线。

## 验收

1. SDK 锁定为稳定版 `0.3.227`，lockfile 无漂移；
2. 多轮累计 `modelUsage` 不重复计算，累计值回退可正确重新建基线；
3. `529`、`429`、取消、权限拒绝、预算/轮次限制分别得到正确 outcome；
4. 取消不出现失败卡，权限拒绝不冒充网络故障；
5. 网络 retry 与 subagent retry 可并存；
6. 用量持久化包含多模型增量，上下文占用仍使用主循环本轮值；
7. focused tests、全量 typecheck、renderer/main build 通过；
8. 至少完成一次真实 Claude SDK smoke（若本机凭据/网络可用），否则明确记录外部阻塞而不虚报。
