# 新窗口交接：轮 4 卡 H 收尾（搜索源设置页 UI）

BASE = `f7595bd`（main，未 push，工作树干净）。测试 **1243 全绿**，typecheck 三段 + build 干净。

## 起手式（按这个顺序读，别全读）

1. 本文件
2. `docs/sdd/progress.md` **末尾三条**（轮 3 卡 G / 轮 4 卡 H / 对照实验）
3. `docs/sdd/probe-r4-h-search.md` —— 卡 H 的全部实证台账（9 组探针，脚本可复跑）
4. 要动前端才读 `docs/specs/02-前端设计规格-v2.0.md`；要动搜索逻辑才读 `06-Leemo-产品设计文档-v1.0.md` §四

## 本窗口剩下的唯一一块

**搜索源设置页的输入框还没做。** 两条 IPC 通道已通且有测试，但渲染层没有界面 ——
用户**自己没法在界面上填 key**，只能靠 `scripts/seed-search-key.mjs` 送进去。

已就绪的接口（`src/bridge/contract.ts`）：

```ts
"bridge:getSearchSources": { request: void; response: SearchSourceStatus[] }
"bridge:saveSearchKey":    { request: { source: SearchSourceId; key: string };
                             response: SearchSourceStatus[] }

type SearchSourceId = "anysearch" | "tavily" | "bocha";
interface SearchSourceStatus {
  id: SearchSourceId;
  label: string;      // "AnySearch" / "Tavily" / "博查"
  keyless: boolean;   // 只有 anysearch 是 true
  configured: boolean;
  note: string;       // 已写好的人话说明，直接显示，别自己另编
}
```

要做的：`SettingsPage` 加一个「联网搜索」段，列三个源 + password 输入框 + 保存。
纪律（都已在 host 侧钉死，UI 别破坏）：
- **状态里没有 key 字段** —— 明文 key 不出主进程，UI 只能显示「已配置 / 未配置」。
- **空串 = 清除**（用户要能撤回，不是只能覆盖）。
- **AnySearch 标成「不配也能用」** —— 一把 key 都没配不是错误状态，别显示成红色警告。
- 保存失败要报真话（没有加密件时 host 会抛，不许静默假装存好了）。

`src/renderer/pages/SettingsPage.tsx` 里 Provider 段是现成的抄写对象。

## 两个明确的缺口（不是 bug，是没条件做）

1. **官方端点那一格未验**：对照实验缺 `api.anthropic.com` 的 key，所以「官方端点下
   内置 WebSearch 能不能用」仍是未知。有 key 后跑
   `ANTHROPIC_OFFICIAL_KEY=... node smoke/websearch-arms.mjs` 即可补上（脚本已留位）。
2. **秘塔**：无文档无 key，端点纯猜，本轮不接。链式设计支持后续加。

## 上一轮做完了什么（三个 commit）

### `17f806a` 轮 3 卡 G — 本子 = 目录
- 本子就是 `~/Leemo/<名>/` 真目录，**无任何元数据文件**（id === title === 目录名，
  颜色由名字稳定哈希）。理由：sidecar 会在用户去资源管理器改名时立刻失同步；且
  `artifacts.ts bookForPath` 早就把「路径第一段」当本子 id 在查了。
- workspace IPC 走独立 `leemo:workspace`（循 `leemo:persist` 先例，不进 09 冻结契约）。
  唯一契约加法 = `CreateConversationRequest.notebookId?`，因为 prompt 组装确实在对话
  边界内；传 id 不传正文，host 每次建对话重读 `<本子>/CLAUDE.md`（= prompt 层⑨）。
- 权限边界单点收口 `resolveInside()`：renderer **只持工作区相对路径**。
- 拖入归类三条路（06 §2.2）：有活跃本子直落 / 无本子则 momo 建议 + 确认条 / 认不出 Inbox。
  「momo 判断」是本地确定性启发式，不调模型（拖个文件不能等两秒）。拖入=复制不是移动。
- 顺手修两个真 bug：`isValidSegment` 误把空格和 `-` 当非法字符（「高等数学 2024」会被拒）；
  `FIXTURE_FILE_TREE` 路径首段是 `"books"` 导致 `bookForPath` 恒返回 null（既存 bug）。
- 验收三层：真文件系统 smoke 13/13（`npm run smoke:workspace`）+ 真 Electron 起过一次
  （`~/Leemo/Inbox` 真出现）+ 18 条接线测试（反向验过：摘掉 `onDrop` → 3 条红）。

### `d0f2982` 轮 4 卡 H — 自建联网搜索 MCP
- **不装第三方搜索 MCP**：失败降级、防幻觉话术、fallback 链必须在我们手里。
- 链 = **AnySearch（免 key 主源）→ Tavily（用户配 key 兜底）**，两跳都是官方 API，
  无抓页环节。真网络烟测 14/14（`npm run smoke:workspace` 的姊妹脚本
  `scripts/smoke-web-search.mjs`，需先 esbuild 出 `dist-smoke/web-search.mjs`）。
- **Phase 0 记的「AnySearch api 404」是方法用错** —— 该路由只吃 POST，我头两轮也只
  发 GET，八条路径齐刷刷 404，一度让我误判成「没有这个 API」并向用户报了错结论。
  **教训：GET 404 不能推断服务不存在。**
- 带 key 反而更差（3 条 vs 匿名 10 条、内容跑偏）⇒ 有 key 的源**不前插**。
- `content` 占 87.9% 体积、服务端不认 `exclude_content` ⇒ 只能客户端裁。
- **兜底源换了三轮**（这段最贵）：DDG lite 被否（这台机器 DNS 通、TCP 全
  `CONNECT_TIMEOUT`，Brave/Startpage 同形状；我先前记的「DDG 可用」在这台机器上
  不成立）；Bing 被否（中文数学题 3/3 **确定性**全废，而那正是主场景）。
- key 存进 provider **同一份** safeStorage 加密件（`ProviderConfigFile.searchKeys`，
  可选字段不抬 version），优先级 **加密件 > 环境变量**。

### `f7595bd` 对照实验 — 推翻 06 §4.1
用户记忆「接 DeepSeek 时原生 web search 能用」是对的。四臂实测
（`smoke/websearch-arms.mjs`，`ARMS=C,D` 只跑指定臂，`ARM_PROXY=1` 走 VPN）：

| 端点 | 内置 WebSearch | 内置 WebFetch |
|---|---|---|
| DeepSeek | ✅ 真结果（Links 数组 5 URL） | ✅ |
| GLM | ❌ 空壳 | ✅ |
| 中转站（真 Claude 模型） | ❌ 空壳 | ✅ |
| 官方端点 | 未验（无 key） | 未验 |

- **「第三方 vs 官方」这个因果站不住** —— 差别在具体端点兼容层的实现。
- **WebFetch 解禁**（三家全能用，§4.1 说保留是对的，卡 H 禁它是我的错）。它上一轮
  「全端点失败」是网络问题：域名预检要回连 claude.ai，这台机器连不上（同 DDG 那堵墙），
  开 VPN 后三家全通。`READONLY_TOOLS` 已含它 ⇒ 判 safe，不会天天弹审批卡。
- **WebSearch 继续禁，理由换硬的**：失败形态是**空壳**（不标 error、零链接、装的是
  模型自己写的话被包成 `Web search results for query:…`），比报错危险；且按 provider
  分裂。留了 TODO：若要按家放行，判据只能逐家实测 + catalog 标 capability。
- **productName 试了四条路，实证后决定不改**。根因 Windows DPAPI 密钥派生绑 app 身份
  且进程初始化时定死 —— 顶层 `setName` 会让加密件全解不开（实机第一次
  `secrets source` 从 encrypted 掉成 env-plaintext = key 全丢）。为装饰性目录名搭
  「子进程传明文密钥」不值得；`electron-builder.yml` 早有 `productName: Leemo`，
  **打包产物本来就对，问题只在开发机既有数据**。`src/main/userdata-migration.ts`
  （DPAPI 两步 + 17 测试）留着**不接线**，打包里程碑用。

## 环境坑（本窗口踩过的，别重踩）

- **PowerShell 是主力**，Bash 工具返回空。中文日志要先 `chcp 65001`，否则乱码。
- 正则里含字面控制字符时字符串编辑会失败，改用一次性 node 脚本重写整段。
- `contract.test.ts` 有个**手写的 channel 运行时镜像集合** —— 加通道必须同步它，
  否则「1:1 对应」那条测试会红（它就是防漂移用的，红了是它在干活）。
- userData 在 `%APPDATA%\Electron\`（**不是 Leemo**，见上文 productName 那段）。
- 用户的 Tavily key 已在加密件里；`.env` 有 DeepSeek/GLM/Kimi/DashScope/Relay，
  **没有官方 Anthropic key**。

## 铁律提醒

- **测试+typecheck 一绿就 commit 给 hash，不问、不先写总结**。用户的核验建立在
  clean checkout 上，不提交等于卡住他（这条已被纠正过三次）。
- 只 `git add` 本卡文件 —— 仓库长期有 `.kimi/` `comate/` `openspec/` 等未跟踪件。
- 涉及 SDK 行为**先实证再写代码**（本轮 06 §4.1 又被推翻一次，这是第三次了）。
- 判据别只看「有没有报错」：**空壳返回**（不标 error 但内容是垃圾）是本项目反复
  出现的失败形态，Bing 和内置 WebSearch 都是这样栽的。
