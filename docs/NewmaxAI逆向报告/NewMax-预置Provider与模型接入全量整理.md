# NewMax 预置 Provider 与模型接入全量整理

> **数据来源**：`out__renderer__assets__globals-*.js` 中的 `PROVIDER_PRESETS` 硬编码数组（33 个 Provider）+ `resources/skills/newmax-help/references/models.md`（v1.1.5 官方帮助文档）+ `newmax.db` schema 逆向 + 4 个 Provider Adapter 源码交叉验证
> **整理日期**：2026-07-21

---

## 目录

1. [总体架构与代码证据](#一总体架构与代码证据)
2. [33 个 Provider 全量表（按源码分类）](#二33-个-provider-全量表按源码分类)
3. [API 格式分布与适配器对照](#三api-格式分布与适配器对照)
4. [双协议 Provider（可切换 Anthropic/OpenAI）](#四双协议-provider可切换-anthropicopenai)
5. [OAuth 订阅登录（免 API Key）](#五oauth-订阅登录免-api-key)
6. [本地模型（完全离线）](#六本地模型完全离线)
7. [NewMax Gateway（国内版内置充值）](#七newmax-gateway国内版内置充值)
8. [搜索服务 Provider](#八搜索服务-provider)
9. [视觉能力检测机制](#九视觉能力检测机制)
10. [快捷功能全景](#十快捷功能全景)
11. [模型能力特性矩阵](#十一模型能力特性矩阵)
12. [Provider 生命周期与配置 Schema](#十二provider-生命周期与配置-schema)
13. [总结：Provider 生态全景图](#十三总结provider-生态全景图)

---

## 一、总体架构与代码证据

### 1.1 架构模型

NewMax 将所有 AI 模型接入抽象为 **Provider → 模型列表** 两层模型，底层通过 4 个 Adapter + ModelGateway 本地代理屏蔽格式差异：

```
claude.exe (始终发 Anthropic Messages 格式)
    │
    ▼
127.0.0.1:{ModelGatewayPort}
    │
    ├── apiFormat=anthropic   → 直接转发（仅做 thinking 兼容处理）
    ├── apiFormat=openai      → anthropicToOpenAI() 转换请求体
    ├── apiFormat=responses   → OpenAI Responses API 端点（Codex 专用）
    ├── apiFormat=gemini      → @google/genai SDK 格式转换
    └── apiFormat=antigravity → Google Cloud Code Assist 内部 API
```

### 1.2 源码关键位置

| 代码位置 | 内容 |
|---------|------|
| `out__renderer__assets__globals-*.js` L9985-10775 | **`PROVIDER_PRESETS`** 硬编码数组（33 个 Provider 的完整默认配置） |
| `out__renderer__assets__globals-*.js` L10819 | **`getFixedApiFormatForProvider()`**——6 个 Provider 的 apiFormat 硬编码覆写 |
| `out__renderer__assets__globals-*.js` L10841 | **`PROVIDER_SWITCHABLE_BASE_URLS`**——10 个双协议 Provider 的 Base URL 对照 |
| `out__renderer__assets__globals-*.js` L10954 | **`DEFAULT_PROVIDERS`**——合并用户配置后的最终 Provider 列表 |
| `out__renderer__assets__globals-*.js` L10976 | **`mergeProviders()`**——用户配置覆盖默认预设的合并逻辑 |
| `out__renderer__assets__globals-*.js` L10783-10813 | **`KNOWN_VISION_MODELS`** / **`KNOWN_NON_VISION_MODELS`**——识图能力静态覆写表 |
| `out__renderer__assets__globals-*.js` L11012 | **`SEARCH_PROVIDER_METAS`**——9 个搜索服务 Provider |
| `out__main__anthropic-B1AZmpwC.js` | Anthropic 适配器（27KB） |
| `out__main__openai-DweheQL1.js` | OpenAI 适配器（6KB） |
| `out__main__google-CXmmmHhM.js` | Google Gemini 适配器（14KB） |
| `out__main__custom-CNyAx999.js` | Custom 适配器（10KB，通用 OpenAI-compatible + CUA function tools） |
| `newmax.db` → `settings` 表 (key='app') | Provider 列表、排序、failover 配置 |
| `newmax.db` → `model_pricing` 表 | 30+ 模型预置定价 |

---

## 二、33 个 Provider 全量表（按源码分类）

> 以下来自 `PROVIDER_PRESETS` 硬编码数组，按源码中的 4 个 category 分组。

### 2.1 Category: `cn_official`（国内官方 —— 10 个）

| # | Provider ID | 显示名称 | apiFormat | 认证 | 默认模型 | Base URL |
|---|------------|---------|-----------|------|---------|----------|
| 1 | `minimax` | MiniMax | anthropic | API Key | MiniMax-M2.7 | `api.minimaxi.com/anthropic` |
| 2 | `kimi` | Kimi Coding Plan | anthropic | API Key | kimi-for-coding | `api.kimi.com/coding/` |
| 3 | `moonshot` | Moonshot | anthropic | API Key | kimi-k2.6 | `api.moonshot.cn/anthropic` |
| 4 | `zhipu` | 智谱 | anthropic | API Key | glm-5.1 | `open.bigmodel.cn/api/anthropic` |
| 5 | `deepseek` | DeepSeek | anthropic | API Key | deepseek-v4-flash | `api.deepseek.com/anthropic` |
| 6 | `bailian` | 百炼 Coding Plan | anthropic | API Key | qwen3-coder-plus | `coding.dashscope.aliyuncs.com/apps/anthropic` |
| 7 | `stepfun` | 阶跃星辰 | **openai** | API Key | step-3.5-flash | `api.stepfun.com/v1` |
| 8 | `bailing` | 百灵 (BaiLing) | anthropic | API Key | Ling-2.6-1T | `api.tbox.cn/api/anthropic` |
| 9 | `longcat` | Longcat | anthropic | API Key | LongCat-Flash-Chat | `api.longcat.chat/anthropic` |
| 10 | `xiaomimimo` | 小米 MiMo | anthropic | API Key | mimo-v2-flash | `api.xiaomimimo.com/anthropic` |

> **注意**：阶跃星辰 (`stepfun`) 是 `cn_official` 中唯一使用 `openai` 格式的——其 apiFormat 硬编码在 `getFixedApiFormatForProvider()` 中。

### 2.2 Category: `overseas`（海外 —— 15 个）

| # | Provider ID | 显示名称 | apiFormat | 认证 | 默认模型 | Base URL |
|---|------------|---------|-----------|------|---------|----------|
| 11 | `openai` | OpenAI | **openai** | API Key | gpt-5.5 | `api.openai.com/v1` |
| 12 | `openai-oauth` | ChatGPT 订阅 | **openai** | **OAuth** | gpt-5.4 | `chatgpt.com/backend-api/codex/responses` |
| 13 | `grok-oauth` | Grok 订阅 | **openai** | **OAuth** | grok-4.3 | `api.x.ai/v1` |
| 14 | `antigravity-oauth` | Antigravity 订阅 | **antigravity** | **OAuth** | gemini-3.5-flash-extra-low | `daily-cloudcode-pa.googleapis.com` |
| 15 | `minimax-en` | MiniMax (EN) | anthropic | API Key | MiniMax-M2.7 | `api.minimax.io/anthropic` |
| 16 | `zai` | Z.ai | anthropic | API Key | glm-5.1 | `api.z.ai/api/anthropic` |
| 17 | `openrouter` | OpenRouter | anthropic | API Key | anthropic/claude-sonnet-4.6 | `openrouter.ai/api` |
| 18 | `siliconflow` | SiliconFlow | anthropic | API Key | MiniMaxAI/MiniMax-M2.7 | `api.siliconflow.com/` |
| 19 | `zenmux` | ZenMux | anthropic | API Key | zenmux/auto | `zenmux.ai/api/anthropic` |
| 20 | `aihubmix` | **AiHubMix** | anthropic | API Key | claude-sonnet-4-6 | `aihubmix.com` |
| 21 | `nvidia` | **Nvidia** | **openai** | API Key | moonshotai/kimi-k2.6 | `integrate.api.nvidia.com` |
| 22 | `pipellm-claude` | Pipellm (Claude) | anthropic | API Key | claude-opus-4-7 | `cc-api.pipellm.ai` |
| 23 | `dmxapi` | **DMXAPI** | anthropic | API Key | claude-sonnet-4-6 | `www.dmxapi.cn` |
| 24 | `groq` | **Groq** | **openai** | API Key | llama-4-scout-17b-16e-instruct | `api.groq.com/openai/v1` |
| 25 | `cerebras` | **Cerebras** | **openai** | API Key | llama-3.3-70b | `api.cerebras.ai/v1` |

> 🔴 **AiHubMix、Nvidia、DMXAPI、Groq、Cerebras** 是官方 models.md 帮助文档中**未列出**的 5 个 Provider，仅存在于 `PROVIDER_PRESETS` 硬编码数组中。它们可能在「推荐服务」标签页中显示，或作为预设配置供高级用户启用。

### 2.3 Category: `aggregator`（聚合/渠道 —— 6 个）

| # | Provider ID | 显示名称 | apiFormat | 认证 | 默认模型 | Base URL |
|---|------------|---------|-----------|------|---------|----------|
| 26 | `volcengine` | 火山方舟 (DouBao) | anthropic | API Key | doubao-seed-code-preview-latest | `ark.cn-beijing.volces.com/api/coding` |
| 27 | `siliconflow-cn` | **硅基流动** | anthropic | API Key | Pro/MiniMaxAI/MiniMax-M2.7 | `api.siliconflow.cn` |
| 28 | `modelscope` | **ModelScope** | anthropic | API Key | ZhipuAI/GLM-5 | `api-inference.modelscope.cn` |
| 29 | `gptnb` | GPTNB | anthropic | API Key | claude-sonnet-4-6 | 用户自填 |
| 30 | `pipellm-aggregator` | Pipellm (聚合) | **openai** | API Key | (无默认) | `cc-api.pipellm.ai/v1/` |
| 31 | `anthropic-channel` | Anthropic 渠道商 | anthropic | API Key | claude-sonnet-4-6 | 用户自填 |

> 🔴 **硅基流动 (CN)、ModelScope、Pipellm 聚合、Anthropic 渠道商** 是官方 help 文档中未列出的 4 个 Provider。

### 2.4 Category: `local`（本地 —— 2 个）

| # | Provider ID | 显示名称 | apiFormat | 认证 | 默认模型 | Base URL |
|---|------------|---------|-----------|------|---------|----------|
| 32 | `ollama` | Ollama | anthropic | 无需 Key | glm-4.7-flash | `localhost:11434` |
| 33 | `lmstudio` | LM Studio | anthropic | 无需 Key | openai/gpt-oss-20b | `localhost:1234` |

### 2.5 特殊 Provider：`default`

不在 `PROVIDER_PRESETS` 数组中，但在 `providerOrder` 和 `DEFAULT_ENV_MODELS` 中出现的特殊 Provider：

| Provider ID | 显示名称 | apiFormat | 说明 |
|------------|---------|-----------|------|
| `default` | 默认 (Claude) | anthropic（硬编码覆写） | 代表 Anthropic 官方 API。模型名从环境变量读取：`ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` |

---

## 三、API 格式分布与适配器对照

### 3.1 apiFormat 分布

`apiFormat` 在 `PROVIDER_PRESETS` 中只对非默认值显式声明。默认值为 `"anthropic"`。显式声明的：

| apiFormat | 数量 | Provider ID 列表 |
|-----------|------|-----------------|
| `anthropic` (默认) | **24** | minimax, kimi, moonshot, zhipu, deepseek, bailian, bailing, longcat, xiaomimimo, minimax-en, zai, openrouter, siliconflow, zenmux, aihubmix, pipellm-claude, dmxapi, volcengine, siliconflow-cn, modelscope, gptnb, anthropic-channel, ollama, lmstudio |
| `openai` | **8** | openai, openai-oauth, grok-oauth, stepfun, nvidia, groq, cerebras, pipellm-aggregator |
| `antigravity` | **1** | antigravity-oauth |

### 3.2 `getFixedApiFormatForProvider()` 硬编码覆写

```javascript
function getFixedApiFormatForProvider(providerId) {
  switch (providerId) {
    case "default":           return "anthropic";
    case "stepfun":           return "openai";      // 国内唯一 openai 格式
    case "nvidia":            return "openai";
    case "groq":              return "openai";
    case "cerebras":          return "openai";
    case "gemini-oauth":      return "gemini";      // 未来扩展
    case "antigravity-oauth": return "antigravity"; // Google Cloud Code Assist
    default:                  return null;           // 回退到 provider.apiFormat，再回退到 "anthropic"
  }
}
```

> 实际生效逻辑：`getEffectiveApiFormat()` 先查硬编码覆写 → 再查 `provider.apiFormat` → 最终回退到 `"anthropic"`。

### 3.3 4 个 Provider Adapter 对照

| Adapter | 源文件 | 大小 | 处理的 apiFormat | 对应 Provider 数 |
|---------|--------|------|-----------------|-----------------|
| **Anthropic** | `out__main__anthropic-B1AZmpwC.js` | 27KB | `anthropic` | 24 个 |
| **OpenAI** | `out__main__openai-DweheQL1.js` | 6KB | `openai` / `responses` | 8 个 |
| **Google** | `out__main__google-CXmmmHhM.js` | 14KB | `gemini` | Gemini API / Gemini 订阅 |
| **Custom** | `out__main__custom-CNyAx999.js` | 10KB | `openai` (通用) | 自定义 Provider + CUA function tools |

---

## 四、双协议 Provider（可切换 Anthropic/OpenAI）

来自源码 `PROVIDER_SWITCHABLE_BASE_URLS` 对象——以下 10 个 Provider 同时支持 Anthropic 和 OpenAI 两种 API 格式，Base URL 自动切换：

| Provider | Anthropic Base URL | OpenAI Base URL |
|----------|-------------------|-----------------|
| **deepseek** | `api.deepseek.com/anthropic` | `api.deepseek.com` |
| **moonshot** | `api.moonshot.cn/anthropic` | `api.moonshot.cn/v1` |
| **zhipu** | `open.bigmodel.cn/api/anthropic` | `open.bigmodel.cn/api/paas/v4` |
| **minimax** | `api.minimaxi.com/anthropic` | `api.minimaxi.com/v1` |
| **bailian** | `coding.dashscope.aliyuncs.com/apps/anthropic` | `dashscope.aliyuncs.com/compatible-mode/v1` |
| **volcengine** | `ark.cn-beijing.volces.com/api/coding` | `ark.cn-beijing.volces.com/api/v3` |
| **openrouter** | `openrouter.ai/api` | `openrouter.ai/api/v1` |
| **ollama** | `localhost:11434` | `localhost:11434/v1` |
| **siliconflow** | `api.siliconflow.com/` | `api.siliconflow.cn/v1` |
| **lmstudio** | `localhost:1234` | `localhost:1234/v1` |

> 设置中切换 API 格式时，Base URL 自动更新。UI 中也会根据 Provider 能力显示格式切换选项。

---

## 五、OAuth 订阅登录（免 API Key）

3 个 Provider 使用 OAuth 浏览器授权登录，无需 API Key。它们使用 `"oauth-managed"` 作为 `ANTHROPIC_AUTH_TOKEN` 的哨兵值，ModelGateway 在每次请求时替换为真实 OAuth access token。

| Provider ID | 显示名称 | apiFormat | OAuth 目标 | 默认模型 | 上下文窗口 |
|------------|---------|-----------|-----------|---------|-----------|
| `openai-oauth` | ChatGPT 订阅 | openai | OpenAI Codex CLI OAuth | gpt-5.4 | 动态 |
| `grok-oauth` | Grok 订阅 | openai | xAI OAuth (`auth.x.ai`) | grok-4.3 | 500k tokens |
| `antigravity-oauth` | Antigravity 订阅 | antigravity | Google 账号登录 | gemini-3.5-flash-extra-low | 动态 |

**多账号管理**：
- 每个 OAuth Provider 支持绑定多个账号，点击账号头像弹出多账号面板
- 可开启「账号不可用时自动切换」
- 单账号也可「退出登录」

**失败处理**：
- ChatGPT 订阅 429 限流 → 显示专属等候文案
- Grok 订阅断连 → 自动重试一次
- Antigravity 使用独立的 Google Cloud Code Assist 内部 API（非标准 Gemini API）

---

## 六、本地模型（完全离线）

| Provider ID | apiFormat | Base URL | 认证 | 默认模型 |
|------------|-----------|---------|------|---------|
| `ollama` | anthropic | `localhost:11434` | 无需 Key | glm-4.7-flash |
| `lmstudio` | anthropic | `localhost:1234` | 无需 Key | openai/gpt-oss-20b |

> 两个本地 Provider 同时也是双协议 Provider——可切换到 OpenAI 格式（`localhost:11434/v1` 和 `localhost:1234/v1`）。

---

## 七、NewMax Gateway（国内版内置充值）

独立于 Provider 系统的官方网关，不需 API Key。预置模型：

| 模型 | 类型 | 思考档位 |
|------|------|---------|
| DeepSeek V4 | 对话 | 自动 / 关闭 / 高 / 极限 |
| GLM 5.2 | 对话 | 自动 / 关闭 / 高 / 极限 |
| Doubao Seed 2.0 | 对话 | 自动 / 关闭 |
| Doubao Seed 2.1 | 对话 | 自动 / 关闭 |
| gpt-image-2 | 生图 | N币按次计费 |

---

## 八、搜索服务 Provider

9 个搜索服务 Provider（`SEARCH_PROVIDER_METAS`），独立于模型 Provider 体系：

| ID | 名称 | 特点 |
|----|------|------|
| `tavily` | Tavily | AI 优化搜索（推荐首选） |
| `exa` | Exa | 语义搜索，学术内容 |
| `brave` | Brave Search | 隐私友好 |
| `metaso` | 秘塔搜索 | 中文 AI 搜索（无需翻墙） |
| `serpapi` | SerpAPI | Google 搜索结果 API |
| `serper` | Serper | 快速 Google 搜索 |
| `bing` | Bing Search | 国内可用 |
| `google` | Google CSE | 需额外配置搜索引擎 ID |
| `firecrawl` | Firecrawl | 搜索 + 结构化网页抓取 |

---

## 九、视觉能力检测机制

NewMax 采用**探测 + 静态覆写**双层机制确定模型的识图能力：

### 9.1 静态覆写表（`KNOWN_VISION_MODELS` / `KNOWN_NON_VISION_MODELS`）

当自动探测失败时（尤其对于 Antigravity 等非标准协议），使用预置的静态表：

**已知支持识图的模型**：grok-oauth 系列（grok-4.3、grok-4.20-0309-reasoning、grok-4.20-0309-non-reasoning）、antigravity-oauth 系列（gemini-3.5-flash-low、gemini-3-flash-agent、gemini-3.1-pro-low、gemini-pro-agent、claude-sonnet-4-6、claude-opus-4-6-thinking）

**已知不支持识图的模型**：openai-oauth gpt-5.3-codex、antigravity-oauth gpt-oss-120b-medium、antigravity-oauth gemini-3.5-flash-extra-low

### 9.2 视觉 Fallback

主模型不支持识图时，自动调用已通过图片能力测试的辅助模型读取工作区内 ≤10MB 的图片。

---

## 十、快捷功能全景

### 10.1 模型选择器

- 一级菜单：Provider 列表
- 二级菜单（悬停）：该 Provider 的模型列表
- 圆环按钮：上下文窗口占用（悬停查看已用/剩余比例）
- 模型切换按对话隔离

### 10.2 思考档位（Thinking Budget）

按当前模型动态显示有效档位，不支持的档位隐藏：

| 模型系列 | 可用档位 |
|---------|---------|
| Claude | 原生强度或思考预算（按型号） |
| OpenAI GPT-5 / Codex | 关闭、低、中、高、超高、极限 |
| Gemini 3 | 原生思考级别 |
| DeepSeek V4 / GLM 5.2 | 高 / 极限 + 开关 |
| Grok 4.5 | 低 / 中 / 高 |
| Step 3.5 Flash | 低 / 高 |
| Qwen / Kimi（仅开关型） | 自动 / 关闭 |
| 火山方舟 Doubao Seed 2.0 | 自动 / 关闭 |

> 切换模型后，不支持的档位安全回退到「自动」。

### 10.3 规划 & 执行模型（双模型拆分）

| 模型 | 用途 |
|------|------|
| 规划模型 | 出方案、分析、设计 |
| 执行模型 | 代码生成、文件操作、落地执行 |

### 10.4 智能路由与故障转移

| 失败类型 | 处理策略 |
|---------|---------|
| QuotaExhausted | cooldown 5 小时，切下一个 Provider |
| RateLimited | cooldown 60 秒，切下一个 Provider |
| AuthError | 禁用 Provider，要求用户重连 |
| NetworkError | 重试 1 次，再切下一个 |

### 10.5 Provider 管理操作

| 操作 | 说明 |
|------|------|
| 拖拽排序 | 首位 = 默认 Provider |
| 启用/停用 | 开关控制 |
| 模型槽位 | 每 Provider 最多 10 个 |
| 从服务商拉取 | 获取最新模型列表 |
| 窗口大小设置 | 手写（k/M 单位，最大 10M） |
| 自动同步预设 | 升级后自动合并新版模型预设 |
| 测试连接 | 显示延迟 ms + 能力摘要 |
| 多 Key 轮换 | 同一 Provider 多把 Key + 自动切换 |
| 一键清理 | 清理旧 Provider 残留配置 |

### 10.6 图像生成

| 接口类型 | 预设模型 |
|---------|---------|
| OpenAI | `gpt-image-2` |
| Google | `gemini-3.1-flash-image`、`gemini-3-pro-image` |
| DashScope | `z-image-turbo`、`qwen-image`、`wanx2.1-t2i-turbo` |
| GPTNB 中转 | `gpt-image-2-vip`（分层）、`gpt-image-2` |

- DashScope 异步：自动提交任务 → 轮询 `task_id` → 下载结果
- 分层生图：模型名含 `vip` 的一次返回合成图 + 多图层
- 对话中可点名模型 ID 或唯一简称（如 "用 gpt image 2 生成"）

### 10.7 模型网关与 Claude 代理

| 功能 | 说明 |
|------|------|
| 模型网关 | 将 NewMax 作为本地 API 网关，供 `http://localhost:{端口}` 调用 |
| Claude 代理 | 本地 HTTP 代理，用于 Claude Code CLI 请求转发和故障转移 |

---

## 十一、模型能力特性矩阵

### 11.1 联网搜索能力

| 模型 | 联网方式 |
|------|---------|
| Claude 订阅 | 模型侧搜索 |
| Grok 订阅 | 模型侧搜索 |
| OpenAI Responses | 模型侧搜索 |
| Gemini API | 模型侧搜索 |
| 智谱 / Z.ai | 模型侧自带搜索 |
| Moonshot | 模型侧自带搜索 |
| 百炼 DashScope | 模型侧自带搜索 |
| 火山方舟 OpenAI 通道 | 模型侧自带搜索 |
| DeepSeek / MiniMax / MiMo | 内置 `WebSearch` 工具 |
| 其他 | 通过搜索服务 Provider 兜底 |

### 11.2 Computer Use (CUA)

| Adapter | 实现方式 |
|---------|---------|
| Anthropic | 原生 `computer_20251124` beta tool |
| OpenAI | 原生 `computer-preview` tool |
| Google | 原生 `BROWSER` tool |
| Custom | 11 个 function tools 模拟（0-1000 归一化坐标） |

### 11.3 多 Key / 多账号轮换

| 场景 | 机制 |
|------|------|
| 同一 Provider 多 API Key | 开启「密钥不可用时自动切换」，首次从第一把开始，不可用时自动尝试下一把 |
| OAuth 订阅多账号 | 开启「账号不可用时自动切换」，当前账号不可用时自动切换 |
| 跨 Provider | 故障转移队列（拖拽排序） |

---

## 十二、Provider 生命周期与配置 Schema

### 12.1 Provider 配置 JSON Schema

```json
{
  "id": "deepseek",
  "name": "DeepSeek",
  "apiFormat": "anthropic",
  "enabled": true,
  "isBuiltIn": false,
  "settingsConfig": {
    "env": {
      "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
      "ANTHROPIC_AUTH_TOKEN": "sk-your-api-key-here",
      "ANTHROPIC_MODEL": "deepseek-v4-pro",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
      "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro",
      "ANTHROPIC_SMALL_FAST_MODEL": "deepseek-v4-flash"
    }
  },
  "capabilities": {
    "thinking": "none",
    "vision": true,
    "toolUse": true,
    "streaming": true,
    "maxTokens": 65536
  }
}
```

### 12.2 完整生命周期

```
1. 用户添加 Provider
   设置 > 模型 > 添加提供商
   ├── PROVIDER_PRESETS 列表选择
   ├── OAuth 登录（ChatGPT/Gemini/Grok/Antigravity）
   └── 自定义（名称 + API Key + Base URL）

2. mergeProviders(userSettings, PROVIDER_PRESETS)
   └── 用户配置覆盖默认预设

3. 持久化 → newmax.db settings 表 (key='app')
   providers: [{id, name, apiFormat, enabled, settingsConfig: {env: {...}}}]

4. 用户选择 Provider → 模型

5. 环境变量注入到 claude.exe 子进程
   ANTHROPIC_BASE_URL    = 127.0.0.1:{ModelGatewayPort}
   ANTHROPIC_AUTH_TOKEN  = 真实 API Key（或 "oauth-managed"）
   ANTHROPIC_MODEL       = 模型 ID

6. ModelGateway 运行时适配
   ├── 识别目标 Provider（从 session）
   ├── apiFormat 决定适配器路由
   ├── OAuth token 替换（"oauth-managed" → 真实 access token）
   ├── 双协议 Base URL 自动选择
   ├── 格式转换（如 anthropicToOpenAI()）
   ├── SSE 事件流转换
   └── usage 提取 + 计费 + logRequest() → proxy_request_logs
```

### 12.3 数据库相关表

| 表 | 用途 |
|----|------|
| `settings` (key='app') | Provider 列表、排序、failover 配置 |
| `model_pricing` | 30+ 模型预置定价（input/output/cache_read/cache_creation） |
| `proxy_request_logs` | 每笔 API 请求的 token/费用/延迟/错误日志 |

---

## 十三、总结：Provider 生态全景图

```
                          ┌──────────────────────────────────────┐
                          │        NewMax Provider 生态           │
                          │          (v1.1.5, 33+1)             │
                          └──────────────────────────────────────┘
                                            │
        ┌───────────────┬───────────────────┼───────────────────┬───────────────┐
        │               │                   │                   │               │
        ▼               ▼                   ▼                   ▼               ▼
  ┌───────────┐  ┌───────────┐      ┌───────────┐       ┌───────────┐   ┌───────────┐
  │ cn_official│  │ overseas  │      │ aggregator│       │   local   │   │  special  │
  │   (10)    │  │   (15)    │      │    (6)    │       │    (2)    │   │    (1)    │
  ├───────────┤  ├───────────┤      ├───────────┤       ├───────────┤   ├───────────┤
  │ MiniMax   │  │ OpenAI    │      │ 火山方舟   │       │ Ollama    │   │ default   │
  │ Kimi      │  │ ChatGPT*  │      │ 硅基流动CN │       │ LM Studio │   │ (Claude)  │
  │ Moonshot  │  │ Grok*     │      │ ModelScope │       └───────────┘   └───────────┘
  │ 智谱      │  │Antigravity*│     │ GPTNB      │
  │ DeepSeek  │  │MiniMax EN │      │Pipellm聚合 │                         ┌───────────┐
  │ 百炼      │  │ Z.ai      │      │Anthropic渠 │                         │  Gateway  │
  │ 阶跃星辰  │  │OpenRouter │      └───────────┘                         │    (1)    │
  │ 百灵      │  │SiliconFlow│                                           ├───────────┤
  │ Longcat   │  │ ZenMux    │         * = OAuth 订阅登录                   │ NewMax    │
  │ 小米 MiMo │  │ AiHubMix  │                                           │ Gateway   │
  └───────────┘  │ Nvidia    │                                           │(内置充值) │
                 │Pipellm Cl │                                           └───────────┘
                 │ DMXAPI    │
                 │ Groq      │                          ┌───────────┐
                 │ Cerebras  │                          │  搜索 (9)  │
                 └───────────┘                          ├───────────┤
                                                        │ Tavily    │
      ┌───────────┐                                     │ Exa       │
      │ OAuth (3) │                                     │ Brave     │
      ├───────────┤                                     │ 秘塔      │
      │ ChatGPT   │                                     │ SerpAPI   │
      │ Grok      │                                     │ Serper    │
      │Antigravity│                                     │ Bing      │
      └───────────┘                                     │ GoogleCSE │
                                                        │ Firecrawl │
                                                        └───────────┘
```

### 关键数字

| 指标 | 数值 |
|------|------|
| **PROVIDER_PRESETS 总数** | 33 个 |
| **特殊 Provider (default)** | 1 个（不在 PRESETS 中） |
| **API 格式** | 4 种（anthropic / openai / gemini / antigravity） |
| **认证方式** | 4 种（API Key / OAuth / 无需 Key / 内置充值） |
| **OAuth 订阅** | 3 个（ChatGPT / Grok / Antigravity） |
| **本地模型** | 2 个（Ollama / LM Studio） |
| **双协议 Provider** | 10 个（可切换 Anthropic/OpenAI） |
| **搜索服务** | 9 个 |
| **视觉覆写模型** | 14 个（8 已知支持 + 3 已知不支持 + 3 动态探测） |
| **模型槽位上限** | 每 Provider 10 个 |
| **预置模型定价** | 30+ 条 |
| **Provider Adapter 源码** | 4 个文件，共 57KB |
| **硬编码 apiFormat 覆写** | 7 条（`getFixedApiFormatForProvider()`） |

### 与官方帮助文档 (`models.md`) 的差异

| 差异项 | 说明 |
|--------|------|
| 帮助文档列出 27 个 | `PROVIDER_PRESETS` 数组实际包含 33 个 |
| 未在文档出现的 Provider | AiHubMix、Nvidia、DMXAPI、Groq、Cerebras、硅基流动 CN、ModelScope、Pipellm 聚合、Anthropic 渠道商 |
| 文档提到但不在 PRESETS | Gemini API（单独管理）、自定义 Provider（动态创建） |

> 未在文档出现的 9 个 Provider 可能是：①「推荐服务」标签页中的隐藏预设 ② 灰度/实验性接入 ③ 特定地区渠道。它们都有完整的默认配置，可被 `mergeProviders()` 合并入用户配置。

---

## 十四、补充发现：推荐排序、代理要求与特殊配置

### 14.1 推荐 Provider 排序（`recommendedOrder`）

部分 Provider 在「推荐服务」标签页中按 `recommendedOrder` 排序展示：

| 排序 | Provider | 说明 |
|:--:|---------|------|
| 1 | Kimi Code | 月之暗面 Coding Plan |
| 2 | GPTNB | OpenAI 系聚合渠道 |
| 3 | Pipellm Claude | Claude 中转聚合 |
| 4 | Pipellm 聚合 | 多模型聚合平台 |

### 14.2 需要代理的 Provider（`requiresProxy: true`）

以下海外 Provider 标记为需要代理，设置中会提示配置网络代理：

| Provider | 原因 |
|---------|------|
| OpenAI | `api.openai.com` 国内可能不可达 |
| ChatGPT 订阅 | `chatgpt.com` OAuth 需要 |
| Grok (xAI) | `api.x.ai` 需要代理 + 不在绕过列表中 |
| MiniMax (EN) | `api.minimax.io` 国际端点 |
| OpenRouter | `openrouter.ai` |
| Nvidia | `integrate.api.nvidia.com` |
| Groq | `api.groq.com` |
| Cerebras | `api.cerebras.ai` |

### 14.3 特殊环境变量配置

部分 Provider 有独特的运行时配置：

| Provider | 特殊配置 | 原因 |
|---------|---------|------|
| `volcengine` (火山方舟) | `API_TIMEOUT_MS` | 火山方舟编码通道可能需要更长超时 |
| `minimax` | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1` | 禁用非必要流量以兼容 MiniMax 的 Anthropic 端点 |
| `volcengine` | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1` | 同上 |
| `longcat` | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1` + `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | LongCat 端点兼容性 + 输出限制 |
| `aihubmix` | `apiKeyField: "ANTHROPIC_API_KEY"` | AiHubMix 使用 `ANTHROPIC_API_KEY` 而非 `ANTHROPIC_AUTH_TOKEN` 作为认证头 |

### 14.4 预置模型定价表（`DEFAULT_PRICING`）

`newmax.db` → `model_pricing` 表包含 60+ 模型预置定价，按币种分为 USD 和 CNY 两类：

**USD 定价（海外模型，美元/百万 token）**：

| 模型 | 输入 | 输出 | 缓存读取 | 说明 |
|------|------|------|---------|------|
| claude-fable-5 | $10 | $50 | — | Anthropic 最新 |
| claude-opus-4-8 | $5 | $25 | $0.50 | 百万上下文旗舰 |
| claude-sonnet-4-6 | $3 | $15 | $0.30 | 主力均衡 |
| claude-haiku-4-5 | $1 | $5 | $0.10 | 轻量快速 |
| gpt-5.5 | $5 | $30 | — | OpenAI 最新 |
| gpt-5.5-pro | $30 | $180 | — | OpenAI 旗舰 |
| gpt-5.4 | $2.50 | $15 | — | 主力 |
| gpt-5.4-mini | $0.75 | $4.50 | — | 轻量 |
| gpt-5.4-nano | $0.10 | $1.25 | — | 超轻量 |
| gpt-5.4-image-2 | $8 | $15 | — | GPT 生图 |
| gemini-3.1-pro | $2 | $12 | — | Google 旗舰 |
| gemini-3.1-flash-lite | $0.10 | $0.60 | — | Google 轻量 |
| grok-4.5 | — | — | — | xAI（OAuth 订阅按量） |

**CNY 定价（国内模型，人民币/百万 token）**：

| 模型 | 输入 | 输出 | 说明 |
|------|------|------|------|
| deepseek-v4-flash | ¥1 | ¥2 | DeepSeek 轻量 |
| deepseek-v4-pro | ¥3 | ¥6 | DeepSeek 旗舰 |
| kimi-k2.6 | ¥4.5 | ¥27 | Kimi 旗舰 |
| glm-5.1 | ¥4.2 | ¥24.5 | 智谱旗舰 |
| minimax-m2.7 | ¥2.10 | ¥10.5 | MiniMax 主力 |
| qwen3-coder | ¥1.5 | ¥8 | 通义千问代码 |
| mimo-v2-flash | ¥0.7 | ¥3.5 | 小米 MiMo 轻量 |

> Anthropic 缓存定价：缓存读取通常为输入价格的 10%，缓存写入为输入价格的 25%。缓存命中的输入 token 不计入 `inputCost`，而是单独计为 `cacheReadCost`。

---

*数据来源：`out__renderer__assets__globals-*.js` `PROVIDER_PRESETS` + `DEFAULT_PRICING` 硬编码数组 + `resources/skills/newmax-help/references/models.md` + `newmax.db` schema 逆向 + 4 个 Provider Adapter 源码交叉验证*
