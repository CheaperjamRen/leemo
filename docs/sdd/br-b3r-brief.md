# Task B3-R 简报：契约修订（审批策略化 + 本地 provider + NewMax 能力轴）

> 来源：用户 7/21 签字前修订（推翻 B3 的严格审批设计 + 要求 provider 对齐 NewMax）。BASE=6a61e48。
> 执行模型：Opus 4.8（契约级修订，不降档）。零 live（fake 注入）。
> **这是 09 号契约冻结件的修订**——契约尚未最终锁定（等用户签字），本卡改完再定稿。

## Global Constraints（本批每张卡隐含遵守）
- 新代码/改动只进 `E:\Leemo\`；`smoke/`、`vendor/`、`src/gateway/**`、`src/bridge/{pool,providers,events,pricing,balance}.ts`（B0-B2 过审只读）、既有 gateway 测试禁改。
- **严格 TDD**：先失败测试后实现，RED 证据留存。
- 类型防火墙：禁 import `@gateway/vendor/**`。密钥纪律：无明文 key。命名：Leemo/momo，禁旧名。
- `npm run typecheck`=两条命令；自研代码根 tsconfig（ES2022+严格 catch）。禁引 Electron。
- 本卡**允许改** B3 自己的产物：`src/bridge/interact.ts`、`src/bridge/contract.ts`、`tests/bridge/interact.test.ts`、`tests/bridge/contract.test.ts`、`docs/specs/09-Bridge-IPC契约-v1.0.md`（这些是 B3 冻结件，尚未最终锁定，本卡是其修订）。

## 背景：为什么改

B3 把"危险命令永远只 allow-once、绝不缓存"做成了**硬编码不变量**。用户（设计负责人）7/21 明确推翻：**绝大多数用户不会审批、觉得危险也不拒（还要模型干活），反复弹卡只让用户觉得产品麻烦而非安全。默认应低摩擦；危险操作可选地经设置放行或一轮一卡；别老烦用户。** 这是宪法 06 §2.9 的用户主动修订（默认仍安全，用户可选放开）。

同时用户读了 NewMax provider 深挖报告（33 预置 provider，含本地 Ollama/LM Studio 无 key），要求 provider 与模型接入"和 NewMax 一样好一样便捷"。本卡在**契约层留轴**（全量目录+设置页 UI 是后续 Provider 里程碑，不在本卡）。

## 要改的东西

### 1. `src/bridge/contract.ts`

**A. 审批策略类型（新增）**：
- `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'`（对齐 Claude Code 权限模式；`bypassPermissions`=零审批卡，`plan`=只读规划不执行）。
- `PermissionPolicy = { mode: PermissionMode; dangerousCommandCaching: boolean }`——`dangerousCommandCaching`=设置页"危险命令总是放行"开关（默认 false）。
- 导出这两个类型；`CreateConversationRequest` 加**可选** `permissionMode?: PermissionMode`（每对话可覆盖全局默认；不填=用 broker 的默认策略）。

**B. authMode 加 `'none'`**：
- `ProviderAuthMode` 从 `'api-key' | 'oauth-subscription'` → `'api-key' | 'oauth-subscription' | 'none'`。`none`=本地模型无需 key（Ollama/LM Studio，用户点名）。

**C. ProviderCapabilities 扩展（对齐 NewMax，均可选，留位）**：
- 现有：`balanceApi` / `modelDiscovery` / `subscriptionPlan`。
- 新增可选：`local?: boolean`（本地部署）、`protocolSwitchable?: boolean`（NewMax 10 个 provider 支持 anthropic⇄openai Base URL 切换）、`multiKey?: boolean`（多 key 轮换）、`requiresProxy?: boolean`（海外端点需代理）。
- 注释写明这些是 NewMax 对照留位，全量目录+设置页 UI = Provider 里程碑。

### 2. `src/bridge/interact.ts` — ApprovalBroker 策略化

**构造签名改**：`ApprovalBroker(transport, persistence, policy?: PermissionPolicy)`——policy 可选，默认 `{ mode:'acceptEdits', dangerousCommandCaching:false }`（保留 B3 的安全默认）。

**行为改（在现有 canUseTool 回调里）**：
1. **bypassPermissions 短路**：`policy.mode === 'bypassPermissions'` → 一切工具直接 allow，**不生成 ApprovalRequest、不经 transport**（零卡）。危险命令也放行（用户显式选了 bypass = 自负其责）。
2. **plan 模式**（若实现范围允许，最小处理）：`policy.mode === 'plan'` → 对写类工具（Bash/Write/Edit）返回 deny（只读规划）；读类放行。**若 plan 语义复杂，可本卡只在契约留 mode 值 + 注释"plan 执行语义 Phase 1"，broker 暂按 default 处理并报告**——不要臆造复杂 plan 逻辑。
3. **危险命令缓存条件化**（核心改动）：现在的"dangerous → 强制 allow-once、拒 conversation/permanent"改为**受 `policy.dangerousCommandCaching` 控制**：
   - `dangerousCommandCaching === false`（默认）：保留 B3 现行为——dangerous 只 allow-once，拒 conversation 缓存、拒 permanent。
   - `dangerousCommandCaching === true`（用户开了设置开关）：dangerous 与普通命令一样可 allow-conversation 缓存、可 allow-permanent。
4. **fail-closed default 保留**（B3 #3 修复）：未知/畸形 decision → deny，不动。
5. acceptEdits/default 两 mode 的差异（acceptEdits 自动放行编辑类）**若 B3 未实现该区分，本卡可只在契约留 mode 值**、broker 对二者暂同等处理并报告——不强求本卡实现 acceptEdits 自动放行逻辑（那依赖工具分类，可 Phase 1）。**本卡硬要求只有：bypassPermissions 短路 + dangerousCommandCaching 条件化 + fail-closed 保留。**

### 3. `docs/specs/09-Bridge-IPC契约-v1.0.md` 修订
- §二审批：改为"策略驱动"。加 PermissionMode/PermissionPolicy 说明表；`dangerousCommandCaching` 开关（默认关=安全，开=危险可缓存）；bypassPermissions=零卡；写入**审批哲学**："默认低摩擦；危险操作默认每次问，用户可经设置放行或选 bypass；别老烦用户——多数用户只想模型干完活。" 危险档"只 allow-once"从硬不变量降为**默认策略**（可经开关放开）。
- §四 Provider：authMode 加 `none`（本地）；ProviderCapabilities 加 local/protocolSwitchable/multiKey/requiresProxy；变更纪律补一条"对齐 NewMax 便捷特性（双协议切换/多 key/requiresProxy/per-provider env/模型槽位/从服务商拉取/测试连接）= Provider 里程碑填目录数据，契约已留轴"。
- 顶部加**宪法修订记录**：06 §2.9"危险永不永久"经用户 7/21 修订为"默认安全、用户可选放开"；默认策略仍保守。
- 版本注记：v1.0 → 标注"含 7/21 签字前修订（审批策略化 + 本地 provider + NewMax 能力轴）"。

### 4. 测试 `tests/bridge/interact.test.ts` + `contract.test.ts`
- **默认策略**（dangerousCommandCaching:false）：dangerous 仍只 allow-once（B3 现有测试应仍通过；如构造方式变了就更新为传默认 policy）。
- **开关开启**（dangerousCommandCaching:true）：host 对 dangerous 命令返回 allow-conversation → 第二条不同 dangerous 命令**命中缓存不再问**（seen===1）。这是新行为的 RED-first 证据。
- **bypassPermissions**：policy.mode='bypassPermissions' → 危险命令直接 allow、transport 从未被调用（seen===0，含危险命令）。
- **fail-closed 仍在**：畸形 decision → deny（回归保护）。
- **contract.test.ts**：构造带 `authMode:'none'` + `capabilities.local:true` 的 ProviderSpec 类型合法；PermissionPolicy/PermissionMode 类型可用（含 bypassPermissions）。删轴 typecheck 红。

## 风险/边界
- 不要过度实现 plan/acceptEdits 的完整语义（依赖工具分类，Phase 1）——本卡只需 mode 值进契约 + bypass 短路 + danger 条件化 + fail-closed。含糊处按"契约留位、注释标 Phase 1、broker 暂 default 处理"并在报告说明。
- 不建 33-provider 目录、不建设置页 UI（Provider 里程碑）。本卡只动契约类型 + broker 逻辑 + 09 文档 + 测试。
- 若改 broker 构造签名导致 B3 现有测试红：更新那些测试传默认 policy（允许——本卡是 B3 修订，interact.test.ts 可改），但不得削弱原有断言强度（危险默认仍严、fail-closed 仍在、并发不串、三档语义）。

## 禁改清单
smoke/；vendor/；src/gateway/**；src/bridge/{pool,providers,events,pricing,balance}.ts；tests/gateway/**；tests/bridge/{pool,providers,events,pricing,balance}.test.ts；tsconfig*/vitest.config.ts；CLAUDE.md；docs/NewmaxAI逆向报告/；docs/specs/ 的 02/06/08（只改 09）。

## Steps
1. contract.ts：PermissionMode/PermissionPolicy + authMode 'none' + capabilities 扩展（先写 contract.test 断言 RED）
2. interact.ts：broker 吃 policy；bypass 短路 + danger 条件化 + fail-closed 保留（先写 interact.test RED）
3. 09 文档修订（审批哲学 + provider 轴 + 宪法修订记录）
4. 全绿 → Commit `feat(bridge): policy-driven approval (bypass mode, dangerous-caching toggle), authMode=none for local, NewMax capability axes`

## 验收命令
`Set-Location E:\Leemo; npm test; npm run typecheck`（验收方核对：默认危险仍严 + 开关开启危险可缓存 + bypass 零卡 + fail-closed 仍在 + authMode none/capabilities local 类型合法；09 哲学与契约一致）

## 报告
写到 `docs/sdd/br-b3r-report.md`：PermissionPolicy 设计（默认值 + 三条硬行为）、danger 条件化前后对照、bypass 短路证据、authMode/capabilities 新轴、plan/acceptEdits 的处理决定（实现了什么 vs 留位）、09 修订要点、宪法修订记录、RED/GREEN、文件清单、自查、concerns。
