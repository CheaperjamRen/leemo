# Task G4 报告：Live 验收——中转站 OpenAI 端点跑 Phase 0 五项

> 日期：2026-07-21 ／ 仓库 HEAD（起点）=96cb0b3 ／ 执行机：Windows（Node v24.16.0）／ SDK 0.3.210
> 运行器：`smoke/gateway-live.mjs`（新增）／ 结果：`smoke/results/gateway-relay2-2026-07-21T02-15-42-631Z.json`

## 1. 运行器设计选择

### 网关引导 = 子进程方案（brief option a）
验收命令是 `node smoke\gateway-live.mjs`（**纯 node**，非 tsx），无法就地用 tsconfig 别名加载 `@vendor/*`/`@/*` 的 TS 网关源。故运行器 `spawn(process.execPath, [node_modules/tsx/dist/cli.mjs, src/gateway/dev.ts])`，cwd=仓库根，解析其 stdout 打印的 `listening on http://127.0.0.1:<port>` 与 `providers: relay2`。选此方案而非"就地 register+dynamic import"（option b）的理由有二：
- **进程边界即密钥边界**：真 key 只被 `dev.ts` 的 `loadEnvFile()` 读进**网关子进程**内存，运行器进程永不接触 `.env`。
- 与验收命令的纯 node 语义天然吻合，无需在运行器里再挂 alias-hook。

关停：`taskkill /PID <pid> /T /F`（Windows，连带 tsx 派生的子孙进程），置于 `finally` 保证任何路径都不留孤儿网关。

### provider / env 构造
- 运行器**绝不** `loadEnv()`。`checks.mjs` 的 `buildEnv()` 以 `...process.env` 展开成 SDK 子进程 env——运行器保持无 key ⇒ 子进程 env 只可能拿到占位 token。
- provider 形状对齐 `smoke/providers.mjs` 的 `resolveProvider` 产物（`{id,name,baseUrl,apiKey,model}`），供 `buildEnv` 消费：
  - `baseUrl = http://127.0.0.1:<port>`（网关）
  - `apiKey = leemo-gw:relay2`（占位 token，`buildEnv` 会塞进 `ANTHROPIC_AUTH_TOKEN`）
  - `model` = 网关 `GET /v1/models` 返回的伪装名 `claude-gpt-5.6-luna`（网关按 token 解析 provider 后把上游 model 强制覆盖成真 `RELAY2_MODEL`，故 SDK 侧用伪装名即可）
- 起跑前 `GET /health`（确认存活）+ `GET /v1/models`（取模型名）双探。
- 复用 `checks.mjs` 五个导出函数原样调用（未改 smoke）；runner 骨架抄 `smoke-cc-sdk.mjs` 的逐项 try/catch + `redact` + `saveResult`，`--check all|<names>` CLI 同款。

## 2. 五项矩阵（全部经网关）

| check | 结果 | 关键数字 | 归因 |
|-------|------|----------|------|
| streaming | **PASS** | streamEvents=14 · success · is_error=false · 15.2s | — |
| tools | **PASS** | toolsUsed=[PowerShell,PowerShell,Read,Write] · answer=`obsidian-7413` · 75.5s | — |
| multiturn | **PASS** | finalText="蓝色鲸鱼 42" · assistantTurns=2 · 8.5s | — |
| subagent | **PASS** | taskToolUsed=true · toolNames=[Agent,Glob] · subagentActivity=3 · answer 计数=3（alpha/beta/gamma）· 16.3s | 工具真名 Agent，与 §五一致 |
| compaction | **PASS** | trigger=manual · messageTypes 含 `system:compact_boundary` · post_tokens=2595 · 召回"紫色大象 88" · success · 107.7s | boundary 产出+召回存活 |

**5/5 PASS ⇒ 竖切达成（阈值 ≥4/5）。** 无 FAIL。

## 3. 密钥隔离证据

结果 JSON `isolation` 字段（SDK 子进程实际收到的 env dump，即 `buildEnv(provider)` 产物）：

```json
{
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:61340",
  "ANTHROPIC_AUTH_TOKEN": "leemo-gw:relay2",
  "ANTHROPIC_API_KEY_isEmpty": true,
  "ANTHROPIC_MODEL": "claude-gpt-5.6-luna",
  "childEnv_has_RELAY2_API_KEY": false,
  "childEnv_has_RELAY2_BASE_URL": false,
  "childEnv_keyShapedValues": [],
  "runner_process_env_has_RELAY2_API_KEY": false
}
```

SDK 子进程 env 只有占位 token，无真 key、无 key 形状值；运行器自身进程亦无 `RELAY2_API_KEY`。真 key 仅存于网关子进程内存。

**泄漏扫描：**
```
Select-String -Path smoke\results\*.json -Pattern 'sk-[a-zA-Z0-9]{8}'  →  ZERO HITS
```
广义扫描（`(sk|xai|gsk|glm)[-_]{8,}` / `Bearer …`）在**新增文件**（gateway-live.mjs、本轮 gateway-relay2-*.json、gw-live-run.log）零命中；唯二命中在**旧** GLM 结果文件，且系工作区路径串 `glm-canusetool-...` 误匹配（非 key，非本卡产物）。双层脱敏：`lib.redact`（扫 env 内 key）+ registry 同款 `sk-/Bearer` 形状正则兜底。

## 4. 其它验证
- `npm test` → **69/69 passed**（15 test files，2.42s；本卡未动测试）。
- 复现命令 `node smoke\gateway-live.mjs --check all` 可复跑对账（每项独立、`checks.mjs` 内建 10min abort 超时）。

## 5. 变更文件
- **新增** `smoke/gateway-live.mjs`（运行器）
- **修改** `docs/reports/phase0-report.md`（追加 `## 七、网关竖切 Live 验收`）
- **新增（未入库/gitignore）** `smoke/results/gateway-relay2-*.json`、`smoke/results/gw-live-run.log`

## 6. Concerns（回报 G2/G3，本卡禁改网关代码）
1. **usage 计量口径归零（13 坑之⑩，非阻断）**：经网关时 streaming 的 `usage` 全零、compaction 的 `pre_tokens=0`；直连端点为 input≈18k/pre≈21-22k。功能判定不依赖 token 数故五项仍 PASS，但网关未把上游 OpenAI `usage`/`stream_options.include_usage` 透传/换算到 Anthropic 字段（或该中转站流式未回 usage）。**后续 Bridge 层若要统一读 `result.total_cost_usd`/采集成本，此为硬前置**——建议 G2/G3 后续卡专门核查 usage 映射与 `include_usage` 开关。属观察级，不沉竖切。
2. 无其它阻断项；网关五项功能全通，未发现需 STOP 的活体 bug。
