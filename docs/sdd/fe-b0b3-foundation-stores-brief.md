# 第七批 Batch 0b / 卡 B3 简报：notebooks + providers + settings/ui/notifications

> 唯一规格：`docs/specs/10-前端完整形态设计-v1.0.md` §1.3.0、§1.3.6–§1.3.10、§1.7、§四 Batch 0b 卡B3。
> 执行模型：**Claude Sonnet 5**（规格写死的纯 TDD store 卡）。
> 前置：Batch -1 + Batch 0a 已独立复审 PASS；父工作区基线 **41 files / 306 tests**、三段 typecheck 绿。
> 本卡只做 store 类型、内存 fixture 初值和纯 action；不做页面/组件/CSS、统一订阅或 fixture client 扩展。

## Global Constraints

- 严格 TDD：行为测试先行，保存 RED；不得只做字段空壳。
- 执行者≠验收者；隔离 worktree，不 commit/push，保护父工作区所有既有脏项。
- 新 store 不得自行 `client.subscribe`；若 action 需 Bridge invoke，只通过注入 client/deps。
- 所有 provider/settings store 字段必须 key-free；只存 `configured:boolean`、providerId、模型名等事实，绝不出现 apiKey/token/secret。
- 能力分支必须读 `ProviderSpec.capabilities` / `kind`，不得 `id==='deepseek'` 之类硬编码判断。
- 不改 Bridge 契约/实现、message-model/conversations、fixture-client、组件、CSS、package/lockfile/tsconfig/vitest/smoke/gateway/vendor。

## 一、`notebooks.ts`

新建 `src/renderer/stores/notebooks.ts` 与测试：

```ts
export interface Notebook {
  id: string;
  title: string;
  color: "blue" | "green" | "red";
  isSample: boolean;
}
export interface NotebooksState {
  list: Notebook[];
  createNotebook(title: string): Promise<string>;
}
createNotebooksStore(client?: BridgeClient, initial?: Notebook[]): StoreApi<NotebooksState>;
```

- 默认 fixture 初值可为空或 brief 明确的 sample，但必须不写密钥；若提供 sample，`isSample:true` 可删除。
- `createNotebook` trim 空白，空标题不得 invoke/创建；有效标题生成稳定 renderer-local id，按创建顺序 blue→green→red 循环；若无 workspace IPC 契约，使用内存 action 并在报告注明 Phase-1 `workspace:*` 留口，不伪造新 Bridge channel。
- create 失败/非法输入不留 phantom；列表新→旧或旧→新择一但测试钉死。

## 二、`providers.ts`

新建 `src/renderer/stores/providers.ts` 与测试：

```ts
export interface ProvidersState {
  list: ProviderSpec[];
  status: "loading" | "ready" | "error";
  error?: string;
  configuredIds: string[];
  balances: Record<string, { info: BalanceInfo; fetchedAt: number } | { error: string }>;
  refresh(): Promise<void>;
  fetchBalance(providerId: string): Promise<void>;
}
createProvidersStore(client: BridgeClient, initial?: { list?: ProviderSpec[]; configuredIds?: string[] }): StoreApi<ProvidersState>;
```

- 初态如无 initial：`list=[]`, `status:"loading"` 或经明确初始化为 ready，选择必须写测试/报告；`configuredIds=[]`, balances={}。
- `refresh()` 调 `bridge:listProviders`，成功原子替换 list/status ready/清 error；失败 status error、保留旧 list、reject 或安全捕获但须钉死。
- `fetchBalance(providerId)`：未知 provider 或 `capabilities.balanceApi !== true` 时不得 invoke，状态如何记录须明确测试；支持 provider 调 `bridge:fetchBalance({providerId})`，成功保存 `{info,fetchedAt}`；失败保存不含 secret 的 `{error}`，不得把错误中的 key 写入 state。
- 不能从 renderer 获取/缓存 key；`ProviderSpec` 只使用 contract key-free projection；余额 eligibility 不靠 provider id。

## 三、`settings.ts` 扩展

在现有 `src/renderer/stores/settings.ts` 扩展，保留 `mode`, `persona`, `buildGreeting` 和既有消费者兼容；补齐：

```ts
export interface PersonaCard { id:string; name:string; tagline:string; promptText:string; builtin:boolean }
// state additions:
personaCardId: string;
personaCards: PersonaCard[];
talkStyle: 1 | 2 | 3;
defaultProviderId: string | null;
defaultModelId: string | null;
permissionMode: PermissionMode;
dangerousCommandCaching: boolean;
anySearchEnabled: boolean;
searchKeySources: { kind:string; configured:boolean }[];
rememberMode: boolean;
dataDir: string;
```

- 初值：`persona:"momo"`、默认 persona card/3 档 talk style、`permissionMode:"acceptEdits"`、`dangerousCommandCaching:false`、`rememberMode:true`；default provider/model 可为 null，dataDir 只读展示字符串。
- action 采用显式 `setMode`, `setPersonaCard`, `setTalkStyle`, `setDefaultModel`, `setPermissionMode`, `setDangerousCommandCaching`, `setSearchEnabled`, `setRememberMode` 等，命名可等价但必须可测试且不 mutate。
- `bypassPermissions` 只能作为显式设值可选项，不得因默认值/fixture 自动开启；key 输入只允许未来一次性 invoke，本卡不新增 key 字段/输入 action。
- 现有 `createSettingsStore()` call sites 若需参数，最小兼容适配；不要改 context composition（0c/后续集成另卡）。

## 四、`ui.ts`

新建 `src/renderer/stores/ui.ts` 与测试：

```ts
export interface UiState {
  view:"chat"|"skills"|"artifacts";
  settingsOpen:boolean;
  settingsSection:"models"|"momo"|"web"|"permissions"|"usage"|"extensions"|"general";
  searchOpen:boolean;
  notifPanelOpen:boolean;
  wizardOpen:boolean;
  previewOpen:boolean;
  previewWidthPx:number;
  previewTabs:{path:string;title:string;kind:"markdown"|"pdf"|"html"|"other"}[];
  previewActivePath:string|null;
  filesOpen:boolean;
  sidebarCollapsed:boolean;
}
```

导出 action：`setView`, `openSettings(section?)`, `closeSettings`, `toggleSearch`, `toggleNotifPanel`, `openPreview(path,title,kind)`, `closePreview`, `setPreviewWidth(px)`（最小 300，非法值 clamp/reject 但不存 <300）、`toggleFiles`, `toggleSidebar`, `openWizard/closeWizard`；preview 同 path 幂等激活并不重复加 tab，输入不 mutate。

## 五、`notifications.ts` 扩展

在现有文件扩展 `NotificationItem` 与 `NotificationsState`，保留已有 `createNotificationsStore(items)` 用法：

```ts
export interface NotificationItem {
  id:string; text:string; read:boolean; createdAt:number;
  kind:"task-done"|"approval-needed"|"compact"|"generic";
  conversationId?:string;
}
export interface NotificationsState {
  items: NotificationItem[]; unreadCount:number; toasts:NotificationItem[];
  push(n: Omit<NotificationItem,"id"|"read"|"createdAt">):void;
  markAllRead():void;
  dismissToast(id:string):void;
}
```

- 初始旧 items 缺 `createdAt/kind` 时用无密钥稳定默认值最小适配；不得改变已有 unreadCount 语义。
- `push` 生成 renderer-local id、createdAt，插入 items/toasts 头部，unreadCount +1；不创建真实 timer（UI timer 留组件/0c）。
- `markAllRead` 将 items 全部 read 并 unreadCount=0；toasts 可保留或清空但测试钉死。
- `dismissToast(id)` 只删 toasts，不影响 history/read 计数；unknown no-op。
- reducer/action 不 mutate 外部 item 数组。

## 六、允许文件

- `src/renderer/stores/notebooks.ts/.test.ts`
- `src/renderer/stores/providers.ts/.test.ts`
- `src/renderer/stores/settings.ts/.test.ts`
- `src/renderer/stores/ui.ts/.test.ts`
- `src/renderer/stores/notifications.ts/.test.ts`
- `docs/sdd/fe-b0b3-foundation-stores-report.md`

不得改 context.tsx、fixture、conversations、其它组件或 Bridge。

## 七、严格 TDD 矩阵

1. notebooks：初态、空标题、颜色循环、唯一 id、非变异。
2. providers：refresh success/failure 保留旧值；能力 flag 控制 balance invoke；成功/失败状态；无 key 落 state。
3. settings：旧 greeting/消费者仍绿；新增默认安全值；每个 setter 成功更新、非法值不破坏、key-free。
4. ui：默认值、settings section、preview tab dedupe/激活、宽度≥300、toggle actions。
5. notifications：旧初值兼容、push/read/toast/dismiss/unreadCount 精确、unknown no-op、非变异。
6. 所有 store 不自行 subscribe，所有测试不使用真实网络/密钥。

## 八、执行/验收

先在 clean 28921be worktree 应用 `E:\Leemo\.claude\batch0a-reviewed.patch`，复现 41/306；严格 RED→GREEN：

```powershell
npm test -- src/renderer/stores/notebooks.test.ts src/renderer/stores/providers.test.ts src/renderer/stores/settings.test.ts src/renderer/stores/ui.test.ts src/renderer/stores/notifications.test.ts
npm test -- --run
npm run typecheck
git diff --check
git diff --stat
```

全量不得低于 306；完成后交独立 Opus 4.8 复审。
