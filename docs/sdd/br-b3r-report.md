# Task B3-R 报告：契约修订（审批策略化 + 本地 provider + NewMax 能力轴）

> 执行：Opus 4.8。BASE 分支 HEAD=ae7a4c6（简报标 6a61e48；工作树已前进，本卡只改 5 个许可文件）。
> 零 live（全 fake 注入）。严格 TDD（RED→GREEN 见下）。契约冻结件修订，等用户签字定稿。

## 一、PermissionPolicy 设计（默认值 + 三条硬行为）

`PermissionPolicy = { mode: PermissionMode; dangerousCommandCaching: boolean }`，定义在 `src/bridge/interact.ts`（审批行为类型的既有归属处，与 `ApprovalTier`/`RiskLevel` 同源），经 `contract.ts` `export type` 再导出（契约面可见）。

- `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'`（对齐 Claude Code）。
- `DEFAULT_PERMISSION_POLICY = { mode:'acceptEdits', dangerousCommandCaching:false }`——保留 B3 安全默认。
- 构造签名：`createApprovalBroker(transport, persistence, policy = DEFAULT_PERMISSION_POLICY)`。**policy 可选**，既有 B3 测试无参构造即命中默认，行为与 B3 完全一致 → 既有断言零改动仍通过。

**本卡实现的三条硬行为（且仅此三条）**：

1. **bypassPermissions 短路（零卡）**：`policy.mode === 'bypassPermissions'` → `canUseTool` 一进门直接 `allow()`，**不生成 ApprovalRequest、不经 transport、危险命令也放行**。用户显式选 bypass = 自负其责。
2. **dangerousCommandCaching 条件化**（核心改动，见下前后对照）。
3. **fail-closed 保留**：`switch` 的 `default` 分支对未知/畸形 decision 一律 `deny`，一字未动（注释加了 "PRESERVED verbatim through the 07/21 revision"）。

## 二、danger 条件化前后对照

引入 `const dangerLocked = risk === 'dangerous' && !policy.dangerousCommandCaching;`——"这条危险调用是否必须停留在 allow-once"。

| 分支 | B3（前） | B3-R（后） |
|---|---|---|
| `allow-permanent` + dangerous | `if (risk==='dangerous') return allow()`（硬降级，永不持久化） | `if (dangerLocked) return allow()`；否则 `addToWhitelist` 持久化 |
| `allow-conversation` + dangerous | `if (risk!=='dangerous') conversationAllow.add(key)`（危险永不缓存） | `if (!dangerLocked) conversationAllow.add(key)` |
| 开关 = false（默认） | —— | `dangerLocked` 对 dangerous 恒 true → **与 B3 行为逐位相同**（危险严格 allow-once） |
| 开关 = true（用户开） | —— | `dangerLocked` 恒 false → 危险与普通档同等可缓存/持久化 |

顶部永久白名单 / 本对话缓存的命中检查天然协同：开关 false 时危险永不进这两个缓存，命中检查对危险永远 miss；开关 true 时危险可进、可命中。危险**分类**（`classifyRisk` 种子清单）与开关无关——开关只改"危险被批准后能否缓存"，不改"什么算危险"。

## 三、bypass 短路证据

`ApprovalBroker — bypassPermissions mode short-circuits (zero card)` 测试：transport 脚本设为**一律 deny**（若被调用会 deny），policy.mode='bypassPermissions'。三次调用（Read 安全 / Write 中等 / `rm -rf /` 危险）全 `allow`，且 `seen.length === 0`（transport 从未被调用）、`list.length === 0`（无持久化）。危险命令也 allow，证明短路发生在风险分类与问询之前。

## 四、authMode / capabilities 新轴

- `ProviderAuthMode` += `'none'`（本地无 key：Ollama/LM Studio），注释标明配 `capabilities.local`、指向 loopback baseUrl。
- `ProviderCapabilities` += 四个**可选** NewMax 对照留位：`local?` / `protocolSwitchable?`（anthropic⇄openai Base-URL 切换）/ `multiKey?`（多 key 轮换）/ `requiresProxy?`（海外端点需代理）。注释写明"首发无代码路径读它们；全量目录 + 设置页 UI = Provider 里程碑"。
- `CreateConversationRequest` += 可选 `permissionMode?: PermissionMode`（每对话覆盖全局默认；`dangerousCommandCaching` 仍是 broker/设置级开关，非 per-request）。
- contract.test 构造本地 provider（`authMode:'none'` + `capabilities.local:true`）与全轴 capabilities，删任一轴即 typecheck 红。

## 五、plan / acceptEdits 的处理决定（实现 vs 留位）

**实现**：仅 `bypassPermissions`（硬短路）。
**留位（未实现，注释标 Phase-1 执行语义）**：`plan`（只读规划）、`acceptEdits`（自动放行编辑类）。broker 对二者**暂按 `default` 处理**（完整问询流），**不发明**工具分类 / plan 逻辑（那依赖工具 taxonomy = Phase 1）。契约留 mode 值 + 09 §二 PermissionMode 表明确标注"暂等同 default"。这是遵循简报"本卡硬要求只有 bypass 短路 + danger 条件化 + fail-closed 保留；不过度实现 plan/acceptEdits"的边界。

## 六、09 文档修订要点

- 顶部：标题加"含 7/21 签字前修订"；版本注记段；**宪法修订记录**独立块（06 §2.9 "危险永不永久" → "默认安全、用户可选放开"，含理由）。
- §二：标题改"策略驱动"；加 **PermissionMode 表**（标注 plan/acceptEdits 暂等同 default、bypass 零卡硬行为）+ **PermissionPolicy 说明**；时序图加 bypass 短路首行；三档表危险注释改"视开关"；危险档纪律改为**策略条件化**（false=严格降级 / true=同等缓存）；加**审批哲学段**（默认低摩擦、危险默认每次问、可经设置/ bypass 放开、别老烦用户、fail-closed 底线不动）。
- §四：`authMode` 行加 `none`；`capabilities` 行加四个可选轴 + NewMax 留位说明段。
- §六：冻结声明纳入审批策略语义；变更纪律加第 4 条 NewMax 便捷特性留位 + 第 5 条审批策略驱动；完备性表 interact.ts 行加 PermissionMode/PermissionPolicy、contract.ts 行标注新增字段。

## 七、宪法修订记录措辞（写入 09 顶部）

> 06 §2.9 原将"危险操作永不提供永久允许档"定为硬不变量。用户（设计负责人）7/21 主动修订为：**默认安全、用户可选放开**。理由：绝大多数用户不会逐条审批、觉得危险也不会拒（要模型把活干完），反复弹卡只让人觉得产品麻烦而非安全。审批改策略驱动——默认仍保守（危险严格一次一批、不缓存不持久化），用户可经设置开关（`dangerousCommandCaching`）或 `bypassPermissions` 模式显式放开；放开自负其责，默认策略不变。

## 八、RED / GREEN 证据

**RED**（先写测试，实现前 `npm test`）：
- `dangerousCommandCaching toggle ON` → allow-conversation 缓存：`expected 2 to be 1`（危险未缓存）。
- toggle ON allow-permanent 持久化：`expected +0 to be 1`（未持久化）。
- bypassPermissions 零卡：`expected 'deny' to be 'allow'`（走了 transport 被 deny）。
- contract.test 的 PermissionMode/PermissionPolicy/authMode:'none'/capabilities.local：运行时 esbuild 抹类型不报，**typecheck RED**（导入不存在的类型 / 对象字面量含未定义字段）。

**GREEN**（实现后）：`npm test` → 23 files / **215 passed**；`npm run typecheck`（`tsc -p tsconfig.vendor.json && tsc -p tsconfig.json`）→ 0 error。

## 九、文件清单（仅动 5 个许可文件）

- `src/bridge/interact.ts`：+PermissionMode/PermissionPolicy/DEFAULT_PERMISSION_POLICY；broker 构造加 policy 参；bypass 短路 + dangerLocked 条件化 + fail-closed 保留。
- `src/bridge/contract.ts`：re-export PermissionMode/PermissionPolicy；`ProviderAuthMode`+='none'；`ProviderCapabilities`+4 可选轴；`CreateConversationRequest`+`permissionMode?`；import PermissionMode。
- `tests/bridge/interact.test.ts`：+import PermissionPolicy；+3 describe（danger toggle ON 缓存/持久化 + 默认严格回归 + bypass 零卡）。既有 B3 断言零改动。
- `tests/bridge/contract.test.ts`：+import PermissionMode/PermissionPolicy；authMode 联合测试更新为含 'none'（未削弱）；+policy 类型用例 + 本地 provider / NewMax 轴用例。
- `docs/specs/09-Bridge-IPC契约-v1.0.md`：如 §六所述修订。

## 十、自查

- ✅ 只实现 3 条硬行为；plan/acceptEdits 留位不臆造（注释标 Phase-1，broker 按 default）。
- ✅ 默认策略保 B3 安全（危险默认严格；`默认策略回归` 测试 seen===2 证明）。
- ✅ toggle-ON 路径测试（不同危险命令命中缓存 seen===1；危险持久化 list===1）。
- ✅ bypass 测试（transport 零调用含危险）。
- ✅ fail-closed 仍测（既有 default 构造用例，畸形 decision → deny），且注释标 PRESERVED。
- ✅ 既有断言强度未削弱（危险默认严、fail-closed、并发不串、三档语义全保留且通过）。
- ✅ authMode 'none' + capabilities.local 是真类型字段（contract.test 构造 + typecheck 守卫）。
- ✅ 09 审批哲学段 + 宪法修订记录在位；严格 catch（无新增 try/catch，未引 Electron/vendor）。
- ✅ 禁改清单未触（仅 5 个许可文件 M；untracked 的 .kimi/openspec/NewmaxAI报告/brief 非本卡产物，未 add）。

## 十一、Concerns

- `PermissionMode`/`PermissionPolicy` 定义在 `interact.ts` 而非 `contract.ts` 本体：遵循 B3 既有 idiom（审批类型定义在 interact、contract `export type` 再导出），避免 contract↔interact 运行时循环；契约面经 re-export 完全可见，contract.test 从 contract 导入通过。若验收方偏好类型物理落在 contract.ts，可平移（不影响行为/测试）。
- `acceptEdits` 作为**默认 mode 值**但语义暂等同 `default`：契约层已能表达"每对话覆盖为 acceptEdits"，但 broker 不区分二者的自动放行行为（Phase-1）。前端若据 mode 名做 UI 提示需知悉此暂时性。
- `permissionMode` 进了 `CreateConversationRequest` 契约面，但**本卡未接**"IPC 请求 → broker policy"的装配（主进程创建对话时把 request.permissionMode 灌进 broker）——那是 Phase-1 主进程装配，契约轴已留好。
