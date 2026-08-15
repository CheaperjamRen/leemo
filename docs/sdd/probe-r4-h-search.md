# 轮 4 卡 H 探针台账：联网搜索源

先探针再实现（循卡 E/F/G 先例）。所有数字都是本机实测，脚本在 `scripts/probe-*.mjs`，可自己复跑。

## 结论先行

**AnySearch 免 key 可用，06 §四 的默认源前提成立。** 但必须客户端裁 `content` 字段，否则一次搜索吃掉几万 token。

Phase 0 报告记的「AnySearch api 404」是**方法用错**导致的误判，不是服务不存在 —— 该路由只吃 POST，我头两轮探针也只发 GET，于是八条合理路径齐刷刷 404，一度让我误判成"没有这个 API"。真实形状是用户给出的：

```
POST https://api.anysearch.com/v1/search
{"query": "...", "tag": "code.doc", "params": {"library": "golang"}}
```

响应 `{code:0, message, request_id, data:{results:[{title,url,snippet,content}]}}`，`title/url/snippet` 正好够模型引用。

## ① 域名/端点存在性（`probe-search.mjs`, `probe-anysearch.mjs`）

| 探测 | 结果 |
|---|---|
| `anysearch.com` | 200，但正文是 `__next_error__`（Next.js 错误页外壳） |
| `api.anysearch.com` GET 8 条路径 | 全 404，且是 Go 默认 `404 page not found`（有服务、无 GET 路由） |
| `anysearch.ai` | 无关产品（企业内部知识检索），非通用 web 搜索 |
| `anysearch.io` | ENOTFOUND |

⇒ 教训记一笔：**GET 404 不能推断"服务不存在"**，路由可能对方法敏感。下次探 API 先把 POST 试掉。

## ② 匿名 vs 带 key（`probe-anysearch-api.mjs`）

同一查询 `TypeScript 5.6 release notes`：

| 调法 | HTTP | 耗时 | 条数 | 体积 |
|---|---|---|---|---|
| 纯匿名 | 200 `code:0` | 8.5s（冷） | **10** | 69.8 KB |
| 匿名 + `X-Anysearch-Client` | 200 `code:0` | 6.8s（冷） | **10** | 113 KB |
| 带用户提供的 key（Bearer） | 200 `code:0` | 9.7s（冷） | **3** | 1.8 KB |

**反直觉发现：带 key 反而更差。** 3 条 vs 匿名 10 条，且内容跑偏 —— 问 5.6 release notes，带 key 首条是 TypeScript **4.6** 的 Roadmap wiki。不像"付费更好"，更像那把 key 落在受限档位。

⇒ **fallback 链不能想当然把 key 排在匿名前面**，得按实测排。这条直接推翻了我原本"官方 API 一定比免 key 可靠、所以配了 key 就前插"的默认假设。

## ③ 参数调优：全不生效（`probe-anysearch-tune.mjs`）

`exclude_content:true` / `params.exclude_content:true` / `count:3` / `top_k:3` / `summary_only:true` —— 六种写法**一律 10 条 31KB 带正文**，服务端不认这些字段。

⇒ 省上下文**只能客户端裁**，没有别的路。

## ④ 延迟与字段占比（`probe-anysearch-fresh.mjs`，查询掺时间戳绕开缓存）

延迟三档，必须分清（我一度把冷启动数当稳态报了，此处更正）：

| 场景 | 延迟 |
|---|---|
| 首次冷启动 | 6.8–9.7 s |
| 缓存命中（重复查询） | 589–1528 ms，中位 1041 ms |
| **新查询（真实稳态）** | **1538–1997 ms，中位 1868 ms** |

40 条结果合计 128 KB 的字段占比：

| 字段 | 体积 | 占比 |
|---|---|---|
| content | 113 KB | **87.9%** |
| snippet | 11 KB | 8.6% |
| url | 2 KB | 1.9% |
| title | 2 KB | 1.5% |

**只留 `title+url+snippet` ⇒ 15 KB，省 88%**；snippet 均长 296 字符，够判断相关性并引用。中文正常：「高等数学 泰勒展开 例题」→ 首条「6. Taylor 展开」。

## ⑤ 付费源无 key 时的错误形状（`probe-search.mjs`）

- Tavily → `401` `{"detail":{"error":"Unauthorized: missing or invalid API key."}}`
- 博查 → `401` `{"code":"401","log_id":"...","message":"Invalid API KEY"}`

两家 JSON 结构不同，秘塔无正式文档（端点只能猜，本轮不接）。

⇒ **fallback 判据必须是「非 2xx 就换下一家」**，不能去解析错误体。

## ⑥ 兜底源换了三轮才定下来（最贵的一段，结论最反直觉）

**最终：Tavily。DDG lite 与 Bing 都被实测否掉。**

### DDG lite —— DNS 通、TCP 不通

我一度把它写进默认链，也在本台账里记过"免 key 可用、中位 ~1.1s、连打 8 次不封"。**那条记录在用户这台机器上不成立**：

| 探测 | 结果 |
|---|---|
| `dns.lookup('duckduckgo.com')` | 正常 → `108.160.163.106` |
| `fetch` × 3 | 全部 `UND_ERR_CONNECT_TIMEOUT` |
| Brave / Startpage | 同样 `CONNECT_TIMEOUT` |

不是被限流、不是 DNS 污染 —— **连接层不通，且三家隐私搜索同一形状**，是一类封锁。早先那次探针能跑通，说明当时网络条件不同（代理，或封锁是间歇的）。

⇒ **间歇可用的兜底比明知没有的兜底更坏**：我测的时候是绿的，用户真需要时是黑的。故从默认链摘除。`searchDdgLite`/`parseDdgLite` 保留并仍有测试（含离线固件），网络条件变了可以接回来。

### Bing —— 能连，但中文数学题**确定性**翻车

唯一"看着正常"的可连引擎（566ms / 96KB / 无反爬迹象），解析器也能稳定解出 10 条。但结果质量分裂：

| 查询 | 相关性 |
|---|---|
| `SQLite WAL 并发写` | 10/10，重测 3 次稳定 |
| `高等数学 泰勒展开 例题` | **0/10，重测 3 次全废** |

三次全是同一批「学信网 / 高等教育出版社」—— 拿"高等"够到"高等教育"，放着"泰勒展开"不管。快打 8 次零降级，**不是限流，是确定性行为**。

⇒ 否掉的理由不是"质量一般"，而是**它稳定搜不好的恰恰是主场景**（作业辅导 / 中文数学）。喂给模型"长得像搜索结果的垃圾"比搜不到更坏 —— 模型会去引用它。

同批实测：百度、360 返回但带反爬特征；Mojeek 403；Ecosia 15KB 过薄。

### Tavily —— 用户提供 key 后实测通过

| 查询 | 结果 | 耗时 |
|---|---|---|
| `Vitest 4 release notes` | 8/8 相关 | 1.65s |
| **`高等数学 泰勒展开 例题`** | **8/8 相关**（洛谷、中山大学 PDF、知乎） | 1.56s |
| `SQLite WAL 并发写` | 8/8 相关 | 1.40s |

响应 `{results:[{url,title,content,score,raw_content}]}`，映射 `content → snippet`。**`raw_content` 默认全 null**（8/8），`answer`/`images` 也空 ⇒ 10KB 就是纯摘要，不是第二个上下文炸弹；且适配器只映射三字段，将来它填了也会被丢掉。

⇒ 最终链：**AnySearch（免 key）→ Tavily（用户配 key）**。两跳都是官方 API，没有抓页环节，对方改版不会静默失效。

## ⑦ DDG lite 早先的探针记录（已被 ⑥ 推翻，留档备查）

`duckduckgo.com/lite` 免 key、HTML 解析：5 条查询（含中文）全过，约 20 条可解析结果，中位 ~1.1 s；连打 8 次不被封。代价是**抓页不是 API，DDG 改版会静默失效**，故只作兜底，且解析器要能离线测。

同批被否的：DDG Instant Answer（只回百科式 abstract，无 web 结果）、多个公开 SearXNG 实例（不可达 / 禁 JSON / 不稳）。

## ⑧ 对照实验：内置 WebSearch / WebFetch 在第三方端点下的真实行为

脚本 `smoke/websearch-arms.mjs`（留仓，`ARMS=C,D` 可只跑指定臂，`ARM_PROXY=1` 走 VPN）。起因：06 §4.1 断言"内置 WebSearch 是 Anthropic 服务端工具，第三方端点失效"，卡 H 据此**无条件禁用**了两个工具；但用户记忆是"接 DeepSeek 时原生 web search 能用"。卡 H 从未实证过这条。

判据是**四层**，不是"有没有报错"：① init 的 tools 数组里有没有 ② 模型是否真调 ③ `tool_result` 里有没有**真链接**（`Links:[{title,url}]`）④ 最终回答有没有真时效信息。

| 端点 | 内置 WebSearch | 内置 WebFetch |
|---|---|---|
| DeepSeek `api.deepseek.com/anthropic` | ✅ **真结果**（`Links:` 数组 5 个 URL，回答给出 29℃~35℃ + nmc.cn 来源） | ✅ 拿到页面内容 |
| GLM `open.bigmodel.cn/api/anthropic` | ❌ **空壳** | ✅ |
| 中转站（原生 anthropic 协议 + 真 Claude 模型） | ❌ **空壳** | ✅ |
| 官方 `api.anthropic.com` | **未验**（无 key） | **未验** |

**⇒ 06 §4.1 两个方向都错了，但不是"全错"：**
- WebSearch 在 DeepSeek 上**真能用**（§4.1 说失效 → 对 DeepSeek 是错的）；在 GLM/中转站上确实不能用（§4.1 在这两家成立）。**所以"第三方 vs 官方"这个因果站不住 —— 差别在具体端点的兼容层实现。**
- WebFetch **三家全能用**（§4.1 说保留是对的，**卡 H 禁掉它是我的错**）。

**"空壳"是本轮最值得记的失败形态**：`tool_result` **不标 error、零链接**，装的是模型自己写的话，被 CC 的脚手架包成 `Web search results for query: "…"` + `REMINDER: You MUST include the sources above` 的样子。GLM 那条甚至把 `<tool_call>{"name":"web_search"…}</tool_call>` 的原文 JSON 也吐了进去；中转站那条则直说"当前会话未提供可用的网页搜索工具"。两家的模型都如实说了"没搜到"（GLM 转去用 WebFetch 抓 weather.com.cn、中转站抓 wttr.in），**但那是模型的自觉，不是架构保证** —— 换个不那么诚实的模型就会照着空壳编。

**WebFetch 上一轮"全端点失败"是网络问题，与端点无关**：错误统一为 `Unable to verify if domain <host> is safe to fetch … blocking claude.ai` —— 它的域名安全预检要回连 claude.ai，而这台机器连不上（和 DDG/Brave/Startpage 撞同一堵墙）。开 VPN 后三家全通。

**我的探针判据自己踩了两次坑，都记下**：
1. 只看 `is_error` ⇒ 把空壳判成"可用"。正是我在 Bing 那节点名过的"长得像结果的垃圾"。
2. 拿 WebSearch 专属的 `Links:` 信号去卡 WebFetch ⇒ 把真成功判成空壳。**判据必须按工具分开。**

**落地**：`disallowedTools` 从 `["WebSearch","WebFetch"]` 改为 `["WebSearch"]`。
- WebFetch 解禁（三家能用，且 `interact.ts` 的 READONLY_TOOLS 已含它 ⇒ 判 `safe`，不会天天弹审批卡）。
- WebSearch **继续禁**，但理由换成更硬的一条：它的失败形态是**空壳**（比报错危险），且**按 provider 分裂**（同一开关不同家行为不同 = 让用户猜谜）。自建 MCP 在所有 provider 上行为一致、失败时明确说"搜索失败了，别编"，这个一致性值得放弃 DeepSeek 上那一份可用性。
- 留了 TODO：将来若要按家放行内置 WebSearch，判据只能是逐家实测 + catalog 显式标 capability，**不能**用"第三方 vs 官方"（本轮已证伪）。

## ⑨ 卡 H3：四家的**原生**搜索到底谁有、怎么调（本轮最贵的一段实证）

起因是产品要求被我做歪了：卡 H2 的 shim **无条件**拦下所有嵌套搜索请求交给
AnySearch/Tavily，于是"原生"只剩工具名。用户两次澄清「外部源只能兜底，一定要
打通厂商原生、花用户自己的额度」。而 §⑧ 的记录本身就已经说明 shim 对 DeepSeek
是**功能倒退**（它本来就会自己搜）。

四个探针脚本留仓可复跑，**全程无代理**（"国内直连可用"是被测条件）：
`probe-native-search-l1.mjs`（层① 透传，JSON + beta/plain 两臂）、`-l2.mjs`
（GLM/通义 自家机制）、`-qwen.mjs`（通义单独加试四变量）、`-stream.mjs`（层① 的
**流式**臂）。

### 结论表（2026-07-27 实测，用户自己的 key）

| 家 | 层① 自家端点实现服务端工具？ | 层② 自家搜索 API | 落哪一层 |
|---|---|---|---|
| DeepSeek | ✅ JSON 10 url / SSE 10 url，`usage.server_tool_use.web_search_requests=1` | 不需要 | ① |
| **Kimi** | ✅ JSON 14 url / SSE 7 url，但慢（22~30s） | 不需要 | ① |
| GLM | ❌ 空壳 | ✅ `/paas/v4/web_search` 10 条 / 609~1558ms | ② |
| 通义 | ❌ 空壳 | ❌ 六变量全废 | ③ 外部源 |

**三条推翻了我原先的判断：**

1. **Kimi 也能透传 —— §⑧ 从未测过它。** 交接文档那张表把 Kimi 列进"待实证的候选
   机制"（猜它要走 `$web_search` builtin_function），实际它的 anthropic 兼容层
   直接就实现了服务端工具。**猜的那条机制根本不用碰。** 这是"表格是探针起点、不是
   事实"这条纪律的又一次兑现。
2. **DeepSeek 的可用性与 beta 通道无关。** `?beta=true` + `anthropic-beta` 头 与
   裸请求两臂结果一致（都 10 url）。原先我以为服务端工具必须走 beta 通道。
3. **GLM 的 URL 字段是 `link` 不是 `url`。** 照 Anthropic/Tavily 的直觉写 `r.url`
   会让每条都缺 url 被丢掉 —— 症状是"这家搜不到"而不是"有 bug"，最难查的那种。

### 通义：六个变量全试过，明确记「未实证、走兜底」

`enable_search` + `search_options{forced_search,enable_source,enable_citation}`、
裸 `enable_search`、流式、`qwen-plus`、`qwen-max`、DashScope 原生协议
（`/api/v1/services/aigc/text-generation/generation`，回 `InvalidParameter: url error`）
—— **全部零个 url，`search_info` 字段一次都没出现过。**

最像"能用"的那次最危险：HTTP 200、正文带 `[1][3]` 角标、报了具体气温和湿度。但
它引的是 **7月22日** 的数据（实测当天 7月27日），且拿不到任何来源链接。照卡 F
「HTTP 200 会骗人」的纪律记 `mode:"none"` —— **不编端点**，直落外部源。

### 「跨家借」被用户否掉 —— 这条边界值得单独记

我原先做了第三层：通义两条原生路都不成立时，去借用户**另一家已配置好的** provider
（GLM/DeepSeek/Kimi）的原生搜索。我的理由是"仍然是用户自己的 key、不碰第三方，所以
比掉外部源好"。

**用户当场否掉，理由比我的硬**：

> 用户选了这个 api 就是只想用这个 api，怎么还自动消耗其他 api 的额度呢，还不如掉到
> tavily 和 anysearch 和秘塔这些外部服务。

我漏掉的是**知情同意**这一维：外部源要么免 key（AnySearch），要么是用户专门为搜索配
的 key（Tavily）—— 两者他都知道钱花在哪。而"用通义聊天时自动扣 GLM 的搜索额度"是他
从没同意过的支出，**这比掉外部源更坏**，不是更好。我把"是不是第三方"当成了唯一的轴，
而真正的轴是"用户有没有同意花这笔钱"。

落地成**结构性**约束而不是一个开关：`SearchPlan.vendorSearch` 是**单槽位而非列表**，
`buildSearchPlan` 只看 `selfId` 那一条、**从不遍历 catalog 找别家**，`byLayer` 也只剩
三格（没有任何"跨家"计数可言）。将来谁想加回来必须先改契约。同批删掉的还有
`searchViaAnthropicServerTool`（它唯一的用途就是跨家借）—— 留一个没人调的导出，下次
有人会以为它是条可用的路。

代价要写明白：**通义用户拿不到原生搜索**（自己不支持，又不许借别家），只能走外部源。
这是用户明确接受的取舍。

### 「空壳记忆」只记结构性失败

`knownShell` 只在"有响应、能解析、但零链接"时写入。**限流 / 非 2xx / 网络错、以及
上游明确回 `web_search_tool_result_error` 一律不记** —— 把一次限流记成"这家不行"
会永久废掉用户的原生搜索。两条承重测试锁住这个区分。

### 我自己引进的一个洞（live 第一次跑就撞上）

`stats()` 用浅拷返回，`byLayer` 是**活引用** ⇒ 调用方拿前后两次快照做差，差值恒为
0。live 验收脚本正是这么判"走了哪一层"的，于是第一轮四臂全误报 FAIL，而单测只看
单次绝对值、抓不到。已修（深拷一层）并补回归测试。

**教训**：`stats()` 这类"返回快照"的 API，嵌套一层就得深拷一层，否则契约是假的。

## ⑩ productName / userData 目录名：实证后决定**不改**

现象：dev 下 userData 落在 `%APPDATA%\Electron\`（`app.getName()` 是 Electron 默认名），目录名难看且与别的 Electron 应用共用路径。

四条路全试过：

| 做法 | 结果 |
|---|---|
| package.json 加 `productName` | dev **无效**（Electron 读它自己那份 package.json，`app.getName()` 仍是 Electron） |
| `app.setName()` 放 `whenReady` 里 | **太晚**，userData 已解析完，仍是 Electron |
| `app.setName()` 放模块顶层 | 路径确实变 Leemo，但**加密件全部解不开** |
| ready 后临时改回旧名解密、再改回来 | **同样失败** |

根因：**Windows DPAPI 的密钥派生绑 app 身份，且在进程初始化时定死**，不是每次调用现读。实测同一个 `.enc` 在 name=Electron 下解出 `providers=4 searchKeys=["tavily"]`，在 name=Leemo 下抛 `Error while decrypting the ciphertext`。第一次实机就栽在这儿：文件搬过去了，日志里 `secrets source` 从 `encrypted` 掉成 `env-plaintext` —— 等于 key 全丢（`.env` 兜住了 provider，但设置页存的搜索 key 只在加密件里，**就真没了**）。

⇒ 同进程内无解。剩下的路是"起子进程用旧身份解密、把明文管道回来"—— **为一个装饰性的目录名搭一套进程间传明文密钥的机制，不值得**。

而且**这个问题对真实用户不存在**：`electron-builder.yml` 里 `productName: Leemo` 本来就有，打包产物的 app 名原生就是 Leemo，全新安装也没有旧加密件要迁。它只影响我这台开发机的既有数据。故 dev 保持现状。

`src/main/userdata-migration.ts`（含 DPAPI 两步 + 17 条测试）**留着不接线** —— 打包里程碑真要迁历史数据时用得上，届时走"打包后的新身份进程 + 一次性导入"。

## key 的存放

存进 provider 那**同一份** safeStorage 加密件（`ProviderConfigFile.searchKeys`），不新开文件 —— 多开一份就是第二套加密、第二条迁移路径、第二个会漏明文的地方，凭据只应有一个家。可选字段，老加密件读出来是 `undefined`，不必抬 version。

优先级 **加密件 > 环境变量**：用户在界面上明确存过的东西，不该被一个陈旧的环境变量悄悄盖掉。环境变量保留是给探针脚本与 CI 用的。

用户的 Tavily key 已由 `scripts/seed-search-key.mjs` 存入（起无窗口 Electron 走真 safeStorage，写后回读验证；写前已备份原加密件）。实机确认：4 个 provider 实例未被动过。

**明文 key 不出主进程** —— `bridge:getSearchSources` 只回"配没配"，照 `getProviderConfig` 的同一条规矩。

## 未做

- **通义的原生搜索**：六变量实测拿不到可引用 url ⇒ 记 `mode:"none"`。若阿里将来在
  compatible-mode 上真的返回 `search_info`，改 catalog 一处即可（判定逻辑不动）。
- **openai 家（走网关）的原生搜索**：网关剥服务端工具，那些家仍走自建 MCP。
- **官方 Anthropic 端点**：无 key，`mode` 未标 ⇒ 走 undefined 分支（运行时探层①）。
- **秘塔**：无文档无 key，端点纯猜，无法验证 ⇒ 本轮不接。链式设计支持后续加，拿到文档再补。
- **设置页 UI**：两条 IPC 通道（`getSearchSources` / `saveSearchKey`）已通并有测试，但渲染层还没有输入框 —— 目前只能靠 seed 脚本或环境变量把 key 送进去。这是卡 H 剩下的最后一块。
- `productName` 未设 ⇒ userData 落在 `%APPDATA%\Electron\` 而非 `\Leemo\`。不影响功能，但打包前该补，否则用户目录名叫 "Electron"。
