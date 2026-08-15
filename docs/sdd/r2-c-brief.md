# 启动轮 2 · 卡 C：重启后续聊（执行者：Opus 4.8）

高风险卡：动冻结契约 + SQLite 迁移 + 需实机验收。设计已定，规格写死，**不要重开设计讨论**；但如果实证发现我的假设是错的（Phase 0 精神：实证 > 假设），**停下来报告**，别硬凑。

基线：main @ `3674e8f`，664 测试绿，`npm run typecheck` 三段 exit 0。铁律：host/bridge/store = 严格 TDD。

---

## 病灶
`bridge-host.ts:233` `unknown conversation: <cid>`。

对话 id 由 host 铸造（`pool.ts:96` `readonly id = randomUUID()`），host 的 `conversations` Map 是**纯内存**，随进程死。重启后 renderer 从 SQLite hydrate 出一堆老 cid，host 一个都不认识 → 点历史对话发消息静默失败。

用户体感：重启后点历史对话发不出消息。

## 用户已拍板的修复深度
选项卡问过了，用户选 **「真正续上：持久化 session 并 resume」**。

即：**不是**只让消息发得出去就完事。如果 momo 对着屏幕上那段历史一无所知（你问「刚才那个怎么办」它答非所问），那是把 bug 换了个更隐蔽的形态。要真续上。

好消息：`pool.ts:165` 已经在用 `resume` 了（轮内续话），机制现成。SDK 的 session 落在 `CLAUDE_CONFIG_DIR = <dataDir>/providers/<id>`（`pool.ts:147`），而 `dataDir` 跨重启稳定 —— 所以 session 文件重启后还在，resume 有得可 resume。Phase 0 + G4 已验证 resume 在三方端点可靠。

---

## 交付

### 1. pool.ts —— 让 host 能指定 id 和 resume 起点
`ConversationConfig` 加两个**可选**字段（循 Batch -1「只加可选字段」）：
- `id?: string` → `Conversation.id = cfg.id ?? randomUUID()`
- `resume?: string` → 构造时 `this.sessionId = cfg.resume`，于是第一轮 `buildOptions()` 就带 resume

### 2. session id 回流到 renderer
renderer 得知道 session id 才能存。`session_id` 挂在每条 SDK 消息上，`normalizeSdkStream` 看得见。

在 `run.finished` 事件加**可选** `sessionId?: string`。别新开事件通道 —— 加可选字段比加 channel 便宜，也符合既有纪律。

### 3. 契约（`src/bridge/contract.ts`）
`CreateConversationRequest` 加两个可选字段：
- `conversationId?: string` —— 「认领这个 id，别铸新的」
- `resumeSessionId?: string`

### 4. host（`bridge-host.ts`）
`assemble()` 里 `const cid = r.conversationId ?? handle.id`，Map 用 cid 作键，broker / askMcp / push 全部照旧用 cid（它们本来就吃 cid，不依赖 `handle.id`，改动面很小）。resume 透传给 pool。

### 5. renderer store（`conversations.ts`）
- `ConversationMeta` 加 `sessionId?: string | null`（**可选**，否则一大片测试夹具要改）
- `foldConversationEnvelope` 把 `run.finished` 带回的 sessionId 落进 meta → 现有 persistence sync 检测到 meta 引用变化会自动存，不用另写落盘逻辑
- 加**不持久化**的 `hostLive: Set<string>`：`createConversation` 成功后加入；`hydrate` 出来的一律不在里面
- `send()`：若 `!hostLive.has(cid)`，先用持久化的 `meta.providerId / meta.modelId / meta.sessionId` + 当前 persona 调一次 `bridge:createConversation({ conversationId: cid, resumeSessionId, … })` 认领，再发。cid 保持不变 —— timeline / SQLite 主键全都不动。

### 6. 持久化迁移（`src/main/persistence/schema.ts`）—— 最容易翻车的一步
`conversations` 表加 `session_id TEXT`。

**陷阱**：`SCHEMA` 用的是 `CREATE TABLE IF NOT EXISTS`，对**已存在**的表不会补列。用户机器上 `leemo.db` 已经有数据了，光改 DDL 字符串 = 老库永远缺列 = 线上直接崩。

必须写真迁移：`PRAGMA table_info(conversations)` 查一遍，缺了才 `ALTER TABLE conversations ADD COLUMN session_id TEXT`。测试要**同时覆盖**：全新库、以及「先建旧结构再迁移」的老库。

### 7. resume 失败要降级，不能砸掉聊天
session 文件可能被清掉（主控自己实机验收时就清过一次 `leemo.db`）。规格：

**被认领的对话的第一轮**，若流在**吐出任何事件之前**就抛错，则清掉 sessionId 重试一次（不带 resume）。「吐出任何事件之前」是硬条件 —— 半路失败重试会导致工具重复执行。

降级后照常聊，只是丢了那段上下文。宁可失忆，不可发不出消息。

---

## 禁改清单
- `src/renderer/components/**`、`src/renderer/bridge/tool-names.ts`、`src/host/memory-bank.ts`、`src/main/main.ts` 的记忆库相关函数、`src/host/dev.ts` —— **另一个 agent 正在并行改**（记忆库初始化 + 问询卡）。
- `smoke/`（Phase 0 已验收资产）。
- 不要 `git commit`。改完报告，主控复核后统一提交。

## 验收
```
npx vitest run                 # 664 → 只增不减，全绿
npm run typecheck              # 三段全 exit 0
```
不属于你文件清单的测试失败 = 并行 agent 的半成品，报告即可别修。

**实机验收（这卡的核心，跑不出来就不算完）**，可复用 `scripts/cdp-fix-verify.mjs` 的 CDP 套路另写一个脚本留仓：
1. 起 app，新对话，说一句能验证记忆的话（例如告诉 momo 一个仓库里搜不到的事实）
2. 整个进程重启
3. 点那条历史对话，发消息
4. **消息发得出去**（无 `unknown conversation`）
5. **momo 记得重启前说的那个事实** ← 这条才是本卡的验收核心，只测第 4 条不算过
6. 附截图

## 报告要求
需求覆盖表（每项带可复现证据），外加：迁移在「老库」上实测通过的证据、resume 降级路径的测试怎么构造的、实机第 5 条 momo 复述了什么。
