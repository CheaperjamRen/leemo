# 第七批 Batch 0a 简报：conversations 多对话注册表重构

> 唯一规格：`docs/specs/10-前端完整形态设计-v1.0.md` §1.3.0、§1.3.1、§1.4、§四 Batch 0a。
> 执行模型：**Claude Opus 4.8**（动现有绿 store/selector/组件测试的高风险结构重构）。
> 前置：Batch -1 已独立复审 PASS；父工作区基线 **41 files / 298 tests**、三段 typecheck 绿。
> 本卡只做 0a；0b 新 stores、0c 统一订阅、0d fixture 多会话化均不得提前实现。

## Global Constraints

- **严格 TDD**：先写行为测试并保存 RED，再实现；测试必须覆盖真正的 A/B 并发路由，不准只断言字段存在。
- 执行者≠验收者；执行完只交 diff/report，由另一名 Opus 4.8 独立复审。
- `src/renderer/stores/message-model.ts` 与 `applyEvent` 是冻结边界：**零改**。只改变“取哪一个 timeline 数组、传哪一个 renderer-local runId”。
- Batch -1 契约保持：`bridge:event` 唯一信封；Bridge 不产 runId；SDK 仍锁 `0.3.210`。
- 不升级依赖，不改 package/lockfile/tsconfig/vitest，不引路由库/Electron。
- 当前父工作区含已验收但未 commit 的 Batch -1 和用户资产；执行在隔离 worktree，先应用主控提供的 reviewed baseline patch。不得 reset/clean/stash/覆盖父工作区。
- 密钥纪律、Leemo/momo 命名、组件禁直连 BridgeClient 铁律不变。
- 不 commit、不 push。

## 产品语境与本卡边界

- §1.3.1：从单对话顶层 `messages/activeRunId` 升级为 `byId/order/activeId/openTabs/timelines/runIds`。现有 TimelineItem 判别联合已经吸收 runs 职责，**不建 runs store**。
- §1.4：对话 A 后台跑、用户在 B 聊，两边事件必须按 envelope.conversationId 精确折入；activeId 只决定“当前看谁”，不能决定“谁有资格接事件”。
- 旧实现有 store-global `currentRunId`；若简单移除 active-only filter，A 事件会被错配到后来启动的 B run。本卡必须从根上改为 `runIds[conversationId]`。
- 0a 暂保**唯一** direct `client.subscribe("bridge:event")` 以维持 renderer 可运行，但 event→state 迁移必须抽成可单测纯函数；0c 将复用该纯函数并原子迁出订阅、增加 cleanup。不得在 0a 新建 `wireBridgeSubscriptions`，也不得留下两条订阅。
- HistoryDrawer 真数据接线是 S16/Batch 2b；fixture unique id/per-cid timers/interrupt 隔离是 Batch 0d；本卡禁止顺手做。

## 一、精确 store 契约

### 1. 类型

在 `src/renderer/stores/conversations.ts` 导出：

```ts
export interface ConversationMeta {
  id: string;
  title: string;
  titleManuallyUpdated: boolean;
  bookId: string | null;
  source: "buddy" | "workbench";
  providerId: string;
  modelId: string;
  createdAt: number;
  lastActivityAt: number;
  unread: boolean;
}

export interface ConversationsState {
  byId: Record<string, ConversationMeta>;
  order: string[];
  activeId: string | null;
  openTabs: string[];
  timelines: Record<string, TimelineItem[]>;
  runIds: Record<string, string | null>;

  createConversation(opts: { source: "buddy" | "workbench"; bookId?: string | null }): Promise<string>;
  send(conversationId: string, text: string): Promise<void>;
  interrupt(conversationId: string): Promise<void>;
  switchActive(conversationId: string): void;
  openTab(conversationId: string): void;
  closeTab(conversationId: string): void;
  renameTitle(conversationId: string, title: string): void;
  assignToBook(conversationId: string, bookId: string | null): void;
  setModelForConversation(conversationId: string, modelId: string): Promise<void>;
}
```

不得保留旧 `messages`/`activeRunId` 兼容字段或旧参数less action；一次迁完消费者，防双写。

### 2. 初始态

真实空态，不伪造 `conv-1`：

```ts
byId = {}
order = []
activeId = null
openTabs = []
timelines = {}
runIds = {}
```

### 3. 创建对话与 provider/model 批次缝

`createConversation(opts)` 的产品签名不能暴露 provider/model，但 Batch -1 的 IPC 与 ConversationMeta 均需要它们；0b providers/settings 尚未落地。采用**依赖注入的临时 composition seam**，禁止 store import fixture：

```ts
export interface ConversationDefaults {
  providerId: string;
  modelId: string;
}

export interface ConversationsStoreDeps {
  resolveConversationDefaults(): ConversationDefaults;
  now?: () => number; // 默认 Date.now；仅为稳定 TDD/同拍 timestamps
}

createConversationsStore(client, deps)
```

- `resolveConversationDefaults()` 在每次 create 时动态调用，不在工厂创建时缓存，便于 0b 后直接改读 settings/providers 当前值。
- `BridgeProvider` 当前 fixture composition 可从 `FIXTURE_PROVIDERS[0]` 提供默认 id/model；**generic store 不得 import fixtures、不得硬编码 deepseek/conv-1**。
- 0b/0c 集成时只替换 resolver 来源，不改 ConversationsState/action 形状。
- invoke：`bridge:createConversation` request 精确为 `{providerId, modelId, purpose:"main"}`；`bookId/source` 是 renderer metadata，不越界塞进 IPC。
- invoke 成功后才原子注册：meta、空 timeline、null run、order 头部、`activeId=id`。失败时不得残留 phantom state。
- 新 meta：title=`"新对话"`、manual=false、bookId=`opts.bookId ?? null`、source=opts.source、provider/model=resolver 值、createdAt/lastActivityAt=同一个 now、unread=false。
- create 本身不擅自加 `openTabs`；工作台 caller 仍按 S1 走 create→openTab；buddy 允许 activeId 有值而 tabs 为空。

### 4. send / run / order / 标题

`send(conversationId,text)`：

1. 为该次发送生成全局唯一 renderer-local `run-${++runSeq}`（或等价稳定格式）；不使用 SDK session id。
2. 只向 `timelines[conversationId]` 乐观追加用户 text item，runId=本次 id；只写 `runIds[conversationId]`。
3. 若 meta.title 为“新对话”且 `!titleManuallyUpdated`，以本条 text 的前 24 个 Unicode code point（`Array.from(text).slice(0, 24).join("")` 或等价）作为自动标题；手改后永不自动覆盖。
4. 更新该 meta.lastActivityAt，order 以此 conversationId 移到头部（无重复）。
5. invoke `bridge:send` 精确使用显式 conversationId；不得偷读 activeId。
6. 对未注册 conversationId 的 `send`/`interrupt`/`setModelForConversation` 必须 fail-fast reject/throw，且不得 invoke/伪造 timeline；这是内部状态不变量，不做静默 no-op。

### 5. event 纯函数与精确路由

导出一个不读 client、不读 module global 的纯迁移函数（命名可用 `foldConversationEnvelope`）：

```ts
foldConversationEnvelope(state, envelope, now): Partial<ConversationsState>
```

规则：

- 未注册 conversationId：no-op（不能凭未知事件伪造 meta）。
- 注册 cid：先取 `oldRunId=state.runIds[cid]`；调用
  `applyEvent(state.timelines[cid] ?? [], envelope.event, oldRunId)`。
- `run.finished` 的 result 必须仍拿到 oldRunId；折入后才将**该 cid** run 置 null，其它 cid 不动。
- 所有注册对话事件更新其 lastActivityAt 并把 cid 移到 order 头部。
- 非 active cid 的 `run.finished` 将该 meta.unread=true；active cid 不置未读。
- direct subscriber 仅 `store.setState(s => foldConversationEnvelope(s,envelope,now()))`；不得再按 activeId filter。

### 6. metadata / tabs actions

- `switchActive(id)`：仅注册 id 生效；设 activeId=id，清该 meta.unread；不 invoke。
- `openTab(id)`：仅注册 id；已存在 no-op；最多 5 个，满 5 时第六个 no-op（toast 属未来 UI，不耦合 notifications store）。不隐式 switch。
- `closeTab(id)`：
  - 非 active：只移除。
  - active：激活被关闭项的左邻；若它本来是第一个则取移除后的第一个（原右邻）；最后一个关闭后 activeId=null。
- `renameTitle`：更新 title 并置 `titleManuallyUpdated=true`。
- `assignToBook`：只改目标 meta.bookId。
- `setModelForConversation`：先 invoke `{conversationId,modelId}`；成功后只改目标 meta.modelId，失败不乐观篡改。
- `interrupt(conversationId)`：显式 id invoke，不能读 activeId。

## 二、消费者最小迁移

### `BuddyShell.tsx`

只改 selector/callback，不改 JSX 结构/视觉：

- active timeline=`activeId ? timelines[activeId] ?? [] : []`
- active run=`activeId ? runIds[activeId] ?? null : null`
- hasMessages/runningTool 从 active timeline 派生。
- onStop 仅在 activeId 非 null 时 `interrupt(activeId)`。
- onSend：有 activeId 直接 send；无 activeId 时先 `createConversation({source:"buddy"})` 再 send。
- 用 `useRef<Promise<string>|null>`（或等价）共享尚未完成的 first-create promise，防两个快速首次提交创建两个 conversation；settle 后清 ref。

### `Timeline.tsx`

只把两个 selector 改为 active timeline/active run；`groupByRun`、useScrollFollow、TurnBlock JSX 零改。

### `PinnedPlan.tsx`

只扫描 active timeline；null active 返回 undefined；计划卡 JSX/本地展开态零改。

### `BridgeProvider/context.tsx`

只做 factory deps 的 composition 适配：从现有 `FIXTURE_PROVIDERS` 提供动态 defaults resolver。useConversations API 不变；**不在本卡迁订阅/useEffect cleanup**（0c）。

## 三、允许文件

- `src/renderer/stores/conversations.ts`
- `src/renderer/stores/conversations.test.ts`
- `src/renderer/components/BuddyShell.tsx`
- `src/renderer/components/BuddyShell.test.tsx`
- `src/renderer/components/timeline/Timeline.tsx`
- `src/renderer/components/PinnedPlan.tsx`
- `src/renderer/components/PinnedPlan.test.tsx`
- `src/renderer/bridge/context.tsx`（仅 defaults resolver composition）
- `docs/sdd/fe-b0a-conversations-report.md`（新建）

若 typecheck 证明另一个现有 test fake 直接受新 action/state 签名影响，先在 report 列路径与原因，只做最小适配；不得扩业务面。

## 四、禁改清单

- **全部 `src/bridge/**`、`tests/bridge/**`、`docs/specs/09*`**（Batch -1 冻结面从此不再动）
- `src/renderer/stores/message-model.ts` + test
- `src/renderer/bridge/fixture-client.ts` + test、`bridge/fixtures/**`（0d）
- 不新建 `wireBridgeSubscriptions`，不改 subscription ownership/cleanup（0c）
- `HistoryDrawer.tsx`（2b/S16）、InputBox、LiveStatusBar、TurnBlock/ProcessFold/cards/useScrollFollow
- 其它 stores（0b）、notifications/settings 形状、CSS/tokens/视觉文件
- package/lockfile、tsconfig、vitest、smoke、gateway/vendor
- 10号规格、正式台账、根目录规划文件、所有用户未跟踪资产

## 五、严格 TDD 矩阵

### Store（可控 BridgeClient fake，不使用 FixtureBridgeClient 证明并发）

1. 空初态六字段，`activeId=null`，无 conv-1。
2. create request/default resolver/purpose=main；成功原子注册；reject 无 phantom。
3. send 只写目标 timeline/runIds；invoke cid 精确；A/B runId 不同。
4. A send→B send→active B；交错 emit A/B delta：各自 timeline/run 正确，A 不因后台而丢。
5. A `run.finished`：result 仍带 A old runId；只清 A；B 仍 running；A unread=true；switch A 清 unread且零 IPC。
6. auto title 24 字；rename 后后续 send 不覆盖。
7. activity 将 cid move-to-front 且 order 无重复。
8. tabs：dedupe、cap5、关 active 左邻、关首项取右邻、关最后 active null。
9. assign book；setModel invoke/success-only update；interrupt explicit cid；三种异步 action 对 unknown cid fail-fast 且零 invoke。
10. unknown envelope no-op，与“registered background cid 必须更新”分开测试。
11. 纯 fold 函数直接测试，证明无 activeId 路由依赖。

### Components

- Buddy first paint仍显示 greeting。
- 第一次发送证明 create→send 顺序，用户 bubble 与 reply 仍出现。
- 两次快速 first-submit 共享一个 create（若 InputBox busy/draft UI 难以构造，至少对提取的 callback/helper 做确定性测试；不得删并发保护）。
- Timeline null-active 安全；active timeline 切换只渲染目标对话。
- PinnedPlan 通过测试 Seeder 先 create/register 再 emit TodoWrite；不得恢复伪造初始 conv-1。
- 既有 App/InputBox/Timeline/card/message-model 测试全绿且不削弱。

## 六、Steps

1. 在隔离 worktree 对齐 28921be，应用主控提供的 Batch -1 reviewed patch；先跑 298 基线。
2. 写 store 目标行为测试 + 组件 first-boot/selector 测试，保存 RED。
3. 实现类型/initial/create/send/fold/meta/tabs。
4. 迁移 BuddyShell/Timeline/PinnedPlan selectors 与 BridgeProvider deps。
5. 跑定向→全量→三段 typecheck→diff check；核禁改面；写报告。不 commit/push。

## 七、验收命令

```powershell
npm test -- src/renderer/stores/conversations.test.ts src/renderer/components/BuddyShell.test.tsx src/renderer/components/PinnedPlan.test.tsx src/renderer/components/timeline/timeline-groups.test.tsx src/renderer/app/App.test.tsx
npm test
npm run typecheck
git diff --check
git diff --stat
```

最终测试数不得低于 298；message-model test 必须继续绿。

## 八、报告

写 `docs/sdd/fe-b0a-conversations-report.md`：

1. BASE + Batch -1 patch 应用证据 + 改前 298 基线。
2. 旧→新 state/action/selector 对照表。
3. A/B 并发逐拍证据（runId、delta、finish、unread、active B 不乱）。
4. first-boot create→send 与 first-create 去重证据。
5. defaults resolver 临时 seam：为何不硬编码、0b/0c 如何替换。
6. direct subscription 临时边界：0c 必须原子迁出，当前只一条。
7. RED/GREEN 命令与真实输出；全量/typecheck/diff。
8. 实际文件清单与禁改自查；concerns 精确到 file:line。
