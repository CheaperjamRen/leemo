# NewMax 四大核心模块深度拆解报告

> **报告定位**：对 NewMax v1.1.5 的交互可视化、语音输入、浏览器自动化、长期项目四大模块进行原子级拆解
> **前序报告**：`NewMax-产品力深度逆向分析报告.md`（765行）+ `NewMax-深度补充分析报告-数据库-Skill-安全-智能体.md`（685行）
> **本报告补充**：四大模块的架构设计、代码实现、数据流、设计决策与可复现方法论
> **分析日期**：2026-07-20

---

## 一、交互可视化系统

### 1.1 概述

NewMax 的交互可视化是**AI 生成的 HTML/CSS/JS 组件直接嵌入聊天回复**的系统。它不是"AI 生成图表然后截图"——而是直接在聊天界面中渲染一个**受控沙箱**，用户可以在其中拖拽参数、切换视图、实时观察结果变化。

这是 NewMax 产品力最强的**差异化功能**之一：竞品（Claude Code、Cursor、Copilot Chat）全部没有这个能力。

### 1.2 核心架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户与 Chat UI                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │  AI 回复（Markdown）                              │   │
│  │  ┌─────────────────────────────────────────┐    │   │
│  │  │  ████████████████████████████████████  │    │   │
│  │  │  █  交互式可视化 iframe (沙箱)         █  │    │   │
│  │  │  █  HTML/CSS/JS → 参数滑块/图表/...   █  │    │   │
│  │  │  ████████████████████████████████████  │    │   │
│  │  └─────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         ↕ IPC
┌─────────────────────────────────────────────────────────┐
│              Electron Main Process                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │  mcp__visualization MCP Server                    │   │
│  │  ├── create_visualization(file, html)             │   │
│  │  └── read_visualization(file)                     │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  HTML 片段存储 → messages.data.visualization      │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 1.3 MCP 工具定义

可视化系统通过两个 MCP 工具暴露给 AI：

```yaml
# create_visualization 参数
file: string       # 小写 kebab-case 文件名，如 "stock-simulator.html"
                   # 不带子目录，宿主自动管理

html: string       # 自包含 HTML 片段（<2MB）
                   # 禁止包含 <html>/<head>/<body> 包装
                   # 禁止外部资源（CDN/fetch/WebSocket/iframe）
                   # 允许内联 <script> 和 <style>

# read_visualization 参数
file: string       # 要读取的可视化文件名
```

**关键约束**（从系统提示中提取的完整规则）：

| 约束 | 说明 | 设计意图 |
|------|------|----------|
| 无外部网络 | 禁止 `<script src>`、CDN、fetch、WebSocket | 安全沙箱 |
| 仅内联脚本 | `<script>` 标签内的 JS | 可控执行环境 |
| CSS 变量引用 | `--ds-*`、`--viz-*` 系列变量 | 自动主题适配 |
| 响应式 | 320px ~ 736px 宽度 | 聊天列宽自适应 |
| `prefers-reduced-motion` | 尊重系统无障碍设置 | 无障碍合规 |
| 文件命名 | kebab-case，无子目录 | 防止路径遍历 |

### 1.4 CSS Design Token 系统

NewMax 定义了一套完整的 CSS 自定义属性（Design Tokens），分为两大系列：

#### 1.4.1 空间令牌 `--ds-space-*`

提供 6 级间距，用于可视化组件内部布局：

```
--ds-space-1: 4px    # 最小间距（图标与文字之间）
--ds-space-2: 8px    # 卡片之间、标题与内容之间
--ds-space-3: 12px   # 内容区块之间
--ds-space-4: 16px   # 标准边距
--ds-space-5: 20px   # 大边距
--ds-space-6: 24px   # 最大边距（页面级分隔）
```

#### 1.4.2 图表令牌 `--viz-*`

用于 SVG/Canvas 绘图的颜色变量，随主题自动切换：

```
--viz-chart-text         # SVG 文字和主标签颜色
--viz-chart-text-muted   # 坐标轴、图例、次要标签
--viz-chart-grid         # 网格线
--viz-chart-track        # 未填充的条形
--viz-chart-surface      # 图表分隔/裁切区域
```

**关键设计**：SVG 文字默认 `fill` 继承 `--viz-chart-text`，切换主题时**自动更新**。Canvas 则需要监听 `newmax-visualization-themechange` 事件并重新绘制。

### 1.5 NewMax Visualization UI Kit (`newmax-v4`)

这是一套**完整的 UI 组件类名体系**，AI 生成的可视化 HTML 中使用这些类名即可获得与 NewMax 一致的视觉效果：

#### 1.5.1 布局类

| 类名 | 用途 | 规则 |
|------|------|------|
| `.viz-title` | 主标题 | 页面级标题 |
| `.viz-subtitle` | 副标题 | 区块级副标题 |
| `.viz-section` | 内容区块容器 | 包裹每个主题内容 |
| `.viz-section-title` | 区块标题 | `.viz-section` 内的标题 |
| `.viz-grid` | 网格布局 | 自动响应式列 |
| `.viz-row` | 水平排列 | flex row |
| `.viz-stack` | 垂直堆叠 | flex column |
| `.viz-toolbar` | 工具栏 | 按钮/控件组合 |
| `.viz-divider` | 分割线 | 视觉分隔 |

#### 1.5.2 卡片类

| 类名 | 说明 |
|------|------|
| `.viz-card` | 默认卡片（surface-200 背景 + 阴影） |
| `.viz-card-header` | 卡片头部 |
| `[data-variant="flat"]` | 扁平变体（无阴影，用于列表项） |

**语义分层**：
- 默认卡片 → surface-200（有深度感）
- Metric 卡片 / Filled 卡片 → surface-100（更亮的前景层）
- 不要把所有卡片放在同一背景色上

#### 1.5.3 数据展示类

| 类名 | 说明 |
|------|------|
| `.viz-metric` | 指标卡片（已是完整卡片，不要再用 `.viz-card` 包裹） |
| `.viz-metric-label` | 指标标签 |
| `.viz-metric-value` | 指标数值 |
| `.viz-metric-detail` | 指标补充说明 |
| `.viz-number` | 数字样式 |
| `.viz-positive` | 正向/增长（绿色） |
| `.viz-negative` | 负向/下降（红色） |
| `.viz-muted` | 弱化文本 |
| `.viz-tag` | 标签/徽章 |

#### 1.5.4 控件类

| 类名 | 变体 |
|------|------|
| `.viz-button` | `data-variant`: `primary` / `secondary` / `tertiary` / `ghost` / `danger` |
| | `data-size`: `mini` / `small` / `large` |
| `.viz-field` | 表单字段容器 |
| `.viz-label` | 字段标签 |
| `.viz-input` | 文本输入 |
| `.viz-select` | 下拉选择 |
| `.viz-textarea` | 多行文本 |
| `.viz-range` | 范围滑块 |
| `.viz-check` | 复选框 |
| `.viz-switch` | 开关切换 |
| `.viz-tabs` | 标签页容器 |
| `.viz-tab` | 标签按钮 `data-tab="value"` |
| `.viz-table` | 数据表格（包裹在 `.viz-table-wrap` 中） |
| `[data-align="number"]` | 数字列右对齐 |

#### 1.5.5 标签页系统

```html
<!-- 精确宽度模式 -->
<div class="viz-tabs">
  <button class="viz-tab" data-tab="overview" aria-selected="true">概览</button>
  <button class="viz-tab" data-tab="detail">详情</button>
</div>

<!-- 等宽模式 -->
<div class="viz-tabs" data-stretch>
  <button class="viz-tab" data-tab="overview" aria-selected="true">概览</button>
  <button class="viz-tab" data-tab="detail">详情</button>
</div>

<div data-tab-panel="overview">...</div>
<div data-tab-panel="detail" hidden>...</div>
```

### 1.6 渲染管道

```
AI 调用 create_visualization(file, html)
  │
  ├── 1. 参数验证
  │   ├── file: kebab-case + .html 扩展名
  │   ├── html: <2MB，不含 <html>/<head>/<body>
  │   └── html: 不含外部资源引用
  │
  ├── 2. 沙箱包装
  │   ├── 注入 CSS 变量（主题 Token）
  │   ├── 注入 newmax-v4 组件样式
  │   ├── 设置 Content-Security-Policy
  │   └── 注入 themechange 事件监听
  │
  ├── 3. 存储
  │   ├── 文件写入工作区（可视化专用目录）
  │   └── 消息 data.visualization 字段记录路径
  │
  └── 4. 渲染
      ├── Electron BrowserView / iframe
      ├── 宿主自动嵌入聊天界面
      └── 用户可直接交互（拖拽/点击/输入）
```

### 1.7 数据存储

可视化 HTML 片段在 `messages.data` JSON 中的存储结构：

```json
{
  "thinking": "...",
  "tool_calls": [
    {
      "tool": "create_visualization",
      "input": {
        "file": "portfolio-analyzer.html",
        "html": "<div class=\"viz-section\">..."
      }
    }
  ],
  "visualization": {
    "file": "portfolio-analyzer.html",
    "path": "/workspace/visualizations/portfolio-analyzer.html"
  }
}
```

### 1.7a 主题系统深度拆解（OKLCH 色彩引擎）

从渲染进程源码（`out__renderer__assets__index-DUPO04mz.js`）中逆向提取的完整主题生成算法：

**7 种色调风格（MOOD_SPECS）**：

| 风格 | 权重 | 特征 |
|------|------|------|
| `crisp` | 25 | 默认风格，高对比度，清晰锐利 |
| `pastel` | 20 | 柔和粉彩感，低饱和度 |
| `bold` | 20 | 高对比度粗体，活泼有力 |
| `minimal` | 20 | 极简低彩度，干净克制 |
| `cream` | 15 | 暖色调奶油色，舒适温馨 |
| `noir` | 12 | 消色差黑白灰，专业冷峻 |
| `vivid` | 12 | 高彩度饱和色，鲜艳夺目 |

**7 种色相方案（HUE_SCHEMES）**：
`mono` | `analogous` | `complementary` | `split-comp` | `triadic` | `tetradic` | `free`

**核心算法**：
```javascript
// 基于 oklch 色彩空间
generateRandomTheme() {
  // 1. 随机选 mood + hue_scheme
  // 2. 根据 mood 的 lightness/chroma 参数生成主色
  // 3. 根据 hue_scheme 计算辅助色
  // 4. 生成 40+ CSS 自定义属性注入 :root
}
```

**--ds-* 令牌完整列表**（40+ 变量，涵盖浅色/深色双模式）：
```css
/* 文字 */
--ds-text-primary, --ds-text-secondary (56% opacity), --ds-text-tertiary (30% opacity)

/* 品牌 */
--ds-brand-primary, --ds-brand-primary-text

/* 表面（从亮到暗的层次） */
--ds-surface-100 (白色), --ds-surface-200/300/400

/* 交互 */
--ds-on-surface, --ds-on-surface-active, --ds-selection-bg
--ds-pill-bg, --ds-divider, --ds-icon, --ds-accent

/* 阴影（6级投影 + 3级输入框阴影） */
--ds-elevation-100/200/300, --ds-menu-shadow, --ds-input-shadow*

/* 语义色 */
--ds-success, --ds-danger, --ds-warning
--ds-success-bg, --ds-danger-bg, --ds-warning-bg

/* 动画 */
--ds-duration-base, --ds-ease-swift
--ds-motion-soft, --ds-motion-swift, --ds-motion-spring

/* 圆角 */
--ds-radius-sm, --ds-radius-md, --ds-radius-lg, --ds-radius-pill

/* 其他 */
--ds-surface-disabled, --ds-surface-input, --ds-scroll-fade
```

**与 --viz-* 的关系**：
`--viz-*` 系列并不作为 CSS 变量存在——它是**系统提示中的设计指导**。实际可视化组件使用的底层变量全部是 `--ds-*` 系列。`--viz-chart-text` 等名称是告诉 AI "用这些逻辑名称来设计"，宿主环境将它们映射到具体的 `--ds-*` 变量。

### 1.8 设计亮点与为什么好

| 设计决策 | 为什么好 |
|----------|----------|
| **AI 直接写 HTML** | 不依赖图表库、不需要 API 调用，AI 天然擅长生成 HTML/CSS/JS |
| **Design Token 系统** | 所有可视化自动适配深浅主题，无需每个组件处理主题切换 |
| **CSS 类名体系** | AI 只需写标准类名即可获得专业的 UI 外观，降低生成质量方差 |
| **沙箱隔离** | 禁止外部网络，防止数据泄露和恶意代码 |
| **内联自包含** | 单个 HTML 文件包含所有逻辑，复制粘贴即可分享 |
| **响应式约束** | 强制适配聊天列宽，避免溢出 |
| **主题事件驱动** | Canvas 通过 `newmax-visualization-themechange` 事件重新渲染，不失帧 |
| **SVG 自动适配** | SVG 使用 CSS 变量做 fill/stroke，主题切换零代码 |
| **非图片渲染** | HTML 内嵌而非截图，支持交互操作、数据探索 |

### 1.9 可复现的关键技术

如果要实现类似的系统，需要的核心组件：

1. **Design Token 定义**：一套 `--ds-*` 和 `--viz-*` CSS 变量，覆盖间距、颜色、排版
2. **UI Kit CSS**：一组语义化类名，AI 可以直接使用
3. **沙箱 iframe**：CSP 策略 + `sandbox` 属性 + 禁止外部资源
4. **主题桥接**：父窗口向 iframe 注入 CSS 变量 + 主题变更事件
5. **MCP 工具**：`create_visualization` 和 `read_visualization` 两个工具即可

---

## 二、语音输入系统

### 2.1 概述

NewMax 的语音输入采用**完全本地离线**方案，基于 sherpa-onnx 引擎。不依赖任何云端 API（如 Whisper API、Azure Speech），所有语音处理在用户本机完成。

技术栈：`sherpa-onnx → ONNX Runtime → Native Node Addon`

### 2.2 架构全景

```
┌──────────────────────────────────────────────────┐
│                    用户界面                        │
│  ┌──────────┐    ┌──────────────────────────┐    │
│  │ 语音按钮  │    │  实时转写文字流            │    │
│  │ (麦克风)  │    │  "今天天气怎么样..."      │    │
│  └──────────┘    └──────────────────────────┘    │
└──────────────────────────────────────────────────┘
         ↕ IPC
┌──────────────────────────────────────────────────┐
│           Electron Main Process                   │
│  ┌────────────────────────────────────────────┐  │
│  │        语音管道 (Speech Pipeline)           │  │
│  │                                            │  │
│  │  麦克风 → PCM Buffer → VAD → ASR → Text    │  │
│  │     ↑          ↑         ↑      ↑          │  │
│  │  node-pty   环形缓冲   人声检测  流式识别    │  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │        sherpa-onnx-node (JS Wrapper)        │  │
│  │  ├── OnlineRecognizer  ← 流式语音识别       │  │
│  │  ├── OfflineRecognizer ← 批量语音识别       │  │
│  │  ├── Vad              ← 语音活动检测        │  │
│  │  ├── CircularBuffer   ← 环形音频缓冲        │  │
│  │  ├── OfflineTts       ← 文本转语音          │  │
│  │  ├── OnlinePunctuation ← 在线标点           │  │
│  │  ├── KeywordSpotter   ← 关键词检测          │  │
│  │  ├── SpeakerIdentification ← 说话人识别     │  │
│  │  ├── AudioTagging     ← 音频标签分类        │  │
│  │  └── SpeechDenoiser   ← 语音降噪            │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │      sherpa-onnx-win-x64 (Native Layer)     │  │
│  │  ├── onnxruntime.dll (16MB)                 │  │
│  │  ├── sherpa-onnx-c-api.dll (4.4MB)          │  │
│  │  ├── sherpa-onnx-cxx-api.dll (237KB)        │  │
│  │  └── sherpa-onnx.node (657KB) ← Node Addon  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 2.3 流式语音识别核心流程

从 `sherpa-onnx-node/streaming-asr.js` 源码逆向的完整流程：

```
1. 创建识别器
   const recognizer = new OnlineRecognizer(config)
   // config 包含：模型路径、采样率、特征维度、解码参数

2. 创建音频流
   const stream = recognizer.createStream()

3. 音频循环（麦克风回调）
   while (recording) {
     // 3a. 接收 PCM 音频数据
     stream.acceptWaveform({
       samples: Float32Array,   // PCM 浮点采样
       sampleRate: 16000        // 16kHz
     })

     // 3b. 检查流是否就绪
     if (recognizer.isReady(stream)) {
       // 3c. 触发解码
       recognizer.decode(stream)
     }

     // 3d. 获取当前识别结果
     const result = recognizer.getResult(stream)
     // result = { text: "今天天气", tokens: [...], ... }
     // 实时推送到 UI

     // 3e. 检查是否检测到语音结束
     if (recognizer.isEndpoint(stream)) {
       recognizer.reset(stream)  // 准备下一个语音段
     }
   }

4. 结束
   stream.inputFinished()
```

### 2.4 VAD（语音活动检测）机制

```javascript
// 从 vad.js 逆向
class Vad {
  constructor(config, bufferSizeInSeconds)

  // 持续喂入音频
  acceptWaveform(samples: Float32Array)

  // 检测状态
  isEmpty(): boolean      // 缓冲区是否为空
  isDetected(): boolean   // 当前是否检测到人声

  // 取出检测到的语音段
  front(): SpeechSegment  // 查看最早检测到的语音段
  pop(): void            // 移除最早的语音段

  // 状态管理
  reset(): void
  flush(): void
  clear(): void
}

// CircularBuffer 支持
class CircularBuffer {
  constructor(capacity)   // capacity = 采样点数
  push(samples)           // 写入
  get(startIndex, n)      // 读取（不弹出）
  pop(n)                  // 读取并弹出
  size()                  // 当前大小
  head()                  // 头部索引
  reset()                 // 清空
}
```

**VAD 设计精妙之处**：
- 环形缓冲区避免频繁内存分配
- `isDetected()` 不阻塞，可以在 UI 层展示"正在听..."动画
- `front()` 和 `pop()` 分离，可以先检查语音段长度再决定是否处理

### 2.5 原生层详解

#### 2.5.1 文件清单

| 文件 | 大小 | 说明 |
|------|------|------|
| `onnxruntime.dll` | 16 MB | Microsoft ONNX Runtime，执行神经网络推理 |
| `onnxruntime_providers_shared.dll` | 105 KB | 共享执行提供者 |
| `sherpa-onnx-c-api.dll` | 4.4 MB | sherpa-onnx C API 接口层 |
| `sherpa-onnx-cxx-api.dll` | 237 KB | sherpa-onnx C++ API 接口层 |
| `sherpa-onnx.node` | 657 KB | Node.js N-API 原生插件 |

#### 2.5.2 Node Addon 暴露的 API（从 sherpa-onnx.js 汇总）

```javascript
module.exports = {
  // === 语音识别 ===
  OnlineRecognizer,              // 流式 ASR
  OfflineRecognizer,             // 批量 ASR（录完再识别）

  // === 语音合成 ===
  OfflineTts,                    // TTS 引擎
  GenerationConfig,              // TTS 配置

  // === 语音活动检测 ===
  Vad,                           // VAD 检测器
  CircularBuffer,                // 环形缓冲

  // === 音频工具 ===
  readWave,                      // 读取 WAV 文件
  writeWave,                     // 写入 WAV 文件
  Display,                       // 识别结果展示辅助

  // === 高级功能 ===
  SpokenLanguageIdentification,  // 语种识别（说的是什么语言）
  SpeakerEmbeddingExtractor,     // 说话人声纹提取
  SpeakerEmbeddingManager,       // 声纹管理（注册/比对）
  AudioTagging,                  // 音频标签分类
  OfflinePunctuation,            // 离线标点恢复
  OnlinePunctuation,             // 在线标点恢复（流式）
  KeywordSpotter,                // 关键词识别（唤醒词）
  OfflineSpeakerDiarization,     // 说话人分离（谁在什么时候说话）
  OfflineSpeechDenoiser,         // 语音降噪

  // === 元信息 ===
  version,                       // sherpa-onnx 版本
  gitSha1,                       // Git commit
  gitDate,                       // 构建日期
}
```

### 2.5a Preload IPC 桥（渲染进程 ↔ 主进程）

从逆向的 `out__preload__index.mjs` 中提取的完整 `window.newmax` 语音 API：

```javascript
// === 语音模型管理 ===
voiceModel.getStatus()              // 获取模型下载状态
voiceModel.download()               // 开始下载 SenseVoice 模型
voiceModel.cancelDownload()         // 取消下载
voiceModel.delete()                 // 删除已下载模型
voiceModel.transcribe(params)       // 完整转录（传入 WAV Base64）
voiceModel.transcribeInterim(wavBase64)  // 实时中间转录
voiceModel.saveRecording(params)    // 保存录音到磁盘
voiceModel.requestMicPermission()   // 请求麦克风权限
voiceModel.openMicSettings()        // 打开系统麦克风设置

// 事件监听
voiceModel.onDownloadProgress(cb)   // 下载进度回调
voiceModel.onStartRecording(cb)     // 录音开始
voiceModel.onStopRecording(cb)      // 录音停止
voiceModel.onCancelRecording(cb)    // 录音取消

// === 语音指示器 ===
voiceIndicator.onStateChanged(cb)   // 浮窗状态同步

// === 转录历史 ===
transcriptions.list(params)         // 列出转录记录
transcriptions.get(id)              // 获取单条
transcriptions.delete(id)           // 删除
transcriptions.deleteAll()          // 清空

// === 会议纪要 ===
meeting.start()                     // 开始会议录音
meeting.appendChunk(params)         // 追加音频块
meeting.finalize(params)            // 结束会议
meeting.transcribe(params)          // 转录会议音频
```

### 2.5b 客户端 VAD 参数（从渲染进程源码提取）

```javascript
TARGET_SAMPLE_RATE = 16000          // 16kHz（SenseVoice 要求）
MIN_RECORDING_MS = 300              // 最短录音时长
VAD_RMS_THRESHOLD = 0.015           // RMS 音量阈值
VAD_SILENCE_DURATION_MS = 600       // 静音超时 → 语音段结束
VAD_MIN_SPEECH_MS = 300             // 最短语音段判定
CHECKPOINT_INTERVAL_MS = 30000      // 定时保存检查点
```

**VAD 工作流程**：
```
1. AudioContext(16000) → createScriptProcessor(4096, 1, 1)
2. 每个 4096 采样 chunk → 计算 RMS
3. RMS > 0.015 → 标记"说话中"，累积样本
4. RMS < 0.015 持续 600ms → 语音段结束
5. 语音段 >= 300ms → 编码 WAV → Base64 → transcribeInterim()
6. 静音期间 → 重新等待下一个语音段
```

**双轨转录策略**：
- `transcribeInterim()`：每个语音段结束时立即调用，**实时**展示识别文字
- `transcribe()`：录音完全停止后调用，**最终完整**转录（包含全文标点恢复）

### 2.5c 本地 HTTP API 服务

从源码中提取的 SenseVoice 本地 API：

```
端口：127.0.0.1:18923
端点：
  POST /v1/audio/transcriptions  ← 语音转文字
  GET  /v1/audio/models/status   ← 模型状态
请求格式：{ "audioPath": "/path/to/file.wav", "language": "auto" }
支持格式：wav, mp3, flac, m4a, ogg, aac + 视频格式
```

这意味着**外部程序也可以调用 NewMax 的本地语音识别服务**——一个隐藏的本地 ASR 微服务。

### 2.6 模型管理

从 `newmax.db` 的 `transcriptions` 表和相关设置推断：

```sql
CREATE TABLE transcriptions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,      -- 'microphone' | 'file'
    audio_path TEXT,           -- 音频文件路径
    audio_filename TEXT,       -- 原始文件名
    -- 其他字段（duration, language, text, confidence...）
);
CREATE INDEX idx_transcriptions_created_at ON transcriptions(created_at DESC);
```

**模型下载机制**（从设置系统推断）：
- 模型不随安装包分发（太大，常见模型 100-500MB）
- 通过"设置 > 语音"界面按需下载
- 支持多种语言模型：中文、英文、中英混合等
- 模型存储在工作区外的专用目录（避免备份时带走大文件）

### 2.7 完整能力矩阵

| 功能 | 实现方式 | 离线？ | 说明 |
|------|----------|--------|------|
| 实时语音输入 | OnlineRecognizer | ✅ | 边说边识别，流式输出 |
| 录音后转录 | OfflineRecognizer | ✅ | 录完再识别，准确率更高 |
| 语音活动检测 | Vad | ✅ | 自动切分语音段，静音检测 |
| 标点恢复 | OnlinePunctuation | ✅ | 流式添加标点符号 |
| 说话人识别 | SpeakerIdentification | ✅ | 声纹提取 + 比对 |
| 说话人分离 | SpeakerDiarization | ✅ | 多人对话中标记"谁说了什么" |
| 语种识别 | SpokenLanguageIdentification | ✅ | 自动检测输入语言 |
| 关键词唤醒 | KeywordSpotter | ✅ | 支持自定义唤醒词 |
| 音频分类 | AudioTagging | ✅ | 识别环境音类型 |
| 语音降噪 | SpeechDenoiser | ✅ | 去除背景噪音 |
| 文本转语音 | OfflineTts | ✅ | 将文字合成为语音 |

### 2.8 设计亮点

| 设计决策 | 为什么好 |
|----------|----------|
| **全离线** | 隐私安全 + 零延迟 + 无需网络 |
| **流式 + 批量双模式** | 实时场景用流式，高精度场景用批量 |
| **VAD 分离设计** | 语音检测和语音识别解耦，可以独立替换 |
| **环形缓冲区** | 避免内存碎片，高频音频写入零分配 |
| **标点独立模块** | ASR 结果通常无标点，后处理加上，不影响识别速度 |
| **ONNX Runtime** | 跨平台模型推理，不绑定特定 AI 框架 |
| **按需下载模型** | 不预装大模型文件，减小安装包体积 |
| **完整工具箱** | 不只是 ASR，包含 10+ 种语音处理能力 |

### 2.9 可复现方案

如果要实现类似的本地语音系统：

```
技术选型：
├── 推荐：sherpa-onnx（NewMax 同款，C++/Python/Node.js 全平台）
├── 备选：whisper.cpp（GGML 格式，CPU 友好）
├── 备选：Vosk（轻量，多语言）
└── 需联网：Whisper API

集成步骤：
1. 安装 sherpa-onnx Node.js 包
2. 下载对应语言的预训练模型（.onnx 文件）
3. 实现麦克风采集 → Float32Array PCM 的桥接
4. 接入 OnlineRecognizer 流式识别
5. 可选：接入 Vad 优化语音段切分
6. 可选：接入 Punctuation 添加标点
```

---

## 三、浏览器自动化系统

### 3.1 概述

NewMax 的浏览器自动化是一个**AI 直接操控真实 Chrome 浏览器**的系统，通过 Chrome DevTools Protocol（CDP）实现。它不是无头浏览器（headless），而是操控用户可见的 Chrome 实例。

核心能力链：**录制操作 → 提取策略 → 参数化 → 可复用 Workflow → 一键回放**

### 3.2 架构全景

```
┌──────────────────────────────────────────────────────────┐
│                   用户与 Chat UI                          │
│  "帮我在小红书上发布这个视频"                                  │
│  → AI: 调用 browser-use MCP 工具链                         │
│  → AI: 实时汇报操作进度                                     │
│  → 用户：看到 Chrome 窗口自动操作                            │
└──────────────────────────────────────────────────────────┘
         ↕ IPC
┌──────────────────────────────────────────────────────────┐
│              Electron Main Process                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │         browser-use MCP Server                      │  │
│  │                                                    │  │
│  │  基础操作:                                           │  │
│  │  ├── browser_open(url, profile)                     │  │
│  │  ├── browser_close()                                │  │
│  │  ├── browser_click(x, y)       ← 坐标点击           │  │
│  │  ├── browser_click_element(selector) ← CSS 选择器   │  │
│  │  ├── browser_type(text)        ← 键盘输入           │  │
│  │  ├── browser_key(keys)         ← 按键               │  │
│  │  └── browser_scroll(direction) ← 滚动               │  │
│  │                                                    │  │
│  │  信息获取:                                           │  │
│  │  ├── browser_eval(expression)  ← JS 执行            │  │
│  │  ├── browser_screenshot()      ← 截图               │  │
│  │  └── browser_save_file(expr, path) ← 数据导出       │  │
│  │                                                    │  │
│  │  自动化:                                             │  │
│  │  ├── browser_list_workflows()   ← 列出已录制流程    │  │
│  │  ├── browser_workflow_run(id, params) ← 执行流程    │  │
│  │  ├── browser_list_profiles()    ← 列出浏览器身份    │  │
│  │  └── browser_pause_for_human(reason) ← 人工接管     │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Chrome DevTools Protocol (CDP)              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │ Page     │  │ Runtime  │  │ DOM              │  │  │
│  │  │ .navigate│  │ .evaluate│  │ .setFileInputFile│  │  │
│  │  │ .capture │  │ .callFn  │  │ .querySelector   │  │  │
│  │  └──────────┘  └──────────┘  └──────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Chrome Profile Manager                      │  │
│  │  ~/.newmax/chrome-profiles/                         │  │
│  │  ├── bp-default/  ← 浏览器自动化专用（独立登录态）   │  │
│  │  └── chat-default/ ← 聊天浏览器专用                 │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 3.3 操作纪律：AI 的浏览器操作手册

从系统提示中提取的完整操作优先级：

```
优先级 1（零 token，毫秒级）：
  → browser_list_workflows 检查是否有已录制的 Workflow
  → 有匹配的 → browser_workflow_run 执行（最快）

优先级 2（读 DOM，零截图）：
  → browser_eval 读取页面结构（文字/链接/数据）
  → browser_click_element 通过 CSS 选择器点击
  → 比坐标点击精准，不怕页面布局位置变化

优先级 3（需要视觉判断时）：
  → browser_screenshot 截图看页面样子

优先级 4（最后手段）：
  → browser_click(x, y) 坐标点击
  → 仅用于 canvas/图片按钮等无法用选择器的情况
```

**关键原则**：

| 操作 | 用什么 | 为什么 |
|------|--------|--------|
| 读页面内容 | `browser_eval` | 零截图，省 token，毫秒级返回 |
| 点击按钮 | `browser_click_element(CSS)` | 比坐标精准，不怕偏移 |
| 输入文字 | 先 `browser_click_element` 聚焦 → `browser_type` | React 受控组件需要 CDP 设置 value |
| 文件上传 | CDP `DOM.setFileInputFiles` | input.value 赋值被浏览器安全限制 |
| 滚动加载 | `browser_scroll` | 触发懒加载后 eval 读内容 |
| CAPTCHA/登录 | `browser_pause_for_human` | 人工接管，不卡死 |

### 3.4 Chrome Profile 管理

NewMax 的 Chrome Profile 是**完整的 Chromium 用户数据目录**：

```
~/.newmax/chrome-profiles/bp-default/
├── Default/                    ← Chrome 默认 Profile
│   ├── Preferences             ← 浏览器设置/扩展/主题
│   ├── Cookies / Cookie-journal ← 登录态（关键！）
│   ├── Local Storage/          ← localStorage 数据
│   ├── Session Storage/        ← sessionStorage 数据
│   ├── Extensions/             ← 已安装扩展
│   ├── Web Data                ← 表单自动填充/密码
│   └── ...
├── Local State                 ← 全局浏览器状态
├── Last Browser                ← 上次浏览器信息
├── Last Version                ← Chrome 版本
└── Variations                  ← Chrome 实验特性
```

**设计精妙之处**：
- 每个 Profile 是独立的浏览器身份（像 Chrome 多用户）
- 不同 Profile 有完全独立的登录态、Cookie、扩展
- Profile 之间互不干扰
- AI 操作 `bp-default` Profile 时，用户的个人 Chrome 完全不受影响
- 支持多 Profile：用户可以有"工作"和"个人"两个浏览器身份

### 3.5 Workflow 系统

这是浏览器自动化的**核心增值功能**。

#### 3.5.1 Workflow 生命周期

```
1. AI 执行浏览器任务
   ↓
2. 任务完成后，AI 输出 <strategy> 标签
   包含完整的执行策略（选择器、步骤、参数）
   ↓
3. 系统解析 <strategy> 并保存为 Workflow
   ↓
4. 下次相同任务时：
   browser_list_workflows → 匹配 workflow
   → browser_workflow_run(workflow_id, params)
   → 零 token 执行（直接 CDP 命令，无需 LLM）
```

#### 3.5.2 IPC 接口（Preload Bridge）

```javascript
// Workflow CRUD
browser:workflow:list              → workflowList(profileId)
browser:workflow:get               → workflowGet(id)
browser:workflow:save              → workflowSave(params)
browser:workflow:delete            → workflowDelete(id)
browser:workflow:update            → workflowUpdate(id, params)
browser:workflow:update-strategy   → workflowUpdateStrategy(id, strategy)

// Workflow 质量
browser:workflow:confidence        → workflowConfidence(id)       // 可信度评分
browser:workflow:history           → workflowHistory(id)          // 执行历史
browser:workflow:review            → workflowReview(id)           // 查看策略
browser:workflow:review-raw        → workflowReviewRaw(input)     // 原始策略

// 执行
browser:workflow:run               → workflowRun(workflowId, profileId, modelConfig)
browser:workflow:run-with-steps    → workflowRunWithSteps(workflowId, profileId, steps)
browser:workflow:export            → workflowExport(id)

// Profile 管理
browser:profile:list               → 列出所有 Chrome 身份
browser:profile:create             → 创建新 Profile
browser:profile:export             → 导出登录态
browser:profile:import             → 导入登录态
browser:profile:clear              → 清除登录态（登出）

// 窗口控制
browser:window:open(profileId, url)
browser:window:screenshot(profileId)
browser:window:close(profileId)

// AI Agent 控制
browser:agent:run(profileId, instruction, modelConfig)
browser:agent:stop(profileId)
browser:agent:status(profileId)
```

#### 3.5.3 三级失败处理

| 级别 | 信号 | 行为 |
|------|------|------|
| 全成功 | 所有步骤 `tool_result` 正常 | `browser_close`，返回结果 |
| 部分失败 | `tool_result` 以 `⚠` 开头 | 浏览器保持打开，从失败步骤**增量补救** |
| 硬失败 | `tool_result` 以 `✗` 开头 | 用 `strategy` 字段的 Markdown 描述**手动重做** |

#### 3.5.2 Strategy 格式

```xml
<strategy>
## 小红书视频发布流程
1. browser_open 打开 https://creator.xiaohongshu.com/publish/publish?from=menu&target=video
2. 文件上传：找到 input[type=file]，用 CDP DOM.setInputFileFiles 设置文件路径 {{video_file_path}}
   - 不要尝试 input.value 赋值（浏览器安全限制会失败）
   - 不要尝试 AppleScript 操作文件对话框（不可靠）
3. 等待上传完成：轮询检查上传进度，直到 100%
4. 填写标题：用 browser_eval 找到标题 input，CDP 清空后 browser_type 输入 {{title}}（限20字）
   - React controlled input 不响应普通清空，必须用 CDP Runtime.evaluate 直接设置 value
5. 填写正文：点击正文编辑区(.ql-editor)聚焦，browser_type 输入 {{content}}
6. 点击发布按钮
</strategy>
```

#### 3.5.3 Strategy 规则

```
1. 像 Playwright 脚本一样具体——写清每步用什么方法、什么选择器、什么 CDP 命令
2. 标注哪些方法尝试过但失败了（下次直接跳过）
3. 标注动态参数——每次执行可能不同的值用 {{参数名}} 占位符
4. 包含关键的 CSS 选择器、XPath、或 DOM 结构特征
```

### 3.6 大数据量处理优化

当需要从页面抓取大量数据（>20条记录）时：

```
❌ 错误做法：
  browser_eval 返回几千条数据 → tool result → 占满上下文窗口

✅ 正确做法：
  1. browser_eval 收集数据到 JS 变量：
     window.__data = [...收集的数据]

  2. browser_save_file 直接写入本地文件：
     expression: "JSON.stringify(window.__data)"
     filePath: "/Users/xxx/data.json"

  3. 然后用 Bash/Python 处理本地文件

  绝对不要把几百条数据内嵌到 Write/Bash 的参数里
  ——模型需要逐 token 生成几万字符，会卡死十几分钟
```

### 3.7 人工接管机制

```
browser_pause_for_human(reason, instruction)

reason 类型:
├── captcha       ← 验证码
├── login         ← 需要用户真实凭据
├── manual_input  ← 需要用户提供信息
├── payment_confirm ← 支付确认
└── other         ← 其他未知情况

行为：
- Chrome 保持打开，不关闭
- AI 暂停操作
- 用户手动完成需要人工的操作
- 用户说"继续"后 AI 恢复操作
```

### 3.8 browser_eval 常用模式

从系统提示中提取的高效 DOM 操作模式：

```javascript
// 页面基本信息
document.title + ' | ' + location.href

// 所有链接
Array.from(document.querySelectorAll('a'))
  .map(a => ({text: a.textContent.trim(), href: a.href}))
  .filter(a => a.text)

// 页面主要内容
document.querySelector('main, article, .content, #content')?.innerText
  || document.body.innerText.slice(0, 5000)

// 表单字段
Array.from(document.querySelectorAll('input, select, textarea'))
  .map(e => ({tag: e.tagName, type: e.type, name: e.name, id: e.id}))

// 按钮列表
Array.from(document.querySelectorAll('button, [role=button], input[type=submit]'))
  .map(e => ({text: e.textContent.trim(),
              selector: e.id ? '#'+e.id : e.className ? '.'+e.className.split(' ')[0] : e.tagName}))
```

### 3.9 设计亮点

| 设计决策 | 为什么好 |
|----------|----------|
| **真实 Chrome，非无头** | 可以绕过反自动化检测（网站无法区分人工操作和 AI 操作） |
| **Profile 隔离** | AI 操作不影响用户个人浏览器，登录态独立 |
| **CDP 而非 Selenium** | 更底层、更快、更稳定的控制协议 |
| **Workflow 录制与回放** | 重复任务零 token 成本，速度提升 100x |
| **策略提取** | AI 完成任务后自动总结执行路径，下次直接用 |
| **CSS 选择器优先于坐标** | 不怕页面布局变化，维护性好 |
| **DOM 优先于截图** | 截图消耗大量 token，DOM 读取速度快且省 token |
| **大数据管道** | browser_save_file 直接从浏览器写文件，避免 token 溢出 |
| **人工接管设计** | 明确区分"AI 能做的"和"必须人工做的"，不卡死 |
| **参数化模板** | `{{参数名}}` 占位符使 Workflow 可以复用 |

### 3.10 可复现方案

```
核心技术栈：
├── Chrome DevTools Protocol (CDP)
│   ├── puppeteer (Node.js, 推荐)
│   ├── playwright (支持多浏览器)
│   └── chrome-remote-interface (轻量 CDP 客户端)
├── Chrome Profile 管理
│   └── chrome --user-data-dir=/path/to/profile
├── Workflow 引擎
│   ├── 步骤 DSL（JSON/YAML）
│   ├── 参数模板 {{var}}
│   └── 录制/回放控制器
└── MCP 封装
    └── 将 CDP 操作封装为 MCP 工具

最小可行实现：
1. 启动 Chrome 实例：puppeteer.launch({ userDataDir })
2. 暴露 MCP 工具：browser_open/close/click/type/screenshot/eval
3. 实现 Workflow 保存/加载/执行
4. 实现人工接管 hook
```

---

## 四、长期项目系统（Hermes 多智能体引擎）

### 4.1 概述

NewMax 的"长期项目"（UI 层称为"长期放养"）远不止是一个任务看板。在底层，它由 **Hermes 多智能体编排系统**（33 张表）和一个**对话转项目的工具链**支撑。

**双层架构**：
- **UI 层**（newmax.db，16 表）：用户看到和操作的项目/任务/计划
- **引擎层**（hermes-tasks.db，33 表）：智能体编排、协作、执行

### 4.2 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                    用户界面                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │
│  │ 长期放养    │  │ 任务看板    │  │ 项目文件管理       │  │
│  │ 项目列表    │  │ 甘特/列表   │  │ 分屏预览/编辑      │  │
│  └────────────┘  └────────────┘  └────────────────────┘  │
│         │              │                  │               │
│   "拖拽对话      查看进度         AI 生成的产出            │
│    转项目"       调整依赖         文件自动归档"             │
└──────────────────────────────────────────────────────────┘
         ↕ IPC
┌──────────────────────────────────────────────────────────┐
│              Electron Main Process                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │    convert-to-project MCP Server                    │  │
│  │    ├── convert_to_project(title, plan, files)       │  │
│  │    ├── create_tasks(tasks[])                        │  │
│  │    ├── update_task(taskId, ...)                     │  │
│  │    ├── mark_task_done(taskId, outputs[])            │  │
│  │    ├── delete_task(taskId)                          │  │
│  │    ├── list_tasks(status?, date?)                   │  │
│  │    ├── add_dependency(taskId, dependsOn)            │  │
│  │    ├── update_plan_document(content)                │  │
│  │    ├── read_project_file(filePath)                  │  │
│  │    ├── write_project_file(filePath, content)        │  │
│  │    └── list_project_files(path?)                    │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │    scheduled-tasks MCP Server                       │  │
│  │    ├── create_scheduled_task(...)                   │  │
│  │    ├── update_scheduled_task(...)                   │  │
│  │    └── trigger_scheduled_task(...)                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         ↕ SQLite
┌──────────────────────────────────────────────────────────┐
│                 数据存储层                                 │
│  ┌──────────────────┐  ┌──────────────────────────────┐  │
│  │ newmax.db        │  │ hermes-tasks.db (33 tables)   │  │
│  │ ─────────        │  │ ────────────────────────       │  │
│  │ projects         │  │ 智能体定义 (4 tables)          │  │
│  │ project_tasks    │  │ 对话与消息 (3 tables)          │  │
│  │ project_notify   │  │ 执行与运行 (4 tables)          │  │
│  └──────────────────┘  │ 记忆与知识 (3 tables)          │  │
│  ┌──────────────────┐  │ 外部集成 (3 tables)            │  │
│  │ scheduled-       │  │ 联系人/客服 (3 tables)         │  │
│  │ tasks.db         │  │ RBAC 权限 (5 tables)           │  │
│  └──────────────────┘  │ 任务与日志 (2 tables)          │  │
│                        │ 其他 (6 tables)                │  │
│                        └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 4.3 对话转项目流水线

这是 NewMax 最巧妙的**用户意图捕获机制**：

```
1. 用户在对话中说："帮我做一个爬虫监控房价"
   ↓
2. AI 在对话中分析需求、设计方案、编写代码
   ↓
3. 用户觉得值得长期跟进 → 拖拽对话到"长期放养"
   ↓
4. 触发 convert_to_project:
   ├── 提取对话中的目标 → project.md
   ├── 提取对话中的任务 → 拆解为子任务
   ├── 提取对话中的文件 → 归档到 outputs/
   └── 绑定相关 Skills（如 data-analysis）
   ↓
5. 系统自动创建项目、排期、通知
```

#### 4.3.1 `convert_to_project` 工具详解

```typescript
convert_to_project({
  title: string,              // 项目标题（AI 根据对话自动生成）
  plan_document?: string,     // 项目计划文档（Markdown，整理对话中的目标和计划）
  generated_files?: string[]  // 对话中生成的文件路径列表
})

// 调用后：
// - 在 newmax.db 创建 project 记录
// - 创建 project.md（计划文档）
// - 归档文件到 project/outputs/
// - 返回项目 ID，后续可用 create_tasks 添加任务
```

#### 4.3.2 任务管理工具链

```typescript
// 批量创建任务
create_tasks({
  tasks: [{
    title: string,
    description?: string,
    scheduled_date?: string,         // YYYY-MM-DD
    scheduled_time?: string,         // HH:MM（精确到分钟！）
    execution_type?: 'auto' | 'manual',  // 自动执行或人工执行
    estimated_minutes?: number,      // 预估耗时
    priority?: number,               // 优先级
    depends_on_titles?: string[]     // 依赖关系（用标题引用，不用 ID）
  }]
})

// 更新任务
update_task(taskId, { title?, status?, priority?, scheduled_date?, ... })

// 标记完成（带产出文件）
mark_task_done(taskId, { output_files?: string[] })

// 删除任务
delete_task(taskId)

// 查询任务
list_tasks(status?: 'todo'|'in_progress'|'done'|'review', scheduled_date?: string)

// 依赖管理
add_dependency(taskId, depends_on_task_id)
```

#### 4.3.3 项目文件管理

```typescript
// 项目文件操作
list_project_files(path?)      // 列出项目目录内容
read_project_file(filePath)    // 读取文件
write_project_file(filePath, content)  // 创建/覆盖文件
update_plan_document(content)  // 更新 project.md
```

### 4.4 newmax.db 项目相关表

```sql
-- 项目主表
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',  -- active | archived | done
    plan_document TEXT,                      -- Markdown 计划文档
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source_conversation_id TEXT,             -- 来源对话 ID（关键！）
    workspace_id TEXT,
    bound_skills TEXT DEFAULT '[]',          -- 绑定的 Skills（JSON 数组）
    icon TEXT,
    color TEXT
);

-- 项目任务
CREATE TABLE project_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',      -- todo | in_progress | done | review
    priority INTEGER DEFAULT 0,
    scheduled_date TEXT,                      -- YYYY-MM-DD
    scheduled_time TEXT,                      -- HH:MM
    execution_type TEXT DEFAULT 'manual',     -- auto | manual
    estimated_minutes INTEGER,
    actual_minutes INTEGER,
    output_files TEXT DEFAULT '[]',           -- JSON 数组
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 任务依赖
CREATE TABLE task_dependencies (
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    PRIMARY KEY (task_id, depends_on_task_id)
);

-- 项目通知配置（IM 多渠道）
CREATE TABLE project_notify_configs (
    project_id TEXT PRIMARY KEY,
    enable_task_notifications INTEGER NOT NULL DEFAULT 1,
    notification_detail_level TEXT NOT NULL DEFAULT 'brief',  -- brief | detailed
    active_channel_ids TEXT NOT NULL DEFAULT '[]',             -- JSON（微信/飞书/系统通知）
    enable_manual_task_reminder INTEGER NOT NULL DEFAULT 0,
    manual_reminder_channel_ids TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

**关键字段解析**：

| 字段 | 意义 | 产品价值 |
|------|------|----------|
| `source_conversation_id` | 追溯项目来源对话 | 用户可回溯"为什么创建这个项目" |
| `bound_skills` | 项目绑定的 Skills | 项目自动获得特定 AI 能力 |
| `scheduled_time` | 精确到分钟的排期 | 比大多数工具更精确（多数只到天） |
| `execution_type: auto` | 标记 AI 可自动执行 | 区分"需要人工"和"AI 可代劳" |
| `notification_detail_level` | brief vs detailed | brief=仅通知状态变化，detailed=包含执行详情 |
| `active_channel_ids` | 多 IM 渠道通知 | 飞书/微信/系统通知可同时推送 |

### 4.5 Hermes 多智能体引擎

#### 4.5.1 33 表完整分类

```
Hermes 多智能体系统 (33 tables)
│
├── 智能体定义层 (4 tables)
│   ├── agent_types              — 智能体类型模板
│   │   └── 字段: name, description, icon, default_workflow, capabilities[]
│   ├── agent_roles              — 智能体角色实例
│   │   └── 字段: slug, display_name, description
│   ├── agent_capabilities       — 能力标记
│   │   └── 字段: capability_key, display_name, description
│   └── agent_type_members       — 类型成员关系
│       └── 字段: agent_type_id, member_id, role
│
├── 对话与消息层 (3 tables)
│   ├── agent_conversations      — 智能体间对话
│   │   └── 字段: type (group/pair), title, status, created_at
│   ├── agent_messages           — 智能体消息
│   │   └── 字段: role, content, status, reply_to, agent_id
│   └── agent_groups             — 智能体群组
│       └── 字段: name, members[], avatar_seed
│
├── 执行与运行层 (4 tables)
│   ├── agent_runs               — 智能体运行记录
│   │   └── 字段: agent_id, trigger, status, started_at, completed_at
│   ├── agent_workitems          — 工作项队列
│   │   └── 字段: type, payload, status, assigned_agent, priority
│   ├── agent_guidance           — 智能体指导指令
│   │   └── 字段: agent_id, guidance_text, priority, active_until
│   └── agent_confirmations      — 确认/审批节点
│       └── 字段: type, requested_by, status, response
│
├── 记忆与产出层 (3 tables)
│   ├── agent_memories           — 智能体记忆
│   │   └── 字段: agent_id, key, value, importance, ttl
│   ├── agent_memory_grants      — 记忆访问授权
│   │   └── 字段: memory_id, grantee_agent_id, access_level
│   └── agent_artifacts          — 智能体产出物
│       └── 字段: agent_id, run_id, type, file_path, metadata
│
├── 外部集成层 (3 tables)
│   ├── agent_external_channels  — 外部渠道
│   │   └── 字段: channel_type (wechat/feishu/email), config
│   ├── agent_external_conversations — 外部对话
│   │   └── 字段: channel_id, external_user_id, internal_agent_id
│   └── agent_external_messages  — 外部消息
│       └── 字段: direction (inbound/outbound), content, status
│
├── 联系人与客服 (3 tables)
│   ├── agent_contacts           — 联系人
│   ├── agent_customer_service   — 客服服务
│   └── (可能还有更多)
│
├── RBAC 权限层 (5 tables)
│   ├── rbac_agents              — 智能体权限主体
│   ├── rbac_providers           — 权限提供者
│   ├── rbac_agent_grants        — 权限授予记录
│   ├── rbac_grant_requests      — 权限申请
│   └── rbac_revocations         — 权限撤销
│
└── 任务与日志 (2 tables)
    ├── hermes_tasks             — Hermes 任务
    └── hermes_task_logs         — 任务执行日志
```

#### 4.5.2 Hermes 运行模型（推断）

```
1. 触发：用户创建项目 / 定时任务到期 / 外部渠道消息
   ↓
2. 编排器选择一个 Agent 类型（agent_types）
   └── 从 agent_type_members 找到可用 Agent 实例
   ↓
3. 创建 agent_run 记录
   └── 生成 agent_workitems（拆解为工作项）
   └── 注入 agent_guidance（执行指令）
   ↓
4. Agent 之间的协作：
   ├── 创建 agent_conversation（群组对话）
   ├── 发送 agent_message（带着 role 和 reply_to）
   └── 需要确认时 → agent_confirmation（等待审批）
   ↓
5. 记忆管理：
   ├── agent_memories 存储结果
   └── agent_memory_grants 控制谁可以读
   ↓
6. 产出归档：
   └── agent_artifacts 记录产出文件
   ↓
7. 外部通知：
   └── agent_external_messages → IM 渠道推送
```

#### 4.5.3 RBAC 权限模型

即使 AI Agent 之间也需要权限检查：

```
rbac_agents (谁)
  ├── 每个 Agent 有唯一身份
  └── rbac_agent_grants (能做什么)
      ├── 通过 rbac_providers 签发权限
      ├── 通过 rbac_grant_requests 申请新权限
      └── 通过 rbac_revocations 撤销权限

权限控制粒度：
├── 读取：哪些 Agent 可以读我的记忆？
├── 写入：哪些 Agent 可以修改我的产出？
├── 调用：哪些 Agent 可以给我分配任务？
└── 外部：哪些外部渠道可以触发我？
```

### 4.6 定时任务调度

```sql
-- scheduled-tasks.db (简化版 cron)
CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,              -- 要执行的 AI 指令
    scheduled_time TEXT NOT NULL,       -- HH:MM 执行时间
    scheduled_date TEXT,               -- YYYY-MM-DD 特定日期
    repeat_type TEXT NOT NULL DEFAULT 'once',  -- once | daily | weekly | monthly
    repeat_days TEXT,                  -- JSON 数组 ["Mon","Wed","Fri"]
    interval_minutes INTEGER,          -- 间隔分钟（更细粒度调度）
    enabled INTEGER NOT NULL DEFAULT 1,
    enabled_skills TEXT,               -- JSON Skills 列表
    model TEXT,                        -- 指定执行模型
    provider_id TEXT,
    push_to_bot INTEGER NOT NULL DEFAULT 1,  -- IM 推送
    next_execution_at INTEGER,         -- 下次执行时间戳
    last_executed_at INTEGER,
    execution_logs TEXT                -- JSON 执行日志
);
```

### 4.6a 任务执行引擎（60 秒轮询循环）

从逆向代码中恢复的执行逻辑：

```
while (true) {
  await sleep(60_000)  // 60 秒轮询

  // 1. 检查到期的自动执行任务
  const dueTasks = db.all(`
    SELECT * FROM project_tasks
    WHERE execution_type = 'auto'
      AND status = 'todo'
      AND scheduled_date <= date('now')
      AND scheduled_time <= time('now')
    ORDER BY priority DESC, created_at ASC
  `)

  // 2. 过滤：前置依赖未完成的任务跳过
  for (const task of dueTasks) {
    const deps = db.all(
      `SELECT * FROM task_dependencies WHERE task_id = ?`, task.id)
    const blocked = deps.some(d => {
      const dep = db.get(`SELECT status FROM project_tasks WHERE id = ?`,
        d.depends_on_task_id)
      return dep.status !== 'done'
    })
    if (blocked) continue

    // 3. 创建独立对话执行任务
    const execution = db.run(`
      INSERT INTO task_executions (task_id, conversation_id, status, started_at)
      VALUES (?, ?, 'running', unixepoch())
    `, [task.id, newConversationId])

    // 4. 设置 10 分钟超时
    setTimeout(() => {
      if (execution.status === 'running') {
        execution.status = 'timeout'
        execution.finished_at = unixepoch()
        sendNotification(task, 'timeout')
      }
    }, 600_000)

    // 5. AI 在对话中执行 → 完成后 mark_task_done
    //    解锁下游依赖任务
  }
}
```

**关键参数**：
- 轮询间隔：60 秒
- 单任务超时：10 分钟
- 并发：**串行**（单队列，同时只执行一个）
- 失败重试：`max_retries` 次（可配置）
- 执行容器：每个任务一个**独立的新对话**

### 4.6b Agent Role 管理系统

```sql
-- 完整的 agent_roles 表（从实际 SQL 操作还原）
CREATE TABLE agent_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    slug TEXT NOT NULL UNIQUE,
    system_prompt TEXT,         -- 角色系统提示
    tone TEXT,                  -- 语调
    style TEXT,                 -- 风格
    icon TEXT,                  -- 图标
    is_builtin INTEGER,         -- 是否预置
    sort INTEGER,               -- 排序
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

支持完整的 CRUD：`SELECT * FROM agent_roles ORDER BY sort ASC`、`INSERT ... ON CONFLICT(id) DO UPDATE`、`DELETE FROM agent_roles WHERE id = ?`。

### 4.7 通知系统

```
通知分级：
├── 系统通知 (Electron Notification API)
│   └── 即使不在应用中也能收到
├── IM 推送
│   ├── 微信（公众号模板消息）
│   ├── 飞书（机器人消息）
│   └── 其他（通过外部渠道接入）
└── 应用内 Toast
    └── 当前对话页面内轻提示

通知触发场景：
├── 定时任务完成/失败
├── 长期项目任务到期提醒
├── AI 需要用户确认（agent_confirmation）
├── 外部渠道新消息（agent_external_messages）
└── 每日回顾 / 深度分析报告
```

### 4.8 设计亮点

| 设计决策 | 为什么好 |
|----------|----------|
| **对话转项目** | 零摩擦的意图捕获，用户不需要"新建项目→填写描述→添加任务" |
| **双层架构** | UI 层简洁（用户只需理解项目/任务），引擎层强大（33 表编排） |
| **Agent 类型 + 角色分离** | `agent_types` 定义种类，"Code Reviewer"角色定义实例，可组合 |
| **Agent 对话作为协调机制** | 多 Agent 通过结构化对话协调，而非中心化计划器——更灵活 |
| **记忆分为存储和授权** | `agent_memories` + `agent_memory_grants`，访问控制独立于存储 |
| **RBAC 控制一切** | 即使 AI Agent 间交互也有权限检查，安全审计可追溯 |
| **产出物独立管理** | `agent_artifacts` 独立于消息，支持版本化、权限控制 |
| **任务精确到分钟** | `scheduled_time: HH:MM`，比大多数工具更精确 |
| **执行类型标记** | `execution_type: auto/manual`，AI 知道哪些可以自动做 |
| **多 IM 通知渠道** | 飞书/微信/系统通知可同时推送，支持不同详细级别 |
| **依赖用标题引用** | `depends_on_titles` 不用 ID，AI 和人类都能理解 |
| **来源对话追溯** | `source_conversation_id` 让用户知道"我为什么创建这个项目" |

### 4.9 可复现方案

如果要实现类似的长期项目系统，推荐分阶段构建：

```
阶段 1：最小长期项目（1-2 周）
├── projects 表（id, title, description, plan_document, status）
├── project_tasks 表（id, project_id, title, status, priority, scheduled_date）
├── task_dependencies 表
├── convert_to_project MCP 工具（对话转项目）
├── create_tasks / update_task / mark_task_done MCP 工具
└── 简单的任务看板 UI

阶段 2：Hermes 引擎（2-4 周）
├── agent_types / agent_roles（Agent 类型系统）
├── agent_runs / agent_workitems（执行引擎）
├── agent_conversations / agent_messages（Agent 对话）
├── agent_memories（记忆系统）
└── 简单的工作项队列

阶段 3：高级能力（4-8 周）
├── RBAC 权限系统
├── 外部渠道集成（IM 通知）
├── 定时任务调度（cron）
├── 多 Agent 协作编排
└── 产出物管理与版本化

核心技术选型：
├── 数据库：SQLite（与 NewMax 一致）
├── 任务队列：Bull/BullMQ（Redis）或 SQLite 轮询
├── 定时任务：node-cron + 数据库持久化
├── Agent 通信：数据库驱动（Hermes 模式）或消息队列
└── 通知：Electron Notification API + 飞书/微信 Webhook
```

---

## 五、四大模块交互矩阵

四个模块并非孤立存在，它们之间有深度的交叉集成：

```
                     ┌──────────────┐
                     │  长期项目     │
                     │  (Hermes)    │
                     └──────┬───────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
    ┌─────▼──────┐  ┌──────▼──────┐  ┌───────▼──────┐
    │ 浏览器自动化 │  │ 交互可视化   │  │  语音输入     │
    │ (browser)  │  │ (viz)       │  │  (sherpa)    │
    └────────────┘  └─────────────┘  └──────────────┘
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                     ┌──────▼───────┐
                     │  Skill 系统   │
                     │  (52+ Skills)│
                     └──────────────┘

交叉场景举例：

1. 浏览器自动化 + 长期项目：
   项目任务"每天抓取竞品价格" → 定时触发 → browser-use 自动执行 → 结果归档到项目

2. 交互可视化 + 长期项目：
   项目产出数据分析 → AI 生成可视化报告 → 嵌入项目文档 → 定期更新

3. 语音输入 + 长期项目：
   语音说"提醒我明天检查项目进度" → ASR 转录 → 创建项目提醒任务

4. 浏览器自动化 + 交互可视化：
   爬取的实时数据 → browser_save_file 本地 → Python 处理 → 生成可视化仪表盘

5. 语音输入 + 浏览器自动化：
   语音指令"帮我在小红书上搜索..." → ASR → browser-use 自动执行搜索

6. 全部联动：
   长期项目每日回顾 → Hermes 调度 → browser-use 抓取数据 →
   data-analysis Skill 分析 → visualization 展示结果 → 语音读出摘要
```

---

## 六、总结：NewMax 产品力的四个支柱

| 模块 | 核心创新 | 最难复制之处 | 对竞品的降维打击 |
|------|----------|-------------|-----------------|
| **交互可视化** | AI 直接生成可交互 HTML 组件 | Design Token 系统 + UI Kit + 沙箱渲染管道 | Cursor/Copilot 完全没这个能力 |
| **语音输入** | 全离线 10+ 功能语音工具箱 | 原生 ONNX Runtime 集成 + VAD + 声纹 | Whisper API 只能做 ASR，且需联网 |
| **浏览器自动化** | Workflow 录制回放 + 策略提取 | CDP 深度集成 + Profile 隔离 + 人工接管 | Selenium 级别的 AI 操控，且能自学习 |
| **长期项目** | 对话→项目零摩擦转化 + 33 表编排引擎 | Hermes 多智能体 + RBAC + 记忆系统 | GitHub Projects/Linear 是给人用的，Hermes 是给 AI 用的 |

### 如果要做一款类似产品

**必须有的**（基础）：
1. Claude Agent SDK 集成（claude.exe 子进程）
2. Skill 系统（SKILL.md 规范 + 渐进加载）
3. 对话管理（多会话、自动标题、工具调用可视化）

**应该有**（差异化）：
4. 交互可视化（Design Token + UI Kit + 沙箱）
5. 浏览器自动化（CDP + Profile + Workflow）

**锦上添花**（进阶）：
6. 本地语音（sherpa-onnx 全离线）
7. 多智能体编排（Hermes 式 Agent 协作）
8. 对话转长期项目（零摩擦意图捕获）

---

> **报告总结**：NewMax 的这四大模块代表了一种新的产品范式——不是"AI 聊天工具 + 一些附加功能"，而是**以 AI 为操作系统内核、以 Skill 为应用层、以可视化/语音/浏览器/项目为 I/O 通道**的完整工作环境。每一个模块都经过了深思熟虑的架构设计，没有一处是"随便加上去的功能"。
