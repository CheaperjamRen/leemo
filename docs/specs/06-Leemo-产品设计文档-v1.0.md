# Leemo 产品设计文档 v1.0（brainstorming 定稿）

> 日期：2026-07-19
> 来源：superpowers brainstorming（用户 × Fable 5 设计负责人，逐项选项卡拍板）
> 地位：对《02-已定决策清单》（宪法）的**修订与增补记录** + 新增组件设计定稿。与宪法冲突之处以本文为准（所有修订均为用户本人主动拍板，非重开决策）；本文未提及之处，宪法条款继续有效。
> 下游：《02-前端设计规格 v2.0》（视觉与交互细节）、writing-plans 任务卡、Phase 0 smoke 脚本。
> 本文进新仓库后归档于 `E:\Leemo\docs\specs\`。

---

## 〇、一页速览

- **产品名 Leemo，人格 momo（默默），全面替换幸运鹿/Lulu**；代码与新文档全用新名。
- 定位向**个人 AI OS**靠拢，陪伴人格权重上调；目标用户放宽为**泛年轻人**，首发验收仍找大学生；一期学习工作台，二期求职工作台。
- 新增五个此前未覆盖的核心设计：**本地协议网关**（Anthropic→OpenAI，落实"Provider 零卡点"，模型列表不设上限）、**自建 web-search MCP**（第三方端点下 CC 原生 WebSearch 不可用；AnySearch 预置默认）、**wiki 历史分区**（用户原创）、**用户扩展性**（自定义 MCP/Skills，浏览器 MCP 一等公民）、**memory 分层架构**（local-first，短/中/长期三层）。
- momo 行为准则四条（§7.1，用户原话提炼）：会聊天有陪伴感 × 干活利落不啰嗦 × 需求模糊时精准确认 × 任务明确时安静做完；"默默"≠沉默。
- Phase 0 = 5 核心验证（DeepSeek 满血制）+ 4 探测项；仓库 `E:\Leemo` + GitHub 私有，**仓库初始化提前到 Phase 0 之前**。

---

## 一、品牌与定位修订（修订宪法 A 条）

| 项 | 原（宪法） | 新（本轮拍板） |
|----|-----------|---------------|
| 产品名 | 幸运鹿AI / LuckyDeerAI | **Leemo**（裸词，不带 AI/OS 后缀）；中文名暂不配，界面以 Leemo 为主 |
| 人格名 | Lulu | **momo（中文昵称：默默）**，全面替换 |
| 人格内核 | 懂你的 AI 学长/学姐 | 内核沿用，气质按用户定义的**双面准则**重设（详见 §7.1 行为准则四条：会聊天有陪伴感 × 干活利落不啰嗦 × 需求模糊时精准确认 × 任务明确时安静做完）；**"默默"≠沉默寡言**，而是"不用你操心，事情默默就位"；支持用户自定义人设（§七） |
| 第一身份 | 通用 Agent 工作台 | 保持，但**向"个人 AI OS"方向靠拢**，陪伴人格权重上调（体现：首启进搭子态、momo 形象投入、人设卡系统） |
| 目标用户 | 中国大学生（大一大二核心） | **泛年轻人**：大学生 + 初入职场 + AI 尝鲜者，偏效率工具方向拓展；**首发真实验收对象不变 = 5-8 名大学生** |
| 场景路线 | 学习 overlay | **一期 = 学习场景工作台；二期 = 求职投简历工作台**（backlog 记录，通用性检验原则 F4 不变） |
| 产品一句话 | "像 Claude Code 一样能干的 AI 学习搭子" | **内外双句制**：对内定位句（文档用）= "像 Claude Code 一样能干的 AI 搭子——个人 AI OS 的起点"；对外 slogan 围绕 momo 人格另写，**方向 = "会聊天 × 会干活"双面，不走"沉默"梗**（用户明确否决"默默把事做完"式表述——太沉默会削弱搭子感），候选："一个会聊天、更会把事干成的 AI 搭子" / "一个真的会用电脑帮你干活的 AI 搭子"（品牌物料阶段定稿） |
| 命名落地 | — | **代码与新文档全用新名**：仓库 `E:\Leemo`、GitHub 私有仓 `leemo`、用户数据目录 `~/Leemo/`、npm 包名 leemo、prompt 人格 = momo。旧文档不回改 |

不变项（重申）：名词预算=2（本子/成果）、"对话即操作""文件即真相"、不做题库/拍照搜题/查重规避、纯 BYOK。

界面自称约定：momo 为主名，中文语境可用"默默"作昵称；具体文案在 02 v2.0 与人格 prompt 定稿时统一。

---

## 二、交互与体验决策定稿（细化/修订宪法 D、E 条）

### 2.1 双模式细化（承宪法 D1-D6）

- **首次启动**：首设向导 → **搭子模式**（第一印象 = 认识 momo）；此后每次启动记住上次模式。
- **切换入口**：顶栏固定两态切换器（搭子⇄工作台，带图标）+ 全局快捷键（键位 02 v2.0 定，**避开多标签页的 Ctrl+Tab**，候选 Ctrl+M）。
- **搭子态壳**：无常驻侧栏；左上角历史按钮 → 抽屉式滑出对话历史；单栏居中 max-width ~720px 大留白（承 D 条）。
- **momo 形象**：首发 = 静态插画头像（定稿一张）+ CSS 呼吸/眨动微动效；Live2D/动态形象进 backlog。
- **双模式教育**：搭子聊出重任务 → momo 主动提议"去工作台继续"→ 同一对话无缝换壳。不做教程气泡。

### 2.2 本子与文件

- **"本子"首次理解，三招叠加**：①预置一个示例本子（含示例文件，如"📘 例：高等数学"）②首次拖入文件时 momo 顺口提议"要不要建个本子放这门课的东西？"③空状态插画配一句文案（"本子 = 一门课 / 一个项目的文件夹"）。不靠教程。
- **文件归类**：拖入当前本子/对话上下文 → 直落该本子目录；拖到全局/搭子态 → momo 判断归属 + 一句话确认（"这个放高数本子？"），点头或改；无法判断 → Inbox；全部事后可改。

### 2.3 Skill 触发与首发 Skills（修订宪法 E4）

- 触发三渠道共存，同指一套 `.claude/skills/`：**/命令菜单**（输入 / 弹出）+ **自然语言意图**（CC 原生识别）+ **chips 按钮**（首屏/空状态可见性）。
- 首发 Skills = **2 学习 + 1 通用**：费曼导师、期末速通 + 1 个通用（候选：深度阅读 / 任务拆解，SKILL.md 初稿阶段定）。SKILL.md 初稿逐条过用户。

### 2.4 弹窗小 wiki（修订宪法 E2）

- 保留：预览区选中 → 浮出菜单 → "问一下" → ~380px 小窗；独立轻量 query()、低 maxTurns。
- **修订与新增**：
  1. **支持小窗内多轮追问**（仍在同一轻量 session，不升级为正式对话）；
  2. "简短回答"默认开，小窗上有**"详细一点"开关**；
  3. **wiki 历史分区（用户原创设计）**：所有小 wiki 问答落入独立的"小问答"历史分区——可追溯、可回看，不进主对话历史列表、不污染主历史；写入全局搜索索引。
- 模型：默认跟随当前对话/全局默认模型；设置页高级选项可指定一个更便宜的 wiki 专用轻量模型（可选项，不设则跟随；若首发工期紧此开关可后移，分区不动）。

### 2.5 工作台布局

沿用 v1.1 骨架：**两栏默认（侧边栏+对话）+ 预览区/文件区按需展开**，不自动弹窗。细节在 02 v2.0。

### 2.6 用量统计（P3.19 拍板）

- 每轮 `result` 事件落库：tokens（in/out/cache）、耗时、估算费用（内置国产模型价目表）。
- **每条助手消息下折叠脚注常驻**：默认极低调（折叠态），鼠标 hover 才显示灰色低醒目小字（tokens/费用）——保证用量透明但不破坏氛围；搭子态同规则。
- 设置页：按 Provider / 按日汇总视图。

### 2.7 全局搜索（P3.17 拍板）

首发范围：对话（标题+消息文本）+ 文件名 + wiki 分区 + 成果标题；SQLite FTS5 最小索引。文档内容全文索引 = 二期（配合 RAG MCP 一起做）。

### 2.8 深色模式（P3.18 拍板）

首发浅色 only；**全部颜色走 design token（CSS 变量）**，深色二期开。搭子暖白 + 工作台冷灰双基调本身已是两套目验量。

### 2.9 审批（细化宪法 B5，P2.12 拍板）

- 基线 `permissionMode: 'acceptEdits'` + `canUseTool` 回调 → IPC → 对话内嵌审批条。
- 审批条三档：**允许一次 / 本对话内总是允许 / 永久允许**（永久 = 入全局白名单，设置页可查可撤）。
- **危险操作（rm -rf、磁盘格式化、注册表写等 Bash 危险模式）永不提供"永久允许"档**。

---

## 三、Provider 体系与本地协议网关（新增核心组件）

> 用户拍板原话级需求：预置四家 + 自定义；**Anthropic 协议和 OpenAI 协议都要无痛支持**（像 NewMax 一样可选）；**Provider 配置一定不能有任何卡点**，配置卡住 = 用户直接被劝退。

### 3.1 Provider 目录（数据驱动，参考 NewMax 逆向图纸）

```js
{
  id, name, category,            // cn_official | official | custom
  apiFormat: 'anthropic' | 'openai',
  baseUrl, apiKeyUrl,            // apiKeyUrl = "去哪申请 key" 引导链接
  models: [...],
  modelCapabilities: { '<model>': { thinking: bool, vision: bool } },
  envTemplate: { ANTHROPIC_MODEL, ..._SONNET/_HAIKU/_SUBAGENT 别名映射 }   // 承宪法 B4
}
```

- 预置：**DeepSeek（默认推荐）、GLM、Kimi、通义**（四家全部 anthropic 直连）+ **Claude 官方**（anthropic）。
- **自定义 Provider**（可存多个）：用户填 名称 + BaseURL + Key + 模型 + 协议二选（Anthropic / OpenAI）→ 覆盖中转站、火山方舟、OpenRouter、GPT 经转换、任意兼容端点。
- **模型列表 = 动态可扩，数量不设限**（用户拍板补充）：预置 Provider 带精选推荐集（如 DeepSeek 只展示 v4pro / v4flash）；自定义 Provider 支持**从端点 `/v1/models` 一键拉取全量 + 手动增删**（中转站/token plan 接入数十个模型是常态）。**CC 的模型别名映射（ANTHROPIC_MODEL 等 4 槽位）只是"当前对话所选模型"的运行时落地方式，不构成可接入模型数量的上限**——对话选中哪个，别名就映射哪个。
- 每个 Provider 独立 `CLAUDE_CONFIG_DIR`（`userData/providers/<id>/`）隔离状态，防串味（NewMax 已验证此法）。

### 3.2 两种接线模式

| 模式 | 条件 | 接线 |
|------|------|------|
| **直连** | apiFormat=anthropic | env 直铺 SDK：`ANTHROPIC_BASE_URL`=端点、`ANTHROPIC_AUTH_TOKEN`=真 key、模型别名映射。零翻译零风险 |
| **网关** | apiFormat=openai | 主进程起本地网关 `http://127.0.0.1:<随机端口>`（仅本机监听）；SDK env 指向网关，`ANTHROPIC_AUTH_TOKEN` = 占位符编码 `leemo-gw:<providerId>`；网关从 Authorization header 解析 providerId → 查目录 → 翻译协议 → 转发真实上游。**真 key 只存在于主进程（safeStorage 加密），永不进 SDK 子进程 env** |

### 3.3 网关技术方案（已拍板：混合 = 自研薄壳 + vendor 转换核心）

**自研薄壳**（~几百行，严格 TDD）：
- Node `http.createServer`，127.0.0.1 随机端口；
- SSE 直通管道：不缓冲、每 chunk flush、客户端 abort 向上游传递取消；
- 端点面：`POST /v1/messages`（CC 恒带 `?beta=true`）、`POST /v1/messages/count_tokens`（本地 gpt-tokenizer o200k_base 近似——CC 压缩逻辑依赖它）、`GET /v1/models`（Anthropic 格式返回；配合 `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` 让自定义模型出现在模型选择器）、`GET /health`。

**vendor 转换核心**：
- 把 `@musistudio/llms` 的 anthropic transformer（MIT，1069 行，claude-code-router v2 十四万周下载实战验证）**源码级搬入** `src/gateway/vendor/`，附 MIT 许可文本与署名；
- 顺手修掉两个上游 open bug：reasoning 字段无条件注入（打挂不支持的模型）、server tools 丢弃改为显式剥离；
- 对照 `@the-next-ai/ai-gateway` 的 per-provider 开关表补国产端点分支：`reasoning_content`/`thinking` 注入（智谱）、`stream_options.include_usage` 可关（部分中转站不认会 400）。

**13 个已知坑全部进 TDD 用例**（快照回归）：流式 tool_calls 参数拼接（头号杀手：空 input 导致 CC 工具死循环）、含工具轮次 stop_reason 必须=tool_use、content block index 映射、tool id 全链路往返一致、cache_control 剥离、max_tokens clamp/必填差异、system 拼接、tool_result 嵌图片提升为 user 消息、思维链碎片化（reasoning_content 等）、usage 映射（cached_tokens 扣减）、GLM 拒绝 anyOf/oneOf/$ref 的 schema 扁平化、SSE 事件状态机（event+data 成对/ping/[DONE] 吞掉）、`?beta=true` 与 count_tokens 端点面。

**thinking 规整**：`normalizeAnthropicThinking` 按模型能力表剥离/规整 thinking 字段（防 DeepSeek V3 类模型 400）。

### 3.4 按对话选模型（P2.11 拍板：首发即做）

- 每条对话在 store 带 `{providerId, modelId}`；新对话默认 = 全局默认 Provider。
- 输入区低调模型选择器（点开列出各已配 Provider 的模型）。
- 实现：**每对话的 query() 用该对话自己的 env 构造**（直连各铺各的；网关模式经占位 token 路由）→ 多对话并发天然支持不同 Provider 同时跑。
- 对话中途换模型 = 下一轮 query() 生效（UI 提示"下轮起生效"）。

### 3.5 首设向导（细化宪法 E3）

选 Provider（DeepSeek 默认推荐 + 图文申请引导）→ 输 Key → 一键测连通（真实小请求，报错人话化）→ 进搭子态。自定义 Provider 在向导"更多"折叠项中可达。目标 <2 分钟不变。

### 3.6 用户扩展性：自定义 MCP 与 Skills（用户拍板：扩展自由度是硬要求）

- **Skills 扩展**：`~/Leemo/.claude/skills/`（全局）+ 本子级 skills 目录，放入标准 SKILL.md 即被 CC 原生扫描生效；工作台 Skills 管理页：列出全部（预置+用户自装）、启停、一键打开目录。
- **MCP 扩展**：设置页"扩展"分区支持添加自定义 MCP server（stdio 命令 / SSE URL + env 变量），透传 `query()` 的 `mcpServers`；**browser use / Playwright 类浏览器 MCP 是一等公民**——MCP 工具在本地执行，与 LLM 端点无关（cc-switch + DeepSeek 下浏览器 MCP 可用即为佐证），模型侧只依赖工具调用能力（Phase 0 核心验证②已覆盖）。
- **预置生态**：首发前做一轮"值得预置的 Skills / MCP 生态调研"（候选方向：Playwright/chrome-devtools 浏览器自动化、Office/PDF 文档处理、CC 官方技能库精选），挑 2-3 个内置或做成一键安装——列入里程碑 6。
- 技术注意（入风险表）：外部 stdio MCP 子进程需要运行时；用户机器可能无 Node/Python → 预置 MCP 优先选进程内 SDK MCP 或用 Electron 自带 node（`ELECTRON_RUN_AS_NODE`）拉起，避免"装了不能用"。

---

## 四、联网搜索设计（新增，填补空白）

### 4.1 事实基础

CC 内置 **WebSearch 是 Anthropic 服务端工具**：BASE_URL 指向第三方端点时上游无此能力，必然失效（NewMax 亦显式禁用改自建）。内置 **WebFetch 是本地抓取，不受影响，保留**。

### 4.2 方案：自建 web-search MCP（进程内 createSdkMcpServer，~200 行）

- **源链 fallback**（按序尝试，首个成功即返回，全败报错误清单——抄 NewMax 模式）：
  1. **AnySearch（预置默认源）**：Apache-2.0、匿名可用、注册后 1000 次/天免费、纯 REST 从主进程直调（不依赖其 Skill 形态，避免用户机器的 Python/Node 运行时问题）；国内直连性 = Phase 0 探测项；
  2. 用户 key 可选源：秘塔 / Tavily / 博查（设置页配置，配了自动入链）。
- **按 Provider 条件启用**：Claude 官方 Provider → 保留原生 WebSearch，MCP 作补充；第三方 Provider → `disallowedTools` 禁用内置 WebSearch + 注入 MCP。
- **无可用源时优雅降级**：系统提示注入"联网未启用"块（明确告知 momo 不可联网、不得假装能搜——防幻觉，文案思路抄 NewMax 启用/禁用双版本）。

---

## 五、架构总览（更新版）

```
┌──────────────────────────────────────────────────────────────┐
│ 渲染层（二选一显示，显式切换）                                  │
│   BuddyShell（搭子） ⇄ WorkbenchShell（工作台）                │
├──────────────────────────────────────────────────────────────┤
│ 共享状态层（Zustand，模式无关）                                 │
│   conversations / messages / runs / artifacts / notebooks /   │
│   approvals / notifications / settings / usage / wikiEntries  │
├──────────────────────────────────────────────────────────────┤
│ IPC 类型化契约（preload）                                      │
├──────────────────────────────────────────────────────────────┤
│ Electron 主进程                                               │
│  ├─ CC SDK Bridge（per-conversation query() 会话池）           │
│  ├─ 本地协议网关（127.0.0.1，anthropic→openai 翻译+密钥隔离）    │
│  ├─ web-search MCP（AnySearch 默认 + 可选 key 源 fallback）    │
│  ├─ Workspace Manager（本子=目录，~/Leemo/）                   │
│  ├─ SQLite（消息真相源 + FTS5 索引 + usage + wikiEntries）      │
│  └─ 配置/密钥（safeStorage 加密）                              │
├──────────────────────────────────────────────────────────────┤
│ claude-agent-sdk 0.3.210（锁定）+ claude.exe（npm 平台分包）    │
│   直连：DeepSeek/GLM/Kimi/通义/Claude 官方（anthropic 协议）     │
│   经网关：中转站/火山方舟/OpenRouter/GPT 等（openai 协议）        │
└──────────────────────────────────────────────────────────────┘
```

数据目录分离：`~/Leemo/`（用户可见文件树：本子/成果/Inbox + 全局 CLAUDE.md + memory/）；应用内部数据（SQLite/配置/日志）在 `app.getPath('userData')`。

---

## 六、数据与持久化（P2.13 设计决定）

- **UI 真相源 = 自建 SQLite store**（conversations/messages/runs 表，事件流全落库），渲染不依赖 SDK session 文件。
- **上下文续接**：优先 SDK resume（sessionId 存 conversation 记录）；其在第三方端点的可靠性 = Phase 0 探测项①；不可靠则 Bridge 内降级为"新 query() + 历史消息重放"，UI 无感。
- wikiEntries 表：选区引用（文件锚点+原文摘录）+ 问答 + 时间。
- usage 表：per result（conv/provider/model/in/out/cache tokens/耗时/估算费）。
- 全局搜索：SQLite FTS5（§2.7 范围）。
- 密钥：safeStorage 加密；配置导出永不含明文 key。

---

## 七、momo 人格框架（P2.14 拍板：人设卡 + 话风滑杆）

### 7.1 行为准则四条（用户原话提炼，人格 prompt 的最高约束）

> "默默" ≠ 沉默寡言。名字含义 = "不用你操心，事情默默就位"。写 prompt 的人不得往"少说话"方向带偏。

1. **日常对话有陪伴感**：温暖、会说话、会反馈、会聊天，让人省心但不冷场——不过分沉默。
2. **干活干净利落**：好好干活、不过分啰嗦；**双向禁区**——不表现得"又蠢又什么都要教、还不自信"，也不"过分自信、自以为是"。
3. **需求模糊时，精准而细致地确认**：像 brainstorming 流程那样与用户对齐任务目标和边界（选项式提问优先）；让用户真切感到"AI 理解了任务，不会瞎猜"——这个确认过程本身就是好感来源。
4. **任务明确时，安静高效高质量干完**：不中途刷存在感，完成后简洁汇报，让人赞许。

### 7.2 prompt 组装

`systemPrompt: { type:'preset', preset:'claude_code', append: [7.1 行为准则] + [momo 基础人格] + [模式语气块：搭子=陪伴强化 / 工作台=产出纪律+来源标注] + [当前人设卡] + [话风滑杆映射指令] + [联网状态块] }`。

### 7.3 人设自定义（两个控件即全部——简单好上手）

- **人设卡**：预置 3-4 张（默认 momo / 热心学长 / 严谨导师 / 损友——名字与文案待打磨；MBTI 风味作为卡上标签如"ENFP 型"，不做独立配置项）；每张卡 = 一段写好的人格 prompt（7.1 准则对所有卡生效）；**用户可新建卡自写描述**。
- **话风滑杆**：一根（简洁 ⇄ 话痨，3-5 档），映射为 append 中的行为指令。
- 入口：设置页 momo 分区；搭子态头像右键快速换卡（02 v2.0 细化）。

### 7.4 memory 架构（用户拍板：local-first + 分层，目标"越用越懂你"）

原则：**local-first**——全部记忆落 `~/Leemo/` 下的可见文件，用户可查看、编辑、删除（设置页"momo 的记忆"入口直达）。载体复用 CC 原生分层加载机制（零自研引擎，承宪法 D4），我们设计的是**目录结构与写入纪律**：

| 层 | 载体 | 内容 | 写入时机 |
|----|------|------|---------|
| **短期（会话层）** | 对话上下文（CC 自动管理+compaction）+ store 内对话摘要 | 本次对话的任务状态 | 自动 |
| **中期（本子层）** | `<本子>/CLAUDE.md` | 这门课/项目进行到哪、本子内约定 | momo 在关键节点更新（工作台态挂载） |
| **长期（全局层）** | `~/Leemo/CLAUDE.md`（索引+核心事实，每会话加载）+ `~/Leemo/memory/` 分类文件 | `profile.md` 用户画像；`preferences.md` 偏好与雷区；`progress/` 各主题学习进度；`moments.md` 重要时刻与关系记忆（陪伴感来源） | momo 判断"值得记住"时即时写；避免琐碎 |

- **记忆卫生**：CLAUDE.md 只放索引与高频核心事实（防上下文膨胀）；memory/ 文件由 momo 定期合并去重；过时条目更新而非堆积。
- **待办**：02 v2.0 前做一轮 memory 竞品调研（ColaOS 及其他成熟陪伴/工作台产品的记忆分层与写入触发设计），细化写入策略后给用户过目。
- 搭子态挂全局层；工作台态 = 全局 + 本子叠加（承宪法 D4 不变）。

---

## 八、Phase 0 方案（细化宪法 G1；P0 三件套拍板）

- **环境**：`E:\Leemo` git init + GitHub 私有仓 `leemo`（先于 Phase 0，见 §十）；Node ≥18；`npm i @anthropic-ai/claude-agent-sdk@0.3.210`。
- **5 核心验证 × 3 端点**（DeepSeek / GLM / Kimi，key 已备）：①流式增量 ②内置工具调用（真实读写文件）③多轮对话 ④子 agent（Task）⑤上下文压缩（超长对话触发 compaction）。
- **PASS 判定（DeepSeek 满血制）**：DeepSeek 五项全过 = PASS；GLM/Kimi 记录矩阵，允许子 agent/压缩两项降级；若 DeepSeek 不过，候选顺序 GLM → Kimi 顶上重判。
- **4 探测项（不卡门，只记录）**：①SDK session resume 在第三方端点可靠性 ②AnySearch 国内直连+匿名搜索 ③用户中转站是否原生提供 Anthropic 协议（one-api/new-api 系常见）④canUseTool 回调在第三方端点行为。
- **产出**：`smoke/smoke-cc-sdk.mjs`（provider × 验证项矩阵跑）+ `docs/reports/phase0-report.md`（结果矩阵 + 日志摘录）。验收 = 设计负责人复跑脚本核对（可复现证据，承宪法 F3）。
- 时间盒 3-5 天不变。

---

## 九、风险表更新（对宪法及 01 号文档的增量）

| 风险 | 等级 | 应对 |
|------|------|------|
| 网关转换层保真度（流式工具参数拼接等 13 坑） | 🔴 | vendor 实战源码 + 13 坑全进 TDD 快照回归 + 真端点验收（§十 网关竖切） |
| AnySearch 依赖（免费政策变动/国内可达性） | 🟡 | fallback 链任一源可换；Phase 0 探测；不可用则退用户 key 源 |
| 多 Provider 并发的 env/配置串味 | 🟡 | per-provider CLAUDE_CONFIG_DIR 隔离（NewMax 已验证）+ Bridge 测试覆盖 |
| vendor 源码与上游演进脱节 | 🟢 | 只用单向链路接口面小；月度 SDK 升级窗口同步 review 上游 changelog |
| 双壳维护成本（承 01 号） | 🟡 | 共享 store 铁律 + lint 约束"新组件不得直连 IPC" |
| 外部 stdio MCP 的运行时依赖（用户机器无 Node/Python） | 🟡 | 预置 MCP 优先进程内 SDK MCP；外部的用 Electron 自带 node（ELECTRON_RUN_AS_NODE）拉起；文档说明 |
| SDK 升级不兼容（承宪法） | 🔴 | 锁 0.3.210 首发（**明确策略：不逐版跟随**——CC 几乎每工作日发版，我们每月一个升级窗口，新分支跑评测集通过才升，宪法 B1） |

---

## 十、里程碑修订（宪法 G 序列 v2）

1. **仓库先行**（修订：提前到 Phase 0 之前，因 smoke 代码属于新仓库）：`E:\Leemo` git init + GitHub 私有仓 + 本设计文档入 `docs/specs/`。
2. **Phase 0**：5 核心 + 4 探测（3-5 天）→ `phase0-report.md` → **PASS 才继续**。
3. **02-前端设计规格 v2.0** 重写（双模式 + 本文全部交互决策融入），用户过目定稿。
4. **网关竖切**（新增，可与 3 并行，1-2 周）：薄壳 + vendor 转换核心 + 13 坑 TDD 用例；验收 = 用户中转站 OpenAI 端点跑通 5 核心验证。
5. CC SDK Bridge + IPC 契约冻结 → 双壳前端并行施工。
6. momo 人格 prompt（按 §7.1 准则）+ 人设卡 3-4 张 + 首发 SKILL.md ×3 初稿（用户逐条过）+ **两项配套调研**：预置 Skills/MCP 生态挑选（§3.6）、memory 竞品调研（ColaOS 等，§7.4）。
7. Phase 1 最小骨架（2-3 周）→ Phase 2 工作台体验（2-4 周）→ Phase 3 泛化与打磨（5-8 名大学生真实验收）。

---

## 十一、分发与更新（P2.15 拍板）

三渠道并行：**GitHub Release**（主渠道，electron-updater 自动更新）+ **国内网盘**（夸克/百度/阿里，每版人肉镜像）+ **一页式官网**（下载按钮指向前两者；域名候选 leemo.app / leemo.ai 等，注册可用性待查——品牌物料阶段处理）。

---

## 十二、backlog 增量记录（防丢）

二期求职投简历工作台；wiki→原文超链接回跳；深色模式；momo 动态形象（Live2D）；文档内容全文索引 + RAG MCP；错题本/学习计划等学习 MCP；目标模式/定时任务；Skills 市场；Bloom 完整动画；悬浮球/番茄钟/成就系统；搜索源扩展；wiki 专用轻量模型开关（若首发后移）。

---

## 附：本文修订的宪法条款索引

A1（+AI OS 靠拢表述）、A3（用户圈层+一句话）、A5（Lulu→momo+人设卡）、B3（+自定义 Provider+OpenAI 协议网关）、E2（小 wiki 三细节+分区）、E3（向导+自定义入口）、E4（Skills 2+1）、G（里程碑序列 v2）。其余条款不变。
