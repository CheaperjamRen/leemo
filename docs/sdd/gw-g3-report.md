# Task G3 报告：网关薄壳（server + 端点面 + 密钥隔离 + SSE 直通）

**状态：DONE_WITH_CONCERNS**（功能全绿；报告一处 G2 遗留基础缺口=vendor 别名运行时不解析，已在本卡范围内以新增文件补齐，未触碰任何禁改配置）

## 1. 实现内容

在 G2 转换核心之上建成 `127.0.0.1` HTTP 薄壳，SDK 经 `ANTHROPIC_BASE_URL` 指向本网关即可用纯 OpenAI 协议端点。壳层**只**消费 G2 facade（`translate` / `tokens`）+ 本卡 `registry`，从不 import vendor（类型防火墙）。

### 路由表

| 方法 | 路径 | 行为 |
|------|------|------|
| GET  | `/health` | `{status:"ok"}` |
| GET  | `/v1/models` | registry 模型，Anthropic list 格式，id 加 `claude-` 前缀伪装进模型发现 |
| POST | `/v1/messages`（含 `?beta=true`）| 占位 token→registry 解析真 key/baseUrl/model/opts → G2 anthropicToOpenAI → global fetch 上游 → 非流式 openaiToAnthropicResponse / 流式 openaiToAnthropicStream **逐 chunk 直通** |
| POST | `/v1/messages/count_tokens` | 本地 o200k_base 估算，**不打上游** |
| 其他 | * | 404 Anthropic error 形状 |

### 密钥隔离链路

- SDK 侧 env 只拿占位 `leemo-gw:<providerId>`，经 `Authorization: Bearer …` **或** `x-api-key: …`（两种 header 都接受）。
- 真 key 只在 registry 内存；**仅**在壳层构造的上游 `Authorization` 头出现一次。
- registry 带 redacting logger：注册的 key 字面量 + 通用 `sk-/Bearer/glm/xai/gsk` 形状在写 sink 前替换为 `[REDACTED]`。
- 上游错误体**从不回显**（可能内嵌 key）；壳层只发通用 message。

## 2. 文件清单

- 新增 `src/gateway/server.ts` — `startGateway(registry): Promise<{port, close}>`，绑 127.0.0.1:0；路由 + 上游 fetch + SSE 直通 + client abort 传上游 AbortController + 错误映射。
- 新增 `src/gateway/registry.ts` — `ProviderRegistry`（内存 Map + resolve/ids/models）+ redacting logger + `fromEnv()`（读 RELAY2_*，未配置返回空 registry 不抛）。
- 新增 `src/gateway/dev.ts` — `npm run gateway:dev`：注册别名 hook → 读 .env → 起网关打印 port + SDK env。
- 新增 `src/gateway/alias-hook.mjs` — 运行时 ESM resolve hook，把 `@vendor/*`、`@/*` 别名映射到真源文件（见 §5 concern）。
- 新增 `tests/gateway/server.test.ts` — 进程内 mock OpenAI 上游全链路测试（12 例）。

未改任何既有文件（G2 core、pitfall 测试、vitest/tsconfig/.gitignore 全部原样）。

## 3. 测试清单（tests/gateway/server.test.ts，12 例）

1. **占位 token 路由 + 真 key 只在上游头**（参数化 Authorization / x-api-key 两 header）：断言 mock 上游收到 `Bearer test-key-…`、上游收到真 model `deepseek-chat`、客户端响应是 `type:"message"` 且不含真 key、网关日志不含真 key。
2. **beta=true 不破坏路由**：仍分类为 messages，上游命中 `/chat/completions`。
3. **redacting logger**：即便显式要求打印 `Bearer <key>`，sink 收到的行也无真 key。
4. **count_tokens**：返回正整数 `input_tokens`，且 mock 上游 0 次被打（纯本地）。
5. **/v1/models**：Anthropic list 格式，`type:"model"`，id `claude-deepseek-chat`。
6. **/health**：`{status:"ok"}`。
7. **未知路由 → 404** Anthropic error 形状。
8. **未知占位 token → 401** `authentication_error`，上游 0 次被打。
9. **上游 5xx 映射**：即便上游错误体内嵌 key，客户端响应与日志均无真 key；error 形状正确。
10. **client abort 取消上游**：mock 保持连接不 end，客户端读首 chunk 后 abort，轮询断言 mock 观测到其上游连接被关闭（`closedEarly`）。
11. **SSE 直通不缓冲（100-chunk 压力）**：断言客户端收到首字节的时刻 **早于** 上游发出末字节的时刻（`firstRecvAt < upstreamLastSentAt`），且收流窗口 >100ms（非一次性），末态含 `message_start`/`message_stop`，全程无真 key。

## 4. TDD 证据

**RED**（实现前，`npx vitest run tests/gateway/server.test.ts`）：
```
Error: Cannot find package '@gateway/server' imported from …/server.test.ts
 ❯ tests/gateway/server.test.ts:17:1
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN**（实现后）：`Test Files 1 passed (1) / Tests 11 passed (11)`（typecheck 修 `resp.json()` unknown 断言后为 12 例的最终值；全套 15 files / 69 tests）。

**变异测试（证明关键断言非空转）**：
- 注释掉 server.ts pre-stream close 里的 `ac.abort()` → “client abort” 用例 **超时失败**（10.5s）。恢复后绿。
- 把流式 pump 改为整体缓冲后再写 → “unbuffered” 用例 **失败**（首字节晚于上游末字节）。恢复后绿。

两次变异均已回滚，最终 `git diff --stat src/gateway/server.ts` 为空、全套 69 绿。

## 5. 自审发现 & Concerns

- **[已在本卡内解决] vendor 别名运行时不解析（G2 遗留基础缺口）**：`@vendor/*`、`@/*` 别名此前只在 `vitest.config.ts`（测试）与 `tsconfig.json`（typecheck，指向 types-only 的 `dist/vendor-types`）两处接线；`tsx`/`node` 运行时**不读 tsconfig paths**。G3 是首个非 vitest 入口，故此缺口首次暴露——裸跑 `npm run gateway:dev` 会在首个 vendor import 崩。解决：新增 `src/gateway/alias-hook.mjs`（loader-thread resolve hook），`dev.ts` 用 `module.register` 在动态 import server 前注册它。**未触碰任何禁改配置**（vitest.config/tsconfig/package.json 脚本原样）。已实测 `npm run gateway:dev` 起得来、`/health` 与 `/v1/models` 正常、假 key 不入日志。若审查方更倾向把此接线收敛进 package.json 脚本或 tsconfig（而非入口自举），可在 G4 前统一——但那会动到 G2-PRE 冻结的 tsconfig，故本卡按“新增文件、零改配置”的最小侵入处理。
- **abort 的 closedEarly 判定是启发式**：mock 用 `req.on('close')` 且 handler 未 end 来判定“上游连接被过早关闭”。对本用例（mock 全程 hold 不 end）是可靠的；非 hold 场景不用此断言。
- **count_tokens 的 `input_tokens`** 是 o200k_base 近似（G2 既定），非 Claude 真 tokenizer——符合规格（CC 压缩逻辑只需稳定估算）。
- **未做 live 上游验证**：本卡按要求只跑 mock 链路；真中转站验证属 G4（需 RELAY2_* 配置）。

## 6. 验收命令复现

```
Set-Location E:\Leemo
npm test          # 15 files / 69 tests passed
npm run typecheck # tsc vendor + app 两遍均 0 error
npm run gateway:dev  # 起网关打印 port；/health、/v1/models 实测正常
```
