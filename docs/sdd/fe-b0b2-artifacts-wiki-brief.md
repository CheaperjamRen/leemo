# 第七批 Batch 0b / 卡 B2 简报：artifacts + wiki-entries stores

> 唯一规格：`docs/specs/10-前端完整形态设计-v1.0.md` §1.3.0、§1.3.3、§1.3.5、§1.4、§四 Batch 0b 卡B2。
> 执行模型：**Claude Sonnet 5**（规格写死的纯 TDD store 卡）。
> 前置：Batch -1 + Batch 0a 已独立复审 PASS；父工作区基线 **41 files / 306 tests**、三段 typecheck 绿。
> 本卡只建 artifacts/wiki-entries 数据面与纯函数；订阅装配、React context、可视化/成果卡、三栏壳体均留给 0c/Batch 2/4/6。

## Global Constraints

- 严格 TDD：先写行为测试保存 RED，再最小实现；不能只断言接口存在。
- 执行者≠验收者；隔离 worktree，不 commit/push，不碰父工作区。
- 新 store 不得自行 `client.subscribe`；事件处理必须暴露纯函数/显式 action，供 0c 统一装配。
- 只经 `BridgeClient` invoke；不 import FixtureBridgeClient，不直连 Electron/SDK。
- `src/bridge/**`、`tests/bridge/**`、09 契约、message-model/applyEvent、conversations 及其它 stores 均冻结/禁改；不升级依赖。
- 密钥纪律：所有 fixture/test/report 只使用无密钥示例；不出现 apiKey/secret 明文。
- 不把 wiki 影子对话注册进 `conversations.byId/order/openTabs`；不改 conversations 0a action 形状。

## 一、`artifacts.ts` 目标契约

新建 `src/renderer/stores/artifacts.ts` 与测试。只从 `../../bridge/contract` 和 `./message-model` 导入 key-free type。

```ts
export interface ArtifactEntry {
  id: string; // `${conversationId}:${toolUseId}`，幂等键
  kind: "file" | "visualization";
  path: string; // 相对 ~/Leemo/，或绝对 escaped 路径
  title: string; // 文件名/展示标题，不含路径
  bookId: string | null;
  sourceConversationId: string;
  sourceRunId: string;
  createdAt: number;
  escaped: boolean; // 工作区外绝对路径仍登记，但标记 escaped
}

export interface ArtifactsState {
  entries: ArtifactEntry[]; // 新→旧
}
```

导出纯函数：

```ts
export function deriveArtifact(
  item: Extract<TimelineItem, { kind: "tool" }>,
  ctx: { conversationId: string; runId: string; books: Notebook[]; now: number },
): ArtifactEntry | null;

export function createArtifactsStore(initial?: ArtifactEntry[]): StoreApi<ArtifactsState>;
```

`Notebook` 从 `./notebooks` type-only 引用；B2 不实现 notebooks。若为避免并行编译耦合采用等价结构类型，必须与 §1.3.6 字段一致。

### deriveArtifact 规则

- 只处理**已终态** tool item：`status:"running"` → null；`status:"error"` → null。
- `Write` 工具：从 `item.input` 的 `file_path` 读取路径；缺字段/非 string → null；kind=file。
- 可视化工具：工具名必须使用单点常量 `LEEMO_VISUALIZATION_TOOL_NAME`（名称值按已裁决规格，不得散写多个 alias）；从其 input 中读取落盘路径字段（按现有 fixture/类型实际形状支持 `file_path`/`path`，不能把 HTML 内容当路径）；有效则 kind=visualization。
- `Edit`：从 input `file_path` 读取；若已有同 `(book/path)` 语义条目则返回刷新后的条目，若无则新增；不因为 Edit 无旧条目而丢失成果。
- 相对路径按 `~/Leemo/` 工作区路径解释；若能从 `books` 目录 slug/路径前缀判定本子则填 bookId，否则 null。
- 绝对路径解析在 `~/Leemo/` 外仍返回条目、`escaped:true`、`bookId:null`；工作区内为 `escaped:false`。
- `title` 去掉路径目录，仅保留最后一段；Windows/Unix 分隔符都应测试。空 title/空 path → null。
- 不在纯函数中访问 fs、path 的真实环境、Bridge 或 module state；如需路径归一化写纯 helper。
- 幂等由 store action 保证：同 id 新条目替换原条目并保持新→旧排序，不产生重复；不同 id 同 path 的 Edit/Write 按条目规则更新。
- 输入 item/context 不原地 mutate。

### Artifacts store actions

状态最小化即可，建议导出 `registerArtifact(entry)` 与 `removeArtifact(id)`（如实现选择等价 action，必须保留幂等 upsert 语义）。本卡不接订阅；0c 在 tool 终态折入 timeline 后调用 `deriveArtifact` 并 dispatch。

## 二、`wiki-entries.ts` 目标契约

新建 `src/renderer/stores/wiki-entries.ts` 与测试。Wiki state：

```ts
export interface WikiEntry {
  id: string;
  filePath: string;
  quotedText: string;
  turns: { question: string; answer: string }[];
  createdAt: number;
}

export interface WikiActive {
  entryId: string;
  shadowConversationId: string | null;
  streaming: boolean;
  detailed: boolean;
}

export interface WikiState {
  entries: WikiEntry[];
  active: WikiActive | null;
  openPopup(filePath: string, quotedText: string): void;
  ask(question: string): Promise<void>;
  toggleDetailed(v: boolean): void;
  closePopup(): void;
}
```

工厂可采用：

```ts
interface WikiStoreDeps {
  now?: () => number;
  resolveConversationDefaults: () => { providerId: string; modelId: string };
  onEvent?: (conversationId: string, cb: (event: LeemoEvent) => void) => () => void;
}
createWikiEntriesStore(client: BridgeClient, deps: WikiStoreDeps): StoreApi<WikiState>;
```

若执行者选择把 event 接缝延后为 `applyShadowEvent`/显式 `receiveEvent`，必须报告并保持：B2 不自行 subscribe，0c 可按 shadow cid 路由事件；不得接 conversations store。

### Wiki 行为

- 初态 `entries=[]`, `active=null`。
- `openPopup(filePath, quotedText)`：创建新的 active entry（可用 renderer-local稳定 id），追加/复用同文件+选区的 entry 但不能抹掉既有 turns；active=`{entryId,shadowConversationId:null,streaming:false,detailed:false}`。
- `ask(question)`：无 active 或空白问题 → no-op/reject（写明选择）；首次提问才 invoke `bridge:createConversation`，request 必须 `{providerId,modelId,purpose:"wiki"}`；影子 cid 只保存在 `active.shadowConversationId`，不得出现在 conversations store；随后 `bridge:send({conversationId:shadowCid,prompt:<detailed prefix + question>})`。同一 active 后续提问复用 shadow cid，不重复 create。
- `detailed=false` 的 prompt 前缀为“请简短回答（≤3句）”；`detailed=true` 为“请详细展开”；不要把 secret/配置写入 prompt。
- 发送时 `streaming=true`；暴露纯函数/action（如 `receiveEvent(conversationId,event)`）处理 shadow cid 精确路由：text.delta 聚合为当前 turn answer，text.final 固化，run.finished 置 streaming=false；其它 cid no-op。不能读 conversations activeId。
- 只有回答完成后才将 `{question,answer}` 追加/更新到该 entry turns；多轮同 entry 保留历史。
- `toggleDetailed` 只更新 active，null active no-op。
- `closePopup()`：若 shadow cid 存在，调用 `bridge:disposeConversation({conversationId})`；无影子 cid 不 invoke；随后 active=null，但 entries 留存。dispose reject 不应把 entries 删除，错误如何暴露须在报告记录。
- close 后旧事件不能重建 active/修改 entries；同一 store 后续 open 新 popup 可重新创建影子 cid。
- 所有 action 对输入/既有 state 不原地 mutate。

## 三、允许文件

- `src/renderer/stores/artifacts.ts` / `.test.ts`
- `src/renderer/stores/wiki-entries.ts` / `.test.ts`
- `docs/sdd/fe-b0b2-artifacts-wiki-report.md`

不得改 `notebooks.ts`（B3）、context、fixture、conversations、组件、Bridge 契约或 CSS。

## 四、严格 TDD 矩阵

### artifacts

1. derive running/error/missing-path → null。
2. Write、visualization、Edit 分别得到正确 kind/path/title/bookId/escaped。
3. 工作区外绝对路径仍登记 escaped=true，不误删。
4. Windows/Unix path、空路径、未知本子边界。
5. 同 id upsert 无重复且顺序稳定；输入不 mutate。

### wiki

1. 空态/openPopup/entry 留存。
2. 首问 create purpose=wiki→send 顺序；动态 defaults；只创建一次 shadow cid。
3. 简短/详细前缀；多轮同 entry；答案流式聚合与 finished。
4. shadow cid 精确路由，主对话 cid 事件 no-op。
5. closePopup dispose 精确 cid、entries 留存、重复/无影子不 invoke。
6. failed create/send/dispose 的 promise/error 语义不制造 phantom active/turn（具体选择写报告）。

## 五、执行/验收

先在 clean 28921be worktree 应用 `E:\Leemo\.claude\batch0a-reviewed.patch`，复现 41/306；严格 RED→GREEN。验收：

```powershell
npm test -- src/renderer/stores/artifacts.test.ts src/renderer/stores/wiki-entries.test.ts
npm test -- --run
npm run typecheck
git diff --check
git diff --stat
```

全量不得低于 306；完成后写报告，交另一名 Opus 4.8 复审。
