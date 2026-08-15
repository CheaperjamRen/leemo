# NewMax 技能来源审计报告（2026-08-02）

审计对象：`C:\Users\Example\.newmax\skills` 中 18 个"无许可证/来源不明"技能。
审计方法：SKILL.md 内容特征 + 硬编码路径痕迹 + GitHub 仓库/raw 比对 + 网页搜索定位初始来源。
结论用途：决定哪些值得预封装进 Leemo 安装包、哪些应排除。

---

## 一、分类总览

| 档位 | 技能 | 数量 |
|---|---|---|
| A 可预封装（官方/开源来源清晰） | ima-skill、deepl（附官方替代） | 2 |
| B 有官方替代品，社区版不可复制 | feishu-doc-reader、claude-skills-zh-cn | 2 |
| C NewMax 自研/深度定制（排除） | data-analysis、daily-review、deep-review、blog-post-writer | 4 |
| D 来源不明（暂不预封装） | schedule-memory、roblox-site-architect、storage-analyzer、ppocrv5、imagemagick-conversion、gemini-image、ffmpeg-usage、remotion-video、project-init、workflow-automator | 10 |

---

## 二、A 档：来源清晰，可预封装

### 1. ima-skill — 腾讯 ima 官方技能包 ✅

- **初始来源**：腾讯 ima 官方于 2026-03-17 上线 "ima skills" 功能，官方技能包直链：
  `https://app-dl.ima.qq.com/skills/ima-skills-1.1.2.zip`（已下载验证，33.7KB，含 `ima-skill/{SKILL.md, notes/, knowledge-base/}` 三大模块）
- **官方凭证入口**：https://ima.qq.com/agent-interface（获取 Client ID + API Key）
- **NewMax 版关系**：= 官方包 + NewMax 自己加的 `meta.json`（标 v1.1.7）、`ima_api.cjs`、以及增强的 MANDATORY RULES（UTF-8 编码校验、PowerShell 5.1 检测等）。核心结构（notes/knowledge-base/SKILL.md）与官方包一致。
- **许可**：腾讯官方发布供外部 Agent 接入使用（官网直链下载，无需 GitHub）。
- **建议**：✅ **预封装 + 默认不启用**（需用户配置 `IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY`）。直接用官方 1.1.2 包；NewMax 增强版若要用需用户确认（衍生自官方）。
- **运行依赖**：Node（Leemo 自带 ✓）；需网络访问 ima.qq.com + COS。

### 2. deepl — DeepL 翻译技能 ⚠️（社区版不可直接复制，有官方替代）

- **初始来源**：`zhangdszq/vk-skills` 仓库（skills.rest 收录，安装语 `npx skills add` 指向该仓库），德语描述与 NewMax 版一致。
- **许可**：vk-skills 仓库 **无 LICENSE 文件**（默认版权保留）；且 NewMax 版 SKILL.md 与仓库版内容不一致（疑似旧版或改写）。
- **官方替代**：`DeepL/deepl-mcp-server` — **MIT**（Copyright (c) 2022 DeepL SE），官方 MCP server，覆盖文本/文档翻译、语言检测、glossary。
- **建议**：不直接复制社区版。方案一：预封装 DeepL 官方 MCP（MIT，干净）；方案二：用户确认 vk-skills 授权后打包其 skill。需 `DEEPL_API_KEY` → **默认不启用**。

---

## 三、B 档：有官方替代品，社区版无许可不可复制

### 3. feishu-doc-reader — 飞书文档读取 ⚠️

- **初始来源**：`zhangyongcun/feishu-doc-reader`（GitHub，moltbot 生态 metadata 吻合，描述一致）；NewMax 用的是**旧版**（GitHub 版已支持 Lark 国际版 + Markdown 导出增强）。
- **许可**：仓库 **无 LICENSE 文件**（默认版权保留）。
- **官方替代**：`larksuite/cli`（**MIT**，Copyright (c) 2026 Lark Technologies，即 https://www.feishu.cn/feishu-cli 官方 CLI）：200+ 命令覆盖 12 业务域，官方 AI Skill 安装方式 `npx skills add larksuite/cli -g -y`（约 20 个官方 Skill）。
- **建议**：不复制社区版；预封装走官方 larksuite/cli 通道（MIT）。需飞书开放平台 App ID/Secret → **默认不启用**。

### 4. claude-skills-zh-cn — Anthropic Skills 中文翻译集合 ⚠️

- **初始来源**：`anthropics/skills` 的中文翻译版（SKILL.md 自述 + 引用 github.com/anthropics/skills）。
- **许可**：翻译集合无 LICENSE；内容源是 Apache 2.0 的官方仓库，翻译属衍生作品。
- **建议**：**不需要**——官方英文版我们已随包提供，中文翻译无增量价值，跳过。

---

## 四、C 档：NewMax 自研/深度定制（明确排除，有法律风险）

| 技能 | 自研证据 |
|---|---|
| daily-review / deep-review | 输入格式是 NewMax 对话历史 JSON（`workspaces/conversations/usage/globalStats` 字段）→ 为 NewMax 数据定制的分析提示词 |
| data-analysis | SKILL.md 引用 NewMax 的 `\xlsx` 工具、`\docx` 工具、`\pdf` 工具（Leemo 没有同名工具）→ NewMax 整合型自研 |
| blog-post-writer | 调用 `scripts/generate_image_seederam.py`（自研脚本，Seedream 生图集成）→ NewMax 自研 |

**结论：不复制、不参考实现（提示词层面可借鉴思路但重写）。**

---

## 五、D 档：来源不明（暂不预封装）

| 技能 | 现状 | 证据/备注 |
|---|---|---|
| schedule-memory | 硬编码 `.newmax` 路径（`C:\Users\Example\.newmax\workspace\schedule-memory.md`） | NewMax 必改过；openclaw 生态有 memory/schedule 类技能但未定位到精确同源仓库。若需要：参考 openclaw 生态（geq1fan/openclaw-memory 等）自写 |
| roblox-site-architect | 硬编码 `.newmax` 路径；157K，内容完整（SEO 工具站 v3.1） | 初始作者自称 macOS 写就，但无仓库线索；NewMax 适配过路径。未定位来源 → 不复制 |
| storage-analyzer | 中文精细（76K，macOS/Windows 只读扫描 + HTML 报告） | GitHub 有同名 2-star 仓库但 raw 404 未确认同源。未定位 → 不复制 |
| ppocrv5 | PP-OCRv5 API OCR skill | GitHub 有 `Aidenwu0209/PP-OCRv5-claude-code-Skill`（2-star）但 raw 404 未确认；PaddleOCR 框架本身 Apache 2.0。未定位 → 不复制 |
| imagemagick-conversion | frontmatter 带 `model: haiku / created/modified/reviewed` 元数据（某 skill 生成器产物） | 内容是通用 ImageMagick 指南（低风险）；社区同类 MIT 版很多（如 github/awesome-copilot 的 image-manipulation-image-magick）。要能力可自找 MIT 版 |
| gemini-image | 中文，读 `config/secrets.md` 调 Gemini API | 无任何来源标记 → 不复制 |
| ffmpeg-usage | 中文 ffmpeg 指南（16K） | 无来源标记；ffmpeg 能力可用官方文档/社区 MIT skill 替代 → 不复制 |
| remotion-video | 中文 Remotion 指南（44K） | 无来源标记；Remotion 框架开源 → 不复制 |
| project-init / workflow-automator | 中文通用引导提示词（4K 各） | 无来源标记，纯提示词 → 不复制 |

---

## 六、给 Codex 的打包执行清单

### 预封装 + 默认不启用（需用户配置后启用）

| 技能 | 打包源 | 所需配置 | 状态 |
|---|---|---|---|
| ima-skill | 腾讯官方包（`https://app-dl.ima.qq.com/skills/ima-skills-1.1.2.zip`，已下载于 %TEMP%\ima-official） | `IMA_OPENAPI_CLIENTID` + `IMA_OPENAPI_APIKEY` | ✅ 可直接打 |
| deepl | DeepL 官方 MCP（`DeepL/deepl-mcp-server`，MIT）或用户确认 vk-skills 授权 | `DEEPL_API_KEY` | 推荐 MCP 形态 |
| feishu | 官方 `larksuite/cli`（MIT）`npx skills add larksuite/cli -g -y` | 飞书 App ID/Secret | 推荐官方通道 |

### 明确不打包（15 个）

- C 档 4 个（NewMax 自研）：data-analysis、daily-review、deep-review、blog-post-writer
- D 档 10 个（来源不明）：schedule-memory、roblox-site-architect、storage-analyzer、ppocrv5、imagemagick-conversion、gemini-image、ffmpeg-usage、remotion-video、project-init、workflow-automator
- B 档 1 个（无价值）：claude-skills-zh-cn

### 工程注意点

1. **打包机制**：复用 `bundled-skills/` 挂载点模式（现只有 `office/`）。新增技能放 `bundled-skills/extras/`，启动时按"默认启用/按需启用"两档暴露，按需项在技能页标注"需配置 API Key"。
2. **配置入口**：Leemo 需要 env 配置 UI 或 `.env` 约定来承载 `IMA_OPENAPI_*` / `DEEPL_API_KEY` / 飞书凭证——这是新需求，需立卡（密钥纪律：只经 .env，gitignore）。
3. **与 40 个内置工作流重叠检查**：打包前核对 `src/host/builtin-skills.ts` 现有目录，避免能力重复（如 ffmpeg/图片处理类）。
4. **体积**：ima 官方包 33.7KB，deepl/feishu 均 <100KB——对安装包无影响。

---

## 附：审计过程中引用的来源链接

- 腾讯 ima Skills 上线公告：[xix.ai](https://xix.ai/zh-tw/ainews/tencent-ima-unveils-skills-feature-with-note-plugin-and-openclaw-compatibility.html) / [aibase](https://www.aibase.com/zh/news/26314)；官方技能包 `https://app-dl.ima.qq.com/skills/ima-skills-1.1.2.zip`；凭证 `https://ima.qq.com/agent-interface`
- 飞书官方 CLI：[feishu.cn/feishu-cli](https://www.feishu.cn/feishu-cli)；官方仓库 `larksuite/cli`（MIT）
- feishu-doc-reader 社区版：`zhangyongcun/feishu-doc-reader`（无 LICENSE）
- deepl 技能生态：[skills.rest/skill/deepl](https://skills.rest/skill/deepl) → `zhangdszq/vk-skills`（无 LICENSE）；官方替代 [DeepL/deepl-mcp-server](https://github.com/DeepL/deepl-mcp-server)（MIT）
- baoyu 系列（上一轮审计，15 个 MIT）：`JimLiu/baoyu-skills`（MIT，24k+ stars）
- xiaohongshu-skills（MIT，12MB）：`autoclaw-cc/xiaohongshu-skills`（MIT，1.7k stars）
- Anthropic 官方（17 个，其中 11 个 Apache 2.0 / 4 个 Proprietary / doc-coauthoring）：`anthropics/skills`
- OpenClaw 生态（schedule/memory 类参考）：`geq1fan/openclaw-memory`、`Ferosin/openclaw-skills`
