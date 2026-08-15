# host-a-report — 卡 A 验收报告

日期：2026-07-24

## 文件清单

新建文件（仅限计划卡 A 清单）：

- `src/host/provider-catalog.ts`
- `src/host/sdk-adapter.ts`
- `src/host/bridge-host.ts`
- `src/host/ws-server.ts`
- `src/host/dev.ts`
- `tests/host/provider-catalog.test.ts`
- `tests/host/sdk-adapter.test.ts`
- `tests/host/bridge-host.test.ts`
- `tests/host/ws-server.test.ts`
- `smoke/host-live.mjs`
- `docs/sdd/host-a-report.md`（本文件）

## 测试数

新增测试：33（host 套件）
全套测试：590（基线 548 + 新增 42，含 renderer 套件）

## 验收命令输出

### npx vitest run tests/host

```
 RUN  v4.1.10 E:/Leemo

 Test Files  4 passed (4)
      Tests  33 passed (33)
   Start at  15:00:59
   Duration  1.05s (transform 254ms, setup 0ms, import 767ms, tests 450ms, environment 1ms)
```

### npm test

```
> leemo@0.0.1 test
> vitest run

 RUN  v4.1.10 E:/Leemo

 Test Files  71 passed (71)
      Tests  590 passed (590)
   Start at  15:01:20
   Duration  12.59s (transform 9.87s, setup 22.19s, import 24.74s, tests 18.44s, environment 70.24s)
```

### npm run typecheck

```
> leemo@0.0.1 typecheck
> tsc -p tsconfig.vendor.json && tsc -p tsconfig.json && tsc -p tsconfig.renderer.json
```

（三段 exit 0，无输出）

### node --check smoke/host-live.mjs

```
（exit 0，无输出）
```

## A3 broker-cid 先后问题：选用方案及理由

**选用方案：可变 extras 容器（lazy back-fill）**

具体做法：`buildQueryFn` 接收一个 `ConversationExtras` 对象引用，其中 `canUseTool` 和 `mcpServers` 字段在构造时先填占位值。`createBridge` → `bridge.createConversation` 执行后拿到 `handle.id`（即 cid），再用真正的 `broker.canUseTool` 和 `askMcp.server` 回填该对象。`queryFn` 在 `send()` 时才被调用，而 `send()` 永远晚于 `createConversation` 返回，因此回填在任何真实调用前已完成，无竞态。

**未选用方案：host 层自生成 cid 映射表**

该方案需要在 host 层维护一个 id→handle 的额外映射，并绕过 pool 内部的 UUID 生成，增加了不必要的间接层和状态。

## 与计划的偏差

无偏差。

所有实现严格按照计划 v2 的签名、文件清单、禁改清单、测试位置（`tests/host/`）、密钥纪律（测试用 `test-key-*`，代码零真 key）、ws 绑 `127.0.0.1`、端口 8787（`LEEMO_BRIDGE_PORT` 可覆盖）执行。

`src/bridge/**` 等禁改文件零改动。
