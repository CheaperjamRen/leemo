# 新窗口交接：轮 4 卡 H3 —— 原生搜索必须用**厂商自己的**搜索服务

BASE = `2b58f37`（main，未 push，工作树干净）。测试 **1322 全绿**，typecheck 三段 + build + build:main 干净。

## 用户的要求（7/27 第二次澄清，这是产品决定）

> anysearch、tavily 这些本质上是外部的，是用来兜底的。**本质上一定要用一定要打通原生的。**
> deepseek、glm、kimi 这些模型厂一般都自建搜索服务，用户 BYOK，**能不能用他们自己的搜索额度**？

即：用户配好一家国内模型的 key，`WebSearch` 就该走**那一家自己的**搜索服务、花**用户自己的额度**、不经过任何第三方。外部源只在厂商侧确实没有时兜底。

## 上一轮（卡 H2，commit 592f08e/aad92ae/f3474f8）做对了什么、做错了什么

**做对的（保留，别推翻）**
- **WebFetch 已经真·原生可用。** 根因=域名预检回连 `api.anthropic.com/api/web/domain_info`，本机实测返回 **403 Cloudflare**（不是缺 key，那个 GET 不带鉴权）。解法=SDK `extraArgs: {settings: JSON.stringify({skipWebFetchPreflight:true})}`（flag 层不过滤；`managedSettings` 会被 restrictive-only 白名单静默吃掉）。置真后抓取全程本地。**这一条与本卡无关，不要动。**
- **搜索的真实机制已经探清**（`smoke/websearch-nested-probe.mjs`，本地假上游，零成本可复跑）：`WebSearch` 以**客户端工具**发给上游；模型调用后 CC **另发一次** `/v1/messages?beta=true`，body 里只有 `{type:"web_search_20250305",name:"web_search",max_uses:8}`，messages 只有一条 `"Perform a web search for the query: <q>"`；再从响应里挑 `server_tool_use` / `web_search_tool_result` 渲染成 `Links:[{title,url}]` 交回模型。**那次请求发往 `ANTHROPIC_BASE_URL`。**
- 设置页「联网搜索」段 + 开关真接线（此前 `webSearchEnabled` 钉死 false，联网能力在界面上到不了）。

**做错的（本卡要修的核心）**
- **`src/host/search-shim.ts` 无条件拦下所有嵌套搜索请求**，用 AnySearch→Tavily 答掉。于是「原生」只剩工具名，搜索源仍是第三方。
- **对 DeepSeek 是功能倒退。** 台账 `docs/sdd/probe-r4-h-search.md` §⑧ 实测记录：DeepSeek `api.deepseek.com/anthropic` 的内置 WebSearch **本来就能用**——真 `Links:` 5 个 URL、真时效信息（29℃~35℃ + nmc.cn 来源），走的就是 DeepSeek 自己的搜索和用户自己的额度。shim 把它换掉了。

## 本卡要实现的：三层降级链，外部源退到最后

```
① 透传   nested search → 用户配的厂商 anthropic 端点，原样转发
         响应里有真 web_search_tool_result + 非空 results ⇒ 直接回给 CC。完事。
         （DeepSeek 已实测属于这一档）
② 厂商原生搜索 API   ①出空壳 ⇒ 转译到该厂商自己的搜索机制，仍用用户的 key
③ AnySearch → Tavily 兜底   ①②都不行才走（现有 web-search.ts 原样复用）
```

**「空壳」的机械判据（沿用台账已立的，别只看 is_error）**：响应里没有 `web_search_tool_result` block，或该 block 的 `content` 不是数组 / 是空数组 / 零个带 `url` 的条目。GLM 的失败长相就是"不标 error、零链接、装着模型自己写的话"。

### 第一步（最高价值、最小改动）：先把 ① 做出来

只要 ① 落地，DeepSeek 就恢复成真·厂商原生搜索，且**用户额度**这条要求当场满足。②③ 是后续。

### 必须先探针，不许照抄我下面的猜测

下面几条是我**未实证**的候选形状，只能当探针起点，**不能当事实写进代码注释**（本项目已被推翻过多次：AnySearch 的 GET 404、06 §4.1 两个判断、WebSearch 是不是服务端工具）：

| 家 | 候选机制（**待实证**） | OpenAI 协议 base（catalog 里目前没有，可能要加字段） |
|---|---|---|
| DeepSeek | anthropic 兼容层已实现 ⇒ 走①即可 | `api.deepseek.com/v1` |
| GLM | 自家 `web_search` 工具 / `web_search_pro` | `open.bigmodel.cn/api/paas/v4` |
| Kimi | `$web_search` builtin_function | `api.moonshot.cn/v1` |
| 通义 | `enable_search` 参数 | `dashscope.aliyuncs.com/compatible-mode/v1` |

探针要回答的：**这家到底有没有官方联网搜索、怎么调、返回什么形状、能不能拿到可引用的 url、是否计入用户额度**。判据必须**读回复正文/结果条目**，不能只看 HTTP 200 —— 卡 F 的硬发现「HTTP 200 会骗人」（DeepSeek 收下 image block 回 200 然后说"我看不见图"）在这里同样适用。

拿不到确切文档的家，**明确记为"未实证、走兜底"**，不要编一个端点填进去。

## 文件锚点

- `src/host/search-shim.ts` —— 判定/提取/合成都是纯函数，已有 37+ 测试。`answerSearch()` 是要改的地方：现在直接 `deps.runSearch`，要改成三层链。透传路径 `passThrough()` 已经能用，① 基本是复用它 + 检查响应。
- `src/host/bridge-host.ts` —— `ensureSearchShim()` 注入 `runSearch`；`chooseSearchWiring()` 的三态（联网关/走 shim/不走 shim）不要动。
- `src/host/web-search.ts` —— AnySearch/Tavily 链，第③层原样复用，别改。
- `src/host/provider-catalog.ts` —— 四家预置表。若 ② 需要 OpenAI 协议 base 或"支持原生搜索"的 capability，加在这里（`capabilities` 已有 modelDiscovery/balanceApi 先例，**加数据不改契约**是 B3 冻结时就留的扩展轴）。
- `smoke/websearch-native-live.mjs` —— live 验收脚手架已在，改判据即可复用。

## 验收标准（不许 soft-pass）

1. **DeepSeek**：live 实测 `WebSearch` 返回的 `Links:` 来自 DeepSeek 自己的搜索，**shim 的 `searchesAnswered` 计数为 0**（证明没被本地接管）。
2. **至少一家兼容层不实现的家**（GLM 或 Kimi/通义按探针结果选）：走②成功，且能证明用的是那家自己的搜索（结果里有该家特征 / 计费侧可见）。
3. **兜底仍在**：把①②都断掉（注入失败）→ 落 AnySearch，且日志说清走了第几层。
4. **失败时照实说**：三层全挂 ⇒ 仍回 `web_search_tool_result_error`（**不是空数组** —— 空数组会被 CC 渲染成"搜到 0 条"，模型据此编造）。
5. 全套测试绿 + typecheck 三段 exit 0 + commit hash + 需求覆盖表入 `docs/sdd/progress.md`。

## 铁律提醒（本项目踩过的）

- **涉及 SDK / 厂商行为先实证再写代码**（06 §4.1 被推翻过三次）。
- **判据别只看有没有报错**：空壳（不标 error 但内容是垃圾）是本项目反复出现的失败形态；上一轮 WebFetch 探针里「拿到内容」为真其实是模型改用 PowerShell 绕过去了，承重信号是预检报错本身。
- **测试+typecheck 一绿就 commit 给 hash，不问、不先写总结。**
- 只 `git add` 本卡文件（仓库长期有 `.kimi/` `comate/` `openspec/` 等未跟踪件）。
- `tests/bridge/contract.test.ts` 有手写的 channel 运行时镜像，加通道必须同步它。
- 测试必须落 `tests/**`（node）或 `src/renderer/**`（renderer）；`src/tests/` 下的测试永不执行。
- PowerShell 是主力，中文日志先 `chcp 65001`。
- **代理纪律**：国内厂商端点一律直连不走代理；`http_proxy/https_proxy=http://127.0.0.1:10801` 只在需要外网时设。本卡的目标恰恰是「不开代理也能用」，探针默认不设代理。

## 未做 / 留给用户拍的（别擅自改）

- **WebFetch 是否该受「联网搜索」开关约束**：目前无条件放行。产品口径，等用户定。
- **openai 家（走网关）的原生搜索**：网关会剥服务端工具，那些家现在走自建 MCP。本卡先解决 anthropic 直连四家。
- 秘塔未接（无文档无 key）；官方 Anthropic 端点未验（无 key）。
- 视觉：设置页新段与卡 D/E/F 一起攒着统一目验。
