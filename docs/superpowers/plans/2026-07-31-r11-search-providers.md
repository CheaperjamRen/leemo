# R11 Search Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有免 Key 搜索体验和失败回退语义的前提下，接入豆包搜索、秘塔、Google Custom Search 兼容入口与 arXiv 学术检索，并让设置、加密凭据、诊断和打包验收形成完整用户路径。

**Architecture:** 继续以 `src/host/web-search.ts` 的 `SearchHit/SearchOutcome` 作为通用网页搜索边界，新增独立适配器但不改变模型上下文格式。通用来源进入现有 fallback 链；arXiv 走独立 SDK MCP、typed Bridge 诊断入口和缓存/节流，不伪装成普通网页来源。所有秘密继续只存在于 `ProviderConfigFile` 的 safeStorage 加密件，renderer 只得到已配置状态。

**Tech Stack:** TypeScript 5.9、Electron IPC、Claude Agent SDK 0.3.210、React 19、Zustand 5、Vitest 4、Testing Library、原生 fetch、Atom XML 轻量解析。

## Global Constraints

- 产品规格以 `docs/superpowers/specs/2026-07-31-r11-beta-foundation-design.md` 第三节为准。
- 用户提供的豆包测试 Key 只允许通过本机临时环境或设置页进入 safeStorage，不得写入源码、测试 fixture、日志、截图、facts 或提交。
- Google 只做已有 API Key + CX 用户的兼容入口；UI 必须说明它不是新用户默认来源。
- arXiv 不进入普通网页 fallback；连续请求至少间隔 3 秒，并缓存相同查询，避免浪费公共服务资源。
- 只保留 `title/url/snippet` 进入模型上下文；秘塔的整段生成答案不得伪装成普通搜索命中。
- 联网总开关开启后，已启用的只读 WebSearch/WebFetch 不重复弹出权限卡。
- 不新增 XML、状态管理、表单或请求依赖；Atom 解析只覆盖 arXiv API 稳定字段并用 fixture 钉住。
- 每项行为先写失败测试并确认失败原因正确，再写最小实现；每个任务独立提交，提交前检查 `git diff --check`。

---

## Task 1: 扩展搜索凭据契约和安全持久化

**Files:**

- Modify: `src/bridge/contract.ts`
- Modify: `src/host/provider-config.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/host/web-search.ts`
- Modify: `src/renderer/stores/search-sources.ts`
- Modify: `src/renderer/stores/search-sources.test.ts`
- Modify: `src/renderer/components/SearchSourcesSection.test.tsx`
- Modify: `tests/host/provider-config.test.ts`
- Modify: `tests/host/search-keys.test.ts`
- Modify: `tests/host/search-sources-channel.test.ts`
- Modify: `tests/bridge/contract.test.ts`

**Interfaces:**

- Produces: `SearchSourceId = "anysearch" | "tavily" | "bocha" | "doubao" | "metaso" | "google"`
- Produces: `SearchCredentialDraft { source; apiKey; engineId? }`
- Produces: `ProviderConfigFile.searchKeys.googleCx?: string`

- [x] **Step 1: 写失败测试，固定契约不回传秘密**

  在三组测试中断言六个来源都可列出；Google 保存需要 `apiKey` 与 `engineId`；所有 `SearchSourceStatus` 只有 `configured/configuredFields`，没有 Key、CX 或掩码值。

- [x] **Step 2: 运行测试确认红灯**

  ```powershell
  npx vitest run tests/host/provider-config.test.ts tests/host/bridge-host-providers.test.ts tests/bridge/contract.test.ts
  ```

  Expected: `doubao/metaso/google` 不在 union，Google CX 无法持久化。

- [x] **Step 3: 实现向后兼容凭据结构**

  `ProviderConfigFile.searchKeys` 增加 `doubao/metaso/google/googleCx` 可选字符串；clone、sanitize、merge 和 bootstrap 只接受这些白名单字段。旧 version 1 文件不迁移版本，缺字段即未配置。

- [x] **Step 4: 扩展 Bridge 保存接口**

  将 `bridge:saveSearchKey` 请求替换为 `SearchCredentialDraft`；Google 的空 `apiKey` 与空 `engineId` 同时清除，非空配置必须二者齐全。host 状态文案分别说明默认、备用、兼容和学术来源边界。

- [x] **Step 5: 运行定向测试并检查 diff**

  ```powershell
  npx vitest run tests/host/provider-config.test.ts tests/host/bridge-host-providers.test.ts tests/bridge/contract.test.ts
  git diff --check
  ```

- [x] **Step 6: Commit**

  ```powershell
  git add src/bridge/contract.ts src/host/provider-config.ts src/host/bridge-host.ts tests/host/provider-config.test.ts tests/host/bridge-host-providers.test.ts tests/bridge/contract.test.ts
  git commit -m "feat(r11): persist additional search credentials"
  ```

## Task 2: 实现豆包、秘塔与 Google 通用搜索适配器

**Files:**

- Modify: `src/host/web-search.ts`
- Modify: `tests/host/web-search.test.ts`
- Create: `tests/fixtures/search/metaso-success.json`
- Create: `tests/fixtures/search/google-success.json`
- Create: `tests/fixtures/search/doubao-success.json`

**Interfaces:**

- Consumes: Task 1 `ProviderConfigFile.searchKeys`
- Produces: `searchDoubao/searchMetaso/searchGoogle(query, opts): Promise<SearchHit[]>`
- Produces: extended `SearchSourceKeys`

- [x] **Step 1: 用官方响应形状写三个失败 fixture 测试**

  豆包固定 `POST https://open.feedcoopapi.com/search_api/web_search`、`Authorization: Bearer`、请求体 `{ Query, SearchType: "web", Count: 8, Filter: { NeedContent: true, NeedUrl: true } }`，只映射 `Result.WebResults[].Title/Url/Snippet`；顶层 `ResponseMetadata.Error` 必须判为失败。秘塔固定 `POST https://metaso.cn/api/open/search/v2`、Bearer 认证、`stream:false`，只从 `data.references` 产生命中；Google 固定 `GET https://customsearch.googleapis.com/customsearch/v1?key=...&cx=...&q=...`，映射 `items[].title/link/snippet`。

- [x] **Step 2: 写错误测试**

  覆盖 401/403、429、业务错误码、损坏 JSON、零引用、缺标题/URL 和超时；错误文本只能含来源与状态码，不能含 key、请求完整 URL 或上游正文。

- [x] **Step 3: 运行测试确认红灯**

  ```powershell
  npx vitest run tests/host/web-search.test.ts
  ```

- [x] **Step 4: 实现三个适配器并复用统一裁剪**

  保持 `MAX_HITS = 8`；新增 `classifySearchHttpError(source, status)` 返回 `认证失败/额度不足/服务暂不可用` 的内部诊断；`SearchHit` 仍只有三字段。

- [x] **Step 5: 接入 fallback 链**

  顺序固定为 `anysearch -> doubao -> metaso -> tavily -> bocha -> google`，只添加已完整配置的来源。Google 始终最后，避免把将停用的兼容 API 变成默认依赖。

- [x] **Step 6: 运行定向测试并检查 diff**

  ```powershell
  npx vitest run tests/host/web-search.test.ts
  git diff --check
  ```

- [x] **Step 7: Commit**

  ```powershell
  git add src/host/web-search.ts tests/host/web-search.test.ts tests/fixtures/search
  git commit -m "feat(r11): add Chinese and Google search adapters"
  ```

## Task 3: 建立独立 arXiv 学术检索

**Files:**

- Create: `src/host/arxiv-search.ts`
- Create: `src/bridge/academic-search-mcp.ts`
- Create: `tests/host/arxiv-search.test.ts`
- Create: `tests/host/academic-search-channel.test.ts`
- Create: `tests/bridge/academic-search-mcp.test.ts`
- Create: `tests/fixtures/search/arxiv-success.xml`
- Modify: `src/bridge/contract.ts`
- Modify: `src/host/bridge-host.ts`
- Modify: `src/host/momo-prompt.ts`
- Modify: `tests/host/bridge-host.test.ts`
- Modify: `tests/host/momo-prompt.test.ts`

**Interfaces:**

- Produces: `AcademicPaper { id; title; url; abstract; authors; publishedAt; updatedAt; categories; pdfUrl }`
- Produces: `searchArxiv(query, { fetchFn, now, cache, minIntervalMs }): Promise<AcademicSearchOutcome>`
- Produces: built-in `leemo-academic-search` SDK MCP for momo to call
- Produces: typed `bridge:searchAcademic` invoke for direct UI/diagnostic use

- [x] **Step 1: 写 Atom fixture 的失败解析测试**

  覆盖命名空间、多个作者、摘要空白归一化、HTML 实体、PDF link、分类、日期和缺失可选字段；禁止用正则解析整个 XML 文档。

- [x] **Step 2: 写节流与缓存失败测试**

  相同标准化查询在 10 分钟内命中缓存且不 fetch；不同查询在 3 秒内排队而不是并发轰击；失败不写缓存；最多返回 8 篇。

- [x] **Step 3: 运行测试确认红灯**

  ```powershell
  npx vitest run tests/host/arxiv-search.test.ts
  ```

- [x] **Step 4: 实现轻量 Atom 解析、缓存和节流**

  请求使用 `https://export.arxiv.org/api/query`，参数为 `search_query=all:<query>&start=0&max_results=8&sortBy=relevance&sortOrder=descending`。XML 解析器只实现元素栈、文本和属性，拒绝 DTD/ENTITY，避免 XXE。

- [x] **Step 5: 接到模型工具、host 与 momo 能力说明**

  `createAcademicSearchMcp` 提供模型可调用的 `academic_search`，并在联网总开关开启时与 `leemo-web-search` 一起注册；typed Bridge 只用于直接 UI/诊断。momo prompt 说明“论文问题优先使用学术检索”，不把 arXiv 混成 WebSearch fallback。错误时明确可改用普通联网搜索。

- [x] **Step 6: 运行定向测试并检查 diff**

  ```powershell
  npx vitest run tests/host/arxiv-search.test.ts tests/bridge/academic-search-mcp.test.ts tests/host/bridge-host.test.ts tests/host/momo-prompt.test.ts
  git diff --check
  ```

- [x] **Step 7: Commit**

  ```powershell
  git add src/host/arxiv-search.ts src/bridge/academic-search-mcp.ts src/bridge/contract.ts src/host/bridge-host.ts src/host/momo-prompt.ts tests/host/arxiv-search.test.ts tests/bridge/academic-search-mcp.test.ts tests/host/bridge-host.test.ts tests/host/momo-prompt.test.ts tests/fixtures/search/arxiv-success.xml
  git commit -m "feat(r11): add governed arxiv search"
  ```

## Task 4: 重做搜索来源设置的完整配置旅程

**Files:**

- Modify: `src/renderer/stores/search-sources.ts`
- Modify: `src/renderer/stores/search-sources.test.ts`
- Modify: `src/renderer/components/SearchSourcesSection.tsx`
- Modify: `src/renderer/components/SearchSourcesSection.test.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/pages/SettingsPage.test.tsx`

**Interfaces:**

- Consumes: Task 1 `SearchSourceStatus` and `SearchCredentialDraft`
- Produces: source cards with per-source credential fields and truthful state

- [x] **Step 1: 写六来源 UI 失败测试**

  断言来源按“默认/中文增强/兼容”分组；豆包和秘塔单 Key；Google 同屏填写 Key 与搜索引擎 ID；AnySearch 不显示未配置警告；每张卡有适用场景、状态和清除动作。

- [x] **Step 2: 写安全与恢复测试**

  所有秘密输入为 password；保存成功清空草稿；保存失败保留草稿；host 永不回填；Google 缺任一字段时前端给人话错误且不发 IPC；清除需要一次轻确认但不要求输入旧值。

- [x] **Step 3: 运行测试确认红灯**

  ```powershell
  npx vitest run src/renderer/stores/search-sources.test.ts src/renderer/components/SearchSourcesSection.test.tsx src/renderer/pages/SettingsPage.test.tsx
  ```

- [x] **Step 4: 实现紧凑来源卡片**

  不做嵌套卡片；使用分组行和就地凭据区。Google 文案明确“仅兼容已有 Google Custom Search 凭据”；arXiv 显示“免配置，论文检索时自动使用”，不提供 Key 输入。

- [x] **Step 5: 运行定向测试、typecheck 和 renderer build**

  ```powershell
  npx vitest run src/renderer/stores/search-sources.test.ts src/renderer/components/SearchSourcesSection.test.tsx src/renderer/pages/SettingsPage.test.tsx
  npm run typecheck
  npm run build
  git diff --check
  ```

- [x] **Step 6: Commit**

  ```powershell
  git add src/renderer/stores/search-sources.ts src/renderer/stores/search-sources.test.ts src/renderer/components/SearchSourcesSection.tsx src/renderer/components/SearchSourcesSection.test.tsx src/renderer/pages/SettingsPage.tsx src/renderer/pages/SettingsPage.test.tsx
  git commit -m "feat(r11): expose truthful search source setup"
  ```

## Task 5: 真实来源探针与打包态验收

**Files:**

- Create: `scripts/probe-search-providers.mjs`
- Create: `scripts/cdp-search-r11-verify.mjs`
- Create: `docs/research/2026-07-31-r11-search-verification.md`
- Modify: `docs/sdd/r7-requirements-ledger.md`

**Interfaces:**

- Consumes: Tasks 1-4 complete release build
- Produces: redacted probe facts and packaged user-path evidence

- [x] **Step 1: 写不会泄密的 provider 探针**

  从进程环境读取临时 Key；输出只含来源、状态、命中数、耗时和错误分类。脚本启动时扫描自身输出对象，拒绝包含任何输入 Key 子串。

- [x] **Step 2: 对免 Key arXiv 和临时配置来源做真实只读探针**

  豆包只使用用户提供的测试 Key，秘塔/Google 没有凭据时记录 `not_configured`，不伪造通过。每家各一个中文时效查询或论文查询，不执行批量请求。

- [x] **Step 3: 在隔离打包应用中走设置和搜索用户路径**

  覆盖配置、搜索成功、错误恢复、关闭重启后仍已配置且 Key 不回显；关闭联网后模型结构性无 WebSearch，重新开启后下一轮恢复且不重复索权。

- [x] **Step 4: 四视口和性能回归**

  检查搜索设置和长对话输入区在 `1440x900 / 1280x720 / 1024x768 / 720x640` 无横向溢出；记录安装器、解包文件数、冷启动、空闲内存和 renderer chunk，与 r10 同口径比较。

- [x] **Step 5: 全量验证**

  ```powershell
  npm test
  npm run typecheck
  npm run build
  npm run build:main
  npm run electron:pack
  node scripts/probe-search-providers.mjs
  node scripts/cdp-search-r11-verify.mjs
  git diff --check
  ```

- [x] **Step 6: 更新证据与 Commit**

  ```powershell
  git add scripts/probe-search-providers.mjs scripts/cdp-search-r11-verify.mjs docs/research/2026-07-31-r11-search-verification.md docs/sdd/r7-requirements-ledger.md
  git commit -m "test(r11): verify search providers in packaged app"
  ```
