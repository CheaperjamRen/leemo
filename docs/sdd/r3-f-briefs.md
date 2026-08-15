# 轮 3 卡 F 任务卡留仓（F1/F2/F3 可原样重派）

> 循 `r2-bd-brief.md` / `r2-c-brief.md` 先例留仓。**探针数据/预置表/错误分类实测依据不在这里，在 `progress.md` 的「轮 3 卡 F」条**——重派时让执行者两份都读。
> 契约（`src/bridge/contract.ts`）已由主控写完并 typecheck 通过，三卡对着它编程，**均禁改契约**。
> 共同纪律：严格 TDD；**不要 git commit**（主控统一提交）；测试放**顶层 `tests/`**（`tests/host/`、`tests/main/`），渲染层测试就地放 `src/renderer/` 旁。
> ⚠️ 派卡时主控把测试路径写成了 `src/tests/...`（**错**）：`vitest.config.ts` 的 node project `include` 是 `tests/**/*.test.ts`，落在 `src/tests/` 的测试**永远不会被执行**（写了也是死的）。F1 已按真实路径纠正。
> ⚠️ 改 `BRIDGE_CHANNELS` 必须同步 `tests/bridge/contract.test.ts` 里手写的 channel 运行时镜像集合，否则 XOR 断言必挂。

## 共同前置概念

- **`id` = 实例 id，`kind` = 家族**。用户会有几十个 provider，同家族可多实例（两个 DeepSeek 账号、三个中转站）。不许假设一家族一实例，不许拿 kind 当列表 key。四家预置 id 固定等于 kind（`deepseek`/`glm`/`kimi`/`qwen`），保证已存在对话/usage 行仍解析；自定义实例铸造新 id。
- **key 方向**：可 renderer→main（用户表单里敲的，没别的入口），**绝不 main→renderer**。`ProviderConfigView` 只回 `hasApiKey` + 掩码尾巴；`ProviderSpec` 无 key 字段；编辑态「留空=不改」。
- `configured:false` 的家 `apiKey` 恒 `""`；建对话必须拦下给人话错误（**主控自留**，不在三卡内）。

## 卡 F1（Opus，高风险：动加密件迁移）— host 配置数据层

**状态（上一窗口结束时）**：已写 `tests/host/provider-config.test.ts`(221 行) + `tests/host/provider-catalog.test.ts`，**实现文件尚未落盘**（TDD RED 阶段）。重派时先看这两个测试文件，能用就接着做 GREEN。

**新建 `src/host/provider-config.ts`**（fs/加密全依赖注入，照 `src/main/secrets.ts` 风格）。必须导出：
```ts
export interface StoredProvider {
  kind: string; name: string; baseUrl: string;
  apiFormat: "anthropic" | "openai";
  category: "cn_official" | "official" | "custom";
  apiKey?: string; models?: string[];
  modelCapabilities?: Record<string, { thinking: boolean; vision: boolean }>;
  headers?: Record<string, string>;
  envTemplate?: Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
  modelsUrl?: string; apiKeyUrl?: string;
}
export interface ProviderConfigFile { version: 1; providers: Record<string, StoredProvider> }
export function emptyConfig(): ProviderConfigFile;
export function upsertProvider(config, draft: ProviderDraft, mintId: () => string): { config; id: string };
export function removeProvider(config, id: string): ProviderConfigFile;
export function migrateLegacyConfig(raw: unknown, env: Record<string,string|undefined>): ProviderConfigFile;
```
- `upsertProvider`：无 `draft.id`=新建（`mintId()`）；有=更新。**`apiKey` 省略必须保留已存 key**（「留空即不改」）；传 `""` 才是显式清空。纯函数不改入参。
- `migrateLegacyConfig`：吃旧加密件形状 `{DEEPSEEK_API_KEY?,DEEPSEEK_MODEL?}` 或新形状，输出新形状。**不可逆迁移点，用户 key 在里面**。必测：旧形状→deepseek 实例（model 进 models[0]）、新形状→原样、垃圾/null→`emptyConfig()` 不抛。env 各家 key（DEEPSEEK/GLM/KIMI/DASHSCOPE_API_KEY）在对应实例缺失时补进来。

**改 `src/host/provider-catalog.ts`**：
```ts
export function buildCatalog(env, config?: ProviderConfigFile): CatalogEntry[];
export const PRESET_PROVIDERS: readonly PresetProvider[];
```
- **恒返回 4 家预置**（哪怕没 key）+ config 里的自定义实例。**废除「没 key 就返回 []」**。
- `spec.configured = apiKey 非空`；key 优先级 **config > env**。未配置的家 `apiKey=""`（**绝不给假 key**）。
- `models`：config 优先，否则预置精选表；env `<KIND>_MODEL` 有值则置顶 models[0]。
- 每家显式带 `modelsUrl`（`CatalogEntry` 加可选字段）。**预置表见 progress.md 台账的四家表格，原样抄，不许自己改模型名。**
- qwen 支持 `QWEN_BASE_URL` 覆盖 baseUrl，**覆盖时 modelsUrl 要跟着换成同 host 的 `/compatible-mode/v1/models`**。

**改 `src/main/secrets.ts`**：`SecretsValue` 现硬编码只有 DeepSeek 两个字段，四家装不进。改为承载 `ProviderConfigFile`；保留 4 个 source 语义与「绝不落盘明文」；新增 `saveSecrets(deps, config)` 供 saveProvider 用，**加密不可用时必须失败并让调用方知道**（不能静默丢用户刚配的 key）；**必须能读旧加密件**。现有 `tests/main/secrets*.test.ts` 可因签名调整，但**不许削弱「不落明文」「能读旧件」断言**。

**改 `src/main/main.ts` + `src/host/dev.ts`**：接新签名（现在传 `{DEEPSEEK_API_KEY,DEEPSEEK_MODEL}`，改传完整 env + config）；`No providers configured` 日志改成「N 家已配置 / M 家待配置」，别再暗示只有 DeepSeek。

**禁改**：`contract.ts`、`bridge-host.ts`（主控接线）、`pool.ts`、`interact.ts`、`balance.ts`、`smoke/**`、`src/renderer/**`、F2 的三个文件。

## 卡 F2（Sonnet，规格写死）— 错误人话化 / 连通测试 / 模型拉取

**零真实网络**（fetch 全注入）。参考 `src/bridge/balance.ts` 纪律：注入 fetchFn、redact apiKey、**永不抛异常只返回结构化结果**。

**新建 `src/host/provider-errors.ts`**：
```ts
export function classifyProviderError(input: {
  httpStatus?: number; body?: unknown; rawText?: string; thrown?: unknown; apiKey?: string;
}): ProviderError;
```
`message` 中文面向用户，`detail` 脱敏上游原文。**两者都绝不含 apiKey，要有断言。** 分类依据=台账「硬发现 3」的四家真实 body 原文（**当 fixture 用，别自己编形状**）：三种 key 错 body 形状、403 跨厂商冲突（dashscope=auth / GLM=permission）、GLM 方括号业务码 `[1211]/[1220]/[1305]`、模型不存在状态码三家不同（kimi 404 / GLM 400 / deepseek 400）。`thrown` 是 Abort/Timeout→`timeout`，其他 throw→`network`；5xx→`server`（529→`overloaded`）；429→`rate_limit`；认不出→`unknown` + 通用人话 + **detail 不许丢信息**。每个 kind 都要测。

**新建 `src/host/provider-test.ts`**：
```ts
export function testProviderConnection(
  target: { baseUrl; apiKey; modelId; apiFormat; headers? },
  deps: { fetchFn: typeof fetch; now?: () => number },
  opts?: { probeVision?: boolean }
): Promise<ConnectionTestResult>;
```
- 文本探针 POST `<baseUrl>/v1/messages`，量 `latencyMs`（用注入 `now` 才能确定性断言）；回填 `modelEcho`（响应 `model` 字段，**能抓上游偷换模型**）、`thinking`（有无 thinking 块）。
- `probeVision` 再发一个带 image block 的请求。**HTTP 200 不等于支持视觉**——DeepSeek 收下 image、返回 200、然后回「I cannot see your image」。**判定必须看回复正文是否真描述了图**。测试图用 32×32 红蓝棋盘（1×1 会被 qwen 以 `height:1 or width:1 must be larger than 10` 拒、被 kimi 以 `failed to decode image` 拒，**都不是能力问题**）。
- `vision` **三态**：不探针=`undefined`，探过不支持=`false`。**别压成一个值**，UI 要分开显示。
- `apiFormat==="openai"`：打 `<baseUrl>/chat/completions`，判据 `choices[0]`（中转站常见）。

**新建 `src/host/provider-models.ts`**：
```ts
export function listProviderModels(target: { modelsUrl; apiKey; headers? }, deps: { fetchFn }): Promise<ListRemoteModelsResult>;
export function normalizeModelList(raw: unknown): RemoteModel[];
```
- 四家发现端点两种响应形状，**`data[].id` 共通**，一个解析器吃两种。
- `normalizeModelList`：**过滤非对话模型**（qwen 那个端点返回 231 个，混 embedding/audio/asr/tts/speech/ocr/image/wan/realtime/livetranslate/rerank/video）。**保守剔除，宁可留错也别剔掉能聊天的**，规则要可测。**日期快照折叠**：`qwen3.7-flash-2026-07-15` → `snapshotOf: "qwen3.7-flash"`（前提是无日期的 id 也在列表里），正则认 `-\d{4}-\d{2}-\d{2}$` 与 `-\d{8}$`，**只标记不删**。去重 + 稳定排序。
- 空/非 JSON/404（qwen anthropic base 打 `/v1/models` 回 `{"code":"InvalidParameter","message":"Not support"}`）→ 经 `classifyProviderError` 返回 `{models:[], error}`，**不抛**。

**禁改**：除自己 3 个实现 + 3 个测试外一律不碰。主控负责接线，**执行者不接线**。

## 卡 F3（Sonnet）— 渲染层

**用户对这个界面的原话（需求本体，逐条满足）**：
> 在设置界面里面肯定是把所有的 provider 都列出来，没配置就没配置，反正分两栏，一栏是已经配置了的，可以具体配置在对话里面可选哪些模型，没配置的加一个"配置新模型"入口，然后里面是预置的 providers，可以便捷配置，选 provider、填 apikey、选兼容格式、拉取模型列表选可用模型/直接手敲可用模型名字、测试连接（测试多模态能力和连接稳定性/ping 等）等等，参照 newmax 的来，以及其它成熟 agent 的做法，反正从用户视角去考虑，如何保留最全的信息和入口，以及不会违背用户做决定与选择的逻辑等。然后对话界面输入框的模型选择列表，只列出设置页里已配置的模型可供选择，其它没配置的不用弹出来碍眼。

**改 `src/renderer/stores/providers.ts`**：现有 `refresh()` 里 `configuredIds: list.map(p=>p.id)` **已经错了**（catalog 现在含未配置的家），改按 `spec.configured===true` 过滤。新增：`configured`/`unconfigured` 派生、`tests: Record<id, ConnectionTestResult|{pending:true}>`、`remoteModels: Record<id, {models}|{pending:true}|{error}>`、动作 `getConfig`/`saveProvider`/`deleteProvider`/`testConnection`/`listRemoteModels`。`saveProvider` 成功后 `refresh()` 使界面立即反映。保持 `safeError` 纪律（**store 绝不存 key**）。未保存 draft 的测试结果 key 用 `"__draft__"`。

**改 `src/renderer/pages/SettingsPage.tsx`**：Provider 段放「默认模型」段之前，两栏。已配置栏：name+kind+baseUrl+已启用模型数+余额（有 `balanceApi` 时复用 `fetchBalance`），行内操作=编辑/测试连接（显示 latency+thinking+**vision 三态**+人话错误）/删除（**二次确认**）/勾选「对话里可选哪些模型」（写回 `saveProvider` 的 `models`）。未配置栏：预置家族卡片 + 「配置新模型」入口。

**新建 `src/renderer/components/ProviderConfigForm.tsx`**：选 provider（预置下拉 or 自定义）、name、baseUrl、**兼容格式选择**（anthropic 直连 / openai 走网关）、apiKey（`type="password"`；编辑态显示 `apiKeyMasked` 且**留空=不改**，要测）、自定义 headers 键值对增删、模型区=「拉取模型列表」多选 **+ 手敲模型名输入框**（**两条路都要**，用户明确要求）、每模型 thinking/vision 可手动勾（**探针测不出的用户自己标**）、「测试连接」（含 `probeVision` 复选）、保存。**拉取失败/未配 key 时不许卡死表单**，手敲那条路必须始终可用。`snapshotOf` 有值的默认折叠在主条目下可展开，**别丢弃**。

**改 `src/renderer/components/InputArea.tsx`**：第 339-343 行 `模型选择面板（占位）` 换真面板——**只列已配置实例的已启用模型**，按实例分组 + thinking/vision 小标记；选中调 `conversations` store 现有 `setModelForConversation`（`stores/conversations.ts:320`）；第 323 行写死的 `🧠 默认模型` 换成当前对话真实模型名；**一个模型都没配置时给「去设置页配置」引导，不要空面板**。其余 props/职责别乱改。

**测试**（RTL）：store 全部新动作、「留空即不改 key」、手敲模型名、测试连接三态（**vision `undefined` vs `false` 必须显示不同**）、InputArea **断言未配置家的模型名不出现在 DOM**、空态引导、删除二次确认。

**两个陷阱**：① 本仓库**无 `@theme` 块**，`text-ink-2`/`border-line-2`/`bg-card` 裸色名**静默不生成 CSS**，新增标记一律 `text-[var(--leemo-ink-2)]` 方括号写法；SettingsPage 已有旧类名**不要批量重写**（另开卡）。② 视觉档用户统一目验，不追求像素级，但要能用、信息完整。

**禁改**：`contract.ts`、`src/host/**`、`src/main/**`、`src/bridge/**`、`smoke/**`、`stores/conversations.ts`（只调不改）。
